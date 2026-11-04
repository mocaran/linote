(() => {
  'use strict';
  document.body.classList.toggle('linote-android', /LinoteAndroid\/\d+/.test(navigator.userAgent));
  const KEY = 'linote.notes.v1';
  const ACCOUNT_KEY = 'linote.account.v1';
  const MIGRATION_KEY = 'linote.legacy-migrated.v1';
  const INSIGHT_KEY = 'linote.deepseek-key.v1.';
  const DRAFT_KEY = 'linote.drafts.v1.';
  const OFFLINE_DB = 'linote-offline-v1';
  const $ = id => document.getElementById(id);
  const state = { notes: [], account: null, authMode: 'login', tag: null, reviewIds: null, search: '', sort: 'desc', editing: null, draftTags: [], draftImages: [], insightHasKey: false, chatMessages: [], chatScope: '' };
  let toastTimer;

  function normalizeAccount(raw) { return raw.trim().normalize('NFC'); }
  function validAccount(value) { return value && Array.from(value).length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(value); }
  function readAccount() { try { const value = normalizeAccount(localStorage.getItem(ACCOUNT_KEY) || ''); return validAccount(value) ? value : null; } catch { return null; } }
  async function rememberedAccount() {
    const local = readAccount();
    if (local) return local;
    try {
      const last = await offlineRecord('last-account');
      if (last === '') return null;
      if (typeof last === 'string' && validAccount(last)) return last;
      const db = await offlineDatabase();
      const keys = await new Promise((resolve,reject) => { const request=db.transaction('records').objectStore('records').getAllKeys(); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
      db.close();
      const accounts = keys.filter(key => typeof key === 'string' && key.startsWith('notes:'));
      if (accounts.length === 1) return decodeURIComponent(accounts[0].slice(6));
    } catch {}
    return null;
  }
  async function rememberAccount(account) {
    try { localStorage.setItem(ACCOUNT_KEY,account); } catch {}
    try { await offlineRecord('last-account',account); } catch {}
  }
  function offlineKey(kind, account = state.account) { return kind + ':' + encodeURIComponent(account || ''); }
  function offlineDatabase() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open(OFFLINE_DB,1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function offlineRecord(key, value) {
    const db = await offlineDatabase();
    try { return await new Promise((resolve,reject) => {
      const transaction = db.transaction('records',value === undefined ? 'readonly' : 'readwrite');
      const request = value === undefined ? transaction.objectStore('records').get(key) : transaction.objectStore('records').put(value,key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  }
  async function cachedNotes(account = state.account) { try { return await offlineRecord(offlineKey('notes',account)) || []; } catch { return []; } }
  async function cacheNotes() { await offlineRecord(offlineKey('notes'),state.notes); }
  async function pendingChanges(account = state.account) { try { return await offlineRecord(offlineKey('pending',account)) || []; } catch { return []; } }
  async function queueChange(change) {
    const pending = (await pendingChanges()).filter(item => item.id !== change.id);
    pending.push(change);
    await offlineRecord(offlineKey('pending'),pending);
  }
  async function clearPending(id) {
    const pending = await pendingChanges();
    if (pending.some(item => item.id === id)) await offlineRecord(offlineKey('pending'),pending.filter(item => item.id !== id));
  }
  async function syncPending() {
    const account = state.account;
    const key = offlineKey('pending',account);
    const pending = await pendingChanges(account);
    for (const change of pending) {
      try { await api(change.type === 'delete' ? 'DELETE' : 'POST',change.note,change.type === 'delete' ? change.id : undefined); }
      catch (error) { if (error.status === 401) toast('登录已过期，请重新登录后同步'); return false; }
      if (state.account !== account) return false;
      const latest = await pendingChanges(account);
      await offlineRecord(key,latest.filter(item => !(item.id === change.id && item.updatedAt === change.updatedAt)));
    }
    return true;
  }
  function canQueueOffline(error) { return !navigator.onLine || error instanceof TypeError || error.name === 'TimeoutError' || error.status >= 500; }

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
    const response = await fetch('/api/notes' + (id ? '?id=' + encodeURIComponent(id) : ''), {method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
    if (!response.ok) { const error = new Error((await response.json().catch(() => ({}))).error || '同步失败'); error.status = response.status; throw error; }
    return response.json();
  }
  async function loadFromAccount() {
    if (!state.account) return;
    const account = state.account;
    const cached = await cachedNotes(account);
    if (state.account !== account) return;
    if (cached.length) { state.notes = cached; render(); }
    if (!navigator.onLine) { toast('离线模式 · 改动将在联网后同步'); return; }
    try {
      if (!await syncPending()) { toast('待同步笔记已保存在此设备'); return; }
      if (localStorage.getItem(MIGRATION_KEY + '.' + account) !== 'done') {
        const migrated = await fetch('/api/notes/migrate-legacy', {method:'POST',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});
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
      await cacheNotes();
      if (oldNotes.length) localStorage.removeItem(KEY);
      render();
      await syncInsightKey();
      if (oldNotes.length) toast('旧笔记已导入账号');
    } catch (error) { toast('暂时无法同步，已显示本机笔记'); }
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
  const IMAGE_MARKER = '\n\n<!--linote-images:';
  function splitNoteBody(value) {
    const at = value.lastIndexOf(IMAGE_MARKER);
    if (at < 0 || !value.endsWith('-->')) return {text:value,images:[]};
    try {
      const images = JSON.parse(value.slice(at + IMAGE_MARKER.length,-3));
      if (Array.isArray(images) && images.every(src => typeof src === 'string' && /^data:image\/jpeg;base64,/.test(src))) return {text:value.slice(0,at),images};
    } catch {}
    return {text:value,images:[]};
  }
  function joinNoteBody(text, images) { return text + (images.length ? IMAGE_MARKER + JSON.stringify(images) + '-->' : ''); }
  function renderEditorImages() {
    const box = $('editorImages'); box.replaceChildren();
    state.draftImages.forEach((src,index) => {
      const item = el('div','editor-image');
      const img = el('img'); img.src = src; img.alt = '笔记图片 ' + (index+1);
      const remove = el('button','','×'); remove.type='button'; remove.setAttribute('aria-label','移除图片 ' + (index+1));
      remove.addEventListener('click',() => { state.draftImages.splice(index,1); renderEditorImages(); persistEditorDraft(); });
      item.append(img,remove); box.append(item);
    });
  }
  async function compressImage(file) {
    if (!file.type.startsWith('image/') || file.size > 15000000) throw new Error('请选择小于 15 MB 的图片');
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1200 / Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*ratio)); canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const context = canvas.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    for (const quality of [.82,.7,.55,.4]) {
      const data = canvas.toDataURL('image/jpeg',quality);
      if (data.length <= 200000) return data;
    }
    throw new Error('图片压缩后仍太大，请换一张');
  }
  $('addImage').addEventListener('click',() => $('imageInput').click());
  $('imageInput').addEventListener('change',async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (state.draftImages.length + files.length > 4) { toast('一条笔记最多添加 4 张图片'); return; }
    for (const file of files) {
      try { state.draftImages.push(await compressImage(file)); renderEditorImages(); persistEditorDraft(); }
      catch (error) { toast(error.message || '添加图片失败'); }
    }
  });
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
    return state.notes.filter(n => (!state.tag || n.tags.includes(state.tag)) && (!q || splitNoteBody(n.body).text.toLocaleLowerCase().includes(q) || n.tags.some(t => t.toLocaleLowerCase().includes(q)))).sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
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
      actions.append(edit, remove); top.append(actions); card.append(top);
      const parts = splitNoteBody(note.body);
      if (parts.text) card.append(el('div', 'note-body', parts.text));
      if (parts.images.length) { const images=el('div','note-images'); parts.images.forEach((src,index) => { const img=el('img'); img.src=src; img.alt='笔记图片 ' + (index+1); img.loading='lazy'; images.append(img); }); card.append(images); }
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
    renderDraftTags(); renderSuggestions(); persistEditorDraft();
  }
  function renderDraftTags() {
    const container = $('selectedTags'); container.replaceChildren();
    state.draftTags.forEach(tag => {
      const chip = el('span', 'selected-tag', '#' + tag);
      const remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '移除话题 ' + tag);
      remove.addEventListener('click', () => { state.draftTags = state.draftTags.filter(t => t !== tag); renderDraftTags(); renderSuggestions(); persistEditorDraft(); });
      chip.append(remove); container.append(chip);
    });
  }
  function draftStorageKey() { return DRAFT_KEY + encodeURIComponent(state.account || 'guest'); }
  function readDrafts() {
    try { const saved = JSON.parse(localStorage.getItem(draftStorageKey()) || '[]'); return Array.isArray(saved) ? saved.filter(item => item && typeof item.body === 'string' && (item.id === null || typeof item.id === 'string')).map(item => ({...item,tags:Array.isArray(item.tags) ? item.tags : []})) : []; }
    catch { return []; }
  }
  function writeDrafts(drafts) { try { localStorage.setItem(draftStorageKey(), JSON.stringify(drafts)); } catch { toast('草稿保存失败，请检查设备存储空间'); } }
  function persistEditorDraft() {
    if ($('modalLayer').hidden) return;
    const id = state.editing || null;
    const drafts = readDrafts().filter(item => item.id !== id);
    const body = $('noteBody').value;
    const tagInput = $('tagInput').value;
    if (body || tagInput || state.draftTags.length || state.draftImages.length) drafts.unshift({id,body,tagInput,tags:[...state.draftTags],images:[...state.draftImages],updatedAt:new Date().toISOString()});
    writeDrafts(drafts);
    $('editorHint').textContent = body || tagInput || state.draftImages.length ? '草稿已保存在此设备 · 保存后同步到账号' : '保存后同步到当前账号';
  }
  function clearEditorDraft(id) { writeDrafts(readDrafts().filter(item => item.id !== id)); }
  function renderSuggestions() {
    const input = $('tagInput').value.trim().replace(/^#/, '').toLocaleLowerCase();
    const matches = [...tagCounts().keys()].filter(t => !state.draftTags.includes(t) && (!input || t.toLocaleLowerCase().includes(input))).slice(0,6);
    const box = $('tagSuggestions'); box.replaceChildren();
    box.hidden = !input || matches.length === 0;
    matches.forEach(tag => { const b = el('button', '', '#' + tag); b.type = 'button'; b.addEventListener('click', () => { addTag(tag); $('tagInput').focus(); }); box.append(b); });
  }
  function openEditor(id = null) {
    const draft = id === null ? readDrafts().find(item => item.id === null) : readDrafts().find(item => item.id === id);
    const note = state.notes.find(n => n.id === id);
    state.editing = note?.id || null;
    const parts = note ? splitNoteBody(note.body) : {text:'',images:[]};
    state.draftTags = draft ? [...draft.tags] : note ? [...note.tags] : (state.tag ? [state.tag] : []);
    state.draftImages = draft?.images ? [...draft.images] : [...parts.images];
    $('editorTitle').textContent = note ? '编辑笔记' : '写一条笔记';
    $('noteBody').value = draft?.body ?? parts.text;
    $('tagInput').value = draft?.tagInput || '';
    renderDraftTags(); renderSuggestions(); renderEditorImages();
    $('modalLayer').hidden = false;
    $('editorHint').textContent = draft ? '已恢复草稿 · 保存后同步到账号' : '保存后同步到当前账号';
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('noteBody').focus(), 0);
  }
  function closeEditor() {
    if (state.editing) clearEditorDraft(state.editing);
    else persistEditorDraft();
    $('modalLayer').hidden = true;
    document.body.style.overflow = '';
    state.editing = null;
  }
  async function deleteNote(id) {
    if (!confirm('确定删除这条笔记吗？')) return;
    let queued = false;
    try { await api('DELETE', undefined, id); }
    catch (error) {
      if (!canQueueOffline(error)) { toast(error.message || '删除失败'); return; }
      try { await queueChange({type:'delete',id,updatedAt:new Date().toISOString()}); queued = true; }
      catch { toast('本机存储不可用，删除失败'); return; }
    }
    if (!queued) await clearPending(id).catch(() => {});
    state.notes = state.notes.filter(n => n.id !== id);
    try { await cacheNotes(); } catch { toast('本机缓存更新失败'); }
    if (state.reviewIds) state.reviewIds = state.reviewIds.filter(noteId => noteId !== id);
    if (state.tag && !tagCounts().has(state.tag)) state.tag = null;
    render(); toast(queued ? '已在本机删除，联网后同步' : '笔记已删除');
  }
  async function saveNote(event) {
    event.preventDefault();
    const body = $('noteBody').value.trim();
    if (!body && !state.draftImages.length) { $('noteBody').focus(); return; }
    if ($('tagInput').value.trim()) addTag($('tagInput').value);
    const now = new Date().toISOString();
    let note;
    if (state.editing) {
      const existing = state.notes.find(n => n.id === state.editing);
      if (!existing) return;
      note = { ...existing, body:joinNoteBody(body,state.draftImages), tags:[...state.draftTags], updatedAt:now };
    } else note = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), body:joinNoteBody(body,state.draftImages), tags: [...state.draftTags], createdAt: now, updatedAt: now };
    $('saveNote').disabled = true;
    let queued = false;
    try { await api('POST', note); }
    catch (error) {
      if (!canQueueOffline(error)) { $('saveNote').disabled = false; toast(error.message || '保存失败'); return; }
      try { await queueChange({type:'save',id:note.id,note,updatedAt:now}); queued = true; }
      catch { $('saveNote').disabled = false; toast('本机存储不可用，无法离线保存'); return; }
    }
    if (!queued) await clearPending(note.id).catch(() => {});
    $('saveNote').disabled = false;
    state.notes = [note, ...state.notes.filter(n => n.id !== note.id)];
    try { await cacheNotes(); } catch { if (queued) { toast('本机缓存失败，请保留当前页面'); return; } }
    state.reviewIds = null;
    const draftId = state.editing || null;
    closeEditor(); clearEditorDraft(draftId); render(); toast(queued ? '已保存在本机，联网后同步' : '笔记已保存');
  }
  $('noteBody').addEventListener('input', persistEditorDraft);
  $('tagInput').addEventListener('input', persistEditorDraft);
  function exportNotes() {
    if (!state.account) { openAccount(); return; }
    const link = document.createElement('a');
    link.href = '/api/notes/export'; link.download = 'linote-' + new Date().toISOString().slice(0,10) + '.json'; link.click();
  }
  ['newNoteSidebar','newNoteTop','mobileFab','emptyNew'].forEach(id => $(id).addEventListener('click', () => { if (id === 'emptyNew' && (state.search || state.reviewIds !== null)) { state.search = ''; state.reviewIds = null; $('searchInput').value = ''; render(); } else openEditor(); }));
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
    ['insightHome','insightChat','insightRangePanel','insightKeyPanel','insightResult','insightHistory'].forEach(id => { $(id).hidden = id !== name; });
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
  function renderAiText(container, content) {
    container.replaceChildren();
    for (const line of String(content || '').split(/\n/)) {
      if (!line.trim()) { container.append(el('div','ai-spacer')); continue; }
      const heading = line.match(/^\s*#{1,6}\s*(.+)$/);
      const item = el(heading ? 'h4' : 'p',heading ? 'ai-heading' : 'ai-line');
      const source = heading ? heading[1] : line.replace(/^\s*[-*]\s+/,'• ');
      for (const part of source.split(/(\*\*[^*]+\*\*)/g)) {
        if (part.startsWith('**') && part.endsWith('**')) item.append(el('strong','',part.slice(2,-2)));
        else item.append(document.createTextNode(part));
      }
      container.append(item);
    }
  }
  function renderReasoning(host, reasoning) {
    host.querySelector('details')?.remove();
    if (!reasoning) return;
    const details = el('details','ai-reasoning');
    details.append(el('summary','','查看 DeepSeek 思考过程'),el('pre','',reasoning));
    host.append(details);
  }
  async function readSse(response, onEvent) {
    if (!response.ok) { const data=await response.json().catch(() => ({})); throw new Error(data.error || 'AI 请求失败'); }
    if (!response.body) throw new Error('无法读取 AI 实时回复');
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let pending='', completed=null;
    while (true) {
      const {value,done}=await reader.read();
      pending += decoder.decode(value || new Uint8Array(),{stream:!done});
      let boundary;
      while ((boundary=/(?:\r?\n){2}/.exec(pending))) {
        const block=pending.slice(0,boundary.index); pending=pending.slice(boundary.index+boundary[0].length);
        const event=block.match(/^event:\s*(.+)$/m)?.[1];
        const raw=block.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !raw) continue;
        let data; try { data=JSON.parse(raw); } catch { continue; }
        if (event==='error') throw new Error(data.error || 'AI 生成失败');
        onEvent(event,data);
        if (event==='done') completed=data;
      }
      if (done) break;
    }
    if (!completed) throw new Error('AI 回复中断，请重试');
    return completed;
  }
  function showInsightResult(insight, reasoning = '') {
    showInsightPanel('insightResult');
    $('insightResultTitle').textContent = insight.title;
    $('insightResultMeta').textContent = insight.scope + ' · ' + insight.noteCount + ' 条笔记 · ' + formatDate(insight.createdAt);
    renderAiText($('insightResultBody'),insight.content);
    renderReasoning($('insightResult'),reasoning);
  }
  async function startInsight(mode) {
    if (!state.insightHasKey) { showInsightPanel('insightKeyPanel'); $('insightMessage').textContent = '先设置 DeepSeek API 密钥'; return; }
    const customPrompt = mode === 'custom' ? $('insightCustomPrompt').value.trim() : '';
    if (mode === 'custom' && !customPrompt) { $('insightMessage').textContent = '请先输入自定义视角'; return; }
    const scopeTag = $('insightScope').value;
    const bounds = insightDateBounds();
    if (!state.notes.some(note => { const time=Date.parse(note.createdAt); return (!scopeTag || note.tags.includes(scopeTag)) && (!bounds.startDate || time >= Date.parse(bounds.startDate)) && (!bounds.endDate || time < Date.parse(bounds.endDate)); })) { $('insightMessage').textContent = '所选范围内还没有笔记'; return; }
    showInsightPanel('insightResult');
    $('insightResultTitle').textContent = $('insightLayer').querySelector(`.insight-card[data-mode="${mode}"] strong`)?.textContent || 'AI 洞察';
    $('insightResultMeta').textContent = bounds.label + ' · 正在分析笔记';
    $('insightResultBody').textContent = '正在阅读笔记并生成洞察，请稍候…';
    renderReasoning($('insightResult'),'正在等待 DeepSeek 思考…');
    $('insightResult').querySelector('details').open=true;
    $('insightLayer').querySelectorAll('.insight-card,#insightCustomStart').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({mode,customPrompt,scopeTag,...bounds,rangeLabel:bounds.label}),credentials:'same-origin'});
      let thought='',answer='';
      const data = await readSse(response,(event,chunk) => {
        if (event==='progress') $('insightResultMeta').textContent=chunk.text;
        if (event==='reasoning') { thought+=chunk.text; $('insightResult').querySelector('.ai-reasoning pre').textContent=thought; }
        if (event==='answer') { answer+=chunk.text; $('insightResultBody').textContent=answer; }
      });
      showInsightResult(data.insight,thought || data.reasoning || '');
      if (thought) $('insightResult').querySelector('details').open=true;
    } catch (error) { $('insightResultBody').textContent = error.message || '洞察失败，请稍后重试'; renderReasoning($('insightResult'),''); }
    finally { $('insightLayer').querySelectorAll('.insight-card,#insightCustomStart').forEach(button => { button.disabled = false; }); }
  }
  function renderChatMessages() {
    const box = $('insightChatMessages'); box.replaceChildren();
    state.chatMessages.forEach(message => {
      const item = el('div','insight-chat-message ' + message.role);
      const content = el('div'); renderAiText(content,message.content);
      item.append(el('strong','',message.role === 'user' ? '你' : 'AI'),content);
      if (message.role === 'assistant') renderReasoning(item,message.reasoning || '');
      box.append(item);
    });
    box.scrollTop = box.scrollHeight;
  }
  async function sendChat(question) {
    if (!question.trim()) return;
    const history = state.chatMessages.slice(-12);
    const scopeTag = $('insightScope').value;
    const bounds = insightDateBounds();
    state.chatMessages.push({role:'user',content:question.trim()},{role:'assistant',content:'正在阅读笔记并思考…'}); renderChatMessages();
    $('insightChatSend').disabled = true;
    $('insightMessage').textContent = '正在阅读笔记并回复…';
    try {
      const response = await fetch('/api/insights/chat',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({question:question.trim(),history,scopeTag,...bounds}),credentials:'same-origin'});
      let thought='',answer='';
      const data = await readSse(response,(event,chunk) => {
        if (event==='progress') $('insightMessage').textContent=chunk.text;
        if (event==='reasoning') thought+=chunk.text;
        if (event==='answer') answer+=chunk.text;
        if (event==='reasoning' || event==='answer') {
          state.chatMessages[state.chatMessages.length-1]={role:'assistant',content:answer || '正在思考…',reasoning:thought};
          renderChatMessages();
          const details=$('insightChatMessages').querySelector('.insight-chat-message:last-child details'); if (details) details.open=true;
        }
      });
      state.chatMessages[state.chatMessages.length-1] = {role:'assistant',content:data.answer,reasoning:thought || data.reasoning || ''}; renderChatMessages();
      $('insightChatInput').value = '';
      $('insightMessage').textContent = '';
    } catch (error) {
      state.chatMessages[state.chatMessages.length-1] = {role:'assistant',content:error.message || '对话失败，请重试'}; renderChatMessages();
      $('insightMessage').textContent = error.message || '对话失败，请重试';
    } finally { $('insightChatSend').disabled = false; }
  }
  function startChat() {
    const question = $('insightCustomPrompt').value.trim();
    if (!question) { $('insightMessage').textContent = '先写下你想聊的问题'; $('insightCustomPrompt').focus(); return; }
    if (!state.insightHasKey) { showInsightPanel('insightKeyPanel'); $('insightMessage').textContent = '先设置 DeepSeek API 密钥'; return; }
    const bounds = insightDateBounds();
    const scopeTag = $('insightScope').value;
    const key = JSON.stringify([scopeTag,bounds.startDate,bounds.endDate]);
    if (state.chatScope !== key) { state.chatScope = key; state.chatMessages = []; }
    $('insightChatScope').textContent = bounds.label + ' · ' + (scopeTag ? '#' + scopeTag : '全部话题');
    renderChatMessages(); showInsightPanel('insightChat');
    sendChat(question);
    $('insightCustomPrompt').value = '';
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
  $('insightCustomStart').addEventListener('click',startChat);
  $('insightChatBack').addEventListener('click',() => showInsightPanel('insightHome'));
  $('insightChatForm').addEventListener('submit',event => { event.preventDefault(); sendChat($('insightChatInput').value); });
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
    try { await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'}),credentials:'same-origin',signal:AbortSignal.timeout(3000)}); } catch {}
    try { localStorage.removeItem(ACCOUNT_KEY); } catch {}
    try { await offlineRecord('last-account',''); } catch {}
    state.account = null; state.notes = []; state.tag = null; state.reviewIds = null; state.chatMessages = []; state.chatScope = ''; state.search = ''; $('searchInput').value = ''; $('accountName').textContent = '未登录'; render(); closeSidebar(); openAccount();
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
    await rememberAccount(account);
    closeSidebar(); render(); await loadFromAccount();
  });
  function openSidebar() { $('sidebar').classList.add('open'); $('mobileShade').hidden = false; }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('mobileShade').hidden = true; }
  $('mobileMenu').addEventListener('click', () => $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar());
  $('mobileShade').addEventListener('click', closeSidebar);
  $('mobileShade').addEventListener('pointerdown',closeSidebar);
  $('mobileShade').addEventListener('touchstart',closeSidebar,{passive:true});
  document.addEventListener('pointerdown',e => { if ($('sidebar').classList.contains('open') && !$('sidebar').contains(e.target) && !$('mobileMenu').contains(e.target)) closeSidebar(); },true);
  function navigateBack() {
    if (!$('modalLayer').hidden) { closeEditor(); return true; }
    if (!$('insightLayer').hidden) {
      if (!$('insightHome').hidden) closeInsight();
      else showInsightPanel('insightHome');
      return true;
    }
    if ($('sidebar').classList.contains('open')) { closeSidebar(); return true; }
    if (!$('calendarPanel').hidden) { $('calendarPanel').hidden = true; return true; }
    if (!$('accountLayer').hidden) return true;
    return false;
  }
  window.linoteNavigateBack = navigateBack;
  let lastSwipeAt = 0;
  window.linoteSystemBack = () => {
    if (Date.now() - lastSwipeAt < 700) return true;
    lastSwipeAt = Date.now();
    if (navigateBack()) return true;
    if (matchMedia('(max-width:620px)').matches && $('accountLayer').hidden) openSidebar();
    return true;
  };
  function canSwipeOpen(event) {
    return matchMedia('(max-width:620px)').matches && (
      !$('modalLayer').hidden || !$('insightLayer').hidden || $('sidebar').classList.contains('open') ||
      ($('accountLayer').hidden && !event.target.closest('input,textarea,select'))
    );
  }
  function swipeOpensSidebar(start, endX, endY) {
    if (!start) return false;
    const dx = endX - start.x, dy = endY - start.y;
    return dx > 56 && dx > Math.abs(dy) * 1.3;
  }
  window.linoteHandleSwipe = () => {
    if (!matchMedia('(max-width:620px)').matches) return;
    if (Date.now() - lastSwipeAt < 700) return;
    lastSwipeAt = Date.now();
    if ($('sidebar').classList.contains('open')) return;
    if (!navigateBack() && $('accountLayer').hidden) openSidebar();
  };
  let mainTouchStart = null;
  document.addEventListener('touchstart', e => { mainTouchStart = e.touches.length === 1 && canSwipeOpen(e) ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : null; }, {passive:true,capture:true});
  document.addEventListener('touchmove', e => {
    if (mainTouchStart && e.touches.length === 1 && swipeOpensSidebar(mainTouchStart,e.touches[0].clientX,e.touches[0].clientY)) {
      window.linoteHandleSwipe(); mainTouchStart = null;
    }
  }, {passive:true,capture:true});
  document.addEventListener('touchend', e => { if (mainTouchStart && e.changedTouches.length === 1 && swipeOpensSidebar(mainTouchStart,e.changedTouches[0].clientX,e.changedTouches[0].clientY)) window.linoteHandleSwipe(); mainTouchStart=null; }, {passive:true,capture:true});
  document.addEventListener('touchcancel', () => { mainTouchStart=null; }, {passive:true,capture:true});
  let mainPointerStart = null;
  document.addEventListener('pointerdown', e => { mainPointerStart = canSwipeOpen(e) ? {x:e.clientX,y:e.clientY} : null; }, true);
  document.addEventListener('pointermove', e => {
    if (mainPointerStart && swipeOpensSidebar(mainPointerStart,e.clientX,e.clientY)) {
      window.linoteHandleSwipe(); mainPointerStart = null;
    }
  }, true);
  document.addEventListener('pointerup', e => { if (mainPointerStart && swipeOpensSidebar(mainPointerStart,e.clientX,e.clientY)) window.linoteHandleSwipe(); mainPointerStart=null; }, true);
  document.addEventListener('pointercancel', () => { mainPointerStart=null; }, true);
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
  $('importFlomoButton').addEventListener('click', () => {
    if (!state.account) { openAccount(); return; }
    $('importFlomoFile').value = '';
    $('importFlomoFile').click();
  });
  $('importFlomoFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2000000) { toast('导出文件不能超过 2 MB'); return; }
    $('importFlomoButton').disabled = true;
    $('importFlomoButton').textContent = '正在导入…';
    try {
      const response = await fetch('/api/notes/import-flomo', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:await file.text()}),credentials:'same-origin'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '导入失败');
      const data = await api('GET');
      state.notes = data.notes;
      state.tag = null; state.reviewIds = null; state.search = ''; $('searchInput').value = '';
      render(); closeSidebar();
      toast(`已导入 ${result.imported} 条笔记，${result.alreadyPresent} 条已存在；共 ${result.tagCount} 个标签`);
    } catch (error) { toast(error.message || '导入失败'); }
    finally { $('importFlomoButton').disabled = false; $('importFlomoButton').textContent = '导入 flomo'; }
  });
  $('checkUpdate').addEventListener('click', () => {
    if (/LinoteAndroid\/\d+/.test(navigator.userAgent)) window.location.href = 'linote://update';
    else window.location.href = '/linote.apk';
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') navigateBack();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchInput').focus(); }
    if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && $('modalLayer').hidden && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openEditor(); }
  });
  render();
  if ('serviceWorker' in navigator) {
    if (document.body.classList.contains('linote-android')) {
      navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))).catch(() => {});
      if ('caches' in window) caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('linote-shell-')).map(key => caches.delete(key)))).catch(() => {});
    } else {
      let reloadedForUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadedForUpdate) { reloadedForUpdate = true; location.reload(); }
      });
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
  async function startApp() {
    const remembered = await rememberedAccount();
    if (remembered) { state.account=remembered; $('accountName').textContent=remembered; state.notes=await cachedNotes(remembered); render(); }
    if (!navigator.onLine) { if (!remembered) openAccount(); else toast('离线模式 · 可继续编辑，联网后同步'); return; }
    try {
      const response = await fetch('/api/auth',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});
      if (response.status === 401) { if (!remembered) openAccount(); else toast('账号会话已过期，重新登录后可同步'); return; }
      if (!response.ok) throw new Error('账号服务暂时不可用');
      const user = await response.json();
      state.account = user.username; $('accountName').textContent = user.username; await rememberAccount(user.username); await loadFromAccount();
    } catch { if (!remembered) openAccount(); else toast('连接不可用 · 已打开本机笔记'); }
  }
  window.addEventListener('online',() => { if (state.account) loadFromAccount(); });
  startApp();
})();
