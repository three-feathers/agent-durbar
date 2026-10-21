/* File edits in the chat (spec 005 FR-020..FR-025): the words of an edit row, the path shown relative to the agent's folder on any
   platform, line counts, and how many diff lines are open. Pure: no DOM. In the page: window.DurbarEditView; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarEditView=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* FR-021: lines open in Expert before "Show all", and the most lines ever drawn for one call */
  const OPEN_LINES=12, MAX_LINES=400;
  const VERB={edit:['Editing','Edited'],create:['Creating','Created'],write:['Writing','Wrote'],delete:['Deleting','Deleted'],move:['Moving','Moved']};
  /* FR-023: Simple says what happens to the file, not how */
  const PLAIN={edit:['Changing','Changed'],write:['Changing','Changed'],create:['Creating','Created'],delete:['Deleting','Deleted'],move:['Moving','Moved']};
  /* a refused or failed call did not change the file: never the past tense of done (review on #463) */
  const FAIL={edit:'Could not edit',create:'Could not create',write:'Could not write',delete:'Could not delete',move:'Could not move'};
  const PLAIN_FAIL={edit:'Not changed',write:'Not changed',create:'Not created',delete:'Not deleted',move:'Not moved'};
  const kindOf=k=>VERB[k]?k:'edit';
  const isWin=p=>/^[a-z]:[\\/]/i.test(p)||/^\\\\/.test(p);
  /* FR-020, FR-025: { name, dir, full }. A path inside `folder` is shown relative to it; \ and / both split; a Windows path (drive
     letter or UNC) compares case-insensitively; the separator shown is the path's own. */
  function displayPath(path,folder){
    const p=String(path==null?'':path).replace(/[\r\n\t]+/g,' ').trim();
    let rel=p;
    const f=String(folder==null?'':folder).trim().replace(/[\\/]+$/,'');
    if(f&&p.length>f.length+1){
      const win=isWin(p)||isWin(f), a=p.replace(/\\/g,'/'), b=f.replace(/\\/g,'/');
      const head=a.slice(0,b.length);
      if((win?head.toLowerCase()===b.toLowerCase():head===b)&&a[b.length]==='/')rel=p.slice(f.length+1);
    }
    const i=Math.max(rel.lastIndexOf('/'),rel.lastIndexOf('\\'));
    const name=i>=0&&i<rel.length-1?rel.slice(i+1):rel, dir=i>0?rel.slice(0,i):'';
    return {name:name||p,dir,full:p,rel};
  }
  function totals(edit){
    let added=0,removed=0;const fs=edit&&Array.isArray(edit.files)?edit.files:[];
    fs.forEach(f=>{added+=Number(f.added)||0;removed+=Number(f.removed)||0;});
    return {added,removed,any:fs.some(f=>typeof f.diff==='string'&&f.diff)};
  }
  /* "+12 −3" (a real minus sign); '' when there is no diff at all */
  function countText(a,r,any){return any||a||r?'+'+(a||0)+' −'+(r||0):'';}
  /* The row's words: { verb, name, dir, count, text, title }. running: present tense; failed (a refused or failed call, not
     running): "Could not edit" / Simple "Not changed"; simple: plain words (FR-023). */
  function summary(edit,o){
    const opt=o||{}, fs=edit&&Array.isArray(edit.files)?edit.files:[], fail=!opt.running&&!!opt.failed, run=opt.running?0:1;
    const W=opt.simple?PLAIN:VERB, F=opt.simple?PLAIN_FAIL:FAIL, verbOf=k=>fail?F[k]:W[k][run];
    const t=totals(edit), count=countText(t.added,t.removed,t.any), n=fs.length+(Number(edit&&edit.more)||0);
    if(!fs.length)return {verb:'',name:'',dir:'',count:'',text:'',title:''};
    if(n>1){
      const kinds=new Set(fs.map(f=>kindOf(f.kind))), k=kinds.size===1?[...kinds][0]:'edit';
      const verb=verbOf(k), name=n+' files';
      return {verb,name,dir:'',count,text:verb+' '+name,title:fs.map(f=>f.path).join('\n')+(edit.more?'\n… and '+edit.more+' more':'')};
    }
    const f=fs[0], k=kindOf(f.kind), d=displayPath(f.path,opt.folder), verb=verbOf(k);
    const to=f.movedTo?displayPath(f.movedTo,opt.folder).rel:'';
    return {verb,name:d.name,dir:d.dir,count,text:verb+' '+d.name+(to?' → '+to:''),title:d.full+(f.movedTo?' → '+f.movedTo:''),to};
  }
  /* How many of `total` diff lines are drawn: OPEN_LINES until "Show all", then all (at most MAX_LINES) */
  function shown(total,all){const n=Math.max(0,Number(total)||0);return all?Math.min(n,MAX_LINES):Math.min(n,OPEN_LINES);}
  return {displayPath,summary,totals,countText,shown,OPEN_LINES,MAX_LINES,VERB,PLAIN,FAIL,PLAIN_FAIL};
})());
