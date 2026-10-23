/* The message box's size rules (spec 005 FR-044, FR-046, FR-048; issue 592): the pure part. The automatic cap (40% of the chat
   panel, at least 110px), the transcript floor (the chat keeps 140px), the handle's keys and the remembered value. No DOM: app.js
   measures and passes the panel, chat and box heights. In the page: window.DurbarComposerSize; in Node: module.exports
   (scripts/test-composer-size.ts). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarComposerSize=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MIN=36;          /* one line, as before (the textarea's min-height) */
  const AUTO_FLOOR=110;  /* the old fixed cap: the automatic cap is never smaller */
  const AUTO_FRAC=0.4;   /* the automatic cap: 40% of the chat panel's height */
  const KEEP=140;        /* the transcript always keeps this much visible (about five lines) */
  const STEP=16, PAGE=64;
  const KEY='durbar.composerHeight';
  const MAX_STORED=4000;

  /* {panelH, chatH, boxH}: the panel (.panel-in), the transcript (#chat) and the box (#msgInput) as they are now. The box can take what
     the transcript has above KEEP, so box + chat is what counts: measuring again after a resize gives the same limits. */
  function limits(m){
    const panelH=Math.max(0,+m.panelH||0), chatH=Math.max(0,+m.chatH||0), boxH=Math.max(0,+m.boxH||0);
    const max=Math.max(MIN,Math.floor(boxH+chatH-KEEP));
    const auto=Math.max(MIN,Math.min(max,Math.max(AUTO_FLOOR,Math.round(AUTO_FRAC*panelH))));
    return {min:MIN,max,auto};
  }
  function clamp(h,l){return Math.round(Math.min(Math.max(+h||0,l.min),l.max));}
  /* the height to show: a chosen size is fixed (clamped); otherwise the text's height, one line at least, up to the automatic cap */
  function height(o){
    const l=o.lim;
    if(o.chosen!=null)return clamp(o.chosen,l);
    return Math.round(Math.min(Math.max(+o.content||0,l.min),l.auto));
  }
  /* the handle's keys (the window-splitter pattern): a new height, 'reset' (back to automatic), or null (not ours) */
  function keyStep(key,h,l){
    switch(key){
      case 'ArrowUp': return clamp(h+STEP,l);
      case 'ArrowDown': return clamp(h-STEP,l);
      case 'PageUp': return clamp(h+PAGE,l);
      case 'PageDown': return clamp(h-PAGE,l);
      case 'Home': return l.min;
      case 'End': return l.max;
      case 'Enter': return 'reset';
      default: return null;
    }
  }
  /* the remembered value (localStorage text): a whole number of pixels from MIN to MAX_STORED, else nothing */
  function parse(v){
    if(typeof v!=='string'||!/^\d+(\.\d+)?$/.test(v.trim()))return null;
    const n=Math.round(parseFloat(v));
    return n>=MIN&&n<=MAX_STORED?n:null;
  }
  return {MIN,AUTO_FLOOR,AUTO_FRAC,KEEP,STEP,PAGE,KEY,limits,clamp,height,keyStep,parse};
})());
