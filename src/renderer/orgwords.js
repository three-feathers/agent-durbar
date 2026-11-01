/* Spec 076 FR-208 (issue 602): the words of Settings > Organization, from one `orgpolicy:view` entry (no values of any rule, FR-207).
   Pure: no DOM, no escaping (the caller escapes every string it puts in markup). In the page: window.DurbarOrgWords; in Node: module.exports.
   A read that failed or was partial is never "no policy": unreadable means unknown. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarOrgWords=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const str=v=>typeof v==='string'?v:'';
  const strs=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
  const MODES=[['read-only','Read-only'],['ask','Ask first'],['allow','Allow all']];
  const NOTE='A company profile, a registry value or a setting kept on your organization\'s server can still apply: Agent Durbar does not read those.';
  /* state: 'none' (read, no file), 'applies' (read in full), 'unknown' (not read, or only in part) */
  function rowOf(v){
    v=v&&typeof v==='object'?v:{};
    const app=str(v.app)||'This agent app', found=v.found===true, unreadable=v.unreadable===true;
    const problems=strs(v.problems), paths=strs(v.paths);
    let state,status;
    if(unreadable){state='unknown';status=found?'Policy found, but Agent Durbar could not read all of it, so what it blocks is unknown.':'Agent Durbar could not read the policy, so it is unknown.';}
    else if(found){state='applies';status='Policy applies.';}
    else{state='none';status='No policy file found on this computer.';}
    const modes=[];
    const m=v.modes&&typeof v.modes==='object'?v.modes:{};
    for(const [k,label] of MODES){const x=m[k];if(x&&typeof x.why==='string')modes.push({mode:label,why:x.why,refused:x.refuse===true});}
    const c=v.counts&&typeof v.counts==='object'?v.counts:{}, n=x=>typeof x==='number'&&x>=0?x:null;
    const counts=[];
    if(n(c.modelAllow)!==null)counts.push('Models: only '+c.modelAllow+' allowed');
    if(n(c.modelDeny))counts.push('Models: '+c.modelDeny+' blocked');
    if(n(c.mcpAllow)!==null)counts.push('MCP servers: only '+c.mcpAllow+' allowed');
    if(n(c.mcpDeny))counts.push('MCP servers: '+c.mcpDeny+' blocked');
    if(n(c.toolDeny))counts.push('MCP tools: '+c.toolDeny+' blocked');
    return {app,state,status,note:state==='none'?NOTE:'',paths,problems,modes,counts,
      noMode:state==='applies'&&!modes.length?'It blocks none of the permission modes.':''};
  }
  /* the whole section: rows for a view, or a single unknown line when the view could not be had (never read as "nothing applies") */
  function sectionOf(view,failed){
    if(failed)return {failed:true,failText:'Agent Durbar could not read your organization\'s policies, so they are unknown.',rows:[]};
    const ids=view&&typeof view==='object'?Object.keys(view):[];
    return {failed:false,failText:'',rows:ids.map(id=>Object.assign({id},rowOf(view[id])))};
  }
  return {rowOf,sectionOf,NOTE};
})());
