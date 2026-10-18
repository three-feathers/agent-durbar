/* How an agent is doing, for its figure (spec 034, issue #20): the body follows the context window, trouble gets its own drawing.
   Pure: no DOM, no timers of its own (time is injected). In the page: window.DurbarMood; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarMood=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* Same steps as the context chip (toolstats.js ctxLevel): warn from 70%, high above 90%. */
  const HEAVY_PCT=70, MONSTER_PCT=90;
  const IMPATIENT_MS=60000;   /* a permission request waiting this long makes the agent tap the desk */
  const DIZZY_STREAK=3;       /* failed tool calls in a row */
  const DAY_MS=86400000;

  /* 'normal' | 'heavy' (70% to 90%) | 'monster' (above 90%). An unknown window is 'normal'. */
  function bodyOf(pct){
    if(typeof pct!=='number'||!Number.isFinite(pct))return 'normal';
    return pct>MONSTER_PCT?'monster':pct>=HEAVY_PCT?'heavy':'normal';
  }

  /* One trouble at a time, by priority: ambulance (error) > faint (credit limit) > impatient > dizzy; null = nothing special.
     `ambulance` says this agent is the one that got the single ambulance (pickAmbulance); an agent in error without it keeps today's error look. */
  function troubleOf(o){
    const s=o||{};
    if(s.state==='error'&&s.ambulance)return 'ambulance';
    if(s.limit)return 'faint';
    if(typeof s.waitingMs==='number'&&s.waitingMs>=IMPATIENT_MS)return 'impatient';
    if(typeof s.failStreak==='number'&&s.failStreak>=DIZZY_STREAK)return 'dizzy';
    return null;
  }

  /* The id of the agent in error with the latest error, or null. agents: [{id, state, errorAt}]. At most one ambulance at a time;
     a tie goes to the smaller id so the choice does not flicker. */
  function pickAmbulance(agents){
    let best=null;
    (Array.isArray(agents)?agents:[]).forEach(a=>{
      if(!a||a.state!=='error'||a.id==null)return;
      const t=typeof a.errorAt==='number'&&Number.isFinite(a.errorAt)?a.errorAt:0;
      if(!best||t>best.t||(t===best.t&&String(a.id)<String(best.id)))best={id:a.id,t};
    });
    return best?best.id:null;
  }

  /* A room takes the tone of its worst main agent (spec 034 delta, issue #135). moods: [{state, body, trouble}] of the room's main agents.
     tone: 'calm' (nothing to see) | 'uneasy' (the worst agent is heavy) | 'alarm' (a monster, an agent in Error, or any trouble);
     siren: the room has the ambulance or a fainted agent. Unknown or empty input is calm without a siren. */
  function roomAlertOf(moods){
    let tone='calm', siren=false;
    (Array.isArray(moods)?moods:[]).forEach(m=>{
      if(!m)return; /* numbers or text have no fields: they count as calm */
      if(m.trouble==='ambulance'||m.trouble==='faint')siren=true;
      if(m.trouble==='ambulance'||m.trouble==='faint'||m.trouble==='impatient'||m.trouble==='dizzy'||m.body==='monster'||m.state==='error')tone='alarm';
      else if(m.body==='heavy'&&tone==='calm')tone='uneasy';
    });
    return {tone,siren};
  }

  /* Per main agent: failed-call streak, pending permission requests (since when), time of the last error. */
  function createMoodTracker(opts){
    const now=(opts&&opts.now)||Date.now;
    const st=new Map(); /* id -> {streak, errorAt, pending: Map(requestId -> since)} */
    const get=id=>{let s=st.get(id);if(!s){s={streak:0,errorAt:0,pending:new Map()};st.set(id,s);}return s;};
    /* a timestamp from an event is used when plausible (not in the future, not older than a day), else the time it was received */
    const when=ts=>typeof ts==='number'&&Number.isFinite(ts)&&ts<=now()+1000&&now()-ts<=DAY_MS?ts:now();
    return {
      /* `failed` adds to the streak, `complete` ends it. A call that only starts changes nothing (calls start before they fail). */
      onTool(id,e){
        if(id==null||!e||typeof e!=='object')return;
        if(e.phase==='failed')get(id).streak++;
        else if(e.phase==='complete')get(id).streak=0;
      },
      onStatus(id,status){
        if(id==null)return;
        const s=get(id);
        if(status==='error'){s.errorAt=now();s.pending.clear();}
        else if(status==='idle'||status==='stopped'){s.streak=0;s.pending.clear();}
      },
      /* p: {requestId, state: 'pending'|'approved'|'denied'}; ts: the event's timestamp */
      onPermission(id,p,ts){
        if(id==null||!p||typeof p!=='object'||p.requestId==null)return;
        const s=get(id),k=String(p.requestId);
        if(p.state==='pending'){if(!s.pending.has(k))s.pending.set(k,when(ts));}
        else s.pending.delete(k);
      },
      /* how long the oldest pending request has been waiting, 0 if none */
      waitingMs(id){
        const s=st.get(id);if(!s||!s.pending.size)return 0;
        let first=Infinity;s.pending.forEach(t=>{if(t<first)first=t;});
        return Math.max(0,now()-first);
      },
      failStreak(id){const s=st.get(id);return s?s.streak:0;},
      errorAt(id){const s=st.get(id);return s?s.errorAt:0;},
      forget(id){st.delete(id);},
    };
  }

  const fmtWait=ms=>{const m=Math.floor(ms/60000);return m>=1?m+' min':Math.max(1,Math.round(ms/1000))+' s';};
  /* Words for the accessible label and tooltip (the drawing is extra: these say the same thing). From 90% context only. */
  function phrases(o){
    const s=o||{}, out=[];
    if(s.body==='monster'&&typeof s.pct==='number')out.push('context nearly full ('+s.pct+'%)');
    if(s.trouble==='ambulance')out.push('needs help: error');
    else if(s.trouble==='faint')out.push('fainted: credit limit reached');
    else if(s.trouble==='impatient')out.push('impatient: waiting '+fmtWait(s.waitingMs||0)+' for you');
    else if(s.trouble==='dizzy')out.push('dizzy: '+(s.failStreak||DIZZY_STREAK)+' failed tool calls in a row');
    return out;
  }

  return {HEAVY_PCT,MONSTER_PCT,IMPATIENT_MS,DIZZY_STREAK,bodyOf,troubleOf,pickAmbulance,roomAlertOf,createMoodTracker,phrases};
})());
