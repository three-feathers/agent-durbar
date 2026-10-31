/* A schedule's run history (spec 044 FR-040..FR-042): the words and icon of every outcome, the reasons as fixed words, the folded text,
   the empty text, one item's parts and the "Schedules here (N)" label. Pure: no DOM, no storage, no clock of its own
   (the caller passes the time text function and the chat-name lookup), so the unit test does not depend on the locale.
   The row's "last run" line (app.js schedLine) uses the same words table, so the row and the history cannot say different things.
   In the page: window.DurbarSchedHist; in Node (tests): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSchedHist=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* word: the row's text ("last 08:30: sent"); the history shows it with a capital letter. kind: the icon (never colour alone). */
  const OUTCOMES={
    sent:{word:'sent',kind:'sent'},
    'skipped-busy':{word:'skipped: the agent was busy',kind:'skip'},
    'skipped-paused':{word:'skipped: paused',kind:'skip'},
    'skipped-cap':{word:'not sent: reached its limit',kind:'stop'},
    'skipped-ended':{word:'not sent: the session has ended',kind:'stop'},
    missed:{word:'missed: the app was closed',kind:'miss'},
    failed:{word:'could not send',kind:'fail'},
    held:{word:'held: not sent yet (closed door, update or break)',kind:'hold'},
    'skipped-door-full':{word:'not kept: the closed door already holds as many prompts as it can',kind:'stop'},
    'skipped-review':{word:'not sent: the prompt is over 10,000 characters, shorten it with Edit',kind:'stop'},
    'skipped-mode':{word:'not sent: waiting for a mode',kind:'stop'},
    'mode-refused':{word:'not sent: this mode was refused',kind:'stop'},
    ended:{word:'loop ended',kind:'end'}
  };
  /* FR-036: the closed list of reasons a run carries; a code is turned into words here and the error's own text is never kept. */
  const REASONS={
    'no-agent':'no agent in this folder',
    'send-error':'the agent app refused it',
    user:'stopped by you',
    agent:'stopped by the agent',
    session:'the session has ended',
    limit:'reached its limit',
    passes:'reached its last pass',
    time:'reached its end time',
    'no-pace':'the agent did not pace the loop',
    errors:'two passes failed',
    'app-closed':'Durbar was closed',
    /* spec 044 FR-181..FR-184: why a schedule's mode kept a run from going */
    'no-mode':'no mode was chosen',
    'other-agent':'it would have gone to another agent than the one chosen',
    'mode-org':"your organization's policy refuses it",
    'mode-lacking':'this agent app does not have this mode',
    'mode-live':'this session cannot switch to it',
    'mode-limit':'this session is at its spending limit; raise it and the next run goes',
    'mode-autopilot':'Autopilot is not available on a schedule yet',
    'mode-loop-autopilot':'Autopilot is not offered on a loop',
    'no-seal':'its Allow all confirmation could not be checked (the file changed, or your system\'s safe storage is not available or changed), so it asks again'
  };
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const WITH_REASON=['failed','ended','skipped-mode','mode-refused'];
  const cap1=t=>t?t.charAt(0).toUpperCase()+t.slice(1):t;
  /* the row's words for an outcome; an unknown one shows as it is */
  function outcomeWord(outcome){return own(OUTCOMES,outcome)?OUTCOMES[outcome].word:String(outcome);}
  function kindOf(outcome){return own(OUTCOMES,outcome)?OUTCOMES[outcome].kind:'skip';}
  function reasonWords(code){return typeof code==='string'&&own(REASONS,code)?REASONS[code]:'';}
  /* FR-040: "Sent", "Sent (Run now)", "Could not send: no agent in this folder", "Loop ended: stopped by you" */
  function runWords(run){
    if(!run)return '';
    const base=cap1(outcomeWord(run.outcome)), why=reasonWords(run.reason);
    const now=run.manual?' (Run now)':'';
    if(WITH_REASON.includes(run.outcome))return base+now+(why?': '+why:'');
    return base+now;
  }
  /* spec 044 FR-183: the row's "last" words: a mode's refusal says why there too (`last.reason`) */
  function lastWord(last){
    if(!last)return '';
    const why=last.outcome==='skipped-mode'||last.outcome==='mode-refused'?reasonWords(last.reason):'';
    return outcomeWord(last.outcome)+(why?': '+why:'');
  }
  /* spec 044 FR-181: this schedule cannot run until someone chooses a mode (the same rule as main's `waitingForMode`; test:schedhist compares them) */
  function waitingForMode(s){
    return !!s&&!s.mode&&!(s.loop&&s.loop.ended)&&(!s.done||!!(s.last&&s.last.outcome==='skipped-mode'));
  }
  /* spec 044 FR-182: asks again at every launch, not once */
  function asksAgain(s){return waitingForMode(s)&&s.modeLost==='no-seal';}
  /* FR-037: a skip that repeated is one entry: "3 times, until 08:45" */
  function foldText(run,clockOf){
    if(!run||!(run.n>1))return '';
    const t=run.until?String((clockOf||String)(run.until)):'';
    return run.n+' times'+(t?', until '+t:'');
  }
  /* FR-040/FR-041: one item. nameOf(session) is the chat's display name while it is open in the office, else a falsy value ("chat closed"). */
  function runText(run,clockOf,nameOf){
    const clock=clockOf||String;
    const time=String(clock(run.at)), words=runWords(run), fold=foldText(run,clock);
    const name=run.session&&nameOf?nameOf(run.session):'';
    return {time,words,fold,kind:kindOf(run.outcome),session:run.session||'',chat:name||'',closed:!!run.session&&!name};
  }
  /* FR-040: nothing recorded. A schedule from before the update has a `last` but no log (FR-038): say so, with that run's words. */
  function emptyText(last,clockOf,since){
    if(!last||typeof last!=='object')return 'No runs yet.';
    const clock=clockOf||String;
    const from=since?'from '+String(clock(since))+' on':'from the update that added this list on';
    return 'No runs yet. Runs are kept '+from+'; the last one before that: '+outcomeWord(last.outcome)+', '+String(clock(last.at))+'.';
  }
  /* FR-042 (owner Q1 = A, Q4): the folder item and the Folders button; no number when the folder has none */
  function hereLabel(n){return Number.isFinite(n)&&n>0?'Schedules here ('+Math.floor(n)+')':'Schedules here';}
  /* FR-040: the list's accessible name; the caller cuts the prompt */
  function listName(promptCut){return 'Runs of '+promptCut;}
  /* inline icons in currentColor, hidden from screen readers: the words carry the meaning */
  const P={
    sent:'<path d="M2.5 8.5l3.5 3.5 7.5-8"/>',
    skip:'<path d="M3 8h10"/>',
    stop:'<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>',
    miss:'<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.4 1.6"/>',
    fail:'<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
    hold:'<path d="M5.5 3.5v9M10.5 3.5v9"/>',
    end:'<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>'
  };
  function iconSvg(kind){
    const d=own(P,kind)?P[kind]:P.skip;
    return '<svg class="sh-ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+d+'</svg>';
  }
  return {OUTCOMES,REASONS,lastWord,waitingForMode,asksAgain,outcomeWord,kindOf,reasonWords,runWords,foldText,runText,emptyText,hereLabel,listName,iconSvg,KINDS:Object.keys(P)};
})());
