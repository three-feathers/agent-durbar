/* Title search of Previous sessions (spec 006 FR-022, issue #252). Pure: no DOM, no I/O. In the page: window.DurbarSessionSearch; in Node: module.exports. Only titles are matched. */
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
  return {fold, terms, filterSessions};
})());
