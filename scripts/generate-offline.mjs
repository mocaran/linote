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
let androidHtml = html.replace('<link rel="icon" href="/icon.png">','');
for (const asset of ['styles.css','overrides.css','features.css']) {
  const tag = `<link rel="stylesheet" href="/${asset}?v=1.8"/>`;
  if (!androidHtml.includes(tag)) throw new Error(`Missing ${asset} stylesheet in offline page`);
  const css = fs.readFileSync(path.join(root,'public',asset),'utf8').replace(/<\/style/gi,'<\\/style');
  androidHtml = androidHtml.replace(tag,`<style>${css}</style>`);
}
const scriptTag = /<script src="\/app\.js(?:\?[^\"]*)?" defer=""><\/script>/;
if (!scriptTag.test(androidHtml)) throw new Error('Missing app script in offline page');
const js = fs.readFileSync(path.join(root,'public','app.js'),'utf8').replace(/<\/script/gi,'<\\/script');
androidHtml = androidHtml.replace(scriptTag,`<script>${js}</script>`);
fs.writeFileSync(path.join(root,'public','android-offline.html'),androidHtml);
console.log('Generated offline web and self-contained Android pages');
