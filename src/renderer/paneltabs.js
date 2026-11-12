/* Spec 094 T040 (FR-001, FR-003): the chat panel's tablist, in one module. Chat is always there; the Browser tab (spec 080) and, later,
   Terminal (094) and Files (105) are owners that add a tab. The module draws the tablist, owns the roving tabindex and the key rules, and
   tells its caller which tab was chosen; what a tab shows stays with its owner (browserpane.js). Pure helpers first (scripts/test-paneltabs.ts).
   In the page: window.DurbarPanelTabs; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarPanelTabs=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';

  /* ---- pure ---- */
  /* The roving tabindex of a tablist (WAI-ARIA): the next tab for an arrow key, -1 for any other key. */
  function tabKey(key,index,count){
    if(!(count>0))return -1;
    if(key==='ArrowRight')return (index+1)%count;
    if(key==='ArrowLeft')return (index-1+count)%count;
    if(key==='Home')return 0;
    if(key==='End')return count-1;
    return -1;
  }
  /* The tabs of a chat panel, in order: Chat, then each owner that is offered. `own`: {browser:true}. */
  function tabsFor(own){
    const t=[{id:'chat',elId:'tabChat',label:'Chat',controls:'chat'}];
    if(own&&own.browser)t.push({id:'browser',elId:'tabBrowser',label:'Browser',controls:'browserPane'});
    return t;
  }
  /* The tablist's accessible name: the tab words joined with "or" */
  function listLabel(tabs){return tabs.map(t=>t.label.toLowerCase()).map((w,i)=>i?w:w[0].toUpperCase()+w.slice(1)).join(' or ');}
  /* The tab shown when focus moves by key from `index`, or null (not a tab key, or a modifier is held). */
  function nextTab(tabs,index,e){
    if(!e||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return null;
    const n=tabKey(e.key,index,tabs.length);
    return n<0?null:tabs[n];
  }
  /* The tablist's HTML; `selected` is a tab id and gets the one tab stop. */
  function tabsHTML(tabs,selected){
    return '<div class="ptabs" id="panelTabs" role="tablist" aria-label="'+listLabel(tabs)+'">'
      +tabs.map(t=>{const on=t.id===selected;
        return '<button class="ptab" id="'+t.elId+'" role="tab" type="button" aria-selected="'+on+'" aria-controls="'+t.controls+'" tabindex="'+(on?0:-1)+'">'+t.label+'</button>';}).join('')
      +'</div>';
  }

  /* ---- DOM ---- */
  /* Selected state of every tab: aria-selected and the roving tab stop. */
  function setSelected(tabs,selected,doc){
    const d=doc||document;
    tabs.forEach(t=>{const el=d.getElementById(t.elId);if(!el)return;const on=t.id===selected;el.setAttribute('aria-selected',String(on));el.tabIndex=on?0:-1;});
  }
  /* Click and arrow keys of each tab: `choose(tab, {focus})` is called with the chosen tab. */
  function wire(tabs,choose,doc){
    const d=doc||document;
    tabs.forEach((t,i)=>{
      const el=d.getElementById(t.elId);
      if(!el)return;
      el.onclick=()=>choose(t);
      el.onkeydown=e=>{
        const n=nextTab(tabs,i,e);
        if(!n)return;
        e.preventDefault();e.stopPropagation();
        choose(n,{focus:true});
      };
    });
  }
  /* A tab by its id, or undefined: the caller's `select()` may be given an id this chat has no tab for. */
  function byId(tabs,id){return tabs.find(t=>t.id===id);}
  function focusTab(tab,doc){const el=tab&&(doc||document).getElementById(tab.elId);if(el)el.focus({preventScroll:true});}

  return {tabKey,tabsFor,listLabel,nextTab,tabsHTML,setSelected,wire,focusTab,byId};
})());
