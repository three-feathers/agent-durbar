/* Spec 080 T015 (FR-002, FR-006, FR-007, FR-009, FR-012, FR-090): the chat panel's Chat | Browser tabs, the browser bar and the pane.
   The page itself is a native view that main owns (FR-001); this file only draws the bar, and sends main the page area's rectangle
   and whether the Browser tab is shown (FR-003). Nothing here reads the page: the window gets a BrowserState (address, title, loading,
   history, sound, a network error name) and nothing else. Pure helpers first (tested in scripts/test-browserpane.ts), DOM below.
   In the page: window.DurbarBrowserPane; in Node: module.exports. Phase 1 has no agent control. Also here: the one-time note (askConsent),
   the *Leave this page?* box (onLeave), the hidden session's dialog (onDialog) and the overlay still picture (overlay, clearCover). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrowserPane=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';

  /* ---- pure ---- */
  /* The roving tabindex of a tablist (WAI-ARIA): the next tab for an arrow key, -1 for any other key. */
  function tabKey(key,index,count){
    if(!(count>0))return -1;
    if(key==='ArrowRight')return (index+1)%count;
    if(key==='ArrowLeft')return (index-1+count)%count;
    if(key==='Home')return 0;
    if(key==='End')return count-1;
    return -1;
  }
  /* What the bar shows for a state: every word and flag in one place, so the DOM code only copies it. */
  function barModel(s){
    const open=!!(s&&s.open), loading=open&&!!s.loading, err=open&&!loading&&typeof s.error==='string'&&s.error?s.error:'';
    const url=open&&typeof s.url==='string'?s.url:'';
    return {
      open,
      address:url,
      canBack:open&&!!s.canBack,
      canForward:open&&!!s.canForward,
      reload:loading?'stop':'reload',
      reloadLabel:loading?'Stop':'Reload',
      status:open&&s.tabLimit===true?{kind:'limit',word:TAB_LIMIT}:loading?{kind:'loading',word:'Loading…'}:s&&typeof s.failed==='string'?{kind:'error',word:s.failed}:err?{kind:'error',word:'Could not load this page ('+err+')'}:!open&&!(s&&s.connecting)?{kind:'closed',word:'The page closed with the session.'}:open&&typeof s.note==='string'&&s.note?{kind:'dialog',word:s.note}:open&&s.memory==='reloaded'?{kind:'memory',word:'Reloaded to save memory'}:open&&s.memory==='many'?{kind:'memory',word:'Many pages are open; close some to save memory.'}:null,
      title:open&&!loading&&!err&&typeof s.title==='string'?s.title:'',
      sound:open&&s.muted===false?{on:true,word:'Sound on',hint:'Mute this page'}:{on:false,word:'Sound off',hint:'Turn the sound on'},
      dialogOpen:open&&s.dialogOpen===true,
      system:open&&/^https?:\/\//i.test(url)
    };
  }
  /* Spec 080 FR-130: the tab keys. Kept identical to tabShortcut in src/main/browser/tabs.ts (test:browsertabs runs both on one table). */
  function tabShortcut(e,mac){
    if(!e)return null;
    if(e.type!==undefined&&e.type!=='keyDown'&&e.type!=='keydown')return null;
    const ctrl=!!(e.control!==undefined?e.control:e.ctrlKey),meta=!!(e.meta!==undefined?e.meta:e.metaKey),shift=!!(e.shift!==undefined?e.shift:e.shiftKey),alt=!!(e.alt!==undefined?e.alt:e.altKey);
    if(alt)return null;
    const key=typeof e.key==='string'?e.key:'',code=typeof e.code==='string'?e.code:'';
    if(ctrl&&!meta&&(key==='Tab'||code==='Tab'))return shift?'prev':'next';
    if(ctrl&&!meta&&!shift&&(key==='PageDown'||code==='PageDown'))return 'next';
    if(ctrl&&!meta&&!shift&&(key==='PageUp'||code==='PageUp'))return 'prev';
    const mod=mac?meta&&!ctrl:ctrl&&!meta;
    if(!mod||shift)return null;
    const letter=/^[a-z]$/i.test(key)?key.toLowerCase():code==='KeyT'?'t':code==='KeyW'?'w':'';
    return letter==='t'?'new':letter==='w'?'close':null;
  }
  const TAB_MAX=10;
  const TAB_LIMIT='This browser has 10 tabs, the most it can hold. Close one to open another.';
  const escH=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function hostOf(u){try{const x=new URL(u);return x.host||'';}catch(e){return '';}}
  /* FR-122: the name a tab shows: the page title, else its host, else New tab (page text: escaped where it is written) */
  function tabName(x){return x&&typeof x.title==='string'&&x.title.trim()?x.title.trim():x&&hostOf(x.url)?hostOf(x.url):'New tab';}
  /* FR-122, FR-133: what a tab's state says, as an icon and a word (never colour alone) */
  function tabState(x){
    if(!x)return null;
    if(x.dialogOpen)return {icon:'dialog',word:'Dialog open'};
    if(x.loading)return {icon:'loading',word:'Loading'};
    if(x.memory==='dropped')return {icon:'memory',word:'Unloaded to save memory'};
    if(x.memory==='reloaded')return {icon:'memory',word:'Reloaded to save memory'};
    return null;
  }
  /* FR-122, FR-133: the inner tablist of page tabs. Each tab is a role=tab button with aria-selected, aria-controls the page area and a roving
     tabindex; its close button is a sibling, named Close <title>. Titles are page text: escaped. */
  function stripHTML(t){
    const tabs=t&&Array.isArray(t.tabs)?t.tabs:[];
    let h='';
    tabs.forEach((x,i)=>{
      if(!x||typeof x.tabId!=='string'||!/^t[0-9a-f]{8}$/.test(x.tabId))return;
      const sel=x.tabId===t.active,name=tabName(x),st=tabState(x);
      h+='<div class="btab'+(sel?' on':'')+'" data-tab="'+x.tabId+'" role="presentation">'
        +'<button class="btab-b" role="tab" type="button" id="btab-'+x.tabId+'" aria-selected="'+sel+'" aria-controls="bView" aria-setsize="'+tabs.length+'" aria-posinset="'+(i+1)+'" tabindex="'+(sel?0:-1)+'" title="'+escH(name)+(st?' ('+st.word+')':'')+'">'
        +(st?SVG[st.icon]:SVG.page)+'<span class="btab-t">'+escH(name)+'</span>'+(st?'<span class="sr-only">, '+st.word+'</span>':'')+'</button>'
        +'<button class="btab-x" type="button" tabindex="-1" data-close="'+x.tabId+'" aria-label="Close '+escH(name)+'" title="Close this tab">'+SVG.stop+'</button></div>';
    });
    return h;
  }
  /* The tab next to `id` for Ctrl+Tab (step 1) and Ctrl+Shift+Tab (-1), wrapping; or for the strip's arrow keys */
  function tabStep(t,id,step){
    const ids=t&&Array.isArray(t.tabs)?t.tabs.map(x=>x.tabId):[];
    if(!ids.length)return null;
    const i=Math.max(0,ids.indexOf(id));
    return ids[(i+step+ids.length)%ids.length];
  }
  /* The page area's rectangle for main, in CSS pixels; null when it has no size to give. */
  function boundsOf(r){
    if(!r)return null;
    const x=Math.round(r.left),y=Math.round(r.top),w=Math.round(r.width),h=Math.round(r.height);
    return [x,y,w,h].every(Number.isFinite)&&w>=1&&h>=1?{x,y,width:w,height:h}:null;
  }

  /* ---- DOM ---- */
  const SVG={
    back:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3L4.5 8l5 5"/></svg>',
    fwd:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3l5 5-5 5"/></svg>',
    reload:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5v3h-3"/></svg>',
    stop:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    soundOn:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2h2.3L8 3.4v9.2L4.8 9.8H2.5z"/><path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.8a6 6 0 0 1 0 8.4"/></svg>',
    soundOff:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2h2.3L8 3.4v9.2L4.8 9.8H2.5z"/><path d="M10.6 6l3 4M13.6 6l-3 4"/></svg>',
    system:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5"/><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>',
    loading:'<svg class="bspin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 1-5.8 5.8"/></svg>',
    error:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 4.8v3.8M8 11.1v.1"/></svg>',
    dialog:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.2" y="3" width="11.6" height="9" rx="1.8"/><path d="M5 6.2h6M5 8.8h3.6"/></svg>',
    memory:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="10" height="8" rx="1.5"/><path d="M6 2v2M10 2v2M6 12v2M10 12v2"/></svg>',
    closed:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M5 8h6"/></svg>',
    page:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/></svg>',
    plus:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    more:'<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
    limit:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 4.8v3.8M8 11.1v.1"/></svg>'
  };

  let bridge=null, cur=null; /* cur: the mounted panel's browser {id, tab, ro, shown, state, sizeQueued} */
  const states=new Map();
  const tabLists=new Map(); /* spec 080 FR-127: the last browser:tabs of each session (main's list; the window never makes a tab id) */
  let linksNewTab=false; /* FR-123: the app-wide toggle, as main last said */
  const IS_MAC=typeof navigator!=='undefined'&&/Mac/i.test(navigator.platform||'');
  let unsub=null;
  const $=id=>document.getElementById(id);

  let host={}; /* what app.js lends: ask (askDialog), say (toast), nameOf, bringForward, marksChanged */
  const unsubs=[];
  function init(o){
    bridge=(o&&o.bridge)||null;
    host=o||{};
    while(unsubs.length)unsubs.pop()();
    if(bridge&&bridge.onBrowserState)unsubs.push(bridge.onBrowserState(s=>{
      if(!s||typeof s.id!=='string')return;
      const was=!!(states.get(s.id)&&states.get(s.id).dialogOpen);
      states.set(s.id,s);
      if(cur&&cur.id===s.id){cur.state=s;render();}
      if(was!==(s.dialogOpen===true)&&host.marksChanged)host.marksChanged();
    }));
    if(bridge&&bridge.onBrowserTabs)unsubs.push(bridge.onBrowserTabs(t=>{
      if(!t||typeof t.id!=='string')return;
      const before=tabLists.get(t.id);
      tabLists.set(t.id,t);
      if(cur&&cur.id===t.id){
        /* FR-129: a page opened a background tab: no focus moves, the change is announced */
        if(before&&Array.isArray(before.tabs)&&Array.isArray(t.tabs)){
          const old=new Set(before.tabs.map(x=>x.tabId));
          if(t.tabs.some(x=>!old.has(x.tabId)&&x.tabId!==t.active))announce('Opened in a new tab');
        }
        renderStrip();render();
      }
      if(host.marksChanged)host.marksChanged();
    }));
    if(bridge&&bridge.onBrowserKey)unsubs.push(bridge.onBrowserKey(k=>{if(k&&cur&&cur.id===k.id&&cur.tab==='browser')tabAction(k.key,{from:'page'});}));
    if(bridge&&bridge.onBrowserLinksNewTab)unsubs.push(bridge.onBrowserLinksNewTab(on=>{linksNewTab=on===true;}));
    if(bridge&&bridge.onBrowserDialog)unsubs.push(bridge.onBrowserDialog(d=>onDialog(d)));
    if(bridge&&bridge.onBrowserLeave)unsubs.push(bridge.onBrowserLeave(a=>onLeave(a)));
  }
  /* FR-025d, FR-132: a page dialog waits in any tab of this session */
  const dialogOpen=id=>!!(states.get(id)&&states.get(id).dialogOpen)||!!(tabLists.get(id)&&Array.isArray(tabLists.get(id).tabs)&&tabLists.get(id).tabs.some(x=>x&&x.dialogOpen));
  /* The tabs exist for a live top-level session, and only in the app (the page without the bridge has no browser). */
  function available(a){return !!(bridge&&bridge.browserOpen&&a&&a.live&&!a.parent);}

  function tabsHTML(){
    return '<div class="ptabs" id="panelTabs" role="tablist" aria-label="Chat or browser">'
      +'<button class="ptab" id="tabChat" role="tab" type="button" aria-selected="true" aria-controls="chat" tabindex="0">Chat</button>'
      +'<button class="ptab" id="tabBrowser" role="tab" type="button" aria-selected="false" aria-controls="browserPane" tabindex="-1">Browser</button></div>';
  }
  function paneHTML(){
    return '<div class="bpane" id="browserPane" role="tabpanel" aria-labelledby="tabBrowser" hidden>'
      /* spec 080 FR-122, FR-133: the page tabs, above the bar */
      +'<div class="bstrip"><div class="btabs" id="bTabs" role="tablist" aria-label="Pages"></div>'
      +'<button class="bnew" id="bNewTab" type="button" aria-label="New tab" title="New tab">'+SVG.plus+'</button>'
      +'<span class="sr-only" id="bLimitText">'+TAB_LIMIT+'</span><span class="sr-only" id="bLive" aria-live="polite"></span></div>'
      +'<div class="bbar" role="toolbar" aria-label="Browser controls">'
      +'<button class="bbtn" id="bBack" type="button" aria-label="Back" title="Back">'+SVG.back+'</button>'
      +'<button class="bbtn" id="bFwd" type="button" aria-label="Forward" title="Forward">'+SVG.fwd+'</button>'
      +'<button class="bbtn" id="bReload" type="button" aria-label="Reload" title="Reload">'+SVG.reload+'</button>'
      +'<input class="baddr" id="bAddr" type="text" aria-label="Address" placeholder="Type a web address, for example localhost:3000" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="2100">'
      +'<button class="bbtn" id="bMore" type="button" aria-label="More browser actions" title="More browser actions" aria-haspopup="menu" aria-expanded="false">'+SVG.more+'</button>'
      +'</div>'
      +'<div class="bstat"><span class="bnote" id="bNote" role="status" aria-live="polite"></span><span class="btitle" id="bTitle"></span>'
      +'<span class="bacts"><button class="bchip" id="bSound" type="button"></button><button class="bchip" id="bSys" type="button" title="Open this page in your system browser">'+SVG.system+'<span>Open in system browser</span></button></span></div>'
      +'<div class="bview" id="bView"></div></div>';
  }

  /* Which tab a rebuilt panel starts on: the same session keeps its tab (the panel is rebuilt on a rename), any other starts on Chat. */
  function startTab(id){if(want&&want.id===id){const t=want.tab;want=null;return t;}return cur&&cur.id===id?cur.tab:'chat';}

  function setSelected(tab){
    const chat=tab==='chat';
    const pin=document.querySelector('#panel .panel-in');
    if(pin)pin.classList.toggle('on-browser',!chat);
    const tc=$('tabChat'),tb=$('tabBrowser'),pane=$('browserPane');
    if(tc){tc.setAttribute('aria-selected',String(chat));tc.tabIndex=chat?0:-1;}
    if(tb){tb.setAttribute('aria-selected',String(!chat));tb.tabIndex=chat?-1:0;}
    if(pane)pane.hidden=chat;
  }

  function render(){
    if(!cur)return;
    const m=barModel(cur.state);
    const set=(id,fn)=>{const e=$(id);if(e)fn(e);};
    set('bBack',e=>{e.disabled=!m.canBack;});
    set('bFwd',e=>{e.disabled=!m.canForward;});
    set('bReload',e=>{e.disabled=!m.open;e.innerHTML=SVG[m.reload];e.setAttribute('aria-label',m.reloadLabel);e.title=m.reloadLabel;e.dataset.mode=m.reload;});
    set('bAddr',e=>{e.disabled=false;if(document.activeElement!==e||!cur.typing)e.value=m.address;});
    set('bNote',e=>{
      e.dataset.kind=m.status?m.status.kind:'';
      e.innerHTML=m.status?SVG[m.status.kind]+'<span></span>':'';
      if(m.status)e.querySelector('span').textContent=m.status.word;
    });
    set('bTitle',e=>{e.textContent=m.title;e.title=m.title;});
    set('bSound',e=>{e.disabled=!m.open;e.innerHTML=(m.sound.on?SVG.soundOn:SVG.soundOff)+'<span></span>';e.querySelector('span').textContent=m.sound.word;e.title=m.sound.hint;e.dataset.on=String(m.sound.on);});
    set('bSys',e=>{e.disabled=!m.system;});
    set('tabBrowser',e=>{e.textContent=m.dialogOpen?'Browser · Dialog open':'Browser';});
  }

  /* FR-122: the strip of the mounted session; focus stays on the same tab button when the list is redrawn */
  function renderStrip(){
    if(!cur)return;
    const el=$('bTabs');if(!el)return;
    const t=tabLists.get(cur.id)||null;
    const had=document.activeElement&&el.contains(document.activeElement)?document.activeElement.closest('[data-tab]'):null;
    const keep=had?had.dataset.tab:null;
    el.innerHTML=stripHTML(t);
    const n=t&&Array.isArray(t.tabs)?t.tabs.length:0;
    const plus=$('bNewTab');
    if(plus){const full=n>=TAB_MAX;plus.disabled=full;if(full)plus.setAttribute('aria-describedby','bLimitText');else plus.removeAttribute('aria-describedby');plus.title=full?TAB_LIMIT:'New tab';}
    if(keep){const b=el.querySelector('[data-tab="'+keep+'"] .btab-b')||el.querySelector('.btab.on .btab-b');if(b)b.focus({preventScroll:true});}
    keepActiveInView();
  }
  /* FR-122: the strip scrolls sideways inside itself and keeps the active tab in view; never the page or the office */
  function keepActiveInView(){
    const el=$('bTabs'),on=el&&el.querySelector('.btab.on');
    if(!el||!on)return;
    const l=on.offsetLeft,r=l+on.offsetWidth;
    if(l<el.scrollLeft)el.scrollLeft=l;else if(r>el.scrollLeft+el.clientWidth)el.scrollLeft=r-el.clientWidth;
  }
  function announce(text){const e=$('bLive');if(!e)return;e.textContent='';setTimeout(()=>{if(e.isConnected)e.textContent=text;},30);}
  /* A tab answer from main: the state and the list it carries are shown at once (the pushes follow with the same data) */
  function take(r){
    if(!cur||!r)return;
    if(typeof r.linksNewTab==='boolean')linksNewTab=r.linksNewTab;
    if(r.tabs&&r.tabs.id===cur.id)tabLists.set(cur.id,r.tabs);
    if(r.state&&r.state.id===cur.id){cur.state=r.state;states.set(cur.id,r.state);}
    renderStrip();render();
  }
  function showLimit(){
    const n=$('bNote');
    if(n){n.dataset.kind='limit';n.innerHTML=SVG.limit+'<span></span>';n.querySelector('span').textContent=TAB_LIMIT;}
  }
  /* FR-127, FR-129, FR-130: the tab actions, from +, x, the strip's keys, the bar's keys and the page's keys (main sends those). The window
     only names tabs main listed; main checks each one again. */
  async function tabAction(what,o){
    if(!cur||!bridge)return;
    const id=cur.id,t=tabLists.get(id)||null,active=t&&t.active;
    o=o||{};
    if(what==='new'){
      if(!bridge.browserNewTab)return;
      const r=await bridge.browserNewTab(id).catch(()=>null);
      if(!cur||cur.id!==id)return;
      if(r&&r.ok===false&&r.needsConsent)return;
      if(r&&r.ok===false&&r.tabLimit){showLimit();return;}
      take(r);
      const a=$('bAddr');if(a){a.value='';a.focus({preventScroll:true});} /* FR-129: + and Ctrl+T focus the new tab's address field */
      return;
    }
    if(what==='close'){
      const tabId=o.tabId||active;
      if(!tabId||!bridge.browserCloseTab)return;
      const r=await bridge.browserCloseTab(id,tabId).catch(()=>null);
      if(!cur||cur.id!==id)return;
      take(r);
      /* FR-129: closed from the strip by keyboard: focus the newly active tab there; otherwise the address field */
      if(o.from==='strip'){const b=document.querySelector('#bTabs .btab.on .btab-b');if(b){b.focus({preventScroll:true});return;}}
      if(o.from!=='mouse'||document.activeElement===document.body){const a=$('bAddr');if(a)a.focus({preventScroll:true});}
      return;
    }
    if(what==='next'||what==='prev'){
      const to=tabStep(t,active,what==='next'?1:-1);
      if(to&&to!==active)await selectTab(to,{focus:o.from==='strip'});
    }
  }
  async function selectTab(tabId,o){
    if(!cur||!bridge||!bridge.browserSelectTab)return;
    const id=cur.id;
    const r=await bridge.browserSelectTab(id,tabId).catch(()=>null);
    if(!cur||cur.id!==id)return;
    take(r);
    if(o&&o.focus){const b=document.querySelector('#bTabs [data-tab="'+tabId+'"] .btab-b');if(b)b.focus({preventScroll:true});}
  }
  /* FR-133: the strip's own keys: arrows, Home and End move the focus (roving tabindex), Enter or Space selects, Delete closes */
  function stripKey(e){
    const b=e.target&&e.target.closest&&e.target.closest('.btab-b');
    if(!b||e.altKey||e.ctrlKey||e.metaKey)return;
    const items=[...document.querySelectorAll('#bTabs .btab-b')],i=items.indexOf(b);
    const tabId=b.closest('[data-tab]').dataset.tab;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();selectTab(tabId,{focus:true});return;}
    if(e.key==='Delete'){e.preventDefault();e.stopPropagation();tabAction('close',{tabId,from:'strip'});return;}
    const n=tabKey(e.key,i,items.length);
    if(n<0)return;
    e.preventDefault();e.stopPropagation();
    items.forEach((x,j)=>{x.tabIndex=j===n?0:-1;});
    items[n].focus({preventScroll:true});
    const el=$('bTabs'),w=items[n].parentElement;
    if(el&&w){const l=w.offsetLeft,r=l+w.offsetWidth;if(l<el.scrollLeft)el.scrollLeft=l;else if(r>el.scrollLeft+el.clientWidth)el.scrollLeft=r-el.clientWidth;}
  }
  /* FR-130: the tab keys while the focus is in the strip or the bar (the page's own keys come from main) */
  function paneKey(e){
    const k=tabShortcut(e,IS_MAC);
    if(!k)return;
    e.preventDefault();e.stopPropagation();
    const inStrip=!!(e.target&&e.target.closest&&e.target.closest('#bTabs'));
    tabAction(k,{from:inStrip?'strip':'bar'});
  }
  /* FR-123: the bar's More button opens the shared menu (#modeMenu, lent by app.js) with the checkable toggle */
  function openMore(){
    const btn=$('bMore');
    if(!btn||!host.menu||!cur)return;
    const id=cur.id;
    host.menu(btn,[{act:'newtab',label:'Open chat links in a new tab',sub:'A link the session already shows goes to its tab',checked:linksNewTab}],async act=>{
      if(act!=='newtab'||!bridge.browserSetLinksNewTab)return;
      const r=await bridge.browserSetLinksNewTab(!linksNewTab).catch(()=>null);
      if(r&&r.ok&&typeof r.on==='boolean')linksNewTab=r.on;
      if(cur&&cur.id===id)announce(linksNewTab?'Chat links open in a new tab.':'Chat links open in the current tab.');
    });
  }

  /* The page area's rectangle goes to main when it changes (one send per frame). */
  function sendBounds(){
    if(!cur||cur.tab!=='browser')return Promise.resolve(false);
    const el=$('bView');
    const b=el?boundsOf(el.getBoundingClientRect()):null;
    if(!b||!bridge.browserBounds)return Promise.resolve(false);
    return Promise.resolve(bridge.browserBounds(cur.id,b)).then(r=>!!(r&&r.ok),()=>false);
  }
  function queueBounds(){
    if(!cur||cur.sizeQueued)return;
    cur.sizeQueued=true;
    requestAnimationFrame(()=>{if(!cur)return;cur.sizeQueued=false;sendBounds();});
  }
  function watchSize(){
    unwatchSize();
    const el=$('bView');
    if(el&&window.ResizeObserver){cur.ro=new ResizeObserver(queueBounds);cur.ro.observe(el);}
  }
  function unwatchSize(){if(cur&&cur.ro){cur.ro.disconnect();cur.ro=null;}}

  /* The Browser tab shown: create the view (first use), tell main where the page area is, then attach. The Chat tab: detach. */
  async function select(tab,o){
    if(!cur)return;
    const id=cur.id;
    cur.tab=tab;
    setSelected(tab);
    if(o&&o.focus){const t=$(tab==='chat'?'tabChat':'tabBrowser');if(t)t.focus({preventScroll:true});}
    if(tab==='chat'){
      unwatchSize();
      clearCover(cur);
      if(cur.shown){cur.shown=false;bridge.browserVisible(id,false);}
      if(host&&host.chatShown)host.chatShown(id); /* spec 005 FR-176: the Chat tab is in front again */
      return;
    }
    let r=await bridge.browserOpen(id).catch(()=>null);
    if(r&&r.ok===false&&r.needsConsent){
      /* FR-025d (Q2): the one-time note, once per app profile (main refuses to make a view before it). Not now: stay on Chat, nothing opens */
      if(!(await askConsent())){if(cur&&cur.id===id&&cur.tab==='browser')select('chat',{focus:true});return;}
      r=await bridge.browserOpen(id).catch(()=>null);
    }
    if(!cur||cur.id!==id||cur.tab!=='browser')return; /* the user moved on while the view was being made */
    cur.state=r&&r.ok&&r.state?r.state:{id,open:false,failed:(r&&r.reason)||'The browser could not start.'};
    if(r&&r.ok){if(r.tabs&&r.tabs.id===id)tabLists.set(id,r.tabs);if(typeof r.linksNewTab==='boolean')linksNewTab=r.linksNewTab;}
    renderStrip();
    render();
    watchSize();
    if(await sendBounds()&&cur&&cur.id===id&&cur.tab==='browser'){
      const img=$('bShot');if(img)img.remove();
      /* an overlay already open (a menu or question under which this chat came forward) keeps the view off from the start: no attach, no flash;
         otherwise main's flag is cleared (a flag left from before can never hide the view for good) */
      cur.covered=!!(host.covers&&host.covers());
      await bridge.browserOverlay(id,cur.covered).catch(()=>null);
      const v=await bridge.browserVisible(id,true).catch(()=>null);
      if(cur&&cur.id===id&&cur.tab==='browser'){cur.shown=!!(v&&v.ok);if(cur.shown&&host.recheck)host.recheck();}
      else if(v&&v.ok)bridge.browserVisible(id,false);
    }
  }

  /* FR-025d (Q2): asked through the shared askDialog, like a folder's profile; remembered in settings by main. True = the user opened the browser. */
  async function askConsent(){
    if(!host.ask)return false;
    const r=await host.ask({title:'Open the session browser?',
      body:'Each session gets its own private browser. It starts empty, is wiped when the session ends, and keeps its sound off. Chat links will open there once that is built; for now you type an address yourself. A page can show its own dialogs, which appear as system boxes; for a session whose chat is not showing, Durbar tells you which session asks and brings its chat forward. Nothing loads unless you open a Browser tab. You are asked this once.',
      buttons:[{label:'Not now',value:null},{label:'Open the browser',value:'ok',cls:'primary'}]});
    if(!r||r.value!=='ok')return false;
    const a=await bridge.browserConsentAccept().catch(()=>null);
    return !!(a&&a.ok);
  }

  /* FR-030, FR-031: where a click on a chat link goes. `rootAvailable`: the chat's root session is live and has a browser. When it is not (the demo, an ended
     or removed parent of a helper's chat) a web link goes to the system browser and any other link is refused: a link is never lost silently. */
  function linkRoute(web,mod,setting,rootAvailable){
    if(web&&(mod||setting==='system'))return 'system';
    if(!rootAvailable)return web?'system':'refuse';
    return 'tab';
  }
  /* FR-030: a chat link for this session's browser. Main classifies it (web, mail or refused) and navigates; the one-time note is asked on the first
     use, and *Not now* gives {fallback:true} (the caller opens the system browser this time). Returns main's answer. */
  async function openLink(id,url,how){
    if(!bridge||!bridge.browserOpenLink)return {ok:false,reason:'The browser is not available.'};
    const h=how==='newTab'?'newTab':'default'; /* FR-124: the link menu's Open in a new tab; the toggle itself is read in main */
    let r=await bridge.browserOpenLink(id,url,h).catch(()=>null);
    if(r&&r.ok===false&&r.needsConsent){
      if(!(await askConsent()))return {fallback:true};
      r=await bridge.browserOpenLink(id,url,h).catch(()=>null);
    }
    if(r&&r.ok){if(r.tabs&&r.tabs.id===id)tabLists.set(id,r.tabs);if(typeof r.linksNewTab==='boolean')linksNewTab=r.linksNewTab;if(cur&&cur.id===id){if(r.state)cur.state=r.state;renderStrip();render();}}
    return r||{ok:false,reason:'The browser could not start.'};
  }
  /* FR-024: the user pressed Open on a mail link; main checks it is mailto: again */
  function openMail(url){return bridge&&bridge.browserOpenMail?bridge.browserOpenMail(url).catch(()=>null):Promise.resolve(null);}

  /* FR-025d (Q3): a page dialog opened. Toast naming the session (page text, masked in main); a hidden view's chat comes forward on its Browser tab */
  function onDialog(d){
    if(!d||typeof d.id!=='string')return;
    if(d.shown)return; /* a shown view's own chat is open: the system box is next to the right session, no toast (FR-025d) */
    if(host.say)host.say(d);
    if(d.bg)return; /* FR-132: a background tab of the session that is shown: the toast and the tab's marker only, it is not selected */
    if(host.bringForward)host.bringForward(d.id,typeof d.tabId==='string'?d.tabId:undefined);
  }
  /* FR-025e: Durbar's own Leave box; a hidden view's box names its session and its chat comes forward first */
  async function onLeave(a){
    if(!a||typeof a.req!=='string')return;
    if(!a.shown&&host.bringForward)host.bringForward(a.id);
    const who=!a.shown&&host.nameOf?host.nameOf(a.id):'';
    const r=host.ask?await host.ask({title:'Leave this page?',
      body:'Changes you made may not be saved.'+(who?' This is the page in '+who+'.':''),
      lines:a.known?[]:['Leave, then click again.'],
      buttons:[{label:'Stay',value:null},{label:'Leave',value:'leave',cls:'primary warn'}]}):null; /* Stay has the focus: the destructive choice never starts focused (dialog.js) */
    bridge.browserLeaveAnswer(a.req,!!(r&&r.value==='leave'));
  }

  /* FR-008: overlays win. While a Durbar overlay covers the page area, main takes the view off and the pane shows a still picture (in memory only) */
  async function overlay(on){
    if(!cur)return;
    const id=cur.id,v=$('bView');
    if(on){
      if(cur.tab!=='browser'||cur.covered||!cur.shown)return;
      cur.covered=true;
      const r=await Promise.race([bridge.browserSnapshot(id).catch(()=>null),new Promise(res=>setTimeout(()=>res(null),600))]); /* the picture is optional: a page with a dialog open can stall the capture, the view still goes */
      if(!cur||cur.id!==id||!cur.covered)return;
      if(r&&r.ok&&typeof r.image==='string'&&r.image.indexOf('data:image/')===0&&v){
        let img=$('bShot');
        if(!img){img=document.createElement('img');img.id='bShot';img.className='bshot';img.alt='';img.setAttribute('aria-hidden','true');v.appendChild(img);}
        img.src=r.image;
        await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res))); /* the picture is painted before the view goes */
      }
      if(cur&&cur.id===id&&cur.covered)await bridge.browserOverlay(id,true).catch(()=>null);
    }else{
      if(!cur.covered)return; /* whatever the tab is: a cover left from before the tab changed is lifted too */
      cur.covered=false;
      await bridge.browserOverlay(id,false).catch(()=>null);
      setTimeout(()=>{const img=$('bShot');if(img&&(!cur||!cur.covered))img.remove();},120); /* the view has painted again by then */
    }
  }
  /* The tab left Browser, the panel went or another chat opened: no cover, no stale picture, and main's overlay flag is cleared (the next attach starts clean) */
  function clearCover(c){
    const img=$('bShot');if(img)img.remove();
    if(c.covered||c.shown){c.covered=false;if(bridge)bridge.browserOverlay(c.id,false);}
  }
  /* The page area's rectangle (for the overlay test), or null while the pane is not shown */
  function areaRect(){const v=$('bView');return cur&&cur.tab==='browser'&&cur.shown&&v?v.getBoundingClientRect():null;}
  /* A tab request from app.js (a hidden dialog brings the chat forward on its Browser tab): used by the next mount of that session */
  let want=null;
  function wantTab(id,tab){want={id,tab};}
  /* FR-132: the chat brought forward for a dialog also selects the tab that asks (main checks the tab is that session's) */
  function selectPageTab(id,tabId){if(bridge&&bridge.browserSelectTab&&typeof tabId==='string')return bridge.browserSelectTab(id,tabId).then(r=>{if(cur&&cur.id===id)take(r);},()=>null);return Promise.resolve();}

  async function go(){
    const e=$('bAddr');
    if(!cur||!e)return;
    const id=cur.id;
    const r=await bridge.browserNavigate(id,e.value).catch(()=>null);
    if(!cur||cur.id!==id)return;
    cur.typing=false;
    if(r&&r.ok===false){
      const n=$('bNote');
      if(n){n.dataset.kind='error';n.innerHTML=SVG.error+'<span></span>';n.querySelector('span').textContent=r.reason||'That address is not allowed.';}
    }else if(r&&r.state){cur.state=r.state;render();}
  }

  /* After openPanel wrote the template: wire the tabs and the bar of this session. */
  function mount(a){
    if(cur&&cur.id!==a.id)hide();
    if(!available(a)){hide();return;}
    const again=cur&&cur.id===a.id; /* the same session's panel was rebuilt (a rename): it keeps its tab */
    if(again)unwatchSize();
    else cur={id:a.id,tab:'chat',shown:false,state:states.get(a.id)||{id:a.id,open:false,connecting:true},typing:false,ro:null,sizeQueued:false};
    const tab=startTab(a.id);
    cur.tab='chat'; /* the new template starts on Chat; select() below puts it back */
    const tabs=[$('tabChat'),$('tabBrowser')];
    tabs.forEach((t,i)=>{
      t.onclick=()=>select(i?'browser':'chat');
      t.onkeydown=e=>{
        if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
        const n=tabKey(e.key,i,tabs.length);
        if(n<0)return;
        e.preventDefault();e.stopPropagation();
        select(n?'browser':'chat',{focus:true});
      };
    });
    $('bBack').onclick=()=>bridge.browserBack(a.id);
    $('bFwd').onclick=()=>bridge.browserForward(a.id);
    $('bReload').onclick=e=>(e.currentTarget.dataset.mode==='stop'?bridge.browserStop(a.id):bridge.browserReload(a.id));
    $('bSound').onclick=()=>bridge.browserMute(a.id,barModel(cur.state).sound.on); /* on now: mute it; off now: turn it on */
    $('bSys').onclick=()=>bridge.browserOpenSystem(a.id);
    /* spec 080 FR-122..FR-130: the page tabs */
    const strip=$('bTabs');
    strip.onclick=e=>{
      const x=e.target.closest&&e.target.closest('[data-close]');
      if(x){tabAction('close',{tabId:x.dataset.close,from:e.detail===0?'bar':'mouse'});return;}
      const b=e.target.closest&&e.target.closest('.btab-b');
      if(b)selectTab(b.closest('[data-tab]').dataset.tab);
    };
    strip.onauxclick=e=>{if(e.button!==1)return;const w=e.target.closest&&e.target.closest('[data-tab]');if(w){e.preventDefault();tabAction('close',{tabId:w.dataset.tab,from:'mouse'});}}; /* a middle click closes, as in any browser */
    strip.onkeydown=stripKey;
    $('bNewTab').onclick=()=>tabAction('new');
    $('bMore').onclick=()=>openMore();
    $('browserPane').onkeydown=paneKey;
    const addr=$('bAddr');
    addr.oninput=()=>{cur.typing=true;};
    addr.onfocus=()=>addr.select();
    addr.onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();go();}
      else if(e.key==='Escape'&&cur.typing){e.preventDefault();e.stopPropagation();cur.typing=false;render();} /* first Esc undoes the typing; the next one closes the panel as always */
    };
    addr.onblur=()=>{if(cur)cur.typing=false;};
    renderStrip();
    render();
    if(tab==='browser')select('browser');
  }

  /* The panel closed or another session opened: the view comes off the window (the page stays loaded, FR-009). */
  function hide(){
    if(!cur)return;
    unwatchSize();
    clearCover(cur);
    if(cur.shown&&bridge)bridge.browserVisible(cur.id,false);
    cur=null;
  }
  const current=()=>cur?{id:cur.id,tab:cur.tab,shown:cur.shown}:null;

  /* The page area while the Browser tab is selected, shown or still attaching (the overlay test must see an overlay that is open during the attach) */
  function paneRect(){const v=$('bView');return cur&&cur.tab==='browser'&&v?v.getBoundingClientRect():null;}
  const covered=()=>!!(cur&&cur.covered);
  return {tabKey,barModel,boundsOf,init,available,tabsHTML,paneHTML,mount,hide,select,current,overlay,areaRect,wantTab,dialogOpen,covered,paneRect,openLink,openMail,linkRoute,
    tabShortcut,stripHTML,tabName,tabState,tabStep,selectPageTab,TAB_LIMIT,linksNewTab:()=>linksNewTab};
})());
