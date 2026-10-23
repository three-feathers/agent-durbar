/* "Retrying" while the agent app retries the model API (spec 034 FR-018, FR-019, issue #600). Pure: no DOM, no timers.
   In the page: window.DurbarRetry; in Node: module.exports. Reads only the normalized `retry` event (src/adapters/retry.ts)
   and the other normalized events of a main agent; every line is Durbar's own words (a fixed reason, numbers). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarRetry=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const REASONS={'rate-limit':'rate limit','overloaded':'servers busy','server':'server error','network':'connection problem','timeout':'timed out','auth':'sign-in problem','other':'API error'};
  const MAX_ATTEMPT=1000;
  const own=(o,k)=>o!==null&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
  /* a whole number in range, else undefined: a bad number is left out of the line, never guessed */
  const whole=(v,min,max)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max?v:undefined;
  const reasonWords=(reason,status)=>(Object.prototype.hasOwnProperty.call(REASONS,reason)?REASONS[reason]:REASONS.other)+(whole(status,100,599)!==undefined?' (HTTP '+status+')':'');
  const plural=n=>n+' '+(n===1?'retry':'retries');

  /* "Retrying (attempt 3 of 10) – servers busy (HTTP 529)" */
  function retryLine(s){
    const n=whole(own(s,'attempt'),1,MAX_ATTEMPT), m=whole(own(s,'max'),1,MAX_ATTEMPT);
    return 'Retrying'+(n!==undefined?' (attempt '+n+(m!==undefined&&m>=n?' of '+m:'')+')':'')+' – '+reasonWords(own(s,'reason'),own(s,'status'));
  }
  /* "Gave up after 4 retries – rate limit (HTTP 429)" */
  function gaveUpLine(s){
    const n=whole(own(s,'attempt'),1,MAX_ATTEMPT);
    return 'Gave up'+(n!==undefined?' after '+plural(n):'')+' – '+reasonWords(own(s,'reason'),own(s,'status'));
  }
  /* "The request went through after 3 retries." */
  function wentThroughLine(s){
    const n=whole(own(s,'attempt'),1,MAX_ATTEMPT);
    return n!==undefined?'The request went through after '+plural(n)+'.':'The request went through.';
  }
  /* how a run of retries ended when the call neither went through nor gave up: stopped (Stop or End), a usage limit (a coffee break),
     a sign-in failure (the sign-in card says what to do) or the turn ended without an answer */
  function endedLine(s,why){
    const n=whole(own(s,'attempt'),1,MAX_ATTEMPT), after=n!==undefined?' (after '+plural(n)+')':'';
    if(why==='stopped')return 'Stopped while retrying'+after+'.';
    if(why==='limit')return 'Retrying ended at a usage limit'+after+'.';
    if(why==='auth')return 'Retrying ended: the agent app needs you to sign in'+after+'.';
    return 'The turn ended'+(n!==undefined?' after '+plural(n):'')+'.';
  }
  /* the chat note while retrying */
  const noteLine=s=>retryLine(s)+'. The agent app tries again by itself.';
  /* the whole line, Durbar's own words only (kept as a task line when no redact module is loaded) */
  const LINE_RE=/^(Retrying( \(attempt \d{1,4}( of \d{1,4})?\))?|Gave up( after \d{1,4} retr(y|ies))?) – (rate limit|servers busy|server error|connection problem|timed out|sign-in problem|API error)( \(HTTP \d{3}\))?$/;

  const stateOf=e=>({attempt:whole(own(e,'attempt'),1,MAX_ATTEMPT),max:whole(own(e,'maxAttempts'),1,MAX_ATTEMPT),reason:Object.prototype.hasOwnProperty.call(REASONS,own(e,'reason'))?own(e,'reason'):'other',status:whole(own(e,'httpStatus'),100,599)});
  const PROGRESS={output:1,thinking:1,toolCall:1}; /* not usage: a turn that fails after retries can still report its cost (Claude's result) */

  /* The rule of the clarifications: one main agent's retry mark `prev` (null when none) and its next normalized event ->
     {state, action}: 'start' | 'update' (retrying), 'went-through' (the model answered), 'gave-up' (the turn failed after a retry),
     'ended' with `why` (the turn ended otherwise: 'stopped', 'limit', 'auth' or 'done'), or null (no change). A sign-in failure, a stop
     and a usage limit never give up. */
  function next(prev,e){
    const t=own(e,'type');
    if(t==='retry'){
      const ph=own(e,'phase');
      if(ph==='retrying')return {state:stateOf(e),action:prev?'update':'start'};
      if(ph==='gave-up'){const s=stateOf(e);if(s.attempt===undefined&&prev)s.attempt=prev.attempt;return {state:null,action:'gave-up',info:s};}
      return {state:prev,action:null};
    }
    if(!prev)return {state:null,action:null};
    if(PROGRESS[t]===1)return {state:null,action:'went-through',info:prev};
    if(t==='status'){
      const st=own(e,'status');
      if(st==='needs-permission')return {state:null,action:'went-through',info:prev}; /* the model asked for a tool: the call went through */
      if(st==='error'&&own(e,'errorKind')==='auth')return {state:null,action:'ended',info:prev,why:'auth'};
      if(st==='error')return {state:null,action:'gave-up',info:prev}; /* an adapter that sent no gave-up: the error after a retry is one */
      if(st==='stopped'||(st==='idle'&&own(e,'intent')==='Aborted'))return {state:null,action:'ended',info:prev,why:'stopped'};
      if(st==='idle'&&own(e,'reason')==='usage-limit')return {state:null,action:'ended',info:prev,why:'limit'};
      if(st==='idle')return {state:null,action:'ended',info:prev,why:'done'};
      return {state:prev,action:null};
    }
    if(t==='usageLimit')return {state:null,action:'ended',info:prev,why:'limit'}; /* spec 068: a coffee break, not a retry */
    return {state:prev,action:null};
  }

  return {REASONS,LINE_RE,reasonWords,retryLine,gaveUpLine,wentThroughLine,endedLine,noteLine,next};
})());
