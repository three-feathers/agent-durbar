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
      const nf=n(g.newFiles);if(nf)parts.push(plural(nf,'new file','new files'));else if(g.newFilesUnknown===true)parts.push('new files not counted');
      const c=n(g.commits);parts.push(c?plural(c,'commit','commits'):'no commits');
    }else parts.push(g.unreadable===true?'could not read git in the folder, so files and lines are not counted':'not a git folder, so files and lines are not counted');
    const pr=n(sum.pullRequests);if(pr)parts.push(plural(pr,'pull request','pull requests')+' opened');
    parts.push(duration(sum.ms));
    const money=typeof cost==='string'?cost.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80):'';
    parts.push(money||'cost not reported');
    const dirty=g.repo===true&&g.dirtyAtStart===true?' The folder already had changes when the session began; they are counted too.':'';
    const rep=reported(sum.reported);
    return 'Session summary: '+parts.join(', ')+'.'+dirty+(rep?' '+rep:'');
  }
  /* FR-010/FR-011/FR-013: what the agent app itself reported, as its own sentence naming it; counts only, each coerced again here (a missing or hostile
     member is left out, never shown as a zero); the app's name comes from this fixed table by its adapter id, never from the reply */
  const APPS={copilot:'GitHub Copilot',claude:'Claude Code',codex:'Codex'};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
  const rep=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?Math.min(Math.floor(v),MAX):null;
  function reported(r){
    if(!r||typeof r!=='object'||Array.isArray(r))return '';
    const src=own(r,'source'),who=typeof src==='string'&&Object.prototype.hasOwnProperty.call(APPS,src)?APPS[src]:'the agent app';
    const f=rep(own(r,'files')),a=rep(own(r,'added')),d=rep(own(r,'removed')),q=rep(own(r,'requests')),nano=own(r,'nanoAiu');
    const parts=[];
    if(f!==null)parts.push(plural(f,'file','files'));
    if(a!==null||d!==null)parts.push('+'+(a||0)+' −'+(d||0));
    if(typeof nano==='number'&&Number.isFinite(nano)&&nano>=0){const c=Math.round(Math.min(nano,1e15)/1e9*100)/100;parts.push(c+' AI credits');}
    if(q!==null)parts.push(plural(q,'request','requests'));
    return parts.length?who+' reported: '+parts.join(', ')+'.':'';
  }
  /* FR-008: the short form for a resting agent in the lounge: "12 files changed, +340 −80, 1 commit, 25 min"; '' when git gave no numbers (not a repository, unreadable, no start commit) */
  function short(sum){
    if(!sum||sum.ok!==true||!sum.git||typeof sum.git!=='object'||sum.git.repo!==true||sum.git.noHead)return '';
    const g=sum.git,f=n(g.files),parts=[f?plural(f,'file','files')+' changed, +'+n(g.added)+' −'+n(g.removed):'no files changed'];
    const nf=n(g.newFiles);if(nf)parts.push(plural(nf,'new file','new files'));
    const c=n(g.commits);if(c)parts.push(plural(c,'commit','commits'));
    parts.push(duration(sum.ms));
    return parts.join(', ');
  }
  /* FR-008: the shortest form, for the narrow lounge bubble: "6 files, +120 −35" (the peek card has the full short form) */
  function brief(sum){
    if(!short(sum))return '';
    const g=sum.git,f=n(g.files);
    return f?plural(f,'file','files')+', +'+n(g.added)+' −'+n(g.removed):'no files changed';
  }
  /* FR-009: the sentence of the "Since you were away" strip; numbers from main's own rollup, coerced again here; '' when no session ended */
  function briefing(b){
    if(!b||typeof b!=='object'||Array.isArray(b))return '';
    const s=n(own(b,'sessions'));if(!s)return '';
    const f=n(own(b,'files')),c=n(own(b,'commits'));
    return 'Sessions ended yesterday and today: '+s+', '+plural(f,'file','files')+' changed, +'+n(own(b,'added'))+' −'+n(own(b,'removed'))+', '+plural(c,'commit','commits')+', '+duration(n(own(b,'minutes'))*60000)+'.';
  }
  const briefingTip='Counted by Agent Durbar when you ended each session (git and its own clock; no names are kept). A file touched in two sessions counts twice. Only sessions ended with End session count.';
  /* the tooltip says where the numbers come from (Durbar’s own reading, not the agent app’s) */
  const tip='Counted by Agent Durbar from git and its own clock since the first message of this session in this run. Changes made by other tools or people in the same folder are counted too. Show uncommitted changes lists only what is not committed yet.';
  return {text,short,brief,reported,briefing,briefingTip,duration,tip};
});
