/* Spec 106 T006 (FR-014, FR-015, FR-025, FR-030, FR-031, FR-033): the dock, at the top of the chat's right rail (app.js builds the rail and mounts the dock in it).
   Behind the preview flag until T009's Settings switch (spec delta 2026-11-20). It shows the OPEN chat's agent: header (title, Legend, Motion), the cost line,
   the canvas (decorative) with the lobe words over it (FR-134..FR-136), the lobe as text, the card, the sentence and Latest steps, every text through brainsurface's formatters (FR-021, FR-085).
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
    return {id:id==null?null:String(id),lobe:g?S.GLYPHS[g].lobe:null,glyph:g||null,state:step?step.state:'running',trail:S.trailOf(s).map(t=>({lobe:t.lobe,state:t.state})),bloom:s.bloom||[],rev:s.rev,counts:lobeCounts(S,s),folded:s.turn?s.turn.folded:0};
  }
  /* FR-136: how many of the turn's kept steps went to each lobe (glyph and lobe are one to one) */
  function lobeCounts(S,s){const c={};for(const g of LABEL_ORDER)c[g]=0;for(const st of s.turn?s.turn.steps:[])if(c[st.glyph]!=null)c[st.glyph]++;return c;}
  const LABEL_ORDER=['think','read','edit','shell','web','mcp','you']; /* the legend's order, the labels' reading and arrow-key order */
  const MARK_R=7, LABEL_GAP=2; /* draw.js's marker: a 5 px ring and its 1.5 px line, rounded up; the air kept between a marker and a word */
  /* FR-134: one spot per word beside its lobe's anchor, none on a marker (any lobe's: the lit one moves), another word or outside the W x H picture;
     of the sets that fit, the one nearest the anchors. Pure: sizes {glyph:{w,h}} and anchors {glyph:{x,y}} (0..1) in, {glyph:{l,t,r,b}} or null out */
  function placeLabels(W,H,sizes,anchors){
    const gs=LABEL_ORDER.filter(g=>sizes[g]&&anchors[g]), hit=(a,b)=>a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b;
    const marks=gs.map(g=>({l:anchors[g].x*W-MARK_R,t:anchors[g].y*H-MARK_R,r:anchors[g].x*W+MARK_R,b:anchors[g].y*H+MARK_R}));
    const spots={};
    for(const g of gs){
      const ax=anchors[g].x*W, ay=anchors[g].y*H, w=sizes[g].w, h=sizes[g].h, d=MARK_R+LABEL_GAP, xs=[ax-w/2,ax-w+d,ax-d], ys=[ay-h/2,ay-h+d,ay-d];
      spots[g]=xs.map(x=>[x,ay-d-h]).concat(xs.map(x=>[x,ay+d]),ys.map(y=>[ax+d,y]),ys.map(y=>[ax-d-w,y])) /* above, below, right, left: centred or sliding by the marker's width */
        .map(([x,y])=>({l:x,t:y,r:x+w,b:y+h,c:Math.hypot(x+w/2-ax,y+h/2-ay)}))
        .filter(r=>r.l>=0&&r.t>=0&&r.r<=W&&r.b<=H&&!marks.some(m=>hit(m,r))).sort((a,b)=>a.c-b.c);
    }
    const order=gs.slice().sort((a,b)=>spots[a].length-spots[b].length), cur={}, low=[0]; let best=null, bestC=Infinity;
    for(let i=order.length-1;i>=0;i--)low.unshift(low[0]+(spots[order[i]].length?spots[order[i]][0].c:Infinity)); /* the cheapest the rest can cost: a bound for the search */
    (function go(i,c){
      if(c+low[i]>=bestC)return;
      if(i===order.length){bestC=c;best=Object.assign({},cur);return;}
      const g=order[i];
      for(const r of spots[g]){let ok=true;for(const k in cur)if(hit(cur[k],r)){ok=false;break;}if(ok){cur[g]=r;go(i+1,c+r.c);delete cur[g];}}
    })(0,0);
    if(!best)return null;
    const out={};for(const g of gs)out[g]={l:Math.round(best[g].l),t:Math.round(best[g].t),r:Math.round(best[g].r),b:Math.round(best[g].b)};
    return out;
  }
  /* FR-136: the tooltip, constants only: the lobe's sentence and its count this turn */
  function tipText(S,g,counts,folded){
    const n=(counts&&counts[g])||0;
    return S.GLYPHS[g].means+(g==='think'?'':' '+(n?n+(n===1?' step':' steps'):'No steps')+' this turn'+(folded?' (of the last '+S.STEP_CAP+')':'')+'.');
  }
  /* FR-135: what the lines are, with FR-040's own cap */
  const linesText=(S)=>'Lines: the last '+S.TRAIL_MAX+' steps, newest brightest';
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
    return LABEL_ORDER.map(g=>({sym:S.GLYPHS[g].symbol,word:S.GLYPHS[g].word,lobe:S.GLYPHS[g].lobeWord})).concat([{sym:'',word:'Reply',lobe:'calm glow'}]);
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
      '<div class="bv-body"><div class="bv-pic"><div class="bv-fig"><div class="bv-brain"><canvas class="bv-canvas" aria-hidden="true"></canvas><ul class="bv-labs" aria-label="Lobes of the picture"></ul><div class="bv-tip" aria-hidden="true" hidden></div></div><p class="bv-lines"></p></div><div class="bv-card"><strong class="bv-lobe"></strong><strong class="bv-c1"></strong><div class="bv-c2"></div><div class="bv-c3"></div></div></div>'+
      '<div class="bv-legend" id="bvLegend" hidden></div></div>'+
      '<div class="bv-steps"><button type="button" data-bv="steps" aria-expanded="false" aria-controls="bvSteps"><span aria-hidden="true">▸ </span><span class="bv-sum"></span></button><ol class="bv-list" id="bvSteps" hidden></ol></div>';
    const q=(c)=>el.querySelector(c), canvas=q('.bv-canvas');
    /* FR-134..FR-136: the seven words over the picture, one tab stop (roving), the arrow keys between them, the tooltip on hover or focus */
    const labsEl=q('.bv-labs'), tip=q('.bv-tip'), P=win.DurbarBrainPoints; let lastView=null, labKey='', tipG=null, focusG='think';
    const labs=LABEL_ORDER.map((g)=>{const li=doc.createElement('li');li.className='bv-lab';li.setAttribute('data-g',g);li.setAttribute('data-lobe',S.GLYPHS[g].lobe);li.setAttribute('tabindex','-1');li.textContent=S.GLYPHS[g].word;
      const sr=doc.createElement('span');sr.className='sr-only';li.appendChild(sr);li.sr=sr;labsEl.appendChild(li);
      li.addEventListener('mouseenter',()=>showTip(g));li.addEventListener('mouseleave',()=>{if(doc.activeElement!==li)showTip(null);});
      li.addEventListener('focus',()=>{focusG=g;roving();showTip(g);});li.addEventListener('blur',()=>showTip(null));return li;});
    q('.bv-lines').textContent=linesText(S);
    function roving(){labs.forEach((li,i)=>li.setAttribute('tabindex',LABEL_ORDER[i]===focusG?'0':'-1'));}
    labsEl.addEventListener('keydown',(e)=>{
      const i=LABEL_ORDER.indexOf(focusG), n=LABEL_ORDER.length, k=e.key;
      const j=k==='ArrowRight'||k==='ArrowDown'?(i+1)%n:k==='ArrowLeft'||k==='ArrowUp'?(i+n-1)%n:k==='Home'?0:k==='End'?n-1:-1;
      if(k==='Escape'){if(tipG){e.preventDefault();e.stopPropagation();showTip(null);}return;} /* Esc closes the tooltip first, the chat only on a second press */
      if(j<0)return; e.preventDefault(); labs[j].focus();
    });
    function showTip(g){
      tipG=g; if(!g){tip.hidden=true;return;}
      const v=lastView||{}, li=labs[LABEL_ORDER.indexOf(g)], low=parseFloat(li.style.top||'0')>draw.size().h/2;
      tip.textContent=S.GLYPHS[g].word+': '+tipText(S,g,v.counts,v.folded); tip.classList.toggle('is-low',!low); tip.hidden=false; /* in the half away from the word */
    }
    /* each word's spot, measured bold (the lit weight) once per width, skin and font, so the lit word never shifts the others */
    function layoutLabels(){
      if(!P||!labsEl.getClientRects||!labsEl.getClientRects().length)return; /* not laid out (hidden, or a test page): later */
      const cs=win.getComputedStyle?win.getComputedStyle(labsEl):null, sz=draw.size(), key=sz.w+'|'+skinId+'|'+(cs?cs.fontFamily+cs.fontSize:'');
      if(key===labKey)return;
      labsEl.classList.add('is-measure'); const sizes={}, anchors={};
      labs.forEach((li,i)=>{const g=LABEL_ORDER[i];li.style.width='';sizes[g]={w:Math.ceil(li.offsetWidth),h:Math.ceil(li.offsetHeight)};anchors[g]=P.ANCHORS[S.GLYPHS[g].lobe];});
      labsEl.classList.remove('is-measure');
      if(!sizes.think.w)return;
      const at=placeLabels(sz.w,sz.h,sizes,anchors); labKey=key; labsEl.hidden=!at; /* no set fits (a very large font): the caption and the legend still say it */
      if(at)labs.forEach((li,i)=>{const r=at[LABEL_ORDER[i]];li.style.left=r.l+'px';li.style.top=r.t+'px';li.style.width=(r.r-r.l)+'px';});
    }
    function paintLabels(v){
      lastView=v; layoutLabels();
      labs.forEach((li,i)=>{const g=LABEL_ORDER[i];li.classList.toggle('is-lit',g===v.glyph);li.sr.textContent=': '+tipText(S,g,v.counts,v.folded);});
      const c=v.lobe?draw.colors()[v.lobe]:''; el.style.setProperty('--bv-lit',c||'transparent'); el.classList.toggle('is-lit',!!c);
      if(v.glyph&&!(doc.activeElement&&labsEl.contains&&labsEl.contains(doc.activeElement))){focusG=v.glyph;roving();} /* the one tab stop is the lit word, unless the person is moving between words */
      if(tipG)showTip(tipG);
    }
    /* the skin follows the shown world (FR-110): html[data-world], the world's own tokens read from the page; no skin file means the neutral palette */
    const SKN=win.DurbarBrainSkins, rootEl=doc.documentElement;
    const skinNow=()=>{if(!SKN)return undefined;const cs=win.getComputedStyle?win.getComputedStyle(rootEl):null;return SKN.forWorld(rootEl.dataset?rootEl.dataset.world||'':'',cs?(n)=>cs.getPropertyValue(n):null);};
    let seenFocus=doc.hasFocus?!!doc.hasFocus():true; /* the focus the renderer was last told: a page that gains the focus without a focus event is caught at the next event, from hasFocus() */
    const draw=DR.create({canvas,skin:skinNow(),size:'dock',width:W_COMPACT,motion,forced:!!(mqForced&&mqForced.matches),visible:false,focused:seenFocus,
      host:{now:()=>win.performance.now(),raf:(f)=>win.requestAnimationFrame(f),caf:(i)=>win.cancelAnimationFrame(i),dpr:()=>win.devicePixelRatio||1,makeCanvas:(w,h)=>{const c=doc.createElement('canvas');c.width=w;c.height=h;return c;}}});
    /* drawn only while the window is shown, the dock is in the open rail and its picture is not swapped for the legend (FR-104) */
    function covered(){const c=doc.body&&doc.body.classList;return !!c&&!!c.contains&&(!c.contains('panel-open')||c.contains('screen-open')||c.contains('list-mode')||c.contains('brain-rail-off')||c.contains('browser-big'));}
    function syncVisible(){draw.setVisible(mounted&&!doc.hidden&&!legendOpen&&!covered());if(lastView)layoutLabels();} /* words first measured once the picture is shown */
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
    /* FR-025: Latest steps opens and closes its list (a real button: a closed <details> left its text measurable, check-097-chat-contrast) */
    function setSteps(on){const b=q('[data-bv=steps]'),l=q('.bv-list');b.setAttribute('aria-expanded',String(!!on));l.hidden=!on;el.classList.toggle('is-steps',!!on);}
    q('[data-bv=steps]').addEventListener('click',()=>setSteps(q('.bv-list').hidden));
    if(mqReduce&&mqReduce.addEventListener)mqReduce.addEventListener('change',applyMotion);
    if(mqForced&&mqForced.addEventListener)mqForced.addEventListener('change',()=>{draw.setForced(mqForced.matches);applyMotion();});
    doc.addEventListener('visibilitychange',syncVisible);
    if(typeof win.MutationObserver==='function'&&doc.body&&doc.body.nodeType)new win.MutationObserver(syncVisible).observe(doc.body,{attributes:true,attributeFilter:['class']}); /* a chat, Settings or the rail's collapse */
    win.addEventListener('focus',()=>{seenFocus=true;draw.setFocused(true);}); win.addEventListener('blur',()=>{seenFocus=false;draw.setFocused(false);});
    let skinId=draw.skin();
    function syncSkin(){const k=skinNow();if(k&&k.id!==skinId){skinId=k.id;draw.setSkin(k);if(lastView)paintLabels(lastView);}el.setAttribute('data-skin',skinId);}
    el.setAttribute('data-skin',skinId);
    if(typeof win.MutationObserver==='function'&&rootEl&&rootEl.nodeType)new win.MutationObserver(syncSkin).observe(rootEl,{attributes:true,attributeFilter:['data-world']});
    applyMotion(); setLegend(false); setSteps(false);

    function ctxOf(id){return {mask:opts.mask,folder:opts.folder?opts.folder(id):undefined,now:opts.now()};}
    function stateOf(id){let s=states.get(id);if(!s){s=S.initBrain(String((opts.name&&opts.name(id))||'Agent'),opts.mask);states.set(id,s);}return s;}
    /* one paint puts all the text and the picture in the same turn, so no frame shows parts of two cards (FR-023) */
    function paint(){
      timer=0;
      if(shownId==null)return;
      const s=stateOf(shownId), ctx=ctxOf(shownId), st=S.currentStep(s), nm=opts.name?opts.name(shownId):s.name;
      syncVisible();
      el.setAttribute('aria-label',regionLabel(SF,nm,ctx));
      {const t='Brain · '+SF.orbName(String(nm==null?'':nm),ctx), te=q('.bv-title'); te.textContent=t; te.setAttribute('title',t);} /* a long session title is cut with an ellipsis: the whole (masked) name in its tooltip */
      const c=st?SF.cardLines(st,ctx):{head:SF.WAITING_CARD||'Waiting for the first step',preview:'',why:''};
      const cost=SF.costText(s.costKnown?s.turnCost:null,ctx)+' this turn', detail=SF.costDetail(s,ctx), co=q('.bv-cost');
      co.textContent=cost; if(detail){co.setAttribute('title',detail);co.setAttribute('aria-label',detail+' this turn');}else{co.setAttribute('title','');co.setAttribute('aria-label',cost);}
      q('.bv-lobe').textContent=lobeText(S,s); q('.bv-sentence').textContent=SF.sentenceFor(s,ctx);
      q('.bv-c1').textContent=c.head; q('.bv-c2').textContent=c.preview; q('.bv-c3').textContent=c.why;
      const sp=stepsOf(S,SF,s,ctx); q('.bv-sum').textContent=sp.summary; q('.bv-list').innerHTML=sp.rows.map(r=>'<li>'+esc(r)+'</li>').join('');
      const v=viewOf(S,s,shownId); draw.set(v); paintLabels(v); states.set(shownId,S.markPainted(s,opts.now()));
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
      roomy=r; el.classList.toggle('is-roomy',r); draw.resize(w,win.devicePixelRatio||1); if(lastView)paintLabels(lastView); syncVisible();
    }
    /* an agent removed from the office: its brain goes too */
    function forget(id){states.delete(String(id));if(shownId===String(id))show(null);}
    return {feed,show,mount,unmount,setRoomy,setLegend,setSteps,setMotion,setForceStill,motion:motionNow,bySystem,paint,forget,draw,el,labels:()=>labs,stats:()=>draw.stats,shown:()=>shownId,count:()=>states.size,roomy:()=>roomy,legend:()=>legendOpen};
  }
  return {start,viewOf,lobeText,regionLabel,stepsOf,legendRows,lobeCounts,placeLabels,tipText,linesText,LABEL_ORDER,MARK_R,LABEL_GAP,LEGEND_TITLE,STEPS_SHOWN,W_COMPACT};
})());
