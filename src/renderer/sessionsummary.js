/* Spec 085: the words of the card shown in the chat when a session ends. Pure: numbers in, text out, never HTML. In the page it defines
   window.DurbarSessionSummary; in Node (tests) `require` gives the same object. Every number is coerced to a bounded integer, so a
   hostile or broken summary shows as zeros or nothing, and nothing from the repository (file names, messages) is ever shown here. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.DurbarSessionSummary=factory();
})(typeof self!=='undefined'?self:this, function(){
  'use strict';
  const MAX=1e9;
  const n=v=>typeof v==='number'&&Number.isFinite(v)&&v>0?Math.min(Math.floor(v),MAX):0;
  const plural=(k,one,many)=>k+' '+(k===1?one:many);
  /* "under 1 min", "25 min", "1 h 5 min" (a whole minute, rounded down; the clock is Durbar's own, not the agent app's) */
  function duration(ms){
    const m=Math.floor(n(ms)/60000);
    if(m<1)return 'under 1 min';
    if(m<60)return m+' min';
    const h=Math.floor(m/60);
    return h+' h'+(m%60?' '+(m%60)+' min':'');
  }
  /* one line; `cost` is the session's usage text from the existing usage figures ('' = none reported) */
  function text(sum,cost){
    if(!sum||sum.ok!==true)return '';
    const g=sum.git&&typeof sum.git==='object'?sum.git:{repo:false};
    const parts=[];
    if(g.repo===true){
      if(g.noHead){parts.push('no commit in the folder when it began, so files and lines are not counted');}
      else{
        const f=n(g.files),a=n(g.added),r=n(g.removed);
        parts.push(f?plural(f,'file','files')+' changed, +'+a+' −'+r:'no tracked files changed');
      }
      const nf=n(g.newFiles);if(nf)parts.push(plural(nf,'new file','new files'));
      const c=n(g.commits);parts.push(c?plural(c,'commit','commits'):'no commits');
    }else parts.push('not a git folder, so files and lines are not counted');
    const pr=n(sum.pullRequests);if(pr)parts.push(plural(pr,'pull request','pull requests')+' opened');
    parts.push(duration(sum.ms));
    const money=typeof cost==='string'?cost.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80):'';
    parts.push(money||'cost not reported');
    const dirty=g.repo===true&&g.dirtyAtStart===true?' The folder already had changes when the session began; they are counted too.':'';
    return 'Session summary: '+parts.join(', ')+'.'+dirty;
  }
  /* the tooltip says where the numbers come from (Durbar’s own reading, not the agent app’s) */
  const tip='Counted by Agent Durbar from git and its own clock since the first message of this session in this run. Changes made by other tools or people in the same folder are counted too.';
  return {text,duration,tip};
});
