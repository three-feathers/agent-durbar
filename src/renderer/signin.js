/* Sign in again from the chat (spec 012 FR-157): the words of the sign-in card, whether a new message must wait for a sign-in, and the
   last prompt of each session kept in memory only so "Send again" can re-send it (never written anywhere, gone when the window closes).
   Pure: no DOM, no bridge. In the page: window.DurbarSignIn; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSignIn=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_PROMPTS=64;          /* sessions remembered at once (oldest dropped first) */
  const MAX_TEXT=100000;         /* characters of one prompt kept for Send again */

  /* true when the cached adapter list says this agent app is installed but not signed in (FR-156/FR-157) */
  function needsSignIn(kinds,adapterId){
    if(!Array.isArray(kinds))return false;
    const k=kinds.find(x=>x&&x.id===(adapterId||'copilot'));
    return !!k&&k.state==='not-signed-in';
  }

  /* the card's words for each phase: `needed` (refused or not signed in yet), `signing`, `done` (signed in again), `failed` */
  function cardText(name,phase,o){
    const app=String(name||'The agent app'), opts=o||{};
    switch(phase){
      case 'signing':return {title:'Signing in to '+app+'…',note:'Finish the sign-in in the window that opened.',button:''};
      case 'done':return {title:'Signed in ✓',note:opts.hasPrompt?(opts.before?'Send sends the message you typed.':opts.restart?'Send again restarts the session so it uses the new sign-in, then sends your last message.':'Send again sends your last message.'):'Your next message uses the new sign-in.',button:opts.hasPrompt?(opts.before?'Send':'Send again'):''};
      case 'failed':return {title:app+' is still not signed in.',note:'The sign-in did not finish. Try again, or open Settings > Agent apps.',button:'Sign in'};
      default:return {title:app+' needs you to sign in again.',note:opts.before?'Your message was not sent; it is still in the box below.':'The last message did not go through because the sign-in is missing or has expired.',button:'Sign in'};
    }
  }

  /* After a new sign-in, a running session may still hold the old one: Claude Code and Codex read it when their process starts, and
     Copilot's shared runtime is restarted by main after the sign-in (spec 012 FR-158); the session is still restarted (ended, then resumed by Send again) for every app. */
  function restartBeforeResend(){return true;}

  /* the last prompt per session, in memory only; bounded */
  function createPromptMemory(max){
    const cap=max>0?max:MAX_PROMPTS, m=new Map();
    return {
      set(id,text,atts){
        if(!id)return;
        m.delete(id);
        m.set(id,{text:String(text==null?'':text).slice(0,MAX_TEXT),atts:Array.isArray(atts)?atts.slice(0,20):[]});
        while(m.size>cap)m.delete(m.keys().next().value);
      },
      get(id){return m.get(id);},
      clear(id){m.delete(id);},
      size(){return m.size;},
    };
  }

  return {MAX_PROMPTS,MAX_TEXT,needsSignIn,cardText,restartBeforeResend,createPromptMemory};
})());
