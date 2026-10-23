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
  /* ---- Columns on a wide grown desk (spec 001 FR-047, FR-048, owner 2026-10-22): more information, not longer lines.
        grownCols(room, {reply}): room is the text room of the card in px (its width less the illustration and padding). Returns
        {n, main, reply, side}: n = 1 (the single-column grown desk), 2 (main | one side column: the reply above the facts) or 3 (main |
        reply | facts; only with a reply to show). Widths in px, 0 for a column not shown; main, reply and side never exceed their maxima,
        so no line is longer than about 85 characters, and their sum with the gaps never exceeds the room. ---- */
  const GCOL={GAP:16, MAIN:[260,450], MAIN3:[360,450], REPLY:[240,420], SIDE:[180,320]}; /* MAIN3: the main column's min beside two others */
  const spread=(room,cols)=>{ /* each column from its min towards its max, by the same share of the room left */
    const gaps=(cols.length-1)*GCOL.GAP, min=cols.reduce((t,c)=>t+c[0],0), span=cols.reduce((t,c)=>t+c[1]-c[0],0);
    const t=Math.max(0,Math.min(1,(room-gaps-min)/(span||1)));
    return cols.map(c=>Math.floor(c[0]+t*(c[1]-c[0])));
  };
  function grownCols(room,o){
    const reply=!!(o&&o.reply), G=GCOL, w=Math.max(0,Math.floor(Number(room)||0));
    if(reply&&w>=G.MAIN3[0]+G.REPLY[0]+G.SIDE[0]+2*G.GAP){const [m,r,s]=spread(w,[G.MAIN3,G.REPLY,G.SIDE]);return {n:3,main:m,reply:r,side:s};}
    const sideR=reply?[G.SIDE[0],G.REPLY[1]]:G.SIDE; /* two columns: with a reply, the side column holds it (up to the reply's measure) */
    if(w>=G.MAIN[0]+sideR[0]+G.GAP){const [m,s]=spread(w,[G.MAIN,sideR]);return {n:2,main:m,reply:0,side:s};}
    return {n:1,main:w,reply:0,side:0};
  }
  /* ---- Spare height (spec 001 FR-086, FR-087, owner report issue 619): what a drawn office that fits does not need of the floor's height.
        spreadRows(lines, avail, gap, cap): lines are the stage's rows top to bottom ({h, room}: height in px, a row of rooms or not), avail
        the floor's inner height, gap the gap between rows (10 px), cap the share of the shortest room row that every room row may grow.
        Returns {rx, top, rowGap}: rx is added to every room row (whole px, at most cap x the shortest), then top (above the first row) and
        rowGap (between rows) make the gaps above, between and below the rows even; rowGap is never below gap, and when it would be, the rest
        is split above the first and below the last row. Nothing to spare (or bad input): {rx: 0, top: 0, rowGap: gap}. ---- */
  const r2=x=>Math.floor(x*100)/100; /* round down: the rows never end below the floor */
  function spreadRows(lines,avail,gap,cap){
    const none={rx:0,top:0,rowGap:gap}, n=Array.isArray(lines)?lines.length:0;
    if(!n||!(avail>0))return none;
    const free=avail-lines.reduce((t,l)=>t+(Number(l.h)||0),0)-(n-1)*gap;
    if(!(free>0))return none;
    const rooms=lines.filter(l=>l.room), R=rooms.length;
    const rx=R?Math.max(0,Math.floor(Math.min(free/R,(cap||0)*Math.min(...rooms.map(l=>Number(l.h)||0))))):0;
    const rest=free-R*rx, g=(rest+(n-1)*gap)/(n+1);
    if(g>=gap)return {rx,top:r2(g),rowGap:r2(g)};
    return {rx,top:r2(rest/2),rowGap:gap};
  }
  return {svgHollow,styleSplit,GROW,largest,better,pick,GCOL,grownCols,spreadRows};
})());
