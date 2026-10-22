/* Title search of Previous sessions (spec 006 FR-023, issue #252). Pure: no DOM, no I/O. In the page: window.DurbarSessionSearch; in Node: module.exports. Only titles are matched. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSessionSearch=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* lower case, accents removed: "Explicación" and "EXPLICACION" are the same */
  const fold=s=>String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
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
  /* The pins and hides after one mark, as the folder store applies it in main (FR-024): a row is exactly one of pinned, normal or hidden. Returns new arrays. */
  function applyMark(marks, key, mark){
    const m=marks||{}, pin=(m.pinned||[]).filter(k=>k!==key), hide=(m.hidden||[]).filter(k=>k!==key);
    if(mark==='pin')pin.push(key); else if(mark==='hide')hide.push(key);
    return {pinned:pin,hidden:hide};
  }
  /* Rows of a list that show: hidden rows are out. Used for the count on the Previous sessions row (spec 006 FR-033), the toast and the auto-open (FR-025). */
  const visibleCount=(list,hidden)=>{const h=new Set(hidden||[]);return (Array.isArray(list)?list:[]).filter(x=>!h.has(String(x&&x.id!=null?x.id:x&&x.key))).length;};
  /* Words of the delete confirmation (FR-030). `app` = "GitHub Copilot" or "Codex"; `cli` = "Copilot CLI" or "Codex CLI". */
  function deleteDialogText(o){
    const title=String((o&&o.title)||'this session'), app=String((o&&o.app)||'the agent app'), cli=String((o&&o.cli)||'the CLI');
    const lines=['It will also be gone from VS Code and the '+cli+', and it cannot be resumed again.'];
    if(o&&o.codex)lines.push('Its helper threads are deleted too.');
    lines.push('This cannot be undone. To only take it out of this list, use Hide.');
    return {title:'Delete this session?',body:'\u201c'+title+'\u201d will be deleted from '+app+' on this computer.',lines};
  }
  const IN_OFFICE_TITLE='This session is still in the office', IN_OFFICE_BODY='End it and remove it from the office first, then delete it here.', ONLY_SESSION='It is the only session in this folder: start a new session there first.';
  /* The refusal dialog (FR-030): Remove from office is left out for a folder's only main session, and the extra line says what to do instead. */
  const refusalDialogText=canRemove=>({title:IN_OFFICE_TITLE,body:IN_OFFICE_BODY,lines:canRemove?[]:[ONLY_SESSION]});
  const noDeleteReason=app=>String(app||'This agent app')+' cannot delete one session. Hide it instead.';
  return {fold, terms, filterSessions, arrangeSessions, applyMark, visibleCount, deleteDialogText, refusalDialogText, noDeleteReason};
})());
