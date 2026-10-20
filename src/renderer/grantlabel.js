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
  return {shortGrantLabel,grantsBusyFor};
})());
