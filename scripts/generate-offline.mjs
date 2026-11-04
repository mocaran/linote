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
const startupGuard = `<script>(function(){setTimeout(function(){if(window.linoteReady)return;var box=document.createElement('div');box.style.cssText='position:fixed;z-index:100;left:12px;right:12px;bottom:12px;background:#fff;border:1px solid #c94b4b;border-radius:9px;padding:14px;color:#333;box-shadow:0 8px 25px #0002;font:14px sans-serif';box.textContent='linote 页面未正常启动。';var button=document.createElement('button');button.type='button';button.textContent='重试页面';button.style.cssText='margin-left:12px;border:0;border-radius:5px;background:#c94b4b;color:white;padding:7px 12px';button.onclick=function(){location.reload()};box.appendChild(button);document.body.appendChild(box)},4000)})()</script>`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#c94b4b"><title>linote</title><link rel="icon" href="/icon.png"></head><body>' + page.replace('<script src="/app.js?v=1.14" defer=""></script>',startupGuard + '<script src="/app.js?v=1.14" defer=""></script>') + '</body></html>';
fs.writeFileSync(path.join(root,'public','offline.html'),html);
let androidHtml = html.replace('<link rel="icon" href="/icon.png">','').replace('<body>','<body class="linote-android">');
for (const asset of ['styles.css','overrides.css','features.css']) {
  const tag = `<link rel="stylesheet" href="/${asset}?v=1.14"/>`;
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
