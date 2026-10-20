/* Status that tells the truth and a sortable list (spec 052 FR-062, FR-064): "last activity" labels, the list's sort and the lines of a
   permission diff (FR-063). Pure: no DOM, no timers of its own (time is injected). In the page: window.DurbarActivity; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarActivity=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MIN=60000, HOUR=3600000, DAY=86400000;
  const ms=v=>{if(typeof v!=='number')return null;return Number.isFinite(v)&&v>=0?v:null;};

  /* "just now" under a minute, "2 min ago", "3 h ago", "2 d ago"; '' when unknown. The page repaints every 30 s at most. */
  function agoLong(v){
    const n=ms(v); if(n==null)return '';
    if(n<MIN)return 'just now';
    if(n<HOUR)return Math.floor(n/MIN)+' min ago';
    if(n<DAY)return Math.floor(n/HOUR)+' h ago';
    return Math.floor(n/DAY)+' d ago';
  }
  /* the list's column: "just now", "2m", "3h", "2d"; '' when unknown */
  function agoShort(v){
    const n=ms(v); if(n==null)return '';
    if(n<MIN)return 'just now';
    if(n<HOUR)return Math.floor(n/MIN)+'m';
    if(n<DAY)return Math.floor(n/HOUR)+'h';
    return Math.floor(n/DAY)+'d';
  }

  /* Stable sort by valueOf(item): numbers by size, text ignoring case (numeric aware), dir 'asc' | 'desc'.
     A missing value (null, undefined, NaN, '') goes last in both directions; a tie keeps the given order. */
  function sortBy(items,valueOf,dir){
    const sign=dir==='desc'?-1:1, empty=v=>v==null||v===''||(typeof v==='number'&&!Number.isFinite(v));
    return (Array.isArray(items)?items:[]).map((x,i)=>({x,i,v:valueOf(x)})).sort((a,b)=>{
      const ea=empty(a.v), eb=empty(b.v);
      if(ea||eb)return ea&&eb?a.i-b.i:ea?1:-1;
      let c;
      if(typeof a.v==='number'&&typeof b.v==='number')c=a.v-b.v;
      else c=String(a.v).localeCompare(String(b.v),undefined,{sensitivity:'base',numeric:true});
      return c?c*sign:a.i-b.i;
    }).map(o=>o.x);
  }
  /* the next sort after a click on a column header: a new column starts ascending, the same column flips */
  function nextSort(cur,key){return cur&&cur.key===key?{key,dir:cur.dir==='asc'?'desc':'asc'}:{key,dir:'asc'};}

  /* The lines of a unified diff for display: [{t:'add'|'del'|'hunk'|'file'|'ctx', s}]. At most maxLines (default 400) lines; the rest
     is counted in `more`. Text only: the caller escapes it. */
  function diffLines(diff,maxLines){
    const all=String(diff==null?'':diff).replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n'), max=maxLines>0?maxLines:400;
    if(all.length===1&&all[0]==='')return {lines:[],more:0};
    let hunk=false; /* "--- a/x" and "+++ b/x" are file headers only before the first hunk; inside one they are a removed or added line */
    const lines=all.slice(0,max).map(s=>{if(s.startsWith('@@')){hunk=true;return {t:'hunk',s};}
      return {t:!hunk&&/^(\+\+\+|---)( |$)/.test(s)?'file':s.startsWith('+')?'add':s.startsWith('-')?'del':'ctx',s};});
    return {lines,more:Math.max(0,all.length-max)};
  }

  return {agoLong,agoShort,sortBy,nextSort,diffLines};
})());
