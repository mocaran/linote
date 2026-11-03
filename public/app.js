(() => {
  'use strict';
  const KEY = 'linote.notes.v1';
  const ACCOUNT_KEY = 'linote.account.v1';
  const MIGRATION_KEY = 'linote.legacy-migrated.v1';
  const INSIGHT_KEY = 'linote.deepseek-key.v1.';
  const $ = id => document.getElementById(id);
  const state = { notes: [], account: null, authMode: 'login', tag: null, reviewIds: null, search: '', sort: 'desc', editing: null, draftTags: [] };
  let toastTimer;

  function normalizeAccount(raw) { return raw.trim().normalize('NFC'); }
  function validAccount(value) { return value && Array.from(value).length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(value); }
  function readAccount() { try { const value = normalizeAccount(localStorage.getItem(ACCOUNT_KEY) || ''); return validAccount(value) ? value : null; } catch { return null; } }

  function readNotes() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value.filter(n => n && typeof n.id === 'string' && typeof n.body === 'string').map(n => ({ ...n, tags: Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string') : [] })) : [];
    } catch { return []; }
  }
  async function api(method, payload, id) {
    if (!state.account) throw new Error('请先登录');
    const headers = {};
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/notes' + (id ? '?id=' + encodeURIComponent(id) : ''), {method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), cache:'no-store',credentials:'same-origin'});
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '同步失败');
    return response.json();
  }
  async function loadFromAccount() {
    if (!state.account) return;
    const account = state.account;
    try {
      if (localStorage.getItem(MIGRATION_KEY + '.' + account) !== 'done') {
        const migrated = await fetch('/api/notes/migrate-legacy', {method:'POST',cache:'no-store',credentials:'same-origin'});
        if (migrated.ok) {
          const result = await migrated.json();
          if (result.available) localStorage.setItem(MIGRATION_KEY + '.' + account, 'done');
        }
      }
      const oldNotes = readAccount() === account ? readNotes() : [];
      if (oldNotes.length) await api('PUT', oldNotes);
      const data = await api('GET');
      if (state.account !== account) return;
      state.notes = data.notes;
      if (oldNotes.length) localStorage.removeItem(KEY);
      render();
      if (oldNotes.length) toast('旧笔记已导入账号');
    } catch (error) { toast(error.message || '笔记同步失败，请刷新重试'); }
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function tagCounts() {
    const counts = new Map();
    state.notes.forEach(note => new Set(note.tags).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return counts;
  }
  function sortedTags() {
    const tags = [...tagCounts()];
    tags.sort((a, b) => state.sort === 'desc' ? b[1] - a[1] || a[0].localeCompare(b[0], 'zh') : a[1] - b[1] || a[0].localeCompare(b[0], 'zh'));
    return tags;
  }
  function setTag(tag) {
    state.tag = tag;
    state.reviewIds = null;
    $('searchInput').value = '';
    state.search = '';
    closeSidebar();
    render();
  }
  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  function renderSidebar() {
    $('allCount').textContent = state.notes.length;
    $('allNotes').classList.toggle('active', state.tag === null && state.reviewIds === null);
    $('reviewNotes').classList.toggle('active', state.reviewIds !== null);
    $('sortButton').textContent = state.sort === 'desc' ? '笔记数 ↓' : '笔记数 ↑';
    const list = $('topicList'); list.replaceChildren();
    const tags = sortedTags();
    $('topicHint').hidden = tags.length > 0;
    tags.forEach(([tag, count]) => {
      const button = el('button', 'topic-item' + (state.tag === tag ? ' active' : ''));
      button.type = 'button'; button.title = '#' + tag;
      button.append(el('span', 'hash', '#'), el('span', 'topic-name', tag.replaceAll('/', ' / ')), el('span', 'topic-count', String(count)));
      button.addEventListener('click', () => setTag(tag));
      list.append(button);
    });
    renderCalendar();
  }
  function dayKey(date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
  function renderCalendar() {
    const counts = new Map();
    state.notes.forEach(n => { const d = new Date(n.createdAt); if (!isNaN(d.getTime())) { const key = dayKey(d); counts.set(key, (counts.get(key)||0)+1); } });
    const today = new Date();
    $('todayCount').textContent = '今日 ' + (counts.get(dayKey(today)) || 0) + ' 条';
    $('totalStats').textContent = '共 ' + state.notes.length + ' 条笔记';
    const box = $('miniCalendar'); box.replaceChildren();
    for (let offset=34; offset>=0; offset--) {
      const date = new Date(today.getFullYear(),today.getMonth(),today.getDate()-offset);
      const count = counts.get(dayKey(date)) || 0;
      const cell = el('button','calendar-cell level-' + Math.min(count,4));
      cell.type = 'button';
      cell.title = dayKey(date) + ' · ' + count + ' 条笔记';
      cell.setAttribute('aria-label',cell.title);
      cell.addEventListener('click', () => { $('calendarDayDetail').textContent = cell.title; });
      box.append(cell);
    }
  }
  function filteredNotes() {
    if (state.reviewIds !== null) return state.reviewIds.map(id => state.notes.find(n => n.id === id)).filter(Boolean);
    const q = state.search.trim().toLocaleLowerCase();
    return state.notes.filter(n => (!state.tag || n.tags.includes(state.tag)) && (!q || n.body.toLocaleLowerCase().includes(q) || n.tags.some(t => t.toLocaleLowerCase().includes(q)))).sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }
  function renderNotes() {
    const notes = filteredNotes();
    const title = state.reviewIds !== null ? '回顾' : state.tag ? '#' + state.tag : '全部笔记';
    $('pageTitle').textContent = title;
    $('resultCount').textContent = notes.length + ' 条笔记';
    $('filterLabel').textContent = state.reviewIds !== null ? '从全部笔记中随机抽取' : state.search ? '搜索结果' : '按最近编辑排序';
    $('reviewAgain').hidden = state.reviewIds === null;
    $('clearFilter').hidden = !state.tag && !state.search && state.reviewIds === null;
    $('clearFilter').textContent = state.reviewIds !== null ? '退出回顾 ×' : '清除筛选 ×';
    const list = $('notes'); list.replaceChildren();
    notes.forEach(note => {
      const card = el('article', 'note');
      const top = el('div', 'note-top');
      top.append(el('time', '', formatDate(note.createdAt)));
      const actions = el('div', 'note-actions');
      const edit = el('button', '', '编辑'); edit.type = 'button'; edit.setAttribute('aria-label', '编辑笔记'); edit.addEventListener('click', () => openEditor(note.id));
      const remove = el('button', '', '删除'); remove.type = 'button'; remove.setAttribute('aria-label', '删除笔记'); remove.addEventListener('click', () => deleteNote(note.id));
      actions.append(edit, remove); top.append(actions); card.append(top, el('div', 'note-body', note.body));
      if (note.tags.length) {
        const tags = el('div', 'note-tags');
        note.tags.forEach(tag => { const chip = el('button', '', '#' + tag); chip.type = 'button'; chip.addEventListener('click', () => setTag(tag)); tags.append(chip); });
        card.append(tags);
      }
      list.append(card);
    });
    $('empty').hidden = notes.length > 0;
    $('emptyNew').textContent = state.search || state.reviewIds !== null ? '查看全部笔记 ↗' : '写一条笔记 ↗';
  }
  function render() { renderSidebar(); renderNotes(); }
  function chooseReview() {
    const ids = state.notes.map(n => n.id);
    const previous = state.reviewIds;
    for (let i=ids.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [ids[i],ids[j]]=[ids[j],ids[i]]; }
    let next = ids.slice(0,10);
    if (previous && ids.length > 10 && previous.length === 10 && next.every(id => previous.includes(id))) {
      const outside = ids.find(id => !previous.includes(id));
      if (outside) next[9] = outside;
    } else if (previous && next.length > 1 && next.every((id,i) => id === previous[i])) next = [...next.slice(1),next[0]];
    state.reviewIds = next;
    state.tag = null; state.search = ''; $('searchInput').value = '';
    closeSidebar(); render();
  }
  function normalizeTag(raw) { return raw.trim().replace(/^#+/, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').replace(/^\/|\/$/g, '').slice(0,60); }
  function addTag(raw) {
    const tag = normalizeTag(raw);
    if (tag && !state.draftTags.some(t => t.toLocaleLowerCase() === tag.toLocaleLowerCase())) state.draftTags.push(tag);
    $('tagInput').value = '';
    renderDraftTags(); renderSuggestions();
  }
  function renderDraftTags() {
    const container = $('selectedTags'); container.replaceChildren();
    state.draftTags.forEach(tag => {
      const chip = el('span', 'selected-tag', '#' + tag);
      const remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '移除话题 ' + tag);
      remove.addEventListener('click', () => { state.draftTags = state.draftTags.filter(t => t !== tag); renderDraftTags(); renderSuggestions(); });
      chip.append(remove); container.append(chip);
    });
  }
  function renderSuggestions() {
    const input = $('tagInput').value.trim().replace(/^#/, '').toLocaleLowerCase();
    const matches = [...tagCounts().keys()].filter(t => !state.draftTags.includes(t) && (!input || t.toLocaleLowerCase().includes(input))).slice(0,6);
    const box = $('tagSuggestions'); box.replaceChildren();
    box.hidden = !input || matches.length === 0;
    matches.forEach(tag => { const b = el('button', '', '#' + tag); b.type = 'button'; b.addEventListener('click', () => { addTag(tag); $('tagInput').focus(); }); box.append(b); });
  }
  function openEditor(id = null) {
    state.editing = id;
    const note = state.notes.find(n => n.id === id);
    state.draftTags = note ? [...note.tags] : (state.tag ? [state.tag] : []);
    $('editorTitle').textContent = note ? '编辑笔记' : '写一条笔记';
    $('noteBody').value = note?.body || '';
    $('tagInput').value = '';
    renderDraftTags(); renderSuggestions();
    $('modalLayer').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('noteBody').focus(), 0);
  }
  function closeEditor() { $('modalLayer').hidden = true; document.body.style.overflow = ''; state.editing = null; }
  async function deleteNote(id) {
    if (!confirm('确定删除这条笔记吗？')) return;
    try { await api('DELETE', undefined, id); } catch (error) { toast(error.message || '删除失败'); return; }
    state.notes = state.notes.filter(n => n.id !== id);
    if (state.reviewIds) state.reviewIds = state.reviewIds.filter(noteId => noteId !== id);
    if (state.tag && !tagCounts().has(state.tag)) state.tag = null;
    render(); toast('笔记已删除');
  }
  async function saveNote(event) {
    event.preventDefault();
    const body = $('noteBody').value.trim();
    if (!body) { $('noteBody').focus(); return; }
    if ($('tagInput').value.trim()) addTag($('tagInput').value);
    const now = new Date().toISOString();
    let note;
    if (state.editing) {
      const existing = state.notes.find(n => n.id === state.editing);
      if (!existing) return;
      note = { ...existing, body, tags:[...state.draftTags], updatedAt:now };
    } else note = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), body, tags: [...state.draftTags], createdAt: now, updatedAt: now };
    $('saveNote').disabled = true;
    try { await api('POST', note); } catch (error) { $('saveNote').disabled = false; toast(error.message || '保存失败'); return; }
    $('saveNote').disabled = false;
    state.notes = [note, ...state.notes.filter(n => n.id !== note.id)];
    state.reviewIds = null;
    closeEditor(); render(); toast('笔记已保存');
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify({ app:'linote', exportedAt:new Date().toISOString(), notes:state.notes }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'linote-' + new Date().toISOString().slice(0,10) + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  ['newNoteSidebar','newNoteTop','emptyNew'].forEach(id => $(id).addEventListener('click', () => { if (id === 'emptyNew' && (state.search || state.reviewIds !== null)) { state.search = ''; state.reviewIds = null; $('searchInput').value = ''; render(); } else openEditor(); }));
  $('allNotes').addEventListener('click', () => setTag(null));
  $('reviewNotes').addEventListener('click', chooseReview);
  $('reviewAgain').addEventListener('click', chooseReview);
  $('sortButton').addEventListener('click', () => { state.sort = state.sort === 'desc' ? 'asc' : 'desc'; renderSidebar(); });
  $('searchInput').addEventListener('input', e => { state.reviewIds = null; state.search = e.target.value; render(); });
  $('clearFilter').addEventListener('click', () => { state.tag = null; state.reviewIds = null; state.search = ''; $('searchInput').value = ''; render(); });
  $('calendarToggle').addEventListener('click', () => { const open = $('calendarPanel').hidden; $('calendarPanel').hidden = !open; $('calendarToggle').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', e => { if (!$('calendarPanel').hidden && !$('calendarPanel').contains(e.target) && !$('calendarToggle').contains(e.target)) { $('calendarPanel').hidden = true; $('calendarToggle').setAttribute('aria-expanded','false'); } });
  function insightStorageKey() { return INSIGHT_KEY + encodeURIComponent(state.account || ''); }
  function readInsightKey() { try { return localStorage.getItem(insightStorageKey()) || ''; } catch { return ''; } }
  function showInsightPanel(name) {
    ['insightHome','insightKeyPanel','insightResult','insightHistory'].forEach(id => { $(id).hidden = id !== name; });
    $('insightMessage').textContent = '';
  }
  function refreshInsightScope() {
    const select = $('insightScope'); const current = select.value; select.replaceChildren();
    select.append(new Option('全部笔记', ''));
    sortedTags().forEach(([tag,count]) => select.append(new Option('#' + tag + ' · ' + count + ' 条', tag)));
    select.value = [...select.options].some(option => option.value === current) ? current : '';
    refreshInsightCount();
  }
  function refreshInsightCount() {
    const tag = $('insightScope').value;
    const count = tag ? state.notes.filter(note => note.tags.includes(tag)).length : state.notes.length;
    $('insightCount').textContent = count + ' 条笔记';
  }
  function openInsight() {
    if (!state.account) { openAccount(); return; }
    refreshInsightScope(); showInsightPanel('insightHome'); $('insightLayer').hidden = false;
    document.body.style.overflow = 'hidden'; closeSidebar();
  }
  function closeInsight() { $('insightLayer').hidden = true; document.body.style.overflow = ''; }
  function showInsightResult(insight) {
    showInsightPanel('insightResult');
    $('insightResultTitle').textContent = insight.title;
    $('insightResultMeta').textContent = insight.scope + ' · ' + insight.noteCount + ' 条笔记 · ' + formatDate(insight.createdAt);
    $('insightResultBody').textContent = insight.content;
  }
  async function startInsight(mode) {
    const key = readInsightKey();
    if (!key) { showInsightPanel('insightKeyPanel'); $('insightMessage').textContent = '先设置 DeepSeek API 密钥'; return; }
    const customPrompt = mode === 'custom' ? $('insightCustomPrompt').value.trim() : '';
    if (mode === 'custom' && !customPrompt) { $('insightMessage').textContent = '请先输入自定义视角'; return; }
    const scopeTag = $('insightScope').value;
    if (!state.notes.some(note => !scopeTag || note.tags.includes(scopeTag))) { $('insightMessage').textContent = '所选范围内还没有笔记'; return; }
    $('insightMessage').textContent = '正在阅读笔记并生成洞察…';
    $('insightLayer').querySelectorAll('.insight-card,#insightCustomStart').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key,mode,customPrompt,scopeTag}),credentials:'same-origin'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '洞察失败');
      showInsightResult(data.insight);
    } catch (error) { $('insightMessage').textContent = error.message || '洞察失败，请稍后重试'; }
    finally { $('insightLayer').querySelectorAll('.insight-card,#insightCustomStart').forEach(button => { button.disabled = false; }); }
  }
  async function showInsightHistory() {
    showInsightPanel('insightHistory'); $('insightHistoryList').textContent = '正在读取…';
    try {
      const response = await fetch('/api/insights',{credentials:'same-origin',cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取失败');
      const list = $('insightHistoryList'); list.replaceChildren();
      if (!data.insights.length) { list.textContent = '还没有洞察记录'; return; }
      data.insights.forEach(insight => {
        const button = el('button','insight-history-item'); button.type = 'button';
        button.append(el('strong','',insight.title),el('span','',insight.scope + ' · ' + insight.noteCount + ' 条 · ' + formatDate(insight.createdAt)));
        button.addEventListener('click',() => showInsightResult(insight)); list.append(button);
      });
    } catch(error) { $('insightHistoryList').textContent = error.message || '读取失败'; }
  }
  $('insightButton').addEventListener('click',openInsight);
  $('insightClose').addEventListener('click',closeInsight);
  $('insightBackdrop').addEventListener('click',closeInsight);
  $('insightScope').addEventListener('change',refreshInsightCount);
  $('insightLayer').querySelectorAll('.insight-card').forEach(button => button.addEventListener('click',() => startInsight(button.dataset.mode)));
  $('insightCustomStart').addEventListener('click',() => startInsight('custom'));
  $('insightSettingsButton').addEventListener('click',() => { $('insightKeyInput').value = readInsightKey(); showInsightPanel('insightKeyPanel'); });
  $('insightKeyBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightKeySave').addEventListener('click',() => {
    const key = $('insightKeyInput').value.trim();
    if (!key || key.length > 300) { $('insightMessage').textContent = '请输入有效的 DeepSeek API 密钥'; return; }
    try { localStorage.setItem(insightStorageKey(),key); showInsightPanel('insightHome'); toast('密钥已保存在当前浏览器'); }
    catch { $('insightMessage').textContent = '当前浏览器无法保存密钥'; }
  });
  $('insightKeyClear').addEventListener('click',() => { try { localStorage.removeItem(insightStorageKey()); } catch {} $('insightKeyInput').value = ''; $('insightMessage').textContent = '密钥已清除'; });
  $('insightResultBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightHistoryBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightHistoryButton').addEventListener('click',showInsightHistory);
  function setAuthMode(mode) {
    state.authMode = mode;
    $('authLoginTab').classList.toggle('active', mode === 'login');
    $('authRegisterTab').classList.toggle('active', mode === 'register');
    $('authSubmit').textContent = mode === 'register' ? '创建账号并进入' : '登录';
    $('accountTitle').textContent = mode === 'register' ? '创建 linote 账号' : '登录 linote';
    $('passwordInput').autoComplete = mode === 'register' ? 'new-password' : 'current-password';
    $('accountError').textContent = '';
  }
  function openAccount() { $('accountInput').value = state.account || readAccount() || ''; $('passwordInput').value = ''; setAuthMode('login'); $('accountLayer').hidden = false; setTimeout(() => $('accountInput').focus(),0); }
  $('authLoginTab').addEventListener('click', () => setAuthMode('login'));
  $('authRegisterTab').addEventListener('click', () => setAuthMode('register'));
  $('switchAccount').addEventListener('click', async () => {
    try { await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'}),credentials:'same-origin'}); } catch {}
    state.account = null; state.notes = []; state.tag = null; state.reviewIds = null; state.search = ''; $('searchInput').value = ''; $('accountName').textContent = '未登录'; render(); closeSidebar(); openAccount();
  });
  $('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    const account = normalizeAccount($('accountInput').value);
    const password = $('passwordInput').value;
    if (!validAccount(account) || password.length < 8 || password.length > 128) { $('accountError').textContent = '账号需为 1 至 32 个字符，密码至少 8 位'; return; }
    $('authSubmit').disabled = true;
    try {
      const response = await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:state.authMode,username:account,password}),credentials:'same-origin'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '登录失败');
    } catch (error) { $('authSubmit').disabled = false; $('accountError').textContent = error.message || '登录失败'; return; }
    $('authSubmit').disabled = false;
    state.account = account; state.notes = []; state.tag = null; state.reviewIds = null; state.search = ''; $('searchInput').value = '';
    $('accountName').textContent = account;
    $('accountLayer').hidden = true;
    closeSidebar(); render(); await loadFromAccount();
    localStorage.setItem(ACCOUNT_KEY, account);
  });
  function openSidebar() { $('sidebar').classList.add('open'); $('mobileShade').hidden = false; }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('mobileShade').hidden = true; }
  $('mobileMenu').addEventListener('click', () => $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar());
  $('mobileShade').addEventListener('click', closeSidebar);
  let touchStartX = null;
  $('sidebar').addEventListener('touchstart', e => { touchStartX = e.touches[0]?.clientX ?? null; }, {passive:true});
  $('sidebar').addEventListener('touchend', e => { if (touchStartX !== null && touchStartX - (e.changedTouches[0]?.clientX ?? touchStartX) > 65) closeSidebar(); touchStartX = null; }, {passive:true});
  let pointerStart = null;
  $('sidebar').addEventListener('pointerdown', e => { pointerStart = {x:e.clientX,y:e.clientY}; });
  $('sidebar').addEventListener('pointerup', e => { if (pointerStart && pointerStart.x-e.clientX > 65 && Math.abs(pointerStart.x-e.clientX) > Math.abs(pointerStart.y-e.clientY)) closeSidebar(); pointerStart = null; });
  $('closeEditor').addEventListener('click', closeEditor);
  $('cancelEditor').addEventListener('click', closeEditor);
  $('modalBackdrop').addEventListener('click', closeEditor);
  $('noteForm').addEventListener('submit', saveNote);
  $('tagInput').addEventListener('input', renderSuggestions);
  $('tagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); }
    if (e.key === 'Backspace' && !e.target.value && state.draftTags.length) { state.draftTags.pop(); renderDraftTags(); }
  });
  $('exportButton').addEventListener('click', exportNotes);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('insightLayer').hidden) closeInsight(); else if (!$('modalLayer').hidden) closeEditor(); else closeSidebar(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchInput').focus(); }
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && $('modalLayer').hidden && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openEditor(); }
  });
  render();
  fetch('/api/auth',{cache:'no-store',credentials:'same-origin'}).then(async response => {
    if (!response.ok) throw new Error('未登录');
    const user = await response.json();
    state.account = user.username; $('accountName').textContent = user.username; localStorage.setItem(ACCOUNT_KEY,user.username); await loadFromAccount();
  }).catch(openAccount);
})();
