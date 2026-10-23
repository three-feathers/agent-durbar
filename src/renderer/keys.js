/* Keyboard shortcuts per platform (spec 052 FR-084): on a Mac the shortcut key is Command (⌘) and the keys are shown as symbols
   (⌘ ⌥ ⇧); on Windows and Linux it is Ctrl, shown as words. In a chat that waits for you, Alt+A/S/D/N become ⌥⌘A/S/D/N on a Mac,
   because Option+letter types accents there. Pure: no DOM; the platform is passed in. In the page: window.DurbarKeys; in Node:
   module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarKeys=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* navigator.platform is "MacIntel" on every Mac (Apple silicon too) */
  function isMac(platform){return /Mac/.test(String(platform||''));}

  /* the shortcut modifier alone: Command on a Mac, Ctrl elsewhere (never both, so Ctrl+K on a Mac stays the text field's own key) */
  function modDown(e,mac){return mac?!!e.metaKey&&!e.ctrlKey:!!e.ctrlKey&&!e.metaKey;}

  /* the chat answer keys (FR-060): Alt+letter elsewhere, Option+Command+letter on a Mac; a dead key (accent) never counts */
  function chatKeyDown(e,mac){
    if(!e||e.key==='Dead'||e.isComposing||e.shiftKey||!e.altKey||e.ctrlKey)return false;
    return mac?!!e.metaKey:!e.metaKey;
  }

  /* the parts of a chat answer key: ['alt','A'] or, on a Mac, ['alt','mod','A'] */
  function chatParts(letter,mac){return mac?['alt','mod',letter]:['alt',letter];}

  const NAMES={mac:{mod:'⌘',alt:'⌥',shift:'⇧',ctrl:'⌃'},other:{mod:'Ctrl',alt:'Alt',shift:'Shift',ctrl:'Ctrl'}};
  const ARIA={mac:{mod:'Meta',alt:'Alt',shift:'Shift',ctrl:'Control'},other:{mod:'Control',alt:'Alt',shift:'Shift',ctrl:'Control'}};
  /* Apple's order is ⌃ ⌥ ⇧ ⌘ then the key; elsewhere Ctrl, Alt, Shift then the key */
  const ORDER={ctrl:0,alt:1,shift:2,mod:3};
  const sorted=(parts,mac)=>{
    const mods=parts.filter(p=>p in ORDER), keys=parts.filter(p=>!(p in ORDER));
    mods.sort(mac?(a,b)=>ORDER[a]-ORDER[b]:(a,b)=>(a==='mod'?-1:ORDER[a])-(b==='mod'?-1:ORDER[b]));
    return mods.concat(keys);
  };

  /* the labels for <kbd> boxes: ['⌘','K'] on a Mac, ['Ctrl','K'] elsewhere */
  function keyLabels(parts,mac){const n=mac?NAMES.mac:NAMES.other;return sorted(parts,mac).map(p=>n[p]||p);}
  /* one string for titles and toasts: "⇧⌘A" on a Mac, "Ctrl+Shift+A" elsewhere */
  function keyText(parts,mac){return keyLabels(parts,mac).join(mac?'':'+');}
  /* the aria-keyshortcuts value: "Meta+Shift+A" on a Mac, "Control+Shift+A" elsewhere */
  function ariaKeys(parts,mac){const n=mac?ARIA.mac:ARIA.other;return sorted(parts,false).map(p=>n[p]||p).join('+');} /* one order for screen readers: the modifier first */

  /* an aria-keyshortcuts attribute written for Windows and Linux ("Control+Shift+A I"), for this platform */
  function ariaFor(value,mac){return mac?String(value||'').split(/\s+/).filter(Boolean).map(c=>c.split('+').map(p=>p==='Control'?'Meta':p).join('+')).join(' '):String(value||'');}
  /* a title or label written with "Ctrl+Shift+A" style keys, for this platform */
  function textFor(value,mac){
    if(!mac)return String(value||'');
    return String(value||'').replace(/\b(?:(?:Ctrl|Alt|Shift)\+)+[A-Z0-9?,]\b/g,m=>{
      const p=m.split('+'), key=p.pop();
      return keyText(p.map(x=>x==='Ctrl'?'mod':x.toLowerCase()).concat(key),true);
    });
  }

  /* spec 052 FR-085 (issue 591): should a double-click on this element act like a title-bar double-click? Yes on the bare drag areas of
     the top bar, the agent strip, a notice strip and a screen header; no on a control or the agent list inside them. */
  var TITLE_AREAS='.topbar,.strip,.notice-strip,.scr-head';
  var TITLE_CONTROLS='button,a,input,select,textarea,label,summary,[role="button"],[role="menu"],[role="group"],[tabindex],.more-menu,.strip-list,[data-id]';
  function shouldSendTitleDoubleClick(t){
    if(!t||typeof t.closest!=='function')return false;
    return !!t.closest(TITLE_AREAS)&&!t.closest(TITLE_CONTROLS);
  }

  return {shouldSendTitleDoubleClick,isMac,modDown,chatKeyDown,chatParts,keyLabels,keyText,ariaKeys,ariaFor,textFor};
})());
