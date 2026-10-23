/* Scrolling and focus that never move the page (spec 052 FR-055, FR-176; issue #638).
   `el.focus()` and `el.scrollIntoView()` scroll EVERY ancestor that can scroll, including `html`, `body` and boxes with
   `overflow:hidden`. In this app those must stay still: when one moved, the top bar and the chat header slid off the top and a
   blank band was left at the bottom, with no scrollbar to bring them back. So:
   - `reveal(el, o)` scrolls only the nearest INNER scroller (overflow auto or scroll) that holds `el`: the chat, the list, a
     screen's body, a menu. Pinned containers (PINNED) are never scrolled.
   - `focus(el)` focuses without scrolling, then reveals `el` in its own scroller, as a native focus would, minus the page.
   - `pin(doc)` is the safety net: if a pinned container ever ends up scrolled (a native Tab focus, a future regression), it is
     put back to 0 on its scroll event.
   The arithmetic (`delta`, `resetPinned`) is pure: scripts/test-inner-scroll.ts. In the page: window.DurbarScroll; in Node:
   module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarScroll=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* The containers that must never scroll: the page, the app's frame around the office, the chat and the screens (all overflow:hidden or visible) */
  const PINNED='html,body,.workspace,#floor,#panel,.panel-in,#screen';

  /* How far to scroll a scroller so the box r (top/bottom, or left/right with axis 'x') shows inside the view s.
     block: 'start' (r at the top, `margin` below it), 'center', or 'nearest' (0 when r is already inside; a box taller than the
     view lines up its start). Returns the amount to add to scrollTop (or scrollLeft). */
  function delta(r, s, block, margin, axis){
    const a=axis==='x'?'left':'top', b=axis==='x'?'right':'bottom', m=+margin||0;
    const rs=+r[a]||0, re=+r[b]||0, ss=+s[a]||0, se=+s[b]||0;
    if(block==='start')return rs-ss-m;
    if(block==='center')return (rs+re)/2-(ss+se)/2;
    if(rs<ss+m)return rs-ss-m;
    if(re>se-m)return Math.min(re-se+m, rs-ss-m);
    return 0;
  }

  const scrolls=v=>v==='auto'||v==='scroll'||v==='overlay';
  /* the nearest ancestor of el that scrolls on that axis by itself and is not pinned */
  function scrollerOf(el, axis){
    for(let p=el&&el.parentElement;p;p=p.parentElement){
      if(p.matches(PINNED))continue;
      const c=getComputedStyle(p), ov=axis==='x'?c.overflowX:c.overflowY;
      if(scrolls(ov))return p;
    }
    return null;
  }

  /* o: {block:'start'|'center'|'nearest' (default 'nearest'), inline:'nearest'|undefined, margin:number, scroller:Element} */
  function reveal(el, o){
    o=o||{};
    if(!el||!el.isConnected||!el.getClientRects().length)return;
    const sc=o.scroller||scrollerOf(el,'y');
    if(sc&&!sc.matches(PINNED)){const d=delta(el.getBoundingClientRect(),sc.getBoundingClientRect(),o.block||'nearest',o.margin);if(d)sc.scrollTop+=d;}
    if(o.inline){
      const sx=scrollerOf(el,'x');
      if(sx){const d=delta(el.getBoundingClientRect(),sx.getBoundingClientRect(),o.inline,o.margin,'x');if(d)sx.scrollLeft+=d;}
    }
  }

  /* focus without moving the page; o as for reveal, or {reveal:false} to keep every scroller where it is */
  function focus(el, o){
    if(!el||typeof el.focus!=='function')return;
    el.focus({preventScroll:true});
    if(!o||o.reveal!==false)reveal(el,o);
  }

  /* Pure part of the safety net: puts every element of `els` that is scrolled back to 0; returns how many it moved. */
  function resetPinned(els){
    let n=0;
    for(const e of els){if(!e)continue;if(e.scrollTop||e.scrollLeft){e.scrollTop=0;e.scrollLeft=0;n++;}}
    return n;
  }
  let pinned=false;
  function pin(doc){
    if(pinned||!doc)return;
    pinned=true;
    const check=t=>{const el=t===doc?doc.scrollingElement||doc.documentElement:t;if(el&&el.matches&&el.matches(PINNED))resetPinned([el]);};
    /* scroll does not bubble; the capture phase on the document sees every element's scroll (and the page's own, target document) */
    doc.addEventListener('scroll',e=>check(e.target),{capture:true,passive:true});
    resetPinned([doc.scrollingElement,doc.documentElement,doc.body]);
  }

  return {PINNED, delta, scrollerOf, reveal, focus, resetPinned, pin};
})());
