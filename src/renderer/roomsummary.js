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
  return {summarizeRoom};
})());
