(() => {
  'use strict';
  const KEY = 'linote.notes.v1';
  const ACCOUNT_KEY = 'linote.account.v1';
  const MIGRATION_KEY = 'linote.legacy-migrated.v1';
  const INSIGHT_KEY = 'linote.deepseek-key.v1.';
  const $ = id => document.getElementById(id);
  const state = { notes: [], account: null, authMode: 'login', tag: null, reviewIds: null, search: '', sort: 'desc', editing: null, draftTags: [], insightHasKey: false };
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
      await syncInsightKey();
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
    if (!state.account) { openAccount(); return; }
    const link = document.createElement('a');
    link.href = '/api/notes/export'; link.download = 'linote-' + new Date().toISOString().slice(0,10) + '.json'; link.click();
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
  async function insightKeyApi(method, payload) {
    const response = await fetch('/api/insight-key',{method,headers:payload ? {'Content-Type':'application/json'} : {},body:payload ? JSON.stringify(payload) : undefined,credentials:'same-origin',cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '密钥同步失败');
    return data;
  }
  async function syncInsightKey() {
    let data = await insightKeyApi('GET');
    let localKey = '';
    try { localKey = localStorage.getItem(insightStorageKey()) || ''; } catch {}
    if (localKey) {
      try { data = await insightKeyApi('PUT',{apiKey:localKey,ifMissing:true}); localStorage.removeItem(insightStorageKey()); }
      catch (error) { toast(error.message || '旧密钥迁移失败'); }
    }
    state.insightHasKey = Boolean(data.hasKey);
  }
  function showInsightPanel(name) {
    ['insightHome','insightRangePanel','insightKeyPanel','insightResult','insightHistory'].forEach(id => { $(id).hidden = id !== name; });
    $('insightMessage').textContent = '';
  }
  function refreshInsightScope() {
    const select = $('insightScope'); const current = select.value; select.replaceChildren();
    select.append(new Option('全部话题', ''));
    sortedTags().forEach(([tag,count]) => select.append(new Option('#' + tag + ' · ' + count + ' 条', tag)));
    select.value = [...select.options].some(option => option.value === current) ? current : '';
    refreshInsightCount();
  }
  function refreshInsightCount() {
    const tag = $('insightScope').value;
    const bounds = insightDateBounds();
    const count = state.notes.filter(note => { const time=Date.parse(note.createdAt); return (!tag || note.tags.includes(tag)) && (!bounds.startDate || time >= Date.parse(bounds.startDate)) && (!bounds.endDate || time < Date.parse(bounds.endDate)); }).length;
    $('insightCount').textContent = count + ' 条笔记';
    $('insightRangeSummary').textContent = bounds.label + ' · ' + (tag ? '#' + tag : '全部话题');
  }
  function insightDateBounds() {
    const preset = $('insightDatePreset').value;
    if (preset === 'all') return {startDate:'',endDate:'',label:'不限日期'};
    const today = new Date();
    let start, end = new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
    if (preset === 'last7') start = new Date(today.getFullYear(),today.getMonth(),today.getDate()-6);
    else if (preset === 'week') start = new Date(today.getFullYear(),today.getMonth(),today.getDate() - ((today.getDay()+6)%7));
    else if (preset === 'month') start = new Date(today.getFullYear(),today.getMonth(),1);
    else {
      const from = $('insightStartDate').value, to = $('insightEndDate').value;
      start = from ? new Date(from+'T00:00:00') : null;
      end = to ? new Date(to+'T00:00:00') : null;
      if (end) end.setDate(end.getDate()+1);
      return {startDate:start?.toISOString() || '',endDate:end?.toISOString() || '',label:from || to ? (from || '不限') + ' 至 ' + (to || '不限') : '自定义日期'};
    }
    return {startDate:start.toISOString(),endDate:end.toISOString(),label:{last7:'最近 7 天',week:'本周',month:'本月'}[preset]};
  }
  async function openInsight() {
    if (!state.account) { openAccount(); return; }
    refreshInsightScope(); showInsightPanel('insightHome'); $('insightLayer').hidden = false;
    document.body.style.overflow = 'hidden'; closeSidebar();
    try { await syncInsightKey(); } catch (error) { $('insightMessage').textContent = error.message || '密钥同步失败'; }
  }
  function closeInsight() { $('insightLayer').hidden = true; document.body.style.overflow = ''; }
  function showInsightResult(insight) {
    showInsightPanel('insightResult');
    $('insightResultTitle').textContent = insight.title;
    $('insightResultMeta').textContent = insight.scope + ' · ' + insight.noteCount + ' 条笔记 · ' + formatDate(insight.createdAt);
    $('insightResultBody').textContent = insight.content;
  }
  async function startInsight(mode) {
    if (!state.insightHasKey) { showInsightPanel('insightKeyPanel'); $('insightMessage').textContent = '先设置 DeepSeek API 密钥'; return; }
    const customPrompt = mode === 'custom' ? $('insightCustomPrompt').value.trim() : '';
    if (mode === 'custom' && !customPrompt) { $('insightMessage').textContent = '请先输入自定义视角'; return; }
    const scopeTag = $('insightScope').value;
    const bounds = insightDateBounds();
    if (!state.notes.some(note => { const time=Date.parse(note.createdAt); return (!scopeTag || note.tags.includes(scopeTag)) && (!bounds.startDate || time >= Date.parse(bounds.startDate)) && (!bounds.endDate || time < Date.parse(bounds.endDate)); })) { $('insightMessage').textContent = '所选范围内还没有笔记'; return; }
    $('insightMessage').textContent = '正在阅读笔记并生成洞察…';
    $('insightLayer').querySelectorAll('.insight-card,#insightCustomStart').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,customPrompt,scopeTag,...bounds,rangeLabel:bounds.label}),credentials:'same-origin'});
      const data = await response.json().catch(() => ({}));
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
  $('insightRangeButton').addEventListener('click',() => showInsightPanel('insightRangePanel'));
  $('insightRangeBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightRangeApply').addEventListener('click',() => { const bounds=insightDateBounds(); if (bounds.startDate && bounds.endDate && bounds.startDate >= bounds.endDate) { $('insightMessage').textContent='结束日期需晚于开始日期'; return; } refreshInsightCount(); showInsightPanel('insightHome'); });
  $('insightDatePreset').addEventListener('change',() => { $('insightCustomDates').hidden=$('insightDatePreset').value !== 'custom'; refreshInsightCount(); });
  ['insightStartDate','insightEndDate'].forEach(id => $(id).addEventListener('change',refreshInsightCount));
  $('insightLayer').querySelectorAll('.insight-card').forEach(button => button.addEventListener('click',() => startInsight(button.dataset.mode)));
  $('insightCustomStart').addEventListener('click',() => startInsight('custom'));
  $('insightSettingsButton').addEventListener('click',() => { $('insightKeyInput').value = ''; $('insightKeyInput').placeholder = state.insightHasKey ? '已设置密钥；输入新密钥可替换' : '粘贴 DeepSeek API 密钥'; showInsightPanel('insightKeyPanel'); });
  $('insightKeyBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightKeySave').addEventListener('click',async () => {
    const key = $('insightKeyInput').value.trim();
    if (!key || key.length > 300) { $('insightMessage').textContent = '请输入有效的 DeepSeek API 密钥'; return; }
    try { await insightKeyApi('PUT',{apiKey:key}); state.insightHasKey=true; $('insightKeyInput').value=''; showInsightPanel('insightHome'); toast('密钥已保存到账号'); }
    catch (error) { $('insightMessage').textContent = error.message || '保存失败'; }
  });
  $('insightKeyClear').addEventListener('click',async () => { try { await insightKeyApi('DELETE'); state.insightHasKey=false; $('insightKeyInput').value = ''; $('insightMessage').textContent = '密钥已清除'; } catch (error) { $('insightMessage').textContent = error.message || '清除失败'; } });
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
    if (!validAccount(account)) { $('accountError').textContent = '账号需为 1 至 32 个字符'; return; }
    $('authSubmit').disabled = true;
    try {
      const response = await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:state.authMode,username:account,password}),credentials:'same-origin'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '服务暂时不可用，请稍后再试');
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
