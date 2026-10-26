/* Short display label for a session grant (spec 052 FR-141): "server-x › server-x-GetItem" is shown as "server-x › GetItem".
   Pure: no DOM. In the page: window.DurbarGrantLabel; in Node: module.exports. The full label stays in the title and the accessible name. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarGrantLabel=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const SEP=' › ';
  /* Drops a tool-name prefix that repeats the server name (then one of - _ . : / or "__"). Anything else is returned unchanged. */
  function shortGrantLabel(label){
    const s=String(label==null?'':label);
    const i=s.indexOf(SEP);
    if(i<=0)return s;
    const server=s.slice(0,i).trim(), tool=s.slice(i+SEP.length).trim();
    if(!server||!tool||tool.length<=server.length)return s;
    if(tool.slice(0,server.length).toLowerCase()!==server.toLowerCase())return s;
    const rest=tool.slice(server.length).replace(/^[-_.:/]+/,'');
    if(!rest||rest===tool.slice(server.length))return s; /* no separator after the prefix: "serverless" is not "server" + "less" */
    return s.slice(0,i)+SEP+rest;
  }
  /* Which agent's Revoke all is still under way for the agent being drawn: its own id, or '' (another agent's, or none).
     The caller stores the result, so a Revoke all of agent A is dropped as soon as agent B is drawn and can never move B's focus. */
  function grantsBusyFor(busyId, agentId){return busyId&&busyId===agentId?busyId:'';}
  /* Spec 003 FR-108 (FR-013): the plain line on a pending approval card that says how far "for this session" reaches, or '' when the card offers
     nothing wider than the request. p: the normalized request (kind, scopeKey, scopeLabel, broadScopeKey, broadScopeLabel). Text only. */
  function scopeHint(p){
    if(!p||typeof p!=='object')return '';
    const out=[], str=v=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,120):'';
    if(p.kind==='write'&&str(p.scopeKey)){
      const lab=str(p.scopeLabel).replace(/^write in /,''), many=/^write-folders:/.test(p.scopeKey);
      out.push('Allow for this session covers every file in '+(many?'these folders ('+lab+'), not only these.':lab&&lab!=='write'?lab+', not only this one.':'that folder, not only this one.'));
    }
    if(str(p.broadScopeKey)){
      const name=str(p.broadScopeLabel).replace(/^run /,'').replace(/ \(any arguments\)$/,'');
      if(name)out.push('Any arguments allows every simple \u201c'+name+'\u201d command, not only this one'+(name.toLowerCase()==='git'?', also \u201cgit push\u201d':'')+'.');
    }
    return out.join(' ');
  }
  return {shortGrantLabel,grantsBusyFor,scopeHint};
})());
