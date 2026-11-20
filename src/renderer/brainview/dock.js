/* Spec 106 T006 (FR-014, FR-015, FR-025, FR-030, FR-031, FR-033): the dock, at the top of the chat's right rail (app.js builds the rail and mounts the dock in it).
   Behind the preview flag until T009's Settings switch (spec delta 2026-11-20). It shows the OPEN chat's agent: header (title, Legend, Motion), the cost line,
   the canvas (decorative), the lobe as text, the card, the sentence and Latest steps, every text through brainsurface's formatters (FR-021, FR-085).
   Replaces T005's temporary floating host. In the page: window.DurbarBrainDock. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrainDock=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MOTIONS=['full','calm','still'];
  const STEPS_SHOWN=24; /* brainstate.ts TRAIL_MAX: the list shows the steps the trail draws, "M earlier" counts the rest (FR-025, FR-040) */
  const W_COMPACT=150; /* the brain beside the card while Your door has items (FR-031) */
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  /* what the renderer needs from a brain state: the lit lobe (the current step's, else what the agent is doing), the trail, the bloom */
  function viewOf(S,s,id){
    const g=s.act&&s.act.glyph, step=S.currentStep(s);
    return {id:id==null?null:String(id),lobe:g?S.GLYPHS[g].lobe:null,state:step?step.state:'running',trail:S.trailOf(s).map(t=>({lobe:t.lobe,state:t.state})),bloom:s.bloom||[],rev:s.rev};
  }
  function lobeText(S,s){const g=s.act&&s.act.glyph;return g?S.GLYPHS[g].word+', '+S.GLYPHS[g].lobeWord:'At rest';}
  /* the region's name carries the agent's name: through the same name masking as every other surface (FR-021, FR-085) */
  function regionLabel(SF,nm,ctx){return 'Brain view, '+SF.orbName(String(nm==null?'':nm),ctx);}
  /* FR-025: "3 steps this turn · 12 earlier" and the newest steps as text (the trail's text equivalent), from turnMapLine only */
  function stepsOf(S,SF,s,ctx){
    const t=s.turn; if(!t)return {summary:'No steps this turn',rows:[]};
    const shown=t.steps.slice(-STEPS_SHOWN), earlier=Math.max(0,t.total-shown.length);
    return {summary:shown.length+(shown.length===1?' step':' steps')+' this turn'+(earlier?' · '+earlier+' earlier':''),rows:shown.map(st=>SF.turnMapLine(st,ctx))};
  }
  /* FR-014: the legend's rows, from the state module's own glyph table (one source) */
  function legendRows(S){
    const order=['think','read','edit','shell','web','mcp','you'];
    return order.map(g=>({sym:S.GLYPHS[g].symbol,word:S.GLYPHS[g].word,lobe:S.GLYPHS[g].lobeWord})).concat([{sym:'',word:'Reply',lobe:'calm glow'}]);
  }
  const LEGEND_TITLE='A picture of tools, not a real brain';
  const LEGEND_NOTES=['<b>looping?</b> two tools take turns and the last failed','<b>bloom</b> the lobes a turn used swell once at its end'];

  /* opts: {doc, win, mask, now(), name(id), folder?(id), motion?: 'full'|'calm'|'still' (Settings > Brain motion, T426)} */
  function start(opts){
    const doc=opts.doc||document, win=opts.win||window, S=win.exports, SF=win.exports, DR=win.DurbarBrainDraw;
    if(!S||!S.brainState||!SF.cardLines||!SF.turnMapLine||!DR||!opts.mask)return null; /* fail closed: no mask, no brain */
    const states=new Map(); let shownId=null, timer=0, mounted=false, roomy=false, legendOpen=false;
    let motion=MOTIONS.indexOf(opts.motion)>=0?opts.motion:'full', forceStill=false; /* the Settings choice; forceStill: Still highlights, Motion off or a low battery (app.js, FR-060) */
    const mqReduce=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):null, mqForced=win.matchMedia?win.matchMedia('(forced-colors: active)'):null;

    const el=doc.createElement('section'); el.className='bv'; el.setAttribute('role','region'); el.setAttribute('aria-label','Brain view');
    el.innerHTML='<div class="bv-head"><strong class="bv-title">Brain</strong><button type="button" class="btn" data-bv="legend" aria-expanded="false" aria-controls="bvLegend">Legend</button></div>'+
      '<p class="bv-cost"></p><p class="bv-sentence"></p>'+
      '<div class="bv-body"><div class="bv-pic"><canvas class="bv-canvas" aria-hidden="true"></canvas><div class="bv-card"><strong class="bv-lobe"></strong><strong class="bv-c1"></strong><div class="bv-c2"></div><div class="bv-c3"></div></div></div>'+
      '<div class="bv-legend" id="bvLegend" hidden></div></div>'+
      '<details class="bv-steps"><summary class="bv-sum"></summary><ol class="bv-list"></ol></details>';
    const q=(c)=>el.querySelector(c), canvas=q('.bv-canvas');
    /* the skin follows the shown world (FR-110): html[data-world], the world's own tokens read from the page; no skin file means the neutral palette */
    const SKN=win.DurbarBrainSkins, rootEl=doc.documentElement;
    const skinNow=()=>{if(!SKN)return undefined;const cs=win.getComputedStyle?win.getComputedStyle(rootEl):null;return SKN.forWorld(rootEl.dataset?rootEl.dataset.world||'':'',cs?(n)=>cs.getPropertyValue(n):null);};
    let seenFocus=doc.hasFocus?!!doc.hasFocus():true; /* the focus the renderer was last told: a page that gains the focus without a focus event is caught at the next event, from hasFocus() */
    const draw=DR.create({canvas,skin:skinNow(),size:'dock',width:W_COMPACT,motion,forced:!!(mqForced&&mqForced.matches),visible:false,focused:seenFocus,
      host:{now:()=>win.performance.now(),raf:(f)=>win.requestAnimationFrame(f),caf:(i)=>win.cancelAnimationFrame(i),dpr:()=>win.devicePixelRatio||1,makeCanvas:(w,h)=>{const c=doc.createElement('canvas');c.width=w;c.height=h;return c;}}});
    /* drawn only while the window is shown, the dock is in the open rail and its picture is not swapped for the legend (FR-104) */
    function covered(){const c=doc.body&&doc.body.classList;return !!c&&!!c.contains&&(!c.contains('panel-open')||c.contains('screen-open')||c.contains('list-mode')||c.contains('brain-rail-off'));}
    function syncVisible(){draw.setVisible(mounted&&!doc.hidden&&!legendOpen&&!covered());}
    const bySystem=()=>!!((mqReduce&&mqReduce.matches)||(mqForced&&mqForced.matches)); /* reduced motion or forced colours: Still */
    const motionNow=()=>bySystem()||forceStill?'still':motion;
    const applyMotion=()=>{draw.setMotion(motionNow());};
    function setMotion(m){if(MOTIONS.indexOf(m)<0)return;motion=m;applyMotion();}
    function setForceStill(on){forceStill=!!on;applyMotion();}
    /* FR-014: the legend takes the brain area; the header, the cost line and Your door stay where they are */
    function setLegend(on){
      legendOpen=!!on; const b=q('[data-bv=legend]'), lg=q('.bv-legend'), pic=q('.bv-pic');
      b.setAttribute('aria-expanded',String(legendOpen)); lg.hidden=!legendOpen; pic.hidden=legendOpen; el.classList.toggle('is-legend',legendOpen);
      if(legendOpen&&!lg.innerHTML)lg.innerHTML='<strong class="bv-lt">'+esc(LEGEND_TITLE)+'</strong><ul class="bv-lg">'+legendRows(S).map(r=>'<li><span class="bv-sym" aria-hidden="true">'+esc(r.sym)+'</span><b>'+esc(r.word)+'</b> · '+esc(r.lobe)+'</li>').join('')+'</ul>'+LEGEND_NOTES.map(t=>'<p class="bv-ln">'+t+'</p>').join('');
      syncVisible();
    }
    q('[data-bv=legend]').addEventListener('click',()=>setLegend(!legendOpen));
    if(mqReduce&&mqReduce.addEventListener)mqReduce.addEventListener('change',applyMotion);
    if(mqForced&&mqForced.addEventListener)mqForced.addEventListener('change',()=>{draw.setForced(mqForced.matches);applyMotion();});
    doc.addEventListener('visibilitychange',syncVisible);
    if(typeof win.MutationObserver==='function'&&doc.body&&doc.body.nodeType)new win.MutationObserver(syncVisible).observe(doc.body,{attributes:true,attributeFilter:['class']}); /* a chat, Settings or the rail's collapse */
    win.addEventListener('focus',()=>{seenFocus=true;draw.setFocused(true);}); win.addEventListener('blur',()=>{seenFocus=false;draw.setFocused(false);});
    let skinId=draw.skin();
    function syncSkin(){const k=skinNow();if(k&&k.id!==skinId){skinId=k.id;draw.setSkin(k);}el.setAttribute('data-skin',skinId);}
    el.setAttribute('data-skin',skinId);
    if(typeof win.MutationObserver==='function'&&rootEl&&rootEl.nodeType)new win.MutationObserver(syncSkin).observe(rootEl,{attributes:true,attributeFilter:['data-world']});
    applyMotion(); setLegend(false);

    function ctxOf(id){return {mask:opts.mask,folder:opts.folder?opts.folder(id):undefined,now:opts.now()};}
    function stateOf(id){let s=states.get(id);if(!s){s=S.initBrain(String((opts.name&&opts.name(id))||'Agent'),opts.mask);states.set(id,s);}return s;}
    /* one paint puts all the text and the picture in the same turn, so no frame shows parts of two cards (FR-023) */
    function paint(){
      timer=0;
      if(shownId==null)return;
      const s=stateOf(shownId), ctx=ctxOf(shownId), st=S.currentStep(s), nm=opts.name?opts.name(shownId):s.name;
      syncVisible();
      el.setAttribute('aria-label',regionLabel(SF,nm,ctx));
      q('.bv-title').textContent='Brain · '+SF.orbName(String(nm==null?'':nm),ctx);
      const c=st?SF.cardLines(st,ctx):{head:SF.WAITING_CARD||'Waiting for the first step',preview:'',why:''};
      const cost=SF.costText(s.costKnown?s.turnCost:null,ctx)+' this turn', detail=SF.costDetail(s,ctx), co=q('.bv-cost');
      co.textContent=cost; if(detail){co.setAttribute('title',detail);co.setAttribute('aria-label',detail+' this turn');}else{co.setAttribute('title','');co.setAttribute('aria-label',cost);}
      q('.bv-lobe').textContent=lobeText(S,s); q('.bv-sentence').textContent=SF.sentenceFor(s,ctx);
      q('.bv-c1').textContent=c.head; q('.bv-c2').textContent=c.preview; q('.bv-c3').textContent=c.why;
      const sp=stepsOf(S,SF,s,ctx); q('.bv-sum').textContent=sp.summary; q('.bv-list').innerHTML=sp.rows.map(r=>'<li>'+esc(r)+'</li>').join('');
      draw.set(viewOf(S,s,shownId)); states.set(shownId,S.markPainted(s,opts.now()));
    }
    function schedule(now){
      const s=states.get(shownId); if(timer||!s)return;
      const wait=S.shouldPaint(s,now)?0:Math.max(0,S.PAINT_MS-(now-s.paintedAt)); timer=win.setTimeout(paint,wait); /* FR-004: paced */
    }
    function feed(id,name,ev){
      const hf=doc.hasFocus?!!doc.hasFocus():true; if(hf!==seenFocus)draw.setFocused(hf); seenFocus=hf;
      const k=String(id), prev=states.get(k)||S.initBrain(String(name||'Agent'),opts.mask);
      const now=opts.now(), next=S.brainState(prev,ev,now,opts.mask);
      states.set(k,next); for(const x of states.keys()){if(states.size<=60)break;if(x!==k&&x!==shownId)states.delete(x);} /* oldest first, never the one in use */
      if(k!==shownId)return; /* another agent's chat is not open: its state waits for it */
      if(next.rev===prev.rev&&next.paintedRev===next.rev)return; /* nothing visible changed */
      schedule(now);
    }
    /* the open chat's agent (FR-030): its state, or a resting one, painted at once */
    function show(id){
      const k=id==null?null:String(id);
      if(timer){win.clearTimeout(timer);timer=0;}
      shownId=k;
      if(k==null){el.classList.add('is-empty');draw.set({id:null,lobe:null,state:'done',trail:[],bloom:[],rev:0});return;}
      el.classList.remove('is-empty'); paint();
    }
    /* the rail places the dock: in its slot, visible while the chat is */
    function mount(parent){if(parent&&el.parentNode!==parent)parent.appendChild(el);mounted=!!parent;syncVisible();}
    function unmount(){mounted=false;syncVisible();}
    /* FR-031: compact (the brain beside the card) while Your door has items; roomy (the brain above the card at the rail's width) when it is empty */
    function setRoomy(on,width){
      const r=!!on, w=r?Math.max(W_COMPACT,Math.round(width||W_COMPACT)):W_COMPACT;
      if(r===roomy&&w===draw.size().w)return;
      roomy=r; el.classList.toggle('is-roomy',r); draw.resize(w,win.devicePixelRatio||1); syncVisible();
    }
    /* an agent removed from the office: its brain goes too */
    function forget(id){states.delete(String(id));if(shownId===String(id))show(null);}
    return {feed,show,mount,unmount,setRoomy,setLegend,setMotion,setForceStill,motion:motionNow,bySystem,paint,forget,draw,el,stats:()=>draw.stats,shown:()=>shownId,count:()=>states.size,roomy:()=>roomy,legend:()=>legendOpen};
  }
  return {start,viewOf,lobeText,regionLabel,stepsOf,legendRows,LEGEND_TITLE,STEPS_SHOWN,W_COMPACT};
})());
