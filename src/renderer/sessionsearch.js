/* Title search of Previous sessions (spec 006 FR-023, issue #252). Pure: no DOM, no I/O. In the page: window.DurbarSessionSearch; in Node: module.exports. Only titles are matched. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSessionSearch=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* lower case, accents removed: "Explicación" and "EXPLICACION" are the same */
  const fold=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  /* the words of a query, folded; empty when the query is blank */
  const terms=q=>fold(q).split(/\s+/).filter(Boolean);
  /* sessions whose title holds every word of the query (any order); the input order (newest first) is kept; a blank query keeps all */
  function filterSessions(list, query){
    const arr=Array.isArray(list)?list:[], t=terms(query);
    if(!t.length)return arr.slice();
    return arr.filter(x=>{const title=fold(x&&x.title);return t.every(w=>title.includes(w));});
  }
  /* Spec 006 FR-024/FR-025: pin and hide. `pinned` and `hidden` are arrays of ids; `timeKey` names the time field ('modifiedTime' or 'updated').
     Hidden rows are out unless `showHidden` (then they stay in place, flagged); pinned rows come first, newest first; the rest keep the input order.
     A row is exactly one of pinned, normal or hidden (hidden wins). `total` = rows shown before the search (M of "N of M"); `hiddenCount` = hidden rows in the list. */
  function arrangeSessions(list, o){
    const arr=Array.isArray(list)?list:[], opt=o||{}, keyOf=x=>String(x&&x.id!=null?x.id:x&&x.key!=null?x.key:'');
    const pin=new Set(Array.isArray(opt.pinned)?opt.pinned:[]), hide=new Set(Array.isArray(opt.hidden)?opt.hidden:[]);
    const tk=opt.timeKey||'modifiedTime', time=x=>{const v=x&&x[tk];return typeof v==='number'?v:0;};
    const all=arr.map(item=>{const k=keyOf(item),h=hide.has(k);return {item,hidden:h,pinned:!h&&pin.has(k)};});
    const hiddenCount=all.filter(r=>r.hidden).length;
    const shown=all.filter(r=>!r.hidden||opt.showHidden===true);
    const pins=shown.filter(r=>r.pinned).map((r,i)=>({r,i})).sort((a,b)=>time(b.r.item)-time(a.r.item)||a.i-b.i).map(x=>x.r);
    const ordered=pins.concat(shown.filter(r=>!r.pinned));
    const keep=new Set(filterSessions(ordered.map(r=>r.item),opt.query));
    return {rows:ordered.filter(r=>keep.has(r.item)),hiddenCount,total:shown.length};
  }
  return {fold, terms, filterSessions, arrangeSessions};
})());
