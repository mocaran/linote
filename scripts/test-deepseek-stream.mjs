import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'lib','deepseek-stream.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function('module','exports',code)(module,module.exports);
const {readDeepSeekStream,sseResponse}=module.exports;

const payload='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'正在思考：'}}]})+'\n\n'
  +'data: '+JSON.stringify({choices:[{delta:{reasoning_content:'笔记线索',content:'你好'}}]})+'\n\n'
  +'data: [DONE]\n\n';
const bytes=new TextEncoder().encode(payload);
const body=new ReadableStream({start(controller){
  for(let index=0;index<bytes.length;index+=3) controller.enqueue(bytes.slice(index,index+3));
  controller.close();
}});
const events=[];
const result=await readDeepSeekStream(new Response(body),(event,data)=>events.push([event,data.text]));
assert.deepEqual(result,{content:'你好',reasoning:'正在思考：笔记线索'});
assert.deepEqual(events.map(event=>event[0]),['reasoning','reasoning','answer']);
const response=sseResponse(async send=>{send('progress',{text:'整理中'});send('done',{answer:'完成'});});
const text=await response.text();
assert.match(response.headers.get('Content-Type'),/text\/event-stream/);
assert.match(text,/event: progress\ndata: \{"text":"整理中"\}/);
assert.match(text,/event: done\ndata: \{"answer":"完成"\}/);
let finish;
const delayed=sseResponse(async send=>{send('progress',{text:'已开始'});await new Promise(resolve=>{finish=resolve;});send('done',{answer:'完成'});});
const reader=delayed.body.getReader();
const first=await reader.read();
assert.match(new TextDecoder().decode(first.value),/event: progress/);
finish();
await reader.read();
console.log('DeepSeek streaming checks passed');
