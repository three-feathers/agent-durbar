/* Spec 065: the words for undoing an agent's file changes. Pure: no DOM. In the page: window.DurbarCheckpoints; in Node (tests):
   module.exports. app.js draws the note after a turn and the confirmation dialog from these. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarCheckpoints=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const plural=(n,one,many)=>n+' '+(n===1?one:many);
  /* +/− lines of a unified diff (headers not counted) */
  function diffCounts(diff){
    let add=0,del=0;
    for(const l of String(diff||'').split('\n')){
      if(l.startsWith('+++')||l.startsWith('---'))continue;
      if(l.startsWith('+'))add++; else if(l.startsWith('-'))del++;
    }
    return {add,del};
  }
  /* The muted line after a turn: what changed, and what an undo cannot cover */
  function noteText(n){
    const files=Array.isArray(n&&n.files)?n.files:[], skipped=Array.isArray(n&&n.notCovered)?n.notCovered:[];
    const names=files.slice(0,3).map(f=>f.path+(f.change==='created'?' (new)':f.change==='deleted'?' (deleted)':'')).join(', ')+(files.length>3?', and '+plural(files.length-3,'more file','more files'):'');
    const head=n&&n.kind==='undo'
      ? (files.length?'Restored '+plural(files.length,'file','files')+': '+names+'.':'Nothing to restore.')
      : (files.length?'Changed '+plural(files.length,'file','files')+' in this turn: '+names+'.':'');
    const tail=skipped.length?' '+plural(skipped.length,'change','changes')+' cannot be undone ('+skipped.slice(0,2).map(s=>s.path+': '+s.why).join('; ')+(skipped.length>2?'; …':'')+').':'';
    return (head+tail).trim();
  }
  const button=n=>n&&n.kind==='undo'?'Undo the undo…':'Undo these changes…';
  /* The dialog: one line per file (what will happen, +/−), then what is not covered */
  function previewLines(p){
    const lines=[];
    for(const f of p&&p.files||[]){
      const verb=f.action==='remove'?'Remove '+f.path+' (the agent created it)':f.action==='create'?'Create '+f.path+' again (the agent deleted it)':'Restore '+f.path;
      const c=f.binary?' (binary file)':f.diff?(()=>{const k=diffCounts(f.diff);return ' (+'+k.add+' −'+k.del+')';})():'';
      lines.push(verb+c);
    }
    for(const s of p&&p.notCovered||[])lines.push('Not covered: '+s.path+' ('+s.why+')');
    return lines;
  }
  function confirmLabel(p){
    const n=(p&&p.files||[]).length;
    return n===1?'Restore 1 file':'Restore '+n+' files';
  }
  return {diffCounts,noteText,button,previewLines,confirmLabel};
})());
