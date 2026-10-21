/* The office layout search (spec 001 FR-028) measures trial layouts in the hidden #probe. Two pure helpers make a trial cheaper
   without changing any box it measures. No DOM. In the page: window.DurbarProbe; in Node (tests): module.exports.
   - svgHollow(html): keeps every outer <svg ...> tag with its attributes and drops what is inside it (nested <svg> included).
     An <svg>'s box comes from its own attributes and CSS, never from its children, so every measured box stays the same, and
     the drawings (two thirds of a trial's elements) are not parsed, styled or laid out.
   - styleSplit(html): the HTML without its style="..." attributes, and those values in document order. Two trials with the same
     rest differ only in those values, so the probe can set them in place instead of parsing the whole stage again. */
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
  return {svgHollow,styleSplit};
})());
