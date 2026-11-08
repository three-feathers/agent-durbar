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
  function viewOf(S,s,id){
    const g=s.act&&s.act.glyph, step=S.currentStep(s);
    return {id:id==null?null:String(id),lobe:g?S.GLYPHS[g].lobe:null,state:step?step.state:'running',trail:S.trailOf(s).map(t=>({lobe:t.lobe,state:t.state})),bloom:s.bloom||[],rev:s.rev};
  }
  function lobeText(S,s){const g=s.act&&s.act.glyph;return g?S.GLYPHS[g].word+', '+S.GLYPHS[g].lobeWord:'At rest';}

  /* the region's name carries the agent's name: through the same name masking as every other surface (FR-021, FR-085) */
  function regionLabel(SF,nm,ctx){return 'Brain view, '+SF.orbName(String(nm==null?'':nm),ctx);}

  /* opts: {doc, win, mask, now(), name(id), folder(id)?} */
  function start(opts){
    const doc=opts.doc||document, win=opts.win||window, S=win.exports, SF=win.exports, DR=win.DurbarBrainDraw;
    if(!S||!S.brainState||!SF.cardLines||!DR||!opts.mask)return null; /* fail closed: no mask, no brain */
    const states=new Map(); let shownId=null, timer=0, collapsed=false;
    let motion=store.get('durbar.brainMotion'); if(MOTIONS.indexOf(motion)<0)motion='full';
    const mqReduce=win.matchMedia?win.matchMedia('(prefers-reduced-motion: reduce)'):null, mqForced=win.matchMedia?win.matchMedia('(forced-colors: active)'):null;

    const el=doc.createElement('section'); el.className='bv'; el.setAttribute('role','region'); el.setAttribute('aria-label','Brain view');
    el.innerHTML='<div class="bv-head"><strong class="bv-title">Brain</strong><button type="button" class="btn" data-bv="motion"></button><button type="button" class="btn" data-bv="fold" aria-expanded="true">Hide</button></div>'+
      '<div class="bv-body"><canvas class="bv-canvas" aria-hidden="true"></canvas><strong class="bv-lobe"></strong><p class="bv-sentence"></p><div class="bv-card"><strong class="bv-c1"></strong><div class="bv-c2"></div><div class="bv-c3"></div></div></div>';
    doc.body.appendChild(el);
    const q=(c)=>el.querySelector(c), canvas=q('.bv-canvas');
    const draw=DR.create({canvas,size:'dock',width:240,motion,forced:!!(mqForced&&mqForced.matches),visible:!doc.hidden,focused:doc.hasFocus?doc.hasFocus():true,
      host:{now:()=>win.performance.now(),raf:(f)=>win.requestAnimationFrame(f),caf:(i)=>win.cancelAnimationFrame(i),dpr:()=>win.devicePixelRatio||1,makeCanvas:(w,h)=>{const c=doc.createElement('canvas');c.width=w;c.height=h;return c;}}});
    /* drawn only while the window is shown and the body is not folded: a folded host draws nothing (FR-104) */
    function syncVisible(){draw.setVisible(!doc.hidden&&!collapsed);}
    const applyMotion=()=>{const m=mqReduce&&mqReduce.matches?'still':motion;draw.setMotion(m);const b=q('[data-bv=motion]');b.textContent='Motion: '+WORD[m]+(m!==motion?' (system)':'');b.setAttribute('aria-label','Brain motion '+WORD[m]+(m!==motion?', set by reduced motion':'')+'. Press to change');b.setAttribute('aria-disabled',String(m!==motion));};
    q('[data-bv=motion]').addEventListener('click',()=>{if(mqReduce&&mqReduce.matches)return; /* set by the system: the button keeps focus and does nothing */motion=MOTIONS[(MOTIONS.indexOf(motion)+1)%3];store.set('durbar.brainMotion',motion);applyMotion();});
    q('[data-bv=fold]').addEventListener('click',(e)=>{collapsed=!collapsed;el.classList.toggle('is-folded',collapsed);syncVisible();e.currentTarget.textContent=collapsed?'Show':'Hide';e.currentTarget.setAttribute('aria-expanded',String(!collapsed));});
    if(mqReduce&&mqReduce.addEventListener)mqReduce.addEventListener('change',applyMotion);
    if(mqForced&&mqForced.addEventListener)mqForced.addEventListener('change',()=>draw.setForced(mqForced.matches));
    doc.addEventListener('visibilitychange',syncVisible);
    win.addEventListener('focus',()=>draw.setFocused(true)); win.addEventListener('blur',()=>draw.setFocused(false));
    applyMotion();

    /* one paint puts all the text and the picture in the same turn, so no frame shows parts of two cards (FR-023) */
    function paint(){
      timer=0;
      const s=states.get(shownId); if(!s)return;
      el.classList.remove('is-empty');
      const ctx={mask:opts.mask,folder:opts.folder?opts.folder(shownId):undefined,now:opts.now()}, st=S.currentStep(s);
      const nm=opts.name?opts.name(shownId):s.name;
      el.setAttribute('aria-label',regionLabel(SF,nm,ctx));
      const c=st?SF.cardLines(st,ctx):{head:'Waiting for the first step',preview:'',why:''};
      q('.bv-lobe').textContent=lobeText(S,s); q('.bv-sentence').textContent=SF.sentenceFor(s,ctx);
      q('.bv-c1').textContent=c.head; q('.bv-c2').textContent=c.preview; q('.bv-c3').textContent=c.why;
      draw.set(viewOf(S,s,shownId)); states.set(shownId,S.markPainted(s,opts.now()));
    }
    function feed(id,name,ev){
      const prev=states.get(id)||S.initBrain(String(name||'Agent'),opts.mask);
      const now=opts.now(), next=S.brainState(prev,ev,now,opts.mask);
      states.set(id,next); for(const k of states.keys()){if(states.size<=60)break;if(k!==id&&k!==shownId)states.delete(k);} /* oldest first, never the one in use */
      if(next.rev===prev.rev&&shownId===id&&next.paintedRev===next.rev)return; /* nothing visible changed */
      shownId=id;
      if(!timer){const wait=S.shouldPaint(next,now)?0:Math.max(0,S.PAINT_MS-(now-next.paintedAt)); timer=win.setTimeout(paint,wait);} /* FR-004: paced */
    }
    /* an agent removed from the office: its brain goes too, and the box is empty if it was the one shown */
    function forget(id){
      states.delete(id);
      if(shownId!==id)return;
      shownId=null; if(timer){win.clearTimeout(timer);timer=0;}
      el.classList.add('is-empty'); draw.set({id:null,lobe:null,state:'done',trail:[],bloom:[],rev:0});
    }
    return {feed,paint,forget,draw,el,stats:()=>draw.stats,shown:()=>shownId,count:()=>states.size};
  }
  return {start,viewOf,lobeText,regionLabel};
})());
