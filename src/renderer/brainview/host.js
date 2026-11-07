/* Spec 106 T005: the TEMPORARY floating host of the brain, until Your door's right-rail host exists (052 T201, then T006's dock replaces this file).
   Off by default (app.js loads it only with localStorage durbar.brainPreview = "on", or ?brain=1 in the simulator). It shows the most recently active agent:
   the canvas (decorative), its lobe as text, the sentence and the card, all through brainsurface's masking (FR-021, FR-085). In the page: window.DurbarBrainHost. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrainHost=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MOTIONS=['full','calm','still'], WORD={full:'Full',calm:'Calm',still:'Still'};
  const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};

  /* what the renderer needs from a brain state: the lit lobe (the current step's, else what the agent is doing), the trail, the bloom */
  function viewOf(S,s){
    const g=s.act&&s.act.glyph, step=S.currentStep(s);
    return {lobe:g?S.GLYPHS[g].lobe:null,state:step?step.state:'running',trail:S.trailOf(s).map(t=>({lobe:t.lobe,state:t.state})),bloom:s.bloom||[],rev:s.rev};
  }
  function lobeText(S,s){const g=s.act&&s.act.glyph;return g?S.GLYPHS[g].word+', '+S.GLYPHS[g].lobeWord:'At rest';}

  /* opts: {doc, win, mask, now(), name(id), folder(id)?} */
  function start(opts){
    const doc=opts.doc||document, win=opts.win||window, S=win.exports, SF=win.exports, DR=win.DurbarBrainDraw;
    if(!S||!S.brainState||!SF.cardLines||!DR||!opts.mask)return null; /* fail closed: no mask, no brain */
    const states=new Map(); let shownId=null, timer=0, collapsed=false;
    let motion=store.get('durbar.brainMotion'); if(MOTIONS.indexOf(motion)<0)motion='full';
    const mqReduce=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):null, mqForced=win.matchMedia?win.matchMedia('(forced-colors: active)'):null;

    const el=doc.createElement('section'); el.className='bv'; el.setAttribute('role','region'); el.setAttribute('aria-label','Brain view');
    el.innerHTML='<div class="bv-head"><span class="bv-title">Brain</span><button type="button" class="bv-btn bv-motion"></button><button type="button" class="bv-btn bv-fold" aria-expanded="true">Hide</button></div>'+
      '<div class="bv-body"><canvas class="bv-canvas" aria-hidden="true"></canvas><div class="bv-lobe"></div><p class="bv-sentence"></p><div class="bv-card"><div class="bv-c1"></div><div class="bv-c2"></div><div class="bv-c3"></div></div></div>';
    doc.body.appendChild(el);
    const q=(c)=>el.querySelector(c), canvas=q('.bv-canvas');
    const draw=DR.create({canvas,size:'dock',width:240,motion,forced:!!(mqForced&&mqForced.matches),visible:!doc.hidden,focused:doc.hasFocus?doc.hasFocus():true,
      host:{now:()=>win.performance.now(),raf:(f)=>win.requestAnimationFrame(f),caf:(i)=>win.cancelAnimationFrame(i),dpr:()=>win.devicePixelRatio||1,makeCanvas:(w,h)=>{const c=doc.createElement('canvas');c.width=w;c.height=h;return c;}}});
    const applyMotion=()=>{const m=mqReduce&&mqReduce.matches?'still':motion;draw.setMotion(m);const b=q('.bv-motion');b.textContent='Motion: '+WORD[m]+(m!==motion?' (system)':'');b.setAttribute('aria-label','Brain motion '+WORD[m]+(m!==motion?', set by reduced motion':'')+'. Press to change');b.disabled=m!==motion;};
    q('.bv-motion').addEventListener('click',()=>{motion=MOTIONS[(MOTIONS.indexOf(motion)+1)%3];store.set('durbar.brainMotion',motion);applyMotion();});
    q('.bv-fold').addEventListener('click',(e)=>{collapsed=!collapsed;el.classList.toggle('is-folded',collapsed);e.currentTarget.textContent=collapsed?'Show':'Hide';e.currentTarget.setAttribute('aria-expanded',String(!collapsed));});
    if(mqReduce&&mqReduce.addEventListener)mqReduce.addEventListener('change',applyMotion);
    if(mqForced&&mqForced.addEventListener)mqForced.addEventListener('change',()=>draw.setForced(mqForced.matches));
    doc.addEventListener('visibilitychange',()=>draw.setVisible(!doc.hidden));
    win.addEventListener('focus',()=>draw.setFocused(true)); win.addEventListener('blur',()=>draw.setFocused(false));
    applyMotion();

    /* one paint puts all the text and the picture in the same turn, so no frame shows parts of two cards (FR-023) */
    function paint(){
      timer=0;
      const s=states.get(shownId); if(!s)return;
      const ctx={mask:opts.mask,folder:opts.folder?opts.folder(shownId):undefined,now:opts.now()}, st=S.currentStep(s);
      const nm=opts.name?opts.name(shownId):s.name;
      el.setAttribute('aria-label','Brain view, '+nm);
      const c=st?SF.cardLines(st,ctx):{head:'Waiting for the first step',preview:'',why:''};
      q('.bv-lobe').textContent=lobeText(S,s); q('.bv-sentence').textContent=SF.sentenceFor(s,ctx);
      q('.bv-c1').textContent=c.head; q('.bv-c2').textContent=c.preview; q('.bv-c3').textContent=c.why;
      draw.set(viewOf(S,s)); states.set(shownId,S.markPainted(s,opts.now()));
    }
    function feed(id,name,ev){
      const prev=states.get(id)||S.initBrain(String(name||'Agent'),opts.mask);
      const now=opts.now(), next=S.brainState(prev,ev,now,opts.mask);
      states.set(id,next); if(states.size>60){const k=states.keys().next().value;if(k!==id&&k!==shownId)states.delete(k);}
      if(next.rev===prev.rev&&shownId===id&&next.paintedRev===next.rev)return; /* nothing visible changed */
      shownId=id;
      if(!timer){const wait=S.shouldPaint(next,now)?0:Math.max(0,S.PAINT_MS-(now-next.paintedAt)); timer=win.setTimeout(paint,wait);} /* FR-004: paced */
    }
    return {feed,paint,draw,el,stats:()=>draw.stats,shown:()=>shownId};
  }
  return {start,viewOf,lobeText};
})());
