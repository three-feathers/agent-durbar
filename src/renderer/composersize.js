/* The splitters' size rules (spec 005 FR-044, FR-046, FR-048; issue 592; FR-236, issue 1223: the agent rail's width shares clamp, keys and
   remembered value with the message box): the pure part. The automatic cap (40% of the chat
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
  /* the agent rail's width (spec 005 FR-236): default 220px, at least 180px, at most 40% of the window */
  const RAIL_DEFAULT=220, RAIL_MIN=180, RAIL_FRAC=0.4, RAIL_KEY='durbar.railWidth', RAIL_MAX_STORED=8000;

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
  /* the handle's keys (the window-splitter pattern): a new size, 'reset' (back to automatic), or null (not ours). o names the keys that
     grow and shrink (the box: ArrowUp, ArrowDown, the default; the rail: ArrowRight, ArrowLeft) and whether Shift makes the big step */
  function keyStep(key,h,l,o){
    o=o||{};const grow=o.grow||'ArrowUp',shrink=o.shrink||'ArrowDown',st=o.big?PAGE:STEP;
    switch(key){
      case grow: return clamp(h+st,l);
      case shrink: return clamp(h-st,l);
      case 'PageUp': return clamp(h+PAGE,l);
      case 'PageDown': return clamp(h-PAGE,l);
      case 'Home': return l.min;
      case 'End': return l.max;
      case 'Enter': return 'reset';
      default: return null;
    }
  }
  /* the remembered value (localStorage text): a whole number of pixels from MIN to MAX_STORED, else nothing */
  function parseBetween(v,lo,hi){
    if(typeof v!=='string'||!/^\d+(\.\d+)?$/.test(v.trim()))return null;
    const n=Math.round(parseFloat(v));
    return n>=lo&&n<=hi?n:null;
  }
  function parse(v){return parseBetween(v,MIN,MAX_STORED);}
  /* the rail: its limits for a window this wide (the maximum never under the minimum), the width to show and the remembered value */
  function railLimits(winW){
    const max=Math.max(RAIL_MIN,Math.floor(RAIL_FRAC*Math.max(0,+winW||0)));
    return {min:RAIL_MIN,max,auto:Math.min(max,RAIL_DEFAULT)};
  }
  function railWidth(chosen,winW){const l=railLimits(winW);return clamp(chosen==null?RAIL_DEFAULT:chosen,l);}
  function parseRail(v){return parseBetween(v,RAIL_MIN,RAIL_MAX_STORED);}
  return {MIN,AUTO_FLOOR,AUTO_FRAC,KEEP,STEP,PAGE,KEY,limits,clamp,height,keyStep,parse,
    RAIL_DEFAULT,RAIL_MIN,RAIL_FRAC,RAIL_KEY,railLimits,railWidth,parseRail};
})());
