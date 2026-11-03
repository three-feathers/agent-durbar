/* Title search of Previous sessions (spec 006 FR-023, issue #252). Pure: no DOM, no I/O. In the page: window.DurbarSessionSearch; in Node: module.exports. Only titles are matched.
   Spec 095 (conversation search) reuses fold and terms and adds locate and anchorKey; main requires this same file from the built tree (spec 095 T010). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSessionSearch=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* lower case, accents removed: "Explicación" and "EXPLICACION" are the same */
  const fold=s=>String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  /* the words of a query, folded; empty when the query is blank */
  const terms=q=>fold(q).split(/\s+/).filter(Boolean);
  /* Spec 095 FR-040: `text` folded, with for each folded unit the original UTF-16 range it came from (st[i]..en[i]). Folding changes lengths
     (NFD, marks removed), so the map is built per code point, which keeps every range on code point boundaries (never inside a surrogate
     pair); a removed combining mark joins the range of the character before it. Per code point folding differs from folding a whole word
     in rare cases (Greek final sigma: fold('ΟΔΟΣ') ends in 'ς', fold('Σ') is 'σ'): such a run of non-space characters is folded whole, as
     `fold` does, and each of its units maps to the whole run. ASCII text folds to its lower case, one unit per character (map = identity). */
  function foldMap(text){
    const s=String(text==null?'':text);
    if(!/[^\x00-\x7f]/.test(s))return {f:s.toLowerCase(),st:null,en:null};
    let f='';const st=[],en=[],re=/\s+|\S+/g;let m;
    while((m=re.exec(s))){
      const c=m[0],o=m.index,whole=fold(c);
      let per='',i=0,prev=-1;const ps=[],pe=[];
      for(const cp of c){const u=fold(cp);
        if(u){prev=ps.length;for(let k=0;k<u.length;k++){ps.push(o+i);pe.push(o+i+cp.length);}per+=u;}
        else if(prev>=0){for(let k=prev;k<pe.length;k++)pe[k]=o+i+cp.length;}
        i+=cp.length;}
      if(per===whole){for(let k=0;k<ps.length;k++){st.push(ps[k]);en.push(pe[k]);}}
      else{for(let k=0;k<whole.length;k++){st.push(o);en.push(o+c.length);}}
      f+=whole;
    }
    return {f,st,en};
  }
  /* Spec 095 FR-040: where the words of `query` occur in `text`, as ranges of the ORIGINAL text: [{start, end, term}] (end exclusive, UTF-16
     offsets on code point boundaries; `term` = index in terms(query)), sorted by start. Same fold and words as filterSessions; plain
     substrings, never a regex. At most `max` occurrences per word (default 200). Empty for a blank query or text. */
  function locate(text, query, max){
    const t=[...new Set(terms(query))], lim=typeof max==='number'&&max>0?max:200, out=[];
    if(!t.length)return out;
    const {f,st,en}=foldMap(text);
    t.forEach((w,term)=>{for(let i=f.indexOf(w),n=0;i>=0&&n<lim;i=f.indexOf(w,i+w.length),n++)out.push(st?{start:st[i],end:en[i+w.length-1],term}:{start:i,end:i+w.length,term});});
    return out.sort((a,b)=>a.start-b.start||a.term-b.term);
  }
  /* Spec 095 FR-013: the one comparison key of a message for the jump to it, used by main (on the masked text) and by the window (on the
     rendered message): Markdown marks stripped (code fences, links and images to their text, heading, quote and list marks, * _ ~ `),
     whitespace collapsed, then `fold`. The code inside a fence is kept, since the chat shows it. */
  const anchorKey=t=>fold(String(t==null?'':t).replace(/```[^\n]*\n?/g,' ').replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,9}[.)])[ \t]+/gm,'').replace(/[*_~`]/g,'').replace(/\s+/g,' ').trim());
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
  return {fold, terms, locate, anchorKey, filterSessions, arrangeSessions, applyMark, visibleCount, deleteDialogText, refusalDialogText, noDeleteReason};
})());
