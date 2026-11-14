(() => {
  'use strict';
  const KEY = 'linote.appearance.v1';
  const defaults = {mode:'light', palette:'red', accent:null, tint:5};
  const palettes = [
    ['red','经典红','#c94b4b'], ['blue','雾蓝','#477ebd'],
    ['green','森林','#368269'], ['violet','鸢尾','#8261ba'],
    ['rose','玫瑰','#bc5682'], ['amber','琥珀','#a56b22'],
    ['tea','奶茶','#95715b'], ['graphite','石墨','#687580'],
  ];
  const hex = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {mode:['light','dark','system'].includes(value.mode)?value.mode:defaults.mode,
      palette:palettes.some(p=>p[0]===value.palette)?value.palette:defaults.palette,
      accent:hex(value.accent)?value.accent:null,
      tint:typeof value.tint==='number' && Number.isFinite(value.tint)?Math.min(20,Math.max(0,value.tint)):defaults.tint};
  }
  function read() { try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return {...defaults}; } }
  let settings = read();
  const media = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const rgb = color => [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  function mix(a,b,amount) {
    const x=rgb(a), y=rgb(b);
    return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*amount).toString(16).padStart(2,'0')).join('');
  }
  function luminance(color) { return rgb(color).map(v=>{v/=255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0); }
  function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
  function readable(color, surfaces, dark) {
    const target=dark?'#ffffff':'#000000';
    let result=color;
    for(let n=0;n<=100 && surfaces.some(surface=>contrast(result,surface)<4.5);n++) result=mix(color,target,n/100);
    return result;
  }
  function colors(palette, accent, dark, tint) {
    const seed=accent || palettes.find(p=>p[0]===palette)[2];
    const bg=mix(dark?'#141518':'#f7f7f8',seed,tint/100);
    const paper=mix(dark?'#202125':'#ffffff',seed,tint/300);
    const sidebar=mix(dark?'#191a1e':'#fcfcfc',seed,tint/220);
    const ink=dark?'#eeeeef':'#29292e';
    const muted=dark?'#aaaab4':'#707078';
    const soft=mix(paper,seed,dark?.17:.08);
    const accentText=readable(seed,[paper,bg,sidebar,soft],dark);
    const button=mix(seed,dark?'#ffffff':'#000000',dark?.25:0);
    const onAccent=contrast('#ffffff',button)>=contrast('#000000',button)?'#ffffff':'#000000';
    return {'bg':bg,'paper':paper,'sidebar':sidebar,'ink':ink,'muted':muted,
      'line':mix(paper,ink,dark?.14:.12),'soft':soft,
      'field':mix(paper,ink,dark?.035:.025),'accent':button,'accent-text':accentText,
      'accent-hover':mix(button,onAccent==='#ffffff'?'#000000':'#ffffff',.12),'on-accent':onAccent,
      'danger':dark?'#ff999e':'#ad303c','overlay':dark?'#000000a8':'#17172266',
      'shadow':dark?'0 20px 80px #0006':'0 20px 80px #24203018'};
  }
  let currentColors;
  function systemDark() {
    try { if(window.LinoteAppearance?.isSystemDark) return window.LinoteAppearance.isSystemDark(); } catch {}
    return media.matches;
  }
  function apply() {
    const dark=settings.mode==='dark' || (settings.mode==='system' && systemDark());
    root.dataset.theme=dark?'dark':'light';
    root.style.colorScheme=dark?'dark':'light';
    currentColors=colors(settings.palette,settings.accent,dark,settings.tint);
    for(const [key,value] of Object.entries(currentColors)) root.style.setProperty('--t-'+key,value);
    // Retain the old variable names used by the note renderer.
    for(const key of ['bg','paper','ink','muted','line','soft']) root.style.setProperty('--'+key,currentColors[key]);
    root.style.setProperty('--green',currentColors.accent);
    root.style.setProperty('--green-dark',currentColors['accent-hover']);
    let meta=document.querySelector('meta[name="theme-color"]');
    if(!meta) { meta=document.createElement('meta');meta.name='theme-color';document.head.append(meta); }
    meta.content=currentColors.sidebar;
    try { window.LinoteAppearance?.setTheme(currentColors.sidebar,dark); } catch {}
    if(document.getElementById('themeLayer')) refreshControls();
  }
  function update(patch) {
    settings=normalize({...settings,...patch});apply();
    try { localStorage.setItem(KEY,JSON.stringify(settings));document.getElementById('themeSaveStatus').textContent='已保存到此设备 · 离线可用'; }
    catch { document.getElementById('themeSaveStatus').textContent='当前已应用，但设备存储不可用，重开后可能需要重新选择'; }
  }
  function refreshControls() {
    document.querySelectorAll('[data-theme-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.themeMode===settings.mode)));
    document.querySelectorAll('[data-theme-palette]').forEach(el=>{
      el.setAttribute('aria-pressed',String(el.dataset.themePalette===settings.palette && !settings.accent));
      const c=colors(el.dataset.themePalette,null,root.dataset.theme==='dark',settings.tint);
      el.style.setProperty('--sample-bg',c.bg);el.style.setProperty('--sample-paper',c.paper);el.style.setProperty('--sample-accent',c.accent);el.style.setProperty('--sample-ink',c.muted);
    });
    const accent=settings.accent || palettes.find(p=>p[0]===settings.palette)[2];
    document.getElementById('themeAccent').value=accent;
    if(document.activeElement!==document.getElementById('themeHex')) document.getElementById('themeHex').value=accent.toUpperCase();
    document.getElementById('themeTint').value=settings.tint;
    document.getElementById('themeTintValue').textContent=settings.tint===0?'中性灰':Math.round(settings.tint/20*100)+'%';
    document.getElementById('themePreviewName').textContent=(settings.accent?'自选颜色':palettes.find(p=>p[0]===settings.palette)[1])+' · '+(root.dataset.theme==='dark'?'深色':'浅色');
  }
  let previousFocus;
  function close() {
    const layer=document.getElementById('themeLayer');
    if(!layer || layer.hidden) return false;
    layer.hidden=true;document.body.classList.remove('theme-open');
    previousFocus?.focus({preventScroll:true});return true;
  }
  function open() {
    previousFocus=document.activeElement;
    document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileShade').hidden=true;
    document.getElementById('themeLayer').hidden=false;document.body.classList.add('theme-open');
    refreshControls();document.getElementById('themeClose').focus({preventScroll:true});
  }
  window.linoteTheme={close,isOpen:()=>!!document.getElementById('themeLayer') && !document.getElementById('themeLayer').hidden};
  apply();
  media.addEventListener('change',()=>{if(settings.mode==='system') apply();});
  window.addEventListener('linote-system-theme',()=>{if(settings.mode==='system') apply();});
  window.addEventListener('storage',event=>{if(event.key===KEY){settings=read();apply();}});
  function init() {
    const layer=document.createElement('div');layer.id='themeLayer';layer.className='theme-layer';layer.hidden=true;
    layer.innerHTML=`<div class="theme-backdrop" id="themeBackdrop"></div><section class="theme-dialog" role="dialog" aria-modal="true" aria-labelledby="themeTitle"><header><div><h2 id="themeTitle">主题颜色</h2><p>让每一页，都有舒服的颜色。</p></div><button type="button" id="themeClose" aria-label="关闭主题颜色">×</button></header><div class="theme-content"><fieldset><legend>外观模式</legend><div class="theme-modes"><button type="button" data-theme-mode="light">☀ 浅色</button><button type="button" data-theme-mode="dark">☾ 深色</button><button type="button" data-theme-mode="system">◐ 跟随系统</button></div></fieldset><fieldset><legend>配色方案</legend><div class="theme-palettes">${palettes.map(p=>`<button type="button" class="theme-palette" data-theme-palette="${p[0]}" aria-pressed="false"><span class="theme-sample" aria-hidden="true"><i></i><span><b></b><em></em><em></em></span></span><span class="theme-palette-label">${p[1]}<span class="theme-check" aria-hidden="true">✓</span></span></button>`).join('')}</div></fieldset><fieldset><legend>自由调整</legend><div class="theme-custom-row"><label for="themeAccent">强调色<small>按钮、话题和选中状态</small></label><div class="theme-color-input"><input type="color" id="themeAccent" aria-label="自选强调色"><input type="text" id="themeHex" aria-label="强调色十六进制色值" maxlength="7" spellcheck="false"></div></div><div class="theme-custom-row"><label for="themeTint">背景染色<small>页面与笔记背景一起协调变化</small></label><output id="themeTintValue" for="themeTint"></output></div><input type="range" id="themeTint" min="0" max="20" step="1" aria-label="背景染色程度"><div class="theme-range-labels"><span>中性</span><span>浓郁</span></div></fieldset><div class="theme-preview"><div class="theme-preview-card"><small id="themePreviewName"></small><p>保卫个人史，记下每一个想法。</p><span class="theme-preview-tag">#此刻</span></div></div></div><footer><span id="themeSaveStatus" role="status">选择即生效 · 已保存到此设备</span><button type="button" id="themeReset">恢复默认</button></footer></section>`;
    document.body.append(layer);
    document.getElementById('themeButton')?.addEventListener('click',open);
    document.getElementById('themeClose').addEventListener('click',close);
    document.getElementById('themeBackdrop').addEventListener('click',close);
    layer.querySelectorAll('[data-theme-mode]').forEach(el=>el.addEventListener('click',()=>update({mode:el.dataset.themeMode})));
    layer.querySelectorAll('[data-theme-palette]').forEach(el=>el.addEventListener('click',()=>update({palette:el.dataset.themePalette,accent:null})));
    document.getElementById('themeAccent').addEventListener('input',event=>update({accent:event.target.value}));
    const input=document.getElementById('themeHex');
    input.addEventListener('input',()=>{if(hex(input.value)) update({accent:input.value});});
    input.addEventListener('blur',()=>{input.value=(settings.accent || palettes.find(p=>p[0]===settings.palette)[2]).toUpperCase();});
    document.getElementById('themeTint').addEventListener('input',event=>update({tint:Number(event.target.value)}));
    document.getElementById('themeReset').addEventListener('click',()=>update({...defaults}));
    layer.addEventListener('keydown',event=>{
      if(event.key!=='Tab') return;
      const items=[...layer.querySelectorAll('button,input')].filter(el=>!el.disabled);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    });
    refreshControls();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
