/* One-line status of a room for its closed door plate (spec 017). Pure: no DOM. In the page: window.DurbarRoom; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarRoom=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const isWork=s=>s==='working'||s==='thinking';
  /* mains: [{state, helpers:[state,...]}] with the *effective* states (a paused agent counts as idle).
     Priority: error > waiting > meeting (a helper is working) > busy > all done > available. */
  function summarizeRoom(mains){
    const list=Array.isArray(mains)?mains:[];
    const n=s=>list.filter(m=>m&&m.state===s).length;
    const err=n('error'), wait=n('waiting'), work=list.filter(m=>m&&isWork(m.state)).length;
    const meeting=list.some(m=>m&&Array.isArray(m.helpers)&&m.helpers.some(isWork));
    if(err)return {text:err>1?'Needs attention - '+err+' errors':'Needs attention - error',tone:'error',attention:true};
    if(wait)return {text:'Waiting for you - '+wait,tone:'waiting',attention:true};
    if(meeting)return {text:'Meeting in progress',tone:'meeting',attention:false};
    if(work)return {text:'Busy - '+work+' working',tone:'busy',attention:false};
    if(list.length&&n('done')===list.length)return {text:'All done',tone:'done',attention:false};
    return {text:'Available',tone:'idle',attention:false};
  }
  /* spec 017 FR-003 (2026-10-23, owner): the meeting-room door sign of one session (a main agent), derived from its shown state.
     x: {state (the shown state, vis), paused, coffee, limit, ended, resting, failing, helpers:[shown states]}. First match wins:
     error > waiting (a question, a permission or Durbar's spending limit) > paused or a coffee break > ended or resting > a helper at
     work while it works > working/thinking > done > idle. `door` (owner 2026-10-23, a real office cabin): closed while the agent is
     busy, waits, must not be disturbed or is away; open when its work is done, when it is free, and on an error (so the trouble on the
     desk stays in sight, Clarifications Q6). `figure` (owner 2026-10-23 13:59 UTC): 'wave' when the agent waits for you: it stands in
     front of its closed door, waving, instead of the door with its photo. `tone` is an existing status colour (.st-*), never a new one; `short` is the
     word where a desk has least room (the mini and micro status word), the full word is then in its tooltip.
     Owner answers 2026-10-23 14:45 UTC: Durbar's spending limit has its own sign and pose ('limit', figure 'wallet'); a door the user
     closed (x.userClosed, x.held = runs held there) is 'shut', after an error and a wait for you; an error carries effect 'fire'. */
  const SIGNS={
    attention:{word:'Needs attention',short:'Alert',door:'open',icon:'alert',effect:'fire'},
    limit:{word:'Limit reached',short:'Limit',door:'closed',icon:'wallet',figure:'wallet'},
    waiting:{word:'Waiting for you',short:'Waiting',door:'closed',icon:'hourglass',figure:'wave'},
    shut:{word:'Do not disturb · by you',short:'DND',door:'closed',icon:'lock'},
    dnd:{word:'Do not disturb',short:'DND',door:'closed',icon:'bar'},
    away:{word:'Away',short:'Away',door:'closed',icon:'clock'},
    meeting:{word:'In a meeting',short:'Meeting',door:'closed',icon:'people'},
    busy:{word:'Busy',short:'Busy',door:'closed',icon:'dot'},
    done:{word:'Done',short:'Done',door:'open',icon:'check'},
    available:{word:'Available',short:'Available',door:'open',icon:'ring'}
  };
  const SIGN_KEYS=Object.freeze(Object.keys(SIGNS));
  function doorSign(x){
    const o=x&&typeof x==='object'?x:{}, st=o.state;
    const sign=(key,tone)=>Object.assign({key,tone,figure:'',effect:''},SIGNS[key]);
    if(st==='error')return sign('attention','error');
    if(st==='waiting'&&o.limit)return sign('limit','waiting');
    if(st==='waiting')return sign('waiting','waiting');
    if(o.userClosed){
      /* FR-015: a door the user closed; its held runs counted on the sign */
      const n=Number.isInteger(o.held)&&o.held>0?o.held:0, g=sign('shut','idle');
      if(n){g.word='Do not disturb · '+n+' held';g.short='DND · '+n;}
      return g;
    }
    if(o.paused||o.coffee)return sign('dnd','idle');
    if(o.ended||o.resting)return sign('away','idle');
    if(isWork(st)){
      const tone=o.failing?'failing':st;
      return sign(Array.isArray(o.helpers)&&o.helpers.some(isWork)?'meeting':'busy',tone);
    }
    return st==='done'?sign('done','done'):sign('available','idle');
  }
  return {summarizeRoom,doorSign,SIGN_KEYS};
})());
