(() => {
  'use strict';
  const KEY = 'linote.notes.v1';
  const $ = id => document.getElementById(id);
  const state = { notes: readNotes(), tag: null, search: '', sort: 'desc', editing: null, draftTags: [] };
  let toastTimer;

  function readNotes() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value.filter(n => n && typeof n.id === 'string' && typeof n.body === 'string').map(n => ({ ...n, tags: Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string') : [] })) : [];
    } catch { return []; }
  }
  async function api(method, payload, id) {
    const response = await fetch('/api/notes' + (id ? '?id=' + encodeURIComponent(id) : ''), {method, headers: payload === undefined ? {} : {'Content-Type':'application/json'}, body: payload === undefined ? undefined : JSON.stringify(payload), cache:'no-store'});
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '同步失败');
    return response.json();
  }
  async function loadFromAccount() {
    try {
      const oldNotes = readNotes();
      if (oldNotes.length) await api('PUT', oldNotes);
      const data = await api('GET');
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
    $('allNotes').classList.toggle('active', state.tag === null);
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
      const cell = el('span','calendar-cell level-' + Math.min(count,4));
      cell.title = dayKey(date) + ' · ' + count + ' 条笔记';
      cell.setAttribute('aria-label',cell.title);
      box.append(cell);
    }
  }
  function filteredNotes() {
    const q = state.search.trim().toLocaleLowerCase();
    return state.notes.filter(n => (!state.tag || n.tags.includes(state.tag)) && (!q || n.body.toLocaleLowerCase().includes(q) || n.tags.some(t => t.toLocaleLowerCase().includes(q)))).sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }
  function renderNotes() {
    const notes = filteredNotes();
    const title = state.tag ? '#' + state.tag : '全部笔记';
    $('pageTitle').textContent = title;
    $('resultCount').textContent = notes.length + ' 条笔记';
    $('filterLabel').textContent = state.search ? '搜索结果' : '按最近编辑排序';
    $('clearFilter').hidden = !state.tag && !state.search;
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
    $('emptyTitle').textContent = state.search ? '没有找到匹配的笔记' : state.tag ? '这个话题还没有笔记' : '从一条笔记开始';
    $('emptyText').textContent = state.search ? '试试其他关键词或清除筛选。' : state.tag ? '写下新想法，并添加这个话题。' : '把稍纵即逝的想法留在这里。';
    $('emptyNew').textContent = state.search ? '清除搜索 ↗' : '写一条笔记 ↗';
  }
  function render() { renderSidebar(); renderNotes(); }
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
    closeEditor(); render(); toast('笔记已保存');
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify({ app:'linote', exportedAt:new Date().toISOString(), notes:state.notes }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'linote-' + new Date().toISOString().slice(0,10) + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  ['newNoteSidebar','newNoteTop','emptyNew'].forEach(id => $(id).addEventListener('click', () => { if (id === 'emptyNew' && state.search) { state.search = ''; $('searchInput').value = ''; render(); } else openEditor(); }));
  $('allNotes').addEventListener('click', () => setTag(null));
  $('sortButton').addEventListener('click', () => { state.sort = state.sort === 'desc' ? 'asc' : 'desc'; renderSidebar(); });
  $('searchInput').addEventListener('input', e => { state.search = e.target.value; renderNotes(); });
  $('clearFilter').addEventListener('click', () => { state.tag = null; state.search = ''; $('searchInput').value = ''; render(); });
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
    if (e.key === 'Escape') { if (!$('modalLayer').hidden) closeEditor(); else closeSidebar(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchInput').focus(); }
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && $('modalLayer').hidden && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openEditor(); }
  });
  render();
  loadFromAccount();
})();
