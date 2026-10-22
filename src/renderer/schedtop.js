/* The top-bar Schedules button's facts (spec 044 FR-027..FR-029, FR-033): how many schedules are active, how many runs did not happen
   since the user last looked, and the words for the button's accessible name and title. Pure: no DOM, no storage, no clock of its own
   (the caller passes the time stamp, "now" and the clock text function), so the unit test does not depend on the locale.
   In the page: window.DurbarSchedTop; in Node (tests): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSchedTop=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const DAY=24*3600000, MAX=120;
  const list=doc=>doc&&Array.isArray(doc.schedules)?doc.schedules.filter(s=>s&&typeof s==='object'):[];
  const recurring=s=>s.every!==undefined||!!s.rule;
  /* FR-028: Durbar's schedules that are not done and not paused; "Pause all" is not part of it (the number says what would run) */
  function activeCount(doc){return list(doc).filter(s=>!s.done&&!s.paused).length;}
  /* FR-029: schedules whose last run was missed or failed and is newer than the stamp (no stamp: the last 24 hours). Done one-time
     schedules count (a missed one is marked done at start); skipped-* never do. A later run replaces `last`, so it clears itself. */
  /* The one rule for "its last run did not happen": missed or failed, a done one-time schedule included, a done recurring one not (the store never
     sets that); skipped-* never. Shared with the lobby Postbox (PR 511's postMissed), so the two cannot drift. */
  function missedOrFailed(s){
    return !!(s&&typeof s==='object'&&s.last&&(s.last.outcome==='missed'||s.last.outcome==='failed')&&(!s.done||!recurring(s)));
  }
  function troubleSince(doc,seenAt,now){
    const since=typeof seenAt==='number'&&isFinite(seenAt)&&seenAt>0?Math.min(seenAt,now):now-DAY; /* a stamp from the future (clock change) never hides a newer run */
    return list(doc).filter(s=>missedOrFailed(s)&&s.last.at>since).length;
  }
  /* The window can show the Schedules heading to the user only while it is visible and has the focus: a background window does not count as "on screen". */
  function windowSees(visibilityState,hasFocus){return visibilityState==='visible'&&hasFocus===true;}
  function nextAt(doc){
    const t=list(doc).filter(s=>!s.done&&!s.paused).map(s=>recurring(s)?s.next:s.at).filter(Boolean).sort((a,b)=>a-b)[0];
    return t||0;
  }
  const cap=t=>t.length>MAX?t.slice(0,MAX-1)+'…':t;
  /* o: { keys: "Ctrl+Shift+S" (the platform's text), clockOf: ms => "08:30" }. Returns the facts for the button and its two texts. */
  function topText(doc,seenAt,now,o){
    const opt=o||{}, keys=opt.keys||'', clockOf=opt.clockOf||(ms=>String(ms));
    const total=list(doc).length, count=activeCount(doc), trouble=troubleSince(doc,seenAt,now);
    const paused=!!(doc&&doc.pausedAll)&&count>0;
    const at=nextAt(doc), next=!paused&&count&&at>0?String(clockOf(at)).slice(0,24):'';
    /* each schedule keeps only its last run, so this counts schedules, and the words say so */
    const tr=trouble?(trouble===1?'1 schedule':trouble+' schedules')+' missed or failed a run':'';
    let state,said;
    if(paused){state='all paused ('+count+' set)';said='all paused, '+count+' set';}
    else if(count){state=count+' active'+(next?', next '+next:'');said=count+' active'+(next?', next at '+next:'');}
    else if(total){state='none active ('+total+' set)';said='none active, '+total+' set';}
    else {state='none yet. Add one to a folder';said='none yet';}
    const k=keys?' ('+keys+')':'';
    return {count:Math.min(count,99),paused,trouble,
      label:cap('Schedules: '+said+'.'+(tr?' '+tr+'.':'')),
      title:cap('Schedules: '+state+(tr?'. '+tr:'')+k)};
  }
  return {activeCount,troubleSince,topText,nextAt,missedOrFailed,windowSees};
})());
