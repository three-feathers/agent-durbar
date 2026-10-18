/* theme.js — data-only theme pack loader for Agent Durbar (spec 035)
 *
 * Themes are data-only: a manifest, token map, art slots, motion presets and
 * scene-word overrides. No scripts, no raw CSS, no arbitrary SVG.
 * The active theme is applied as CSS custom properties; art slots are returned
 * as sanitized SVG fragments. Unknown/missing values fall back to Clean Office.
 */
(function(root, factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else if(typeof define==='function' && define.amd) define([], factory);
  else root.THEME=factory();
}(typeof self!=='undefined'?self:this, function(){
  'use strict';

  const CLEAN_ID='clean-office';

  /* ---------- Clean Office token map ----------
     Semantic names grouped by domain. These become CSS custom properties
     on :root when the theme is active. */
  const CLEAN_TOKENS={
    /* core UI */
    '--bg':'#f6f3ee',
    '--surface':'#fffdf9',
    '--surface-2':'#faf7f1',
    '--line':'#e2dbcf',
    '--line-2':'#d3cabb',
    '--ink':'#2c3733',
    '--ink-2':'#56605b',
    '--muted':'#6a716c',
    '--room-path':'#5c635e',

    /* brand / accent */
    '--sage':'#8fb09a',
    '--sage-ink':'#3f6a54',
    '--blue':'#6f93b5',
    '--blue-ink':'#34607f',
    '--amber':'#d9962b',
    '--amber-ink':'#80530a',
    '--red':'#bf5a50',
    '--red-ink':'#8e3a32',
    '--green':'#5f9a76',
    '--gray':'#9b978d',

    /* status */
    '--c-working':'#6f93b5',
    '--c-thinking':'#8a97bd',
    '--c-waiting':'#d9962b',
    '--c-idle':'#a29e94',
    '--c-error':'#bf5a50',
    '--c-done':'#5f9a76',

    /* scene / office objects */
    '--scene-shadow':'#2c3733',
    '--chair':'#cdc6b8',
    '--desk':'#d8c6a8',
    '--desk-front':'#e8dcc6',
    '--desk-drawer':'#dccdb1',
    '--monitor':'#5f6d77',
    '--monitor-stand':'#7c8791',
    '--laptop':'#8f99a1',
    '--coffee-cup':'#f6f1e7',
    '--coffee-stroke':'#cdbf9f',
    '--steam':'#b6b2a8',
    '--plant-light':'#aac6b2',
    '--plant-mid':'#9dbca6',
    '--plant-dark':'#86a98f',
    '--pot':'#d4b99a',
    '--skin-shadow':'#7a7f8c',   /* generic shadow tone used in avatar */
    '--mouth':'#7a4b3a',
    '--glasses':'#3b3330',
    '--horn':'#6e8a70',
    '--sweat':'#a9c6e3',
    '--sweat-stroke':'#7fa3c9',
    '--star':'#d9a441',
    '--ambulance-body':'#f7f4ee',
    '--ambulance-stripe':'#bf5a50',
    '--ambulance-window':'#bcd3e6',
    '--ambulance-light':'#d9534f',
    '--ambulance-wheel':'#4a5560',
    '--ambulance-stroke':'#9aa59f',
    '--bubble-stroke':'#c9d0e0',
    '--bubble-fill':'#fff',
    '--bubble-fill':'#fff',
    '--bubble-text':'#8a97bd',

    /* screen content */
    '--scr-working':'#eaf1f7',
    '--scr-thinking':'#eaeef6',
    '--scr-waiting':'#f8eed9',
    '--scr-idle':'#d4d8d6',
    '--scr-error':'#f6e3e0',
    '--scr-done':'#e2efe7',
    '--scr-bar-1':'#6f93b5',
    '--scr-bar-2':'#8fb09a',
    '--scr-bar-3':'#6f93b5',
    '--scr-bar-4':'#a8bfd2',
    '--scr-thinking-bar':'#8a97bd',
    '--scr-waiting-bar':'#d9962b',
    '--scr-waiting-stroke':'#e5be78',
    '--scr-waiting-fill':'#fff',
    '--scr-waiting-fill':'#fff',
    '--scr-waiting-text':'#e5cf9f',
    '--scr-waiting-text-2':'#efe0bb',
    '--scr-error-bar':'#e3b5af',
    '--scr-idle-stroke':'#b5b9b6',

    '--monster-skin':'#8fa98f',

    /* mood / status halos */
    '--halo-working':'#6f93b5',
    '--halo-thinking':'#8a97bd',
    '--halo-waiting':'#d9962b',
    '--halo-error':'#bf5a50',
  };

  /* ---------- Art slot registry ----------
     Slots are SVG fragments. They are assembled by scene() in app.js.
     For now the registry lists the slot ids; the actual Clean Office SVGs
     remain inline in app.js because scene() is a complex composition.
     Later specs will override individual slots. */
  const CLEAN_SLOTS={
    'chair-back':'<rect x="52" y="50" width="44" height="48" rx="13" fill="var(--chair)"/>',
    'desk':'<rect x="10" y="86" width="180" height="7" rx="3.5" fill="var(--desk)"/><rect x="15" y="93" width="170" height="21" rx="4" fill="var(--desk-front)"/><rect x="22" y="98" width="46" height="11" rx="3" fill="var(--desk-drawer)"/><rect x="142" y="98" width="36" height="11" rx="3" fill="var(--desk-drawer)"/>',
    'monitor':'<rect x="138.5" y="76" width="11" height="9" fill="var(--monitor-stand)"/><rect x="130" y="83" width="28" height="3.5" rx="1.75" fill="var(--monitor-stand)"/>',
    'plant':'<path d="M13 20C13 12 9 8 4 7c0 6 3 11 9 13z" fill="var(--plant-mid)"/><path d="M13 20c0-9 4-13 9-14 0 7-3 12-9 14z" fill="var(--plant-dark)"/><path d="M13 20C12 14 12 9 13 3c2 6 2 11 0 17z" fill="var(--plant-light)"/><path d="M7 21h12l-1.5 8h-9z" fill="var(--pot)"/>',
  };

  /* Scene words a theme may rename (no other wording changes). */
  const CLEAN_WORDS={};

  /* ---------- Manifest validation / slot sanitization ----------
     A theme pack contains SVG fragments. We allow only a small whitelist of
     tags and attributes; scripts, styles, event handlers, links, and foreign
     objects are rejected. The cleaner works with strings so it runs in both
     the browser and Node unit tests (no DOMParser dependency). */
  const SLOT_TAG_RE=/^\s*(g|path|rect|circle|ellipse|line|polyline|polygon|text)\s*$/i;
  const VOID_TAG_RE=/^\s*(rect|circle|ellipse|line|polyline|polygon|path)\s*$/i;
  const ATTR_BLACKLIST_RE=/^(on[a-z]+|href|xlink:href|style)$/i;
  const SVG_WHITELIST=['xmlns','viewBox','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','opacity','rx','ry','cx','cy','r','x','y','x1','y1','x2','y2','points','d','transform','class','aria-hidden','focusable'];

  function sanitizeSlot(svg){
    if(typeof svg!=='string' || !svg.trim()) return null;
    let depth=0, lastIndex=0;
    const tagRe=/\u003c(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\S+))?)*)\s*(\/?)\u003e/g;
    let m;
    while((m=tagRe.exec(svg))!==null){
      // text outside tags must be whitespace-only
      const outside=svg.slice(lastIndex,m.index);
      if(outside.trim().length>0) return null;
      lastIndex=tagRe.lastIndex;
      const closing=m[1], tag=m[2].toLowerCase(), attrs=m[3], selfClose=m[4];
      if(!SLOT_TAG_RE.test(tag)) return null;
      // attribute validation
      const attrRe=/\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
      let am;
      while((am=attrRe.exec(attrs))!==null){
        const name=am[1].toLowerCase();
        const value=(am[2]!==undefined?am[2]:am[3]!==undefined?am[3]:am[4])||'';
        if(ATTR_BLACKLIST_RE.test(name)) return null;
        if(!SVG_WHITELIST.includes(name) && !name.startsWith('data-')) return null;
        // reject dangerous values in data-* attributes too
        if(/javascript:/i.test(value) || /\bon\w+\s*=/i.test(value)) return null;
      }
      if(closing){ depth--; if(depth<0) return null; }
      else if(!selfClose && !VOID_TAG_RE.test(tag)){ depth++; }
    }
    const tail=svg.slice(lastIndex);
    if(tail.trim().length>0) return null;
    if(depth!==0) return null;
    return svg.trim();
  }

  function validateManifest(m){
    if(!m || typeof m!=='object') return null;
    const out={};
    out.id=String(m.id||CLEAN_ID).replace(/[^a-z0-9_-]/gi,'');
    if(!out.id) out.id=CLEAN_ID;
    out.name=String(m.name||out.id);
    out.author=String(m.author||'');
    out.version=String(m.version||'1.0');
    out.extends=String(m.extends||CLEAN_ID);
    if(!['clean-office'].includes(out.extends)) out.extends=CLEAN_ID;
    out.tokens=Object.assign({}, m.tokens && typeof m.tokens==='object'?m.tokens:{});
    out.art={};
    if(m.art && typeof m.art==='object'){
      for(const [k,v] of Object.entries(m.art)){
        const clean=sanitizeSlot(v);
        if(clean!==null) out.art[k]=clean;
      }
    }
    out.motion=Object.assign({}, m.motion && typeof m.motion==='object'?m.motion:{});
    out.words=Object.assign({}, m.words && typeof m.words==='object'?m.words:{});
    return out;
  }

  /* ---------- Theme store ---------- */
  let currentId=CLEAN_ID;
  let currentManifest=null;
  let listeners=[];

  function resolveTokens(manifest){
    const t=Object.assign({}, CLEAN_TOKENS);
    if(manifest && manifest.tokens) Object.assign(t, manifest.tokens);
    return t;
  }

  function resolveSlots(manifest){
    const s=Object.assign({}, CLEAN_SLOTS);
    if(manifest && manifest.art) Object.assign(s, manifest.art);
    return s;
  }

  function resolveWords(manifest){
    const w=Object.assign({}, CLEAN_WORDS);
    if(manifest && manifest.words) Object.assign(w, manifest.words);
    return w;
  }

  function applyTokens(tokens){
    if (typeof document === 'undefined' || !document.documentElement) return;
    const el = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) { el.style.setProperty(k, v); }
  }

  const BUILT_IN={};
  BUILT_IN[CLEAN_ID]={
    id:CLEAN_ID,
    name:'Clean Office',
    author:'Three Feathers',
    version:'1.0',
    extends:CLEAN_ID,
    tokens:{},
    art:{},
    motion:{},
    words:{},
  };

  function loadManifest(idOrManifest){
    if(typeof idOrManifest==='string' && BUILT_IN[idOrManifest]) return validateManifest(BUILT_IN[idOrManifest]);
    if(typeof idOrManifest==='object') return validateManifest(idOrManifest);
    return null;
  }

  function setTheme(idOrManifest){
    const manifest=loadManifest(idOrManifest);
    const id=manifest?manifest.id:CLEAN_ID;
    if(id===currentId && currentManifest) return id; /* already active */
    currentId=id;
    currentManifest=manifest;
    applyTokens(resolveTokens(manifest));
    listeners.forEach(fn=>{ try{fn(currentId, manifest);}catch(e){console.warn('[theme] listener error',e);} });
    return id;
  }

  function current(){return {id:currentId, manifest:currentManifest};}
  function token(name){
    const key=name.startsWith('--')?name:'--'+name;
    const tokens=resolveTokens(currentManifest);
    return tokens.hasOwnProperty(key)?tokens[key]:CLEAN_TOKENS[key]||null;
  }
  function slot(name){
    const slots=resolveSlots(currentManifest);
    return slots[name]||CLEAN_SLOTS[name]||null;
  }
  function word(key){ return resolveWords(currentManifest)[key]||CLEAN_WORDS[key]||key; }
  function onChange(fn){ listeners.push(fn); }
  function themeIdForCache(){ return currentId; }

  /* boot: apply Clean Office immediately so the page never has un-tokenized colours */
  if(typeof document!=='undefined' && document.documentElement){
    applyTokens(CLEAN_TOKENS);
  }

  return {
    CLEAN_ID,
    setTheme,
    current,
    token,
    slot,
    word,
    onChange,
    themeIdForCache,
    _sanitizeSlot:sanitizeSlot, /* exposed for tests */
    _validateManifest:validateManifest,
  };
}));
