/* "Why was this allowed?" on a tool card (spec 003 FR-099..FR-103, issue #605): turns the `allowedBy` of a permission event into the
   words of the tag and of the open card, and says whether there is a rule Durbar can undo. Pure: no DOM. In the page: window.DurbarWhyAllowed;
   in Node (tests): module.exports.
   The words come from a fixed table. The only text taken from the event is a session rule's label (the tool's own path, command, host or
   tool name), which is cut and returned as a plain string: the caller sets it as text, never as HTML.
   Fails closed: an unknown kind, a missing key or label or a source nobody reports gives null (no tag), never a guessed reason. */
(function(root, factory){
  const api=factory(typeof module==='object'&&module.exports?require('./cuttext.js'):root.DurbarCutText);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarWhyAllowed=api;
})(typeof self!=='undefined'?self:this, function(CT){
  'use strict';
  const LABEL_MAX=240;
  const KEYS_MAX=50; /* = ALLOWED_BY_KEYS_MAX in src/adapters/types.ts (test:permissions checks they agree) */
  const APP={config:'config',hook:'hook',classifier:'classifier'};
  const APP_WORDS={config:"the agent app's config",hook:"a hook of the agent app",classifier:"the agent app's auto-mode classifier"};
  const cutLabel=l=>{const s=String(l);return CT&&typeof CT.cutText==='function'?CT.cutText(s,LABEL_MAX):s.slice(0,LABEL_MAX);};
  const MODE_WHERE='Change the mode with the mode chip under the message box.';
  /* by: the event's allowedBy (untrusted); live: the keys of the session rules this window knows now (a Set or an array), or null when
     unknown; opts.seen: keys this window has seen live; opts.undone: this window removed the rule from the card.
     "Rule removed" is said only when none of the rule's keys is live AND this window saw it live or removed it itself (a window that
     reloaded with sessions running knows no rules, and must not claim one is gone, spec 003 FR-101).
     Returns null (no tag) or { kind, pill, sentence, label?, undoKeys?, gone? }. */
  function describe(by, live, opts){
    if(!by||typeof by!=='object'||Array.isArray(by))return null;
    const lv=live==null?null:new Set(Array.isArray(live)?live:[...live]);
    const o=opts||{}, seen=o.seen==null?null:new Set(Array.isArray(o.seen)?o.seen:[...o.seen]);
    switch(by.kind){
      case 'session-grant':{
        if(typeof by.key!=='string'||!by.key||typeof by.label!=='string')return null;
        let keys=[by.key];
        if(by.keys!==undefined){
          if(!Array.isArray(by.keys)||by.keys.length<1||by.keys.length>KEYS_MAX||by.keys.some(k=>typeof k!=='string'||!k))return null;
          keys=[...new Set(by.keys)];
        }
        let more=0;
        if(by.more!==undefined){if(!Number.isInteger(by.more)||by.more<1||by.more>100000)return null;more=by.more;}
        const label=cutLabel(by.label), many=keys.length>1||more>0;
        const anyLive=lv?keys.some(k=>lv.has(k)):true;
        const wasKnown=o.undone===true||(seen?keys.some(k=>seen.has(k)):false);
        if(o.confirmed===true||(lv&&!anyLive&&wasKnown&&more===0))return {kind:'session-grant',pill:'Rule removed',sentence:'This was allowed by a session rule that you have since removed: Durbar asks again.',label,gone:true};
        const liveKeys=lv?keys.filter(k=>lv.has(k)):keys;
        return {kind:'session-grant',more,pill:many?'Allowed: session rules':'Allowed: session rule',
          sentence:many?'Allowed because you chose Approve for this session for each of these folders'+(more?' ('+more+' more rules are not listed: Undo asks Durbar to remove all of them)':'')+': ':'Allowed because you chose Approve for this session for: ',label,undoKeys:liveKeys.length?liveKeys:keys};
      }
      case 'allow-all':
        return {kind:'allow-all',pill:'Allowed: Allow all',sentence:'Allowed because this agent is in Allow all: it runs without asking. '+MODE_WHERE};
      case 'in-folder':
        return {kind:'in-folder',pill:'Allowed: folder read',sentence:"Allowed: this file is inside this agent's folders, and reads there never ask, in every mode."};
      case 'attachment':
        return {kind:'attachment',pill:'Allowed: attached file',sentence:'Allowed: you attached this file to a message, so the agent may read it.'};
      case 'app':{
        if(typeof by.source!=='string'||!Object.prototype.hasOwnProperty.call(APP,by.source))return null;
        return {kind:'app',pill:'Allowed: agent app '+APP[by.source],sentence:'Allowed by '+APP_WORDS[by.source]+'. Durbar does not own this rule: change it in the agent app.'};
      }
      default:return null;
    }
  }
  return {describe,LABEL_MAX,KEYS_MAX};
});
