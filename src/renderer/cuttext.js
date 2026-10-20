/* One way to shorten a line of text for display (spec 044 FR-021): collapses whitespace, counts code points (so an emoji or a
   surrogate pair is never split, and a combining mark stays with its letter), and ends a cut text with "…" within `max`.
   Pure: no DOM. In the page: window.DurbarCutText; in Node (tests, attention.js): module.exports.
   Used by clipName (file names), attention.clip (notification text) and the grant and schedule-row texts. The word-boundary and
   punctuation options are for names (not used by the others, which keep a plain cut).
   Options: { wordBoundary: cut at the last space of the second half when there is one; trimPunct: also drop trailing . , ; : ! ? - } */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarCutText=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MARK=/^[\p{M}‍️]$/u;
  /* At most `max` code points including the "…"; the whole text (whitespace collapsed) when it fits; '' for null or max < 1 */
  function cutText(text,max,opts){
    const o=opts||{}, s=String(text==null?'':text).replace(/\s+/g,' ').trim(), m=Math.floor(Number(max));
    if(!(m>=1))return '';
    const cps=Array.from(s);
    if(cps.length<=m)return s;
    let cut=m-1;
    if(o.wordBoundary&&cps[cut]!==' '){const i=cps.lastIndexOf(' ',cut);if(i>=Math.floor(m/2))cut=i;}
    while(cut>0&&(MARK.test(cps[cut])||cps[cut-1]==='‍'))cut--; /* never between a letter and its mark, or after a joiner */
    let head=cps.slice(0,cut).join('').trimEnd();
    if(o.trimPunct)head=head.replace(/[\s.,;:!?-]+$/,'');
    return head+'…';
  }
  return {cutText};
})());
