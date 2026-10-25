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
  const APP={config:'config',hook:'hook',classifier:'classifier'};
  const APP_WORDS={config:"the agent app's config",hook:"a hook of the agent app",classifier:"the agent app's auto-mode classifier"};
  const cutLabel=l=>{const s=String(l);return CT&&typeof CT.cutText==='function'?CT.cutText(s,LABEL_MAX):s.slice(0,LABEL_MAX);};
  /* by: the event's allowedBy (untrusted); liveKeys: the keys of the session grants that exist now (a Set or an array), or null when unknown.
     Returns null (no tag) or { kind, pill, sentence, label?, undoKey?, gone? }. */
  function describe(by, liveKeys){
    if(!by||typeof by!=='object'||Array.isArray(by))return null;
    const live=liveKeys==null?null:new Set(Array.isArray(liveKeys)?liveKeys:[...liveKeys]);
    switch(by.kind){
      case 'session-grant':{
        if(typeof by.key!=='string'||!by.key||typeof by.label!=='string')return null;
        const label=cutLabel(by.label);
        if(live&&!live.has(by.key))return {kind:'session-grant',pill:'Rule removed',sentence:'This was allowed by a session rule that you have since removed: Durbar asks again.',label,gone:true};
        return {kind:'session-grant',pill:'Allowed: session rule',sentence:'Allowed because you chose Approve for this session for: ',label,undoKey:by.key};
      }
      case 'allow-all':
        return {kind:'allow-all',pill:'Allowed: Allow all',sentence:'Allowed because this agent is in Allow all: it runs without asking. Change the mode in the chat header.'};
      case 'in-folder':
        return {kind:'in-folder',pill:'Allowed: folder read',sentence:"Allowed: reading inside this agent's folders is always allowed. Change the mode in the chat header to limit the agent."};
      case 'app':{
        if(typeof by.source!=='string'||!Object.prototype.hasOwnProperty.call(APP,by.source))return null;
        return {kind:'app',pill:'Allowed: agent app '+APP[by.source],sentence:'Allowed by '+APP_WORDS[by.source]+'. Durbar does not own this rule: change it in the agent app.'};
      }
      default:return null;
    }
  }
  return {describe,LABEL_MAX};
});
