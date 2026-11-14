import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code=fs.readFileSync('public/theme.js','utf8');
function boot(saved,systemDark=false,nativeSystemDark) {
  const tokens={},root={dataset:{},style:{setProperty:(k,v)=>tokens[k]=v}};
  const media={matches:systemDark,addEventListener:(_,fn)=>media.change=fn};
  const events={};
  const document={documentElement:root,querySelector:()=>null,createElement:()=>({}),head:{append(){}},getElementById:()=>null,readyState:'loading',addEventListener(){}};
  vm.runInNewContext(code,{document,window:{LinoteAppearance:nativeSystemDark===undefined?undefined:{isSystemDark:()=>nativeSystemDark,setTheme(){}},addEventListener:(key,fn)=>events[key]=fn},localStorage:{getItem:()=>saved},matchMedia:()=>media});
  return {tokens,root,media};
}
function luminance(hex) {return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const mode of ['light','dark']) for(const palette of ['red','blue','green','violet','rose','amber','tea','graphite']) for(const accent of [null,'#ffffff','#000000','#ffff00','#00ff00','#0000ff']) for(const tint of [0,5,20]) {
  const {tokens:t}=boot(JSON.stringify({mode,palette,accent,tint}));
  const label=JSON.stringify({mode,palette,accent,tint});
  for(const surface of ['paper','sidebar','soft']) {
    assert.ok(contrast(t['--t-ink'],t['--t-'+surface])>=4.5,'body contrast '+surface+' '+label);
    assert.ok(contrast(t['--t-accent-text'],t['--t-'+surface])>=4.5,'accent contrast '+surface+' '+label);
  }
  assert.ok(contrast(t['--t-page-ink'],t['--t-bg'])>=4.5,'page contrast '+label);
  assert.ok(contrast(t['--t-note-ink'],t['--t-note'])>=4.5,'note contrast '+label);
  assert.ok(contrast(t['--t-note-accent'],t['--t-note'])>=4.5,'note accent contrast '+label);
  assert.ok(contrast(t['--t-on-accent'],t['--t-accent'])>=4.5,'button contrast '+label);
}
for(const mode of ['light','dark']) for(const page of ['#ffffff','#101010','#eaafc8','#205f85']) for(const note of ['#ffffff','#101010','#ffe6b5','#32553d']) {
  const backgrounds={light:{page,note},dark:{page,note}};
  const {tokens:t}=boot(JSON.stringify({mode,backgrounds}));
  assert.equal(t['--t-bg'],page);assert.equal(t['--t-note'],note);
  assert.ok(contrast(t['--t-page-ink'],page)>=4.5);
  assert.ok(contrast(t['--t-note-ink'],note)>=4.5);
  assert.ok(contrast(t['--t-note-accent'],note)>=4.5);
}
const system=boot(JSON.stringify({mode:'system',palette:'blue'}),false);
assert.equal(system.root.dataset.theme,'light');system.media.matches=true;system.media.change();assert.equal(system.root.dataset.theme,'dark');
const fixed=boot(JSON.stringify({mode:'light'}),true);assert.equal(fixed.root.dataset.theme,'light');
assert.equal(boot(JSON.stringify({mode:'system'}),false,true).root.dataset.theme,'dark','Android follows system even when WebView reports light');
assert.equal(boot('{bad json').root.dataset.theme,'light');
assert.equal(boot(JSON.stringify({mode:'invalid',accent:'red;display:none',tint:999})).root.dataset.theme,'light');
const android=fs.readFileSync('public/android-offline.html','utf8');
assert.ok(android.includes('linote.appearance.v1') && android.includes('theme-palettes'));
assert.ok(!/src="\/theme\.js/.test(android),'Android theme must be bundled for offline startup');
console.log('Theme contrast, system switching, preference recovery and Android offline bundle checks passed');
