import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root,'app','notes-page.tsx'),'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module = {exports:{}};
new Function('require','module','exports',compiled)(createRequire(import.meta.url),module,module.exports);
const page = renderToStaticMarkup(React.createElement(module.exports.default));
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#c94b4b"><title>linote</title><link rel="icon" href="/icon.png"></head><body>' + page + '</body></html>';
fs.writeFileSync(path.join(root,'public','offline.html'),html);
console.log('Generated offline app shell');
