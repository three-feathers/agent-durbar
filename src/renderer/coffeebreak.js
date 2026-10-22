/* Coffee break (spec 068): an agent whose usage limit is used up waits on a break and, by the rules below, comes back when the limit
   resets. Pure: no DOM, no timers and no sends of its own (time is injected; the page calls tick() from its timer and does what the
   returned actions say). In the page: window.DurbarCoffee; in Node: module.exports.

   Safety rules (FR-007): only a provider break with a known reset time that costs nothing extra (not `paid`) may resume by itself, at
   resetsAt + margin, never before; agents of the same agent app resume one at a time, `gapMs` apart; a new limit within `rehitMs` of a
   resume stops automatic resumes for that agent and for the other waiting agents of the same app (they ask instead); a reset that the
   timer saw more than `lateMs` late (the computer slept) asks; Durbar's own cap (`kind: 'cap'`) never resumes by itself, and while it is
   pending a provider limit does not replace it (the cap break wins, 2026-10-22); an agent the page holds (paused, or a Durbar spending
   limit still pending: holdIds) asks instead of resuming; a break without a reset time gets one reminder after `remindMs`. Nothing is
   ever sent to find out whether a limit has reset. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarCoffee=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MARGIN_MS=60000, GAP_MS=20000, REHIT_MS=120000, LATE_MS=300000, REMIND_MS=3600000;
  /* The one message a resume sends (FR-007): fixed, never the user's last prompt. */
  const RESUME_TEXT='The usage limit has reset. Please continue where you stopped.';
  const DAY=86400000;
  const okTime=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;

  function createBreaks(opts){
    const o=opts||{}, now=o.now||Date.now;
    const margin=o.marginMs??MARGIN_MS, gap=o.gapMs??GAP_MS, rehit=o.rehitMs??REHIT_MS, late=o.lateMs??LATE_MS, remind=o.remindMs??REMIND_MS;
    const breaks=new Map();      /* agent id -> break */
    const lastResume=new Map();  /* agent id -> when its last resume was sent (automatic or by the user) */
    const lastAuto=new Map();    /* agent app -> when the last automatic resume of that app was sent */
    let seq=0;
    const auto=b=>b.kind==='provider'&&b.policy==='auto'&&okTime(b.resetsAt)&&!b.paid&&!b.noAuto;
    return {
      /* An agent goes on a break, or its break gets new facts (a reset time read later). info: {kind:'provider'|'cap', app, resetsAt, estimated,
         paid, source}; policy: 'auto' | 'ask' (the setting). Returns the break. */
      start(id,info,policy){
        if(id==null)return null;
        const i=info||{}, t=now(), cur=breaks.get(id);
        const kind=i.kind==='cap'?'cap':'provider';
        if(cur&&cur.kind==='cap'&&kind==='provider'&&cur.phase==='on')return cur; /* FR-007: never after a Durbar spending limit; the cap break stays until the user answers it */
        if(cur&&cur.kind===kind&&cur.phase==='on'){ /* the same break: keep its start, take a better reset time */
          if(okTime(i.resetsAt))cur.resetsAt=i.resetsAt;
          if(i.estimated===true)cur.estimated=true;
          if(i.paid===true)cur.paid=true;
          if(typeof i.source==='string'&&i.source)cur.source=i.source;
          return cur;
        }
        const b={id,kind,app:String(i.app||''),since:t,order:++seq,resetsAt:okTime(i.resetsAt)?i.resetsAt:undefined,estimated:i.estimated===true,paid:i.paid===true,
          source:typeof i.source==='string'?i.source:'',policy:policy==='ask'?'ask':'auto',phase:'on',noAuto:false,reminded:false};
        const r=lastResume.get(id);
        if(kind==='provider'&&r!=null&&t-r<rehit){ /* the resume hit the limit again: no more automatic resumes here, nor for the app's others */
          b.noAuto=true;
          breaks.forEach(x=>{if(x.app===b.app&&x.kind==='provider')x.noAuto=true;});
        }
        breaks.set(id,b);
        return b;
      },
      get(id){return breaks.get(id)||null;},
      has(id){return breaks.has(id);},
      /* will this break resume by itself when the limit resets? */
      autoResumes(id){const b=breaks.get(id);return !!b&&b.phase==='on'&&auto(b);},
      /* the break is over without a resume of ours (a message, Stop, the session ended, the agent went on by itself) */
      end(id){return breaks.delete(id);},
      /* the page sent the resume message (automatic, Try now or Resume): the break is over; a new limit soon after is a re-hit */
      resumed(id){lastResume.set(id,now());return breaks.delete(id);},
      /* Stay on break: no automatic resume for this break (it asks at the reset time instead) */
      stay(id){const b=breaks.get(id);if(!b)return false;b.noAuto=true;return true;},
      /* What is due now: [{type:'resume'|'ask'|'remind', id}]. 'resume' marks the break as resuming (the page sends, then calls resumed);
         'ask' marks it as back and waiting for the user's Resume. Each action is returned once. o.hold: ids that must not resume by
         themselves now (holdIds: paused, or a Durbar spending limit pending); a due break of theirs asks instead (FR-007). */
      tick(o){
        const t=now(), out=[], hold=o&&o.hold instanceof Set?o.hold:new Set();
        [...breaks.values()].sort((a,b)=>a.order-b.order).forEach(b=>{
          if(b.phase!=='on'||b.kind!=='provider')return;
          if(okTime(b.resetsAt)){
            const due=b.resetsAt+margin; if(t<due)return;
            if(auto(b)&&t-due<=late&&!hold.has(b.id)){
              const l=lastAuto.get(b.app); if(l!=null&&t-l<gap)return; /* one at a time per agent app */
              lastAuto.set(b.app,t); b.phase='resuming'; out.push({type:'resume',id:b.id}); return;
            }
            b.phase='back'; out.push({type:'ask',id:b.id}); return;
          }
          if(!b.reminded&&t-b.since>=remind){b.reminded=true;out.push({type:'remind',id:b.id});}
        });
        return out;
      },
      size(){return breaks.size;},
      ids(){return [...breaks.keys()];},
    };
  }

  /* FR-007: the agents the page holds back from an automatic resume: paused (the user stopped it from going on) or with a Durbar
     spending limit still pending (`limit`). agents: [{id, paused, limit}]. */
  function holdIds(agents){
    const out=new Set();
    (agents||[]).forEach(a=>{if(a&&a.id!=null&&(a.paused||a.limit))out.add(a.id);});
    return out;
  }

  /* "14:30" today, "Fri 09:00" within six days, "1 Nov" further away (FR-004); local time unless a timeZone is given (tests). */
  function whenText(ts,nowMs,o){
    if(!okTime(ts))return '';
    const opt=o||{}, loc=opt.locale, tz=opt.timeZone?{timeZone:opt.timeZone}:{};
    const time=new Intl.DateTimeFormat(loc,{hour:'numeric',minute:'2-digit',...tz}).format(ts);
    const day=d=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',...tz}).format(d);
    const n=typeof nowMs==='number'?nowMs:Date.now();
    if(day(ts)===day(n))return time;
    if(ts-n<6*DAY&&ts>n)return new Intl.DateTimeFormat(loc,{weekday:'short',...tz}).format(ts)+' '+time;
    return new Intl.DateTimeFormat(loc,{day:'numeric',month:'short',...tz}).format(ts);
  }

  /* "at 14:30" today, "Fri 9:00" within six days, "1 Nov" further away: the words after "resumes" or "resets" (FR-004) */
  function atWhen(ts,nowMs,o){
    const w=whenText(ts,nowMs,o); if(!w)return '';
    const n=typeof nowMs==='number'?nowMs:Date.now(), tz=o&&o.timeZone?{timeZone:o.timeZone}:{};
    const day=d=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',...tz}).format(d);
    return day(ts)===day(n)?'at '+w:w;
  }

  /* The words after "Coffee break — " on the card and in the List (FR-004). b: a break; auto: whether it resumes by itself. */
  function untilText(b,auto,nowMs,o){
    if(!b)return '';
    if(b.kind==='cap')return 'until you raise the limit';
    if(b.phase==='back')return 'the limit has reset. Resume?';
    if(b.phase==='resuming')return 'coming back now';
    if(okTime(b.resetsAt)){const w=atWhen(b.resetsAt,nowMs,o);return (auto?'resumes ':'the limit resets ')+w+(b.estimated?' (estimate)':'');}
    return 'the limit resets later';
  }

  return {MARGIN_MS,GAP_MS,REHIT_MS,LATE_MS,REMIND_MS,RESUME_TEXT,createBreaks,holdIds,whenText,atWhen,untilText};
})());
