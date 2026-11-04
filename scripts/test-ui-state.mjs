import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const records = new Map();
const now = new Date().toISOString();
const notes = ['第一条原笔记','第二条原笔记'].map((body,index) => ({id:`note-${index}`,body,tags:[],createdAt:now,updatedAt:now}));
notes[1].body='<!--linote-images:["data:image/jpeg;base64,AAAA"]-->';
records.set('notes:tester',notes);
const storage = new Map([
  ['linote.account.v1','tester'],
  ['linote.drafts.v1.tester',JSON.stringify([
    {id:'note-0',body:'旧编辑草稿一',tags:[]},
    {id:'note-1',body:'旧编辑草稿二',tags:[]},
    {id:null,body:'未发的新草稿',tags:[]},
  ])],
]);

const dom = new Map();
class Node {
  constructor(tagName='DIV',id='') {
    this.tagName=tagName.toUpperCase(); this.id=id; this.children=[]; this.listeners=new Map();
    this.style={}; this.value=''; this.hidden=false; this.dataset={}; this.attributes=new Map(); this._text='';
    const classes=new Set();
    this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle:(name,force)=>{
      if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name);
    }};
  }
  set textContent(value) { this._text=String(value); this.children=[]; }
  get textContent() { return this._text; }
  get options() { return this.children; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  addEventListener(type,fn) { this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]); }
  dispatch(type) { return Promise.all((this.listeners.get(type)||[]).map(fn=>fn({target:this,preventDefault(){},stopPropagation(){}}))); }
  setAttribute(name,value) { this.attributes.set(name,value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { document.activeElement=this; }
  querySelector(selector) { const name=selector.slice(1); return this.children.find(child=>typeof child.className==='string' && child.className.split(' ').includes(name)) || null; }
  querySelectorAll() { return []; }
}
const html = fs.readFileSync(new URL('../public/offline.html',import.meta.url),'utf8');
for (const [,id] of html.matchAll(/\bid="([^"]+)"/g)) dom.set(id,new Node('div',id));
for (const id of ['modalLayer','accountLayer','insightLayer','calendarPanel']) dom.get(id).hidden=true;
dom.get('insightDatePreset').value='all';
const document = {
  body:new Node('body'),activeElement:new Node('body'),
  getElementById:id=>dom.get(id),createElement:tag=>new Node(tag),
  createTextNode:text=>({textContent:text}),addEventListener(){},
};
const makeRequest = value => {
  const request={result:value};
  queueMicrotask(()=>request.onsuccess?.());
  return request;
};
const db = {transaction:()=>({objectStore:()=>({
  get:key=>makeRequest(records.get(key)),
  put:(value,key)=>{records.set(key,value);return makeRequest(undefined)},
  getAllKeys:()=>makeRequest([...records.keys()]),
})}),close(){}};
const indexedDB={open:()=>makeRequest(db)};
const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
const window={addEventListener(){},scrollY:120,scrollTo(x,y){this.scrollY=y}};
const context={document,window,navigator:{userAgent:'LinoteAndroid/9',onLine:false},indexedDB,localStorage,
  matchMedia:()=>({matches:true}),fetch:async()=>{throw new TypeError('offline')},confirm:()=>true,crypto:globalThis.crypto,
  Option:class {constructor(text,value){this.text=text;this.value=value}},
  setTimeout,clearTimeout,Date,Intl,Map,Set,Promise,JSON,Array,Number,String,Math,Blob,URL,console};
vm.runInNewContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(dom.get('notes').children.length,2,'cached notes render without network');
const imageNote=dom.get('notes').children[1];
assert.equal(imageNote.children.some(child=>child.className==='note-body'),false,'legacy image marker is not displayed as text');
const image=imageNote.children.find(child=>child.className==='note-images').children[0];
await image.dispatch('click');
assert.equal(dom.get('imageViewer').hidden,false,'note image opens a viewer');
await dom.get('imageViewerClose').dispatch('click');
assert.equal(dom.get('imageViewer').hidden,true,'image viewer closes');

for (let index=0;index<2;index++) {
  const card=dom.get('notes').children[index];
  const edit=card.children[0].children[1].children[0];
  await edit.dispatch('click');
  assert.equal(dom.get('editorTitle').textContent,'编辑笔记');
  assert.notEqual(document.activeElement,dom.get('noteBody'),'editing an existing note does not summon the keyboard');
  await dom.get('cancelEditor').dispatch('click');
  assert.equal(dom.get('modalLayer').hidden,true);
}
assert.deepEqual(JSON.parse(storage.get('linote.drafts.v1.tester')).map(draft=>draft.id),[null],
  'cancel removes both abandoned edit drafts');

await dom.get('newNoteTop').dispatch('click');
assert.equal(dom.get('editorTitle').textContent,'写一条笔记');
assert.equal(dom.get('noteBody').value,'未发的新草稿');
await dom.get('cancelEditor').dispatch('click');
await dom.get('newNoteSidebar').dispatch('click');
assert.equal(dom.get('noteBody').value,'未发的新草稿','new-note draft survives close');
dom.get('noteBody').value='离线发表 #记录\n下一段仍是正文 #? #！';
await dom.get('noteForm').dispatch('submit');
assert.equal(dom.get('modalLayer').hidden,true);
assert.equal(records.get('notes:tester').length,3,'offline note is published locally');
assert.equal(records.get('pending:tester').length,1,'offline note is queued for sync');
assert.equal(JSON.stringify(records.get('notes:tester')[0].tags),JSON.stringify(['记录','?','！']),'inline topics include single punctuation without absorbing prose');
assert.equal(dom.get('notes').children[0].className.includes('preview'),true,'notes default to preview mode');
const firstCard=dom.get('notes').children[0], firstToggle=firstCard.querySelector('.note-toggle');
firstToggle.hidden=false;
await firstToggle.dispatch('click');
assert.equal(dom.get('notes').children[0],firstCard,'opening a note keeps its DOM node and scroll position');
assert.equal(window.scrollY,120);
assert.equal(firstCard.className.includes('expanded'),true);
await firstToggle.dispatch('click');
assert.equal(firstCard.className.includes('preview'),true);
await dom.get('collapseAll').dispatch('click');
assert.equal(dom.get('notes').children[0].className.includes('expanded'),true,'bulk expand works');
await dom.get('collapseAll').dispatch('click');
assert.equal(dom.get('notes').children[0].className.includes('preview'),true,'bulk collapse returns to preview');
await dom.get('filterLabel').dispatch('click');
assert.equal(dom.get('filterLabel').textContent,'按发出日期排序 ▾','feed sort switches');
await dom.get('reviewNotes').dispatch('click');
assert.equal(dom.get('pageTitle').textContent,'回顾');
await dom.get('allNotes').dispatch('click');
assert.equal(dom.get('pageTitle').textContent,'全部笔记');
await dom.get('insightButton').dispatch('click');
assert.equal(dom.get('insightLayer').hidden,false,'insight button opens dialog');
await dom.get('insightClose').dispatch('click');
assert.equal(dom.get('insightLayer').hidden,true);
const highlightChildren=dom.get('noteHighlight').children;
dom.get('noteBody').scrollTop=123;
await dom.get('noteBody').dispatch('scroll');
assert.equal(dom.get('noteHighlight').scrollTop,123);
assert.equal(dom.get('noteHighlight').children,highlightChildren,'editor scroll does not rebuild long text');
dom.get('noteBody').value='长'.repeat(2500);
await dom.get('noteBody').dispatch('input');
assert.equal(dom.get('noteForm').classList.contains('plain-long-note'),true,'long notes use the native textarea for smooth scrolling');
assert.equal(dom.get('noteHighlight').children.length,0,'long note mirror is removed');
dom.get('noteBody').value='';
await dom.get('noteBody').dispatch('input');
const noteToDelete=dom.get('notes').children[0];
await noteToDelete.children[0].children[1].children[1].dispatch('click');
assert.equal(records.get('trash:tester').length,1,'offline deletion goes to the recycle bin');
await dom.get('trashButton').dispatch('click');
assert.equal(dom.get('pageTitle').textContent,'回收站');
assert.equal(dom.get('notes').children.length,1);
await dom.get('notes').children[0].children[0].children[2].children[0].dispatch('click');
assert.equal(records.get('trash:tester').length,0,'a note can be restored from the recycle bin');
await dom.get('allNotes').dispatch('click');
await dom.get('notes').children[0].children[0].children[1].children[1].dispatch('click');
await dom.get('trashButton').dispatch('click');
await dom.get('notes').children[0].children[0].children[2].children[1].dispatch('click');
assert.equal(records.get('trash:tester').length,0,'a second deletion permanently removes the trash entry');
await dom.get('allNotes').dispatch('click');
await dom.get('newNoteTop').dispatch('click');
dom.get('noteBody').value='';
const originalImage=new Blob(['original image bytes'],{type:'image/png'});
dom.get('imageInput').files=[originalImage];
await dom.get('imageInput').dispatch('change');
await dom.get('noteForm').dispatch('submit');
const savedImageNote=records.get('notes:tester')[0];
assert.match(savedImageNote.body,/\/api\/images\/[0-9a-f-]{36}/,'new images use an original-file reference');
const imageKey=[...records.keys()].find(key=>key.startsWith('image:tester:'));
assert.equal(await records.get(imageKey).text(),'original image bytes','original image bytes are stored without compression');
console.log('Offline UI and draft checks passed');
