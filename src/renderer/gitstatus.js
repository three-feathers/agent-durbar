/* Spec 063: words for a folder's git status (the chip text, the dialog body and lines). Plain script: in the page it defines
   window.DurbarGitStatus; in Node (tests) `require` gives the same object. Pure: text only, never HTML. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.DurbarGitStatus=factory();
})(typeof self!=='undefined'?self:this, function(){
  'use strict';
  /* plain words, not git's letters (people who don't use git read this too) */
  const WORD={modified:'changed',added:'new',deleted:'deleted',renamed:'renamed',untracked:'new, not tracked yet',conflict:'merge conflict'};
  const count=st=>st&&st.repo?st.files.length+(st.more||0):0;
  const branchOf=st=>st.detached?'detached HEAD':st.branch;
  /* " · main · 3 changed" (empty for a folder that is not a repository) */
  function chipText(st){
    if(!st||!st.repo)return '';
    const n=count(st);
    return ' · '+branchOf(st)+(n?' · '+n+' changed':'');
  }
  function chipLabel(st){
    if(!st||!st.repo)return '';
    const n=count(st);
    return 'Branch '+branchOf(st)+(n?', '+n+' changed '+(n===1?'file':'files')+'. Show them.':', no uncommitted changes.');
  }
  function body(st){
    const n=count(st);
    const sync=[st.ahead?st.ahead+' ahead':'',st.behind?st.behind+' behind':''].filter(Boolean).join(', ');
    return 'On branch '+branchOf(st)+(sync?' ('+sync+' of its upstream)':'')+'. '+(n?n+' '+(n===1?'file has':'files have')+' changes that are not committed yet:':'No uncommitted changes.');
  }
  function lines(st){
    if(!st||!st.repo)return [];
    const out=st.files.map(f=>{
      const d=f.binary?'binary':(f.added!=null||f.removed!=null)?'+'+(f.added||0)+' −'+(f.removed||0):'';
      return f.path+(d?' · '+d:'')+' · '+WORD[f.state];
    });
    if(st.more)out.push('and '+st.more+' more');
    return out;
  }
  return {chipText,chipLabel,body,lines,count};
});
