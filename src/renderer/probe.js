/* The office layout search (spec 001 FR-033) measures trial layouts in the hidden #probe. Two pure helpers make a trial cheaper
   without changing any box it measures. No DOM. In the page: window.DurbarProbe; in Node (tests): module.exports.
   - svgHollow(html): keeps every outer <svg ...> tag with its attributes and drops what is inside it (nested <svg> included).
     An <svg>'s box comes from its own attributes and CSS, never from its children, so every measured box stays the same, and
     the drawings (two thirds of a trial's elements) are not parsed, styled or laid out.
   - styleSplit(html): the HTML without its style="..." attributes, and those values in document order. Two trials with the same
     rest differ only in those values, so the probe can set them in place instead of parsing the whole stage again.
   - GROW, largest, better, pick: which grown-desk trials to run and which one wins (spec 001 FR-041, FR-042; below). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarProbe=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  function svgHollow(h){
    h=String(h); let o='',i=0;
    for(;;){
      const j=h.indexOf('<svg',i); if(j<0)return o+h.slice(i);
      const e=h.indexOf('>',j); if(e<0)return o+h.slice(i);
      o+=h.slice(i,e+1);
      if(h[e-1]==='/'){i=e+1;continue;} /* <svg .../> has nothing inside */
      let d=1,k=e+1;
      while(d>0){
        const a=h.indexOf('<svg',k),b=h.indexOf('</svg>',k);
        if(b<0)return o+h.slice(k); /* unclosed: leave the rest as it is */
        if(a>=0&&a<b){const ae=h.indexOf('>',a);d+=ae>0&&h[ae-1]==='/'?0:1;k=ae>0?ae+1:a+4;}else{d--;k=b+6;}
      }
      o+='</svg>'; i=k;
    }
  }
  const STYLE_ATTR=/ style="([^"]*)"/g;
  function styleSplit(html){
    const s=String(html), vals=[];
    const bare=s.replace(STYLE_ATTR,(m,v)=>{vals.push(v);return '';});
    return {bare,vals};
  }
  /* ---- Grown desks (spec 001 FR-041, FR-042): with few agents a `roomy` card grows by a factor f (1.0 to 2.5 in 0.1 steps) until the office
        no longer fits. The fit itself is measured by the layout search in the hidden probe (app.js); this module only decides which trials to
        run and which result wins, so it is pure and tested in Node (test:probe).
        - largest(fits, lo, hi, step): the largest f in lo..hi (on the step grid from lo) for which fits(f) is true, or null when fits(lo) is
          false. fits must be monotone (true up to a size, false above it), which holds because a larger card is never smaller in any direction.
        - better(a, b): is result a better than b? Larger f, then more of the floor's height filled, then fewer columns.
        - pick(cols, lo, trial): for every column count, the largest f; trial(c, f) -> {fits, h}. Returns {c, f, h} or null. ---- */
  const GROW={MIN:1, MAX:2.5, STEP:0.1, TWO_LINES:1.4};
  const snap=(f,lo,step)=>Math.round((lo+Math.round((f-lo)/step)*step)*1000)/1000;
  function largest(fits,lo,hi,step){
    step=step||GROW.STEP;
    if(!(hi>=lo)||!fits(lo))return null;
    let a=0, b=Math.floor((hi-lo)/step+1e-9); /* steps: a fits; find the largest that fits up to b */
    if(fits(snap(lo+b*step,lo,step)))return snap(lo+b*step,lo,step);
    while(b-a>1){const m=(a+b)>>1; if(fits(snap(lo+m*step,lo,step)))a=m; else b=m;}
    return snap(lo+a*step,lo,step);
  }
  function better(a,b){
    if(!b)return !!a;
    if(!a)return false;
    if(Math.abs(a.f-b.f)>1e-6)return a.f>b.f;
    if(Math.abs(a.h-b.h)>4)return a.h>b.h; /* the same size: the one that fills more of the floor (within 4 px: the same) */
    return a.c<b.c; /* then fewer columns: wider desks, rows of equal length */
  }
  function pick(cols,lo,trial,hi,step){
    hi=hi==null?GROW.MAX:hi; step=step||GROW.STEP;
    let best=null;
    for(const c of cols){
      const hs=new Map(); /* f -> measured height, for the trials that fit (no trial runs twice) */
      const f=largest(x=>{const r=trial(c,x);if(r&&r.fits){hs.set(x,r.h);return true;}return false;},lo,hi,step);
      if(f==null)continue;
      const cand={c,f,h:hs.get(f)};
      if(better(cand,best))best=cand;
    }
    return best;
  }
  return {svgHollow,styleSplit,GROW,largest,better,pick};
})());
