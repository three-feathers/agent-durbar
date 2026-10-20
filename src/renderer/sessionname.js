/* Session names in the window (spec 059): which name a session shows, the short form for the Schedules option, the words of the Rename
   dialog and its pre-check. Pure: no DOM. In the page: window.DurbarSessionName; in Node: module.exports. The rule mirrors
   src/shared/names.ts and src/shared/sessionname.ts (a test compares them); main runs the real check on every call. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSessionName=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX=60;
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
  /* At most `max` code points, cut on a word boundary when one is near the end, with an ellipsis (FR-008). */
  function shortName(name,max){
    max=max||40;
    const c=Array.from(String(name==null?'':name).trim());
    if(c.length<=max)return c.join('');
    let cut=c.slice(0,max-1);
    const sp=cut.lastIndexOf(' ');
    if(sp>=Math.floor(max/2))cut=cut.slice(0,sp);
    return cut.join('').replace(/\s+$/,'')+'…';
  }
  /* The pre-check of the dialog: '' = fine (empty means reset). Main checks again with the shared rule. */
  const HIDDEN=/[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/;
  const CONTROL=/[\u0000-\u001f\u007f-\u009f]/;
  function nameError(v){
    if(typeof v!=='string')return 'Use 1 to '+MAX+' characters.';
    if(HIDDEN.test(v))return 'Remove control or hidden characters.';
    const n=v.replace(/\s+/g,' ').trim();
    if(CONTROL.test(n))return 'Remove control or hidden characters.';
    if(Array.from(n).length>MAX)return 'Use 1 to '+MAX+' characters.';
    return '';
  }
  /* FR-004, FR-017: the line that says where the name goes, from the capability the agent's kind reports ('any', 'next-turn' or none). */
  function whereLine(cap,app,inAppSession){
    const a=app||'the agent app';
    if(inAppSession===false)return 'Only in Agent Durbar. This session is not in '+a+' yet.';
    if(cap==='any')return 'Also saved in '+a+': its CLI shows the new name, and it may sync with your account. A name saved there cannot be removed from here.';
    if(cap==='next-turn')return 'Also saved in '+a+' at your next message. It shows when you resume this session in '+a+' by its id; the /resume list does not include sessions started here. It may sync with your account.';
    return 'Only in Agent Durbar. '+a+' keeps its own name.';
  }
  return {MAX,displayName,nameTip,shortName,nameError,whereLine};
})());
