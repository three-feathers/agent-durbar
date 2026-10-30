/* An instant, app-styled tooltip (spec 001 FR-187, issue #875). In the page: window.DurbarTip; in Node: module.exports (the DOM part is only
   used by the page; `statusText` and `place` are pure and unit-tested).
   Why not `title`: it waits for the system delay, never shows on keyboard focus and looks different on each OS. One `div#appTip[role=tooltip]`
   is shared by every user; `bind(root,{selector,text})` delegates the events, so a user that redraws its elements (morphHTML) needs no re-bind. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarTip=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const GAP=6, MARGIN=8;
  /* the status counts of the top bar: [name, meaning when one agent, meaning otherwise] */
  const STATES={
    working:['Working','working or thinking','working or thinking'],
    waiting:['Waiting','waiting for you','waiting for you'],
    idle:['Idle','idle or paused','idle or paused'],
    error:['Error','with an error','with errors'],
    done:['Done','done','done']
  };
  /* "Idle · 7 agents idle or paused. Click to show only these." / "... Click to show all." while that filter is on */
  function statusText(k,n,filterOn){
    const s=STATES[k]; if(!s)return '';
    const c=Math.max(0,Math.floor(+n||0));
    return `${s[0]} · ${c} ${c===1?'agent':'agents'} ${c===1?s[1]:s[2]}. ${filterOn?'Click to show all.':'Click to show only these.'}`;
  }
  /* Where the tooltip goes: below the anchor, centered, flipped above when the bottom edge would be passed, clamped inside the window.
     `a` = anchor box {left,top,right,bottom}, `s` = tooltip size {w,h}, `v` = window size {w,h}. It never overlaps the anchor unless the
     window is too small for either side (then it is clamped inside the window). */
  function place(a,s,v,o){
    const gap=o&&o.gap!=null?o.gap:GAP, m=o&&o.margin!=null?o.margin:MARGIN;
    let x=(a.left+a.right)/2-s.w/2;
    x=Math.max(m,Math.min(x,v.w-s.w-m));
    let y=a.bottom+gap, flipped=false;
    if(y+s.h>v.h-m){ const up=a.top-gap-s.h; if(up>=m){y=up;flipped=true;} else y=Math.max(m,v.h-m-s.h); }
    return {x:Math.round(x),y:Math.round(y),flipped};
  }

  /* ---- the page ---- */
  let tip=null, cur=null /* {el,get} shown */, hov=null, foc=null, dismissed=null, binds=[], wired=false;
  const find=t=>{
    if(!t||!t.closest)return null;
    for(const b of binds){const el=t.closest(b.selector); if(el&&b.root.contains(el))return {el,get:b.text};}
    return null;
  };
  function ensure(){
    if(tip&&tip.isConnected)return tip;
    tip=document.createElement('div'); tip.id='appTip'; tip.className='app-tip'; tip.setAttribute('role','tooltip'); tip.hidden=true;
    document.body.appendChild(tip); return tip;
  }
  function describe(el,on){
    if(on)el.setAttribute('aria-describedby','appTip');
    else if(el.getAttribute('aria-describedby')==='appTip')el.removeAttribute('aria-describedby');
  }
  function hide(){
    if(cur){describe(cur.el,false);cur=null;}
    if(tip)tip.hidden=true;
  }
  function put(el,d){
    const r=el.getBoundingClientRect(), de=document.documentElement;
    d.style.left='0px'; d.style.top='0px';
    const p=place(r,{w:d.offsetWidth,h:d.offsetHeight},{w:de.clientWidth,h:de.clientHeight});
    d.style.left=p.x+'px'; d.style.top=p.y+'px';
  }
  function show(f){
    if(dismissed===f.el)return;
    const t=f.get(f.el); if(!t){hide();return;}
    const d=ensure();
    if(cur&&cur.el!==f.el)describe(cur.el,false);
    d.hidden=false; if(d.textContent!==t)d.textContent=t;
    cur=f; describe(f.el,true); put(f.el,d);
  }
  function update(){
    const f=hov||foc;
    if(!f){hide();return;}
    show(f);
  }
  /* the owner redrew its elements or changed the text: new text and place, or gone */
  function refresh(){
    if(!cur)return;
    if(!cur.el.isConnected||(hov&&!hov.el.isConnected&&!foc)){hov=foc=null;hide();return;}
    show(cur);
  }
  const focusVisible=el=>{try{return el.matches(':focus-visible');}catch(e){return true;}};
  function wire(){
    if(wired)return; wired=true;
    document.addEventListener('pointerover',e=>{
      if(e.pointerType==='touch')return;
      const f=find(e.target); if(!f||(hov&&hov.el===f.el))return;
      hov=f; update();
    },true);
    document.addEventListener('pointerout',e=>{
      const f=find(e.target); if(!f||!hov||hov.el!==f.el||f.el.contains(e.relatedTarget))return;
      hov=null; if(dismissed===f.el)dismissed=null; update(); /* a new visit is a new intent */
    },true);
    document.addEventListener('focusin',e=>{
      const f=find(e.target); if(!f||!focusVisible(f.el))return;
      foc=f; update();
    },true);
    document.addEventListener('focusout',e=>{
      const f=find(e.target); if(!f||!foc||foc.el!==f.el)return;
      foc=null; if(dismissed===f.el)dismissed=null; update();
    },true);
    document.addEventListener('click',e=>{const f=find(e.target); if(!f)return; dismissed=f.el; hide();},true);
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape'||!cur||!tip||tip.hidden)return;
      dismissed=cur.el; hide(); e.stopPropagation(); /* WCAG 1.4.13: dismissible; this Escape is used up */
    },true);
    window.addEventListener('scroll',()=>{if(cur)hide();},true);
    window.addEventListener('blur',()=>{hov=foc=dismissed=null;hide();});
    window.addEventListener('resize',()=>{if(cur)hide();});
  }
  /* `text(el)` returns the tooltip text for an element that matches `selector` inside `rootEl` ('' for none) */
  function bind(rootEl,o){
    if(!rootEl||!o||!o.selector||typeof o.text!=='function')return;
    if(!binds.some(b=>b.root===rootEl&&b.selector===o.selector))binds.push({root:rootEl,selector:o.selector,text:o.text});
    wire();
  }
  return {statusText,place,bind,refresh,hide,GAP,MARGIN};
})());
