/* Spec 106 FR-010: the point sets of the side-view brain. Pure: no DOM, no clock. In the page: window.DurbarBrainPoints; in Node: module.exports.
   Generated once per size at first use from a fixed seed (the same points on every run and OS). Coordinates are 0..1 in a box that is ASPECT wide for 1 high.
   Lobes have soft edges: points thin out over a band at each border and at the outline, never a hard line. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrainPoints=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const ASPECT=1.5;
  const SIZES={office:2500,dock:6000,front:10000}; /* FR-010 */
  const LOBES=['frontal','occipital','parietal','cerebellum','temporal','stem','port']; /* the ids of brainstate.ts LobeId; a test compares them */
  const BAND=0.05; /* the soft border, in box heights */
  /* where each lobe's glyph and trail end sit */
  const ANCHORS={frontal:{x:0.25,y:0.36},occipital:{x:0.78,y:0.4},parietal:{x:0.52,y:0.2},cerebellum:{x:0.74,y:0.74},temporal:{x:0.48,y:0.6},stem:{x:0.57,y:0.84},port:{x:0.17,y:0.64}};
  const CEREBRUM={x:0.5,y:0.42,rx:0.46,ry:0.34}, CEREBELLUM={x:0.72,y:0.74,rx:0.16,ry:0.1}, STEM={x:0.57,y:0.84,rx:0.05,ry:0.13}, PORT={x:0.17,y:0.64,rx:0.07,ry:0.06};
  const CEREBRAL=['frontal','occipital','parietal','temporal'];

  function rng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  /* normalised radius of a point in an ellipse (1 at the outline) */
  const rad=(e,x,y)=>Math.hypot((x-e.x)/e.rx,(y-e.y)/e.ry);
  /* the lobe of a point inside the shape and how deep it is: depth 0 at an outline or a lobe border, up to 1; null outside */
  function locate(x,y){
    const rs=rad(STEM,x,y), rc=rad(CEREBELLUM,x,y), rp=rad(PORT,x,y), rb=rad(CEREBRUM,x,y);
    const hit=[];
    if(rs<=1)hit.push(['stem',(1-rs)/BAND/4]);
    if(rc<=1)hit.push(['cerebellum',(1-rc)/BAND/4]);
    if(rp<=1)hit.push(['port',(1-rp)/BAND/4]);
    if(rb<=1&&y<=CEREBRUM.y+CEREBRUM.ry*0.82){
      let d1=1e9,d2=1e9,l1=null;
      for(const l of CEREBRAL){const a=ANCHORS[l],d=Math.hypot((x-a.x)*ASPECT,y-a.y);if(d<d1){d2=d1;d1=d;l1=l;}else if(d<d2)d2=d;}
      hit.push([l1,Math.min((d2-d1)/BAND,(1-rb)/BAND/4)]);
    }
    if(!hit.length)return null;
    hit.sort((a,b)=>b[1]-a[1]);
    return {lobe:hit[0][0],depth:Math.max(0,Math.min(1,hit[0][1]))};
  }
  const cache={};
  /* {n, xs, ys, w, lobe (Uint8, index in LOBES), byLobe: [Uint32Array of point indexes per lobe]} */
  function build(size){
    const N=SIZES[size];
    if(!N)throw new Error('unknown size '+size);
    if(cache[size])return cache[size];
    const r=rng(1061*N+7), xs=new Float32Array(N), ys=new Float32Array(N), w=new Float32Array(N), lobe=new Uint8Array(N);
    let n=0;
    while(n<N){
      const x=r(), y=r(), p=r(), loc=locate(x,y);
      if(!loc)continue;
      if(p>Math.min(1,0.08+loc.depth))continue; /* thinning over the band: the density falls to 8% at a border */
      xs[n]=x;ys[n]=y;w[n]=0.55+0.45*loc.depth;lobe[n]=LOBES.indexOf(loc.lobe);n++;
    }
    const lists=LOBES.map(()=>[]);
    for(let i=0;i<N;i++)lists[lobe[i]].push(i);
    return cache[size]={size,n:N,xs,ys,w,lobe,byLobe:lists.map(l=>Uint32Array.from(l))};
  }
  /* for tests: how close a box point is to a border, in the same units as the thinning (0 at the border) */
  const depthAt=(x,y)=>{const l=locate(x,y);return l?l.depth:null;};
  const lobeAt=(x,y)=>{const l=locate(x,y);return l?l.lobe:null;};
  return {ASPECT,SIZES,LOBES,ANCHORS,BAND,build,depthAt,lobeAt};
})());
