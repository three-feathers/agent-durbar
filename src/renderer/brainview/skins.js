/* Spec 106 FR-110..FR-112 (T020): the skins of the brain. A skin changes colours, point shape and fonts ONLY, never sizes, placements or masking (070 D2).
   App code and the app's own tokens, never a world pack's content (FR-112). In the page: window.DurbarBrainSkins; in Node: module.exports.
   The neutral skin is the palette draw.js always had; the arcade skin reads the Retro arcade's own tokens from the page (a lobe is a tone ink of that world), so a change
   of the arcade palette reaches the brain, and falls back to the same values written here when a token is missing (a test page, Node). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarBrainSkins=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const NEUTRAL={id:'neutral',shape:'square',baseAlpha:0.32,trail:'#cfd6e4',marker:'#ffffff',colors:null}; /* colors null: draw.js's own LOBE_COLORS */
  /* the arcade: lobe -> the token it is read from, and the value that token has in theme.js's `retro` world */
  const ARCADE_TOKENS={frontal:['--tone-warn-ink','#ffc35c'],occipital:['--tone-info-ink','#8fc3ff'],parietal:['--tone-ok-ink','#8fe3ab'],cerebellum:['--tone-bad-ink','#ff9a8f'],
    temporal:['--tone-idea-ink','#b9c0ff'],stem:['--focus','#ffec27'],port:['--sel-border','#ff77a8']};
  const ARCADE_INK=['--ink','#f4eefc'], ARCADE_TRAIL=['--ink-2','#d8d0ec'];
  /* read(name) -> the token's value or '' */
  function arcade(read){
    const g=(p)=>{let v='';try{v=String((read&&read(p[0]))||'').trim();}catch(e){}return v||p[1];};
    const colors={};for(const l of Object.keys(ARCADE_TOKENS))colors[l]=g(ARCADE_TOKENS[l]);
    return {id:'arcade',shape:'square',baseAlpha:0.9,trail:g(ARCADE_TRAIL),marker:g(ARCADE_INK),colors}; /* the voxel brain: opaque cells, not a translucent cloud */
  }
  /* world: the shown world's id (html[data-world]) or ''. Only the arcade has a skin so far (the Photo skin is T020's second slice) */
  function forWorld(world,read){return world==='retro'?arcade(read):NEUTRAL;}
  return {NEUTRAL,arcade,forWorld,ARCADE_TOKENS};
})());
