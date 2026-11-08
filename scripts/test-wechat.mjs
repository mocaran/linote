import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/wechat.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module = {exports:{}};
new Function('module','exports',compiled)(module,module.exports);
const {validWechatSignature,xmlField,textReply,isWechatSaveCommand,composeWechatNote} = module.exports;
const token='sampletoken', timestamp='1700000000', nonce='12345';
const signature=createHash('sha1').update([token,timestamp,nonce].sort().join('')).digest('hex');
assert.equal(await validWechatSignature(token,timestamp,nonce,signature),true);
assert.equal(await validWechatSignature(token,timestamp,nonce,'0'.repeat(40)),false);
assert.equal(xmlField('<xml><Content><![CDATA[你好 #日记]]></Content></xml>','Content'),'你好 #日记');
assert.equal(xmlField('<xml><Content>我 &amp; 你</Content></xml>','Content'),'我 & 你');
const reply=await textReply('user','account','已保存').text();
assert.match(reply,/<ToUserName><!\[CDATA\[user\]\]><\/ToUserName>/);
assert.match(reply,/<Content><!\[CDATA\[已保存\]\]><\/Content>/);
assert.equal(isWechatSaveCommand(' 以上 '),true);
assert.equal(isWechatSaveCommand('以上。'),false);
assert.equal(composeWechatNote([{body:'第一句'},{body:'第二句\n第三句'}]),'第一句\n第二句\n第三句');

const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE wechat_channels (user_id TEXT,channel_id TEXT PRIMARY KEY,verify_token TEXT);
CREATE TABLE wechat_links (channel_id TEXT,openid TEXT,user_id TEXT,PRIMARY KEY(channel_id,openid));
CREATE TABLE wechat_bind_codes (channel_id TEXT,code_hash TEXT,expires_at TEXT);
CREATE TABLE wechat_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT,channel_id TEXT NOT NULL,openid TEXT NOT NULL,message_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(channel_id,message_id));
CREATE TABLE notes (user_id TEXT,id TEXT,body TEXT,tags TEXT,created_at TEXT,updated_at TEXT,PRIMARY KEY(user_id,id));`);
const channel='a'.repeat(24);
sqlite.prepare('INSERT INTO wechat_channels VALUES (?,?,?)').run('四季春',channel,token);
sqlite.prepare('INSERT INTO wechat_links VALUES (?,?,?)').run(channel,'reader1','四季春');
sqlite.prepare('INSERT INTO wechat_links VALUES (?,?,?)').run(channel,'reader2','四季春');
const db={
  prepare(sql){return {bind(...args){const statement=sqlite.prepare(sql);return {first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>statement.run(...args)};}};},
  async batch(statements){sqlite.exec('BEGIN');try {const results=[];for(const statement of statements) results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
};
const routeSource=fs.readFileSync(new URL('../app/api/wechat/[channel]/route.ts',import.meta.url),'utf8');
const routeCompiled=ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const routeModule={exports:{}};
new Function('require','module','exports',routeCompiled)((id)=>{
  if(id==='cloudflare:workers') return {env:{DB:db}};
  if(id==='../../../../lib/wechat') return module.exports;
  throw new Error(`Unexpected import: ${id}`);
},routeModule,routeModule.exports);
async function send(openid,messageId,content){
  const xml=`<xml><ToUserName><![CDATA[official]]></ToUserName><FromUserName><![CDATA[${openid}]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content><MsgId>${messageId}</MsgId></xml>`;
  const request=new Request(`https://linote.test/api/wechat/${channel}?timestamp=${timestamp}&nonce=${nonce}&signature=${signature}`,{method:'POST',body:xml});
  return (await routeModule.exports.POST(request,{params:Promise.resolve({channel})})).text();
}
assert.equal(await send('reader1','1','第一句 #日记'),'success');
assert.equal(await send('reader1','2','第二句'),'success');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count,0);
assert.match(await send('reader1','3','以上'),/合并保存/);
let notes=sqlite.prepare('SELECT body,tags FROM notes ORDER BY rowid').all();
assert.equal(notes.length,1);
assert.equal(notes[0].body,'第一句 #日记\n第二句');
assert.deepEqual(JSON.parse(notes[0].tags),['日记']);
await send('reader1','3','以上');
await send('reader1','2','第二句');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count,1);
await send('reader1','4','新一段');
await send('reader2','5','另一个微信号');
await send('reader2','6','以上');
await send('reader1','7','以上');
notes=sqlite.prepare('SELECT body FROM notes ORDER BY rowid').all();
assert.deepEqual(notes.map(n=>n.body),['第一句 #日记\n第二句','另一个微信号','新一段']);
assert.match(await send('reader1','8','以上'),/没有待保存/);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notes').get().count,3);
console.log('WeChat signature, grouping, duplicate delivery, and account isolation checks passed');
