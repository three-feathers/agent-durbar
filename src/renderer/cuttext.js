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
  const RI=/^[\u{1F1E6}-\u{1F1FF}]$/u;
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
    let ri=0;while(ri<cut&&RI.test(cps[cut-1-ri]))ri++;
    if(ri%2===1)cut--; /* never between the two halves of a flag (a pair of regional indicators) */
    let head=cps.slice(0,cut).join('').trimEnd();
    if(o.trimPunct)head=head.replace(/[\s.,;:!?-]+$/,'');
    return head+'…';
  }
  /* The longest cut of `full` that fits (spec 052 FR-174): `fits(text)` says whether a text fits; the whole text plus "…" when that fits, else the largest code-point count whose cutText fits (binary search, fits is monotone). */
  function fitCut(full,fits){
    const whole=full+'…';if(fits(whole))return whole;
    let lo=1,hi=Array.from(full).length-1;
    while(lo<hi){const m=(lo+hi+1)>>1;if(fits(cutText(full,m)))lo=m;else hi=m-1;}
    return cutText(full,lo);
  }
  /* spec 001 FR-271 (issue 1905): the tail of a long folder name, the part that stays visible when the name is cut in the middle ("iot-pl…form-2").
     '' for a name of 12 characters or fewer (not split). Otherwise whole segments (split at - _ . and space) added from the end until the tail has
     6 or more characters; when that is more than 10, the last 8 characters. Code points, so a surrogate pair is never split. */
  const SEP=/^[-_. ]$/;
  function nameTail(name){
    const cps=Array.from(String(name==null?'':name));
    if(cps.length<=12)return '';
    let start=-1;
    for(let i=cps.length-1;i>0;i--){
      if(!SEP.test(cps[i-1])||SEP.test(cps[i]))continue; /* a segment starts after a separator */
      if(cps.length-i>=6){start=i;break;}
    }
    const len=start<0?Infinity:cps.length-start;
    return (len<=10?cps.slice(start):cps.slice(-8)).join('');
  }
  /* One layout per render (Paco's review of #2017): a fit that clears a mark on each item and measures it in the same loop forces a reflow per item.
     Three passes: (1) `clear(item)` on all, (2) `isCut(item)` on all (reads only), (3) `mark(item)` where cut. With `key(item)`, an item whose key is the one
     it was last measured at keeps its mark and costs no read (a status update that changes neither its text nor its width); returns the items measured. */
  function fitBatch(items,clear,isCut,mark,key){
    const list=Array.from(items).filter(it=>!key||it._fitKey!==key(it));
    for(const it of list)clear(it);
    const cut=list.filter(it=>isCut(it));
    for(const it of cut)mark(it);
    if(key)for(const it of list)it._fitKey=key(it);
    return list;
  }
  /* A fit key for a row whose neighbours can grow (the counts and cost beside a folder name): `base` is what resets it (text, width, form), `len` the neighbour's text length.
     The key holds the longest `len` seen since the base last changed: a neighbour that grows past it measures again, one that shrinks or comes back to a length already
     measured cannot cut the name any more than it did, and costs no read. */
  function growKey(it,base,len){
    if(it._gBase!==base){it._gBase=base;it._gMax=len;}else if(len>it._gMax)it._gMax=len;
    return base+'|'+it._gMax;
  }
  return {cutText,fitCut,nameTail,fitBatch,growKey};
})());
