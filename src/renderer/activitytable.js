/* Activity log table (spec 052 FR-071): plain words for each decision and the HTML of Tools > Activity. Pure: strings only, every
   value escaped by the `esc` passed in. In the page: window.DurbarActivityTable (not DurbarActivity: that is activity.js, issue #474); in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarActivityTable=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const DECISION_WORDS={
    'allowed-once':'Allowed once by you',
    'allowed-session':'Allowed for the session',
    'denied':'Denied',
    'auto-allow-all':'Automatic (Allow all)',
    'auto-session-grant':'Automatic (session permission)',
    'mode-change':'Mode changed',
    'limit-change':'Limit changed',
    'remote-on':'Remote control on','remote-off':'Remote control off',
    'session-deleted':'Session deleted',
  };
  const MODE_WORDS={'read-only':'Read-only',ask:'Ask first',allow:'Allow all'};
  const NOTE='Kept on this computer. Actions and decisions only; never prompts, replies or file contents.';
  const EMPTY='Nothing yet. Answers to permission requests appear here.';
  const str=v=>v==null?'':String(v);
  const decisionWord=d=>DECISION_WORDS[d]||str(d);
  const modeWord=m=>MODE_WORDS[m]||str(m);
  function timeText(iso){
    const d=new Date(str(iso));
    if(isNaN(d.getTime()))return '';
    try{return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});}
    catch(e){return d.toISOString();}
  }
  /* rows: newest first, as activity:list returns them. */
  function tableHtml(rows,esc){
    const list=Array.isArray(rows)?rows.filter(r=>r&&typeof r==='object'):[];
    if(!list.length)return `<p class="scr-empty">${esc(EMPTY)}</p>`;
    const head='<thead><tr><th scope="col">Time</th><th scope="col">Agent</th><th scope="col">Folder</th><th scope="col">App</th><th scope="col">Mode</th><th scope="col">Action</th><th scope="col">Decision</th></tr></thead>';
    const row=r=>`<tr class="act-${esc(str(r.decision))}"><td class="act-t" title="${esc(str(r.t))}">${esc(timeText(r.t))}</td><td>${esc(str(r.agent))}</td><td>${esc(str(r.folder))}</td><td>${esc(str(r.app))}</td><td>${esc(modeWord(r.mode))}</td><td class="act-a">${esc(str(r.action))}</td><td>${esc(decisionWord(r.decision))}</td></tr>`;
    return `<table class="ttab act">${head}<tbody>${list.map(row).join('')}</tbody></table>`;
  }
  return {DECISION_WORDS,MODE_WORDS,NOTE,EMPTY,decisionWord,modeWord,timeText,tableHtml};
})());
