/* Keyboard navigator (spec 074, issue 548): the pure part. The levels of the "Go to" mode of the command palette (start, folders,
   agents, chats), the start-level letters (`f `, `c 3`), number picks, the palette's matching (shared with Ctrl+K), stable chat
   numbers and the configurable shortcut with its clash check. No DOM; the platform is passed in. In the page: window.DurbarNav;
   in Node: module.exports (scripts/test-navigator.ts). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarNav=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';

  /* ---------------- matching (spec 052 FR-042, moved here unchanged so Ctrl+K and the navigator match the same way) ---------------- */
  /* 0 = the label starts with q, 1 = a word of the label does, 2 = the label contains it, 3 = the hint words do; stable otherwise */
  function rank(items,q){
    q=String(q||'').trim().toLowerCase(); if(!q)return items.slice();
    const scored=[];
    items.forEach((x,i)=>{const l=String(x.label||'').toLowerCase(),k=String(x.kw||'').toLowerCase();
      const s=l.startsWith(q)?0:l.split(/[\s\-_.]+/).some(w=>w.startsWith(q))?1:l.includes(q)?2:k.includes(q)?3:-1;
      if(s>=0)scored.push({x,s,i});});
    return scored.sort((a,b)=>a.s-b.s||a.i-b.i).map(o=>o.x);
  }

  /* ---------------- chat numbers (FR-011) ---------------- */
  const MAX_NUMBERS=500, MAX_NO=9999;
  /* every id without a number gets the lowest number nobody holds; numbers already given never change */
  function assignNumbers(map,ids){
    const out=Object.assign({},map||{}), used=new Set(Object.values(out));
    let n=1;
    for(const id of ids||[]){
      if(Object.prototype.hasOwnProperty.call(out,id))continue;
      while(used.has(n))n++;
      out[id]=n; used.add(n);
    }
    return out;
  }
  /* drop the ids that are no longer in the office, which frees their numbers */
  function pruneNumbers(map,ids){
    const keep=new Set(ids||[]), out={};
    for(const [id,n] of Object.entries(map||{}))if(keep.has(id))out[id]=n;
    return out;
  }
  /* saved JSON -> a clean map: string ids up to 200 characters, whole numbers 1..9999, each number once, at most 500 entries */
  function loadNumbers(json){
    let o=null; try{o=typeof json==='string'?JSON.parse(json):json;}catch(e){o=null;}
    const out={}; if(!o||typeof o!=='object'||Array.isArray(o))return out;
    const used=new Set(); let count=0;
    for(const [id,n] of Object.entries(o)){
      if(count>=MAX_NUMBERS)break;
      if(!id||id.length>200||!Number.isInteger(n)||n<1||n>MAX_NO||used.has(n))continue;
      out[id]=n; used.add(n); count++;
    }
    return out;
  }

  /* ---------------- levels (FR-003..FR-008) ---------------- */
  /* snapshot: {floors:[{id,name}], folders:[{id,name,floor,hint}], chats:[{id,name,folder,no,hint}]}, all in office order and only
     what the office shows (floors that are on, folders that are not hidden). Floors are used only when two or more are on. */
  const useFloors=snap=>(snap.floors||[]).length>=2;
  const goRows=()=>[
    {kind:'go',to:'folders',label:'Folders',hint:'Every folder (type F and a space)',kw:'f folders'},
    {kind:'go',to:'chats',label:'Chats',hint:'Every chat by number (type C and a number)',kw:'c chats numbers'},
  ];
  const folderItem=(snap,f,i)=>{const n=(snap.chats||[]).filter(c=>c.folder===f.id).length;
    return {kind:'folder',id:f.id,label:f.name,hint:f.hint||(n===1?'1 chat':n+' chats'),kw:f.hint||'',n:i+1};};
  const chatItem=c=>({kind:'chat',id:c.id,label:c.name,hint:c.hint||'',kw:c.hint||'',n:c.no,no:c.no});
  function levelItems(snap,level){
    const k=level&&level.kind||'start';
    if(k==='start'){
      if(useFloors(snap))return goRows().concat(snap.floors.map((f,i)=>{const n=(snap.folders||[]).filter(x=>x.floor===f.id).length;
        return {kind:'floor',id:f.id,label:f.name,hint:n===1?'1 folder':n+' folders',kw:'floor',n:i+1};}));
      return goRows().concat((snap.folders||[]).map((f,i)=>folderItem(snap,f,i)));
    }
    if(k==='folders')return (snap.folders||[]).filter(f=>!level.floor||f.floor===level.floor).map((f,i)=>folderItem(snap,f,i));
    if(k==='agents')return (snap.chats||[]).filter(c=>c.folder===level.folder).map(chatItem);
    if(k==='chats')return (snap.chats||[]).slice().sort((a,b)=>a.no-b.no).map(chatItem);
    return [];
  }
  /* the start-level letters (FR-004): "f " / "f2" -> folders, "c " / "c3" / "c 3" -> chats; the rest stays as that level's filter.
     "f" or "c" followed by another letter is ordinary filter text ("core", "frontend"). */
  function parseStart(q){
    const m=/^\s*([fFcC])(?:\s+|(?=\d))(.*)$/.exec(String(q||''));
    if(!m)return null;
    return {level:/[fF]/.test(m[1])?'folders':'chats',q:m[2]};
  }
  /* a pick by number: the item with that number, and whether it is the only number starting with those digits */
  function pickNumber(items,digits){
    const d=String(digits||'').trim(); if(!/^\d+$/.test(d))return null;
    const item=items.find(x=>x.n!=null&&String(x.n)===String(+d));
    if(!item)return null;
    const longer=items.some(x=>x!==item&&x.n!=null&&String(x.n).startsWith(String(+d)));
    return {item,unique:!longer};
  }
  /* what a level shows for its filter: {go} (switch level), or {items, active, auto, digits} (auto: open/pick at once) */
  function view(snap,level){
    const q=String(level&&level.q||'');
    if((level&&level.kind||'start')==='start'){const g=parseStart(q);if(g)return {go:g};}
    const items=levelItems(snap,level);
    const d=q.trim();
    if(/^\d+$/.test(d)){
      const shown=items.filter(x=>x.n!=null&&String(x.n).startsWith(String(+d)));
      const p=pickNumber(items,d);
      return {items:shown,active:p?Math.max(0,shown.indexOf(p.item)):0,auto:p&&p.unique?p.item:null,digits:d};
    }
    return {items:rank(items,q),active:0,auto:null,digits:''};
  }
  /* picking an item: {push:level} for another level, or {open:id} for a chat. A folder with one chat opens it (FR-008). */
  function pick(snap,item){
    if(!item)return null;
    if(item.kind==='go')return {push:{kind:item.to,q:''}};
    if(item.kind==='floor')return {push:{kind:'folders',floor:item.id,q:''}};
    if(item.kind==='folder'){const cs=(snap.chats||[]).filter(c=>c.folder===item.id);return cs.length===1?{open:cs[0].id}:{push:{kind:'agents',folder:item.id,q:''}};}
    if(item.kind==='chat')return {open:item.id};
    return null;
  }
  /* the level stack: push a level; back returns false at the start level (the caller closes the box) */
  function push(stack,level){return stack.concat([Object.assign({q:'',active:0},level)]);}
  function back(stack){return stack.length>1?stack.slice(0,-1):false;}
  /* the breadcrumb words: "Go to", then the floor and folder names, or "Folders" / "Chats" */
  function crumbs(snap,stack){
    const out=['Go to'];
    for(const lv of stack.slice(1)){
      if(lv.kind==='folders')out.push(lv.floor?((snap.floors||[]).find(f=>f.id===lv.floor)||{}).name||'Floor':'Folders');
      else if(lv.kind==='agents')out.push(((snap.folders||[]).find(f=>f.id===lv.folder)||{}).name||'Folder');
      else if(lv.kind==='chats')out.push('Chats');
    }
    return out;
  }

  /* ---------------- the shortcut (FR-002, FR-013, FR-014, FR-017) ---------------- */
  /* {mod, ctrl, alt, shift, code}: mod = ⌘ on a Mac and Ctrl elsewhere; ctrl = the Control key on a Mac only */
  const DEFAULT_COMBO=Object.freeze({mod:true,ctrl:false,alt:false,shift:false,code:'KeyJ'});
  const PUNCT={Backquote:'`',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/'};
  const validCode=c=>/^Key[A-Z]$/.test(c)||/^Digit[0-9]$/.test(c)||/^F([1-9]|1[0-2])$/.test(c)||c==='Space'||Object.prototype.hasOwnProperty.call(PUNCT,c);
  const keyName=c=>/^Key[A-Z]$/.test(c)?c.slice(3):/^Digit[0-9]$/.test(c)?c.slice(5):c==='Space'?'Space':PUNCT[c]||c;
  /* the code of the letter or digit a key types on this keyboard layout ('KeyC' for "c" or "C"), or '' (FR-017, 2026-10-23) */
  const typedCode=k=>/^[a-zA-Z]$/.test(String(k||''))?'Key'+String(k).toUpperCase():/^[0-9]$/.test(String(k||''))?'Digit'+k:'';
  /* the combination of a keydown, or null for a modifier key alone. sup = the Windows/Super key on Windows and Linux. typed = the code
     of the letter the key types on this layout when it is not the key's position (Dvorak: the position of I types "c"). */
  function comboFromEvent(e,mac){
    if(!e||!e.code||/^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)/.test(e.code))return null;
    const c={mod:mac?!!e.metaKey:!!e.ctrlKey,ctrl:mac?!!e.ctrlKey:false,alt:!!e.altKey,shift:!!e.shiftKey,code:e.code,sup:mac?false:!!e.metaKey};
    const t=typedCode(e.key); if(t&&t!==e.code)c.typed=t;
    return c;
  }
  function comboMatches(e,combo,mac){
    if(!combo||e.isComposing)return false;
    const x=comboFromEvent(e,mac); if(!x||x.sup)return false;
    if(!(x.code===combo.code&&x.mod===!!combo.mod&&x.ctrl===!!combo.ctrl&&x.alt===!!combo.alt&&x.shift===!!combo.shift))return false;
    /* the app's other shortcuts match the typed letter too (e.key==='k'||e.code==='KeyK'): on another layout, a press that types
       another shortcut's letter is left to it (FR-017, 2026-10-23) */
    return !(x.typed&&takenBy(Object.assign({},x,{code:x.typed}),mac));
  }
  /* the parts for keys.js's keyLabels / keyText: ['mod','shift','J'] */
  function comboParts(combo){
    const c=combo||DEFAULT_COMBO, p=[];
    if(c.ctrl)p.push('ctrl'); if(c.alt)p.push('alt'); if(c.shift)p.push('shift'); if(c.mod)p.push('mod');
    p.push(keyName(c.code)); return p;
  }
  const sig=c=>[c.mod?'mod':'',c.ctrl?'ctrl':'',c.alt?'alt':'',c.shift?'shift':'',c.code].filter(Boolean).join('+');
  /* who already owns a combination: [signature, owner words, 'mac' | 'other' | undefined (both)] */
  const TAKEN=[
    /* the app's own shortcuts */
    ['mod+KeyK','the command palette'],['mod+KeyO','Add folder'],['mod+shift+KeyO','Add VS Code workspace'],
    ['mod+shift+KeyA','the Needs you inbox'],['mod+shift+KeyN','the next agent that needs you'],['mod+shift+KeyH','Previous sessions'],
    ['mod+shift+KeyS','Schedules'], /* spec 044 FR-031: the top-bar Schedules button */
    ['mod+Backquote','Back to the previous chat','other'],['ctrl+Backquote','Back to the previous chat','mac'],['mod+Comma','Settings','mac'],
    ['alt+KeyA','Allow once in a waiting chat','other'],['alt+KeyS','Allow for this session in a waiting chat','other'],['alt+KeyD','Deny in a waiting chat','other'],['alt+KeyN','the next agent that needs you','other'],
    ['mod+alt+KeyA','Allow once in a waiting chat','mac'],['mod+alt+KeyS','Allow for this session in a waiting chat','mac'],['mod+alt+KeyD','Deny in a waiting chat (and the Dock)','mac'],['mod+alt+KeyN','the next agent that needs you','mac'],
    ['mod+shift+KeyI','the developer tools'],
    /* text editing and the window */
    ['mod+KeyA','Select all'],['mod+KeyC','Copy'],['mod+KeyV','Paste'],['mod+KeyX','Cut'],['mod+KeyZ','Undo'],['mod+KeyY','Redo'],['mod+shift+KeyZ','Redo'],['mod+shift+KeyV','Paste as plain text'],
    ['mod+KeyW','Close window'],['mod+KeyQ','Quit'],['mod+KeyR','Reload'],['mod+Equal','Zoom in'],['mod+Minus','Zoom out'],['mod+Digit0','Actual size'],
    ['mod+KeyH','Hide (macOS)','mac'],['mod+alt+KeyH','Hide others (macOS)','mac'],['mod+KeyM','Minimize (macOS)','mac'],['mod+Backquote','switching windows (macOS)','mac'],['mod+ctrl+KeyF','full screen (macOS)','mac'],
    ['alt+F4','closing the window (Windows, Linux)','other'],
    /* operating system shortcuts */
    ['mod+Space','switching input methods (Ctrl+Space)','other'],['mod+shift+Space','input-method switching on many systems','other'],['alt+Space','the window menu (Windows, Linux)','other'],
    ['alt+Tab','switching apps'],['mod+alt+KeyT','opening a terminal (Ubuntu)','other'],['mod+alt+KeyL','locking the screen (Linux)','other'],['alt+F2','the Run dialog (Linux)','other'],
    ['mod+Space','Spotlight (macOS)','mac'],['mod+alt+Space','Finder search (macOS)','mac'],['ctrl+Space','switching input sources (macOS)','mac'],['ctrl+alt+Space','switching input sources (macOS)','mac'],
    ['mod+ctrl+Space','Emoji and Symbols (macOS)','mac'],['mod+Tab','switching apps (macOS)','mac'],['mod+shift+Digit3','screenshots (macOS)','mac'],['mod+shift+Digit4','screenshots (macOS)','mac'],['mod+shift+Digit5','screenshots (macOS)','mac'],
    ['mod+ctrl+KeyQ','locking the screen (macOS)','mac'],
    ['mod+shift+KeyU','Unicode input (Ctrl+Shift+U, IBus on Linux)','other'],['mod+shift+KeyE','emoji input (Ctrl+Shift+E, IBus on Linux)','other'],
  ];
  /* Mac text fields edit with Control and these letters (Cocoa, Emacs style): ⌃A line start, ⌃E line end, ⌃K delete to the end… */
  const MAC_TEXT_KEYS=/^Key[ABDEFHKLNOPTVY]$/;
  const takenBy=(c,mac)=>{const s=sig(c);return TAKEN.find(t=>t[0]===s&&(!t[2]||t[2]===(mac?'mac':'other')))||null;};
  /* '' when the combination may be used, otherwise a sentence that says why not (FR-014) */
  function clashOf(combo,mac){
    const c=combo||{};
    if(!validCode(c.code))return 'Use a letter, a digit, F1 to F12, Space or a punctuation key.';
    if(c.sup)return 'The Windows or Super key belongs to the operating system. Use Ctrl or Alt.';
    if(!c.mod&&!c.ctrl&&!c.alt)return mac?'Add ⌘, ⌃ or ⌥: a key alone would type text.':'Add Ctrl or Alt: a key alone would type text.';
    const letter=/^(Key[A-Z]|Digit[0-9])$/.test(c.code)||Object.prototype.hasOwnProperty.call(PUNCT,c.code);
    if(mac&&c.alt&&!c.mod&&!c.ctrl&&letter)return 'On a Mac, Option with a letter types accented characters. Add ⌘ or ⌃.';
    if(!mac&&c.mod&&c.alt&&letter&&!c.shift)return 'Ctrl+Alt with a letter is AltGr on many keyboard layouts and types characters. Add Shift or pick another key.';
    if(!mac&&c.mod&&c.alt&&/^F/.test(c.code))return 'Ctrl+Alt with a function key switches consoles on Linux.';
    if(mac&&c.ctrl&&!c.mod&&!c.alt&&MAC_TEXT_KEYS.test(c.code))return 'On a Mac, Control with '+keyName(c.code)+' edits text in every text field (⌃A, ⌃E, ⌃K…). Add ⌘ or pick another key.';
    const hit=takenBy(c,mac);
    if(hit)return 'Already used for '+hit[1]+'.';
    /* FR-017: the letter it types on this keyboard layout counts too (Dvorak: Ctrl and the key labelled C is the position of I) */
    if(c.typed&&c.typed!==c.code){
      const t=Object.assign({},c,{code:c.typed,typed:''}), why=clashOf(t,mac);
      if(why)return 'On this keyboard layout it types '+keyName(c.typed)+'. '+why;
    }
    return '';
  }
  /* saved JSON -> a usable combination, or the default when it is missing, damaged or no longer allowed */
  function loadCombo(json,mac){
    let o=null; try{o=typeof json==='string'?JSON.parse(json):json;}catch(e){o=null;}
    if(!o||typeof o!=='object')return Object.assign({},DEFAULT_COMBO);
    const c={mod:o.mod===true,ctrl:o.ctrl===true&&!!mac,alt:o.alt===true,shift:o.shift===true,code:String(o.code||'')};
    return clashOf(c,mac)?Object.assign({},DEFAULT_COMBO):c;
  }
  const sameCombo=(a,b)=>!!a&&!!b&&sig(a)===sig(b);

  return {rank,assignNumbers,pruneNumbers,loadNumbers,levelItems,parseStart,pickNumber,view,pick,push,back,crumbs,
    DEFAULT_COMBO,comboFromEvent,comboMatches,comboParts,clashOf,loadCombo,sameCombo,validCode};
})());
