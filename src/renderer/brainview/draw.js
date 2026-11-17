/* Spec 106 FR-010, FR-013, FR-040, FR-051, FR-060, FR-061, FR-100..FR-104: the Canvas 2D brain. In the page: window.DurbarBrainDraw; in Node: module.exports.
   Constitution V (Amendment 3): a still frame under Still and reduced motion, a frame budget, a pause when hidden, no per-frame filters.
   Everything outside the canvas is injected (`host`: now, raf, caf, makeCanvas, dpr), so tests run it in Node with a recording context.
   The whole brain is drawn ONCE into an offscreen base layer (per size, ratio and palette); a frame stamps it and draws only the lit lobe's points,
   the trail and the marker. Glow sprites are built once. No filter, shadow or blend mode anywhere. A loop runs only while a burst or the bloom does. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrainDraw=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const P=(typeof module==='object'&&module.exports)?require('./points.js'):(typeof self!=='undefined'?self:globalThis).DurbarBrainPoints;
  const TRAIL_MAX=24;            /* brainstate.ts TRAIL_MAX (a test compares) */
  const BURST_MS={full:250,calm:150}, BLOOM_MS=900, BLOOM_ALPHA_MAX=0.3;
  const BUDGET_MS={office:2,dock:3,front:6,still:0.5}; /* FR-101 */
  const OVER_LIMIT=3;            /* frames in a row over budget before this canvas drops to Calm */
  const LOBE_COLORS={frontal:'#e0a458',occipital:'#6fb7d6',parietal:'#9bc86a',cerebellum:'#d97a7a',temporal:'#b08ad8',stem:'#7ed0b6',port:'#e8d36a'};
  const FORCED={point:'CanvasText',lit:'Highlight',line:'CanvasText'};
  const PT={office:1.4,dock:1.6,front:2};

  function create(o){
    const canvas=o.canvas, host=o.host, size=o.size||'dock';
    if(!P.SIZES[size])throw new Error('unknown size '+size);
    const set0=P.build(size);
    let motion=o.motion||'full', forced=!!o.forced, visible=o.visible!==false, focused=o.focused!==false;
    const colors=Object.assign({},LOBE_COLORS,o.colors||{});
    let W=o.width||240, H=Math.round(W/P.ASPECT), dpr=host.dpr?host.dpr():1;
    let ctx=canvas.getContext('2d'), base=null, sprites=null;
    let view={id:null,lobe:null,state:'done',trail:[],bloom:[],rev:0};
    let anim=null, rafId=0, dirty=true, destroyed=false, degraded=false, over=0;
    const stats={frames:0,basePoints:0,pointsLast:0,pointsMax:0,framesHidden:0,loops:0,loopRunning:false,baseBuilds:0,spriteBuilds:0,overBudget:0,degraded:false,lastMs:0,canvases:1};

    const eff=()=>(forced||!focused)?'still':(degraded?'calm':motion);
    const px=(x)=>x*W, py=(y)=>y*H;
    function fit(){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);if(canvas.style){canvas.style.width=W+'px';canvas.style.height=H+'px';}ctx=canvas.getContext('2d');base=null;buildBase();} /* the base layer is built here, never inside a frame: a frame draws only the lit lobe (FR-102) */
    function buildBase(){
      const c=host.makeCanvas(canvas.width,canvas.height), x=c.getContext('2d'), s=PT[size]*dpr;
      x.setTransform(1,0,0,1,0,0);
      for(let l=0;l<P.LOBES.length;l++){
        x.fillStyle=forced?FORCED.point:colors[P.LOBES[l]];
        x.globalAlpha=forced?1:0.32;
        const idx=set0.byLobe[l];
        for(let k=0;k<idx.length;k++){const i=idx[k];x.fillRect(set0.xs[i]*canvas.width,set0.ys[i]*canvas.height,s,s);}
      }
      stats.baseBuilds++;stats.basePoints=set0.n;base=c;
    }
    function buildSprites(){
      if(forced||sprites)return;
      sprites={};const r=Math.round(18*dpr);
      for(const l of P.LOBES){
        const c=host.makeCanvas(r*2,r*2),x=c.getContext('2d'),g=x.createRadialGradient(r,r,0,r,r,r);
        g.addColorStop(0,colors[l]);g.addColorStop(1,'rgba(0,0,0,0)');
        x.fillStyle=g;x.fillRect(0,0,r*2,r*2);sprites[l]=c;stats.spriteBuilds++;
      }
    }
    /* t = 0..1 progress of the burst (1 when none runs); b = 0..1 of the bloom or -1 */
    function paint(t,b){
      const mode=eff(), s=PT[size]*dpr;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(!base)buildBase();
      ctx.globalAlpha=1;ctx.drawImage(base,0,0);
      let pts=0;
      /* the trail: thin lines lobe to lobe, the newest brightest, at most TRAIL_MAX steps (FR-040) */
      const tr=view.trail.slice(-TRAIL_MAX);
      ctx.lineWidth=Math.max(1,dpr);ctx.strokeStyle=forced?FORCED.line:'#cfd6e4';
      for(let i=1;i<tr.length;i++){
        const a=P.ANCHORS[tr[i-1].lobe],c=P.ANCHORS[tr[i].lobe];if(!a||!c)continue;
        ctx.globalAlpha=forced?1:0.15+0.6*(i/tr.length);
        ctx.beginPath();ctx.moveTo(px(a.x)*dpr,py(a.y)*dpr);ctx.lineTo(px(c.x)*dpr,py(c.y)*dpr);ctx.stroke();
      }
      ctx.globalAlpha=1;
      const li=view.lobe?P.LOBES.indexOf(view.lobe):-1;
      if(li>=0){
        const idx=set0.byLobe[li], share=mode==='calm'&&t<1?0.5:1, reach=Math.ceil(idx.length*Math.min(1,t)*share);
        const a=P.ANCHORS[view.lobe], cx=px(a.x)*dpr, cy=py(a.y)*dpr;
        if(mode==='full'&&sprites){ctx.globalAlpha=0.55*(0.4+0.6*Math.min(1,t));const r=sprites[view.lobe].width;ctx.drawImage(sprites[view.lobe],cx-r/2,cy-r/2);}
        ctx.globalAlpha=1;ctx.fillStyle=forced?FORCED.lit:colors[view.lobe];
        for(let k=0;k<reach;k++){const i=idx[k];ctx.fillRect(set0.xs[i]*canvas.width,set0.ys[i]*canvas.height,s*1.4,s*1.4);pts++;}
        /* the marker says the state by shape (FR-016): running a ring, done a filled disc, failed a cross */
        const m=5*dpr;ctx.lineWidth=Math.max(1.5,1.5*dpr);ctx.strokeStyle=forced?FORCED.lit:'#ffffff';ctx.fillStyle=forced?FORCED.lit:colors[view.lobe];
        ctx.beginPath();
        if(view.state==='failed'){ctx.moveTo(cx-m,cy-m);ctx.lineTo(cx+m,cy+m);ctx.moveTo(cx+m,cy-m);ctx.lineTo(cx-m,cy+m);ctx.stroke();}
        else if(view.state==='running'){ctx.arc(cx,cy,m,0,6.2832);ctx.stroke();}
        else{ctx.arc(cx,cy,m,0,6.2832);ctx.fill();ctx.stroke();}
      }
      /* the honest bloom (FR-051): only the lobes the turn used, once, brightness capped; none in Calm or Still */
      if(mode==='full'&&sprites&&b>=0){
        const e=Math.sin(Math.min(1,b)*Math.PI); /* up and down once: two luminance changes in 0.9 s, under 3 a second */
        for(const l of view.bloom){const a=P.ANCHORS[l],sp=sprites[l];if(!a||!sp)continue;ctx.globalAlpha=BLOOM_ALPHA_MAX*e;ctx.drawImage(sp,px(a.x)*dpr-sp.width/2,py(a.y)*dpr-sp.height/2);}
      }
      ctx.globalAlpha=1;
      stats.pointsLast=pts;stats.pointsMax=Math.max(stats.pointsMax,pts);
    }
    function frame(){
      if(destroyed)return;
      if(!visible){stats.framesHidden++;return;} /* never reached: the loop is cancelled when hidden; counted so a test can see it */
      const t0=host.now();
      const burst=anim&&anim.kind!=='bloom'?(host.now()-anim.start)/anim.dur:1, bloom=anim&&anim.bloomStart!=null?(host.now()-anim.bloomStart)/BLOOM_MS:-1;
      dirty=false;paint(burst,bloom>=1?-1:bloom);
      stats.frames++;
      const ms=host.now()-t0;stats.lastMs=ms;
      const budget=BUDGET_MS[eff()==='still'?'still':size];
      if(ms>budget){stats.overBudget++;if(++over>=OVER_LIMIT&&!degraded){degraded=true;stats.degraded=true;}}else over=0;
      const doneBurst=!anim||burst>=1, doneBloom=!anim||anim.bloomStart==null||bloom>=1;
      if(doneBurst&&doneBloom){anim=null;rafId=0;stats.loopRunning=false;return;} /* settled: no loop is left (FR-103) */
      rafId=host.raf(frame);
    }
    function stopLoop(){if(rafId){host.caf(rafId);rafId=0;}stats.loopRunning=false;}
    function startLoop(){if(rafId||destroyed)return;stats.loops++;stats.loopRunning=true;rafId=host.raf(frame);}
    function drawOnce(){
      if(!visible){dirty=true;return;}
      dirty=false;const t0=host.now();paint(1,-1);stats.frames++;stats.lastMs=host.now()-t0;
    }

    fit();
    const api={
      stats,
      mode:eff,
      /* view: {id (the agent: rev counts per agent), lobe, state, trail:[{lobe,state}], bloom:[lobe], rev}; draws only when something visibly changed */
      set(v){
        if(destroyed)return;
        const prev=view, nv={id:v.id==null?null:String(v.id),lobe:v.lobe||null,state:v.state||'done',trail:Array.isArray(v.trail)?v.trail.slice():[],bloom:Array.isArray(v.bloom)?v.bloom.filter(l=>P.LOBES.indexOf(l)>=0):[],rev:v.rev||0};
        const same=prev.id===nv.id&&prev.rev===nv.rev&&prev.lobe===nv.lobe&&prev.state===nv.state&&prev.trail.length===nv.trail.length&&prev.bloom.join()===nv.bloom.join();
        view=nv;
        if(same&&!dirty)return;
        if(!visible){dirty=true;return;}
        const m=eff();
        stopLoop();anim=null;
        if(m==='still'){drawOnce();return;}
        buildSprites();
        const newLobe=prev.lobe!==nv.lobe||prev.rev!==nv.rev, newBloom=nv.bloom.length&&prev.bloom.join()!==nv.bloom.join();
        if(m==='full'&&newBloom||newLobe&&nv.lobe){
          anim={kind:'burst',start:host.now(),dur:BURST_MS[m]};
          if(m==='full'&&newBloom)anim.bloomStart=host.now();
          if(!newLobe)anim.dur=1;
          startLoop();
        }else drawOnce();
      },
      setMotion(m){if(motion===m)return;motion=m;degraded=false;over=0;stats.degraded=false;stopLoop();anim=null;if(m!=='still')buildSprites();drawOnce();},
      setForced(f){forced=!!f;base=null;sprites=null;stopLoop();anim=null;buildBase();drawOnce();},
      /* FR-104: hidden draws nothing and stops the loop; shown again draws the latest state once */
      setVisible(v){visible=!!v;if(!visible){stopLoop();anim=null;dirty=true;return;} /* a burst cut short leaves a part frame on the canvas: draw the settled state once on show */if(dirty)drawOnce();},
      /* unfocused: no animation; the state change is drawn as Still */
      setFocused(f){focused=!!f;if(!focused){stopLoop();anim=null;drawOnce();}},
      resize(w,r){W=Math.max(80,Math.round(w));H=Math.round(W/P.ASPECT);dpr=r||dpr;stopLoop();anim=null;sprites=null;fit();drawOnce();},
      size:()=>({w:W,h:H}),
      pointCount:()=>set0.n,
      destroy(){destroyed=true;stopLoop();anim=null;}
    };
    return api;
  }
  return {create,TRAIL_MAX,BURST_MS,BLOOM_MS,BLOOM_ALPHA_MAX,BUDGET_MS,OVER_LIMIT,LOBE_COLORS};
})());
