/* Settings section list (spec 052 FR-226, T219): the pure part. The entries come from the headings that are rendered, never from a list kept
   here, so a section that appears, goes or moves needs no edit; which entry is current comes from where the headings sit in the scroller.
   No DOM. In the page: window.DurbarSettingsNav; in Node: module.exports (scripts/test-settings-nav.ts). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSettingsNav=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_LABEL=40;
  /* heads: [{id, text}] in page order (text without its <small> note). Returns [{id, label, at}] where `at` is the index in `heads`:
     an empty text or a repeated id is left out, a missing id gets `sn-<position>` (the caller sets it on the heading), a long text is cut. */
  function build(heads){
    const out=[], seen=new Set();
    (Array.isArray(heads)?heads:[]).forEach((h,at)=>{
      const label=String((h&&h.text)||'').replace(/\s+/g,' ').trim();
      if(!label)return;
      const id=h.id?String(h.id):'sn-'+at;
      if(seen.has(id))return;
      seen.add(id);
      out.push({id,label:label.length>MAX_LABEL?label.slice(0,MAX_LABEL-1)+'…':label,at});
    });
    return out;
  }
  /* tops: each section's top relative to the scroller's top, in page order. The current entry is the last one whose top has reached `edge`;
     the first one before any has; the last one when the page is scrolled to its end (a short last section never reaches the edge). */
  function current(tops,edge,atEnd){
    const n=Array.isArray(tops)?tops.length:0;
    if(!n)return -1;
    if(atEnd)return n-1;
    let k=0;
    for(let i=0;i<n;i++)if(tops[i]<=edge)k=i;
    return k;
  }
  /* the entry a key moves the focus to (ArrowUp/ArrowDown step, Home/End jump, no wrap); -1 for any other key */
  function step(key,i,n){
    if(!n)return -1;
    if(key==='ArrowDown')return Math.min(n-1,i+1);
    if(key==='ArrowUp')return Math.max(0,i-1);
    if(key==='Home')return 0;
    if(key==='End')return n-1;
    return -1;
  }
  return {build,current,step,MAX_LABEL};
})());
