/* Session names in the window (spec 059): which name a session shows, the short form for the Schedules option, the words of the Rename
   dialog and its pre-check. Pure: no DOM. In the page: window.DurbarSessionName; in Node: module.exports. The rule mirrors
   src/shared/names.ts and src/shared/sessionname.ts (a test compares them); main runs the real check on every call. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSessionName=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX=60, MAX_FOLDER=40; /* a folder's display name: the same rule, this length (spec 059 delta 2026-10-24) */
  /* The user's name, else the runtime's title, else the folder label (FR-001). */
  function displayName(alias,title,folderLabel){
    const a=typeof alias==='string'?alias.trim():'', t=typeof title==='string'?title.trim():'';
    return a||t||String(folderLabel==null?'':folderLabel);
  }
  /* Tooltip text of a card or header: the name and the folder. The runtime title is not shown once the user named the session (FR-003). */
  function nameTip(alias,title,folderLabel){
    const n=(typeof alias==='string'&&alias.trim())||(typeof title==='string'&&title.trim())||'';
    return n?n+' · '+String(folderLabel||''):'';
  }
  /* A name cut for a small place (the Schedules hint and the schedule list): the one shared cutter (cuttext.js, spec 044 FR-021): code points, at most `max` including the "…", on a word boundary when one is near the end. */
  const CUT=()=>typeof module==='object'&&module.exports?require('./cuttext.js'):self.DurbarCutText; /* resolved at call time: cuttext.js loads after this file in the page */
  function shortName(name,max){return CUT().cutText(name,max||40,{wordBoundary:true});}
  /* The pre-check of the dialog: '' = fine (empty means reset). Main checks again with the shared rule. */
  const HIDDEN=/[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/;
  const CONTROL=/[\u0000-\u001f\u007f-\u009f]/;
  function nameError(v,max){
    max=max||MAX;
    if(typeof v!=='string')return 'Use 1 to '+max+' characters.';
    if(HIDDEN.test(v))return 'Remove control or hidden characters.';
    const n=v.replace(/\s+/g,' ').trim();
    if(CONTROL.test(n))return 'Remove control or hidden characters.';
    if(Array.from(n).length>max)return 'Use 1 to '+max+' characters.';
    return '';
  }
  /* FR-004, FR-017: the line that says where the name goes, from the capability the agent's kind reports ('any', 'next-turn' or none). */
  function whereLine(cap,app,inAppSession){
    const a=app||'the agent app';
    if(inAppSession===false)return 'Only in Agent Durbar. This session is not in '+a+' yet.';
    if(cap==='any')return 'Also saved in '+a+': its CLI shows the new name, and it may sync with your account. A name saved there cannot be removed from here.';
    if(cap==='next-turn')return 'Also saved in '+a+' at your next message: it then shows in its /resume list and when you resume this session by its id, not in the VS Code extension\'s list. It may sync with your account.';
    return 'Only in Agent Durbar. '+a+' keeps its own name.';
  }
  const folderError=v=>nameError(v,MAX_FOLDER);
  return {MAX,MAX_FOLDER,displayName,nameTip,shortName,nameError,folderError,whereLine};
})());
