/* theme.js — data-only theme pack loader for Agent Durbar (spec 035)
 *
 * Themes are data-only: a manifest, token map, art slots, motion presets and
 * scene-word overrides. No scripts, no raw CSS, no arbitrary SVG.
 * The active theme is applied as CSS custom properties; art slots are returned
 * as sanitized SVG fragments. Unknown/missing values fall back to Clean Office.
 */
(function(root, factory){
  const exports = factory();
  if(typeof module==='object' && module.exports) module.exports = exports;
  if(typeof define==='function' && define.amd) define([], function(){ return exports; });
  root.THEME = exports;
}(typeof self!=='undefined'?self:this, function(){
  'use strict';

  const CLEAN_ID='clean-office';

  /* ---------- Clean Office token map ----------
     Semantic names grouped by domain. These become CSS custom properties
     on :root when the theme is active. For the foundation spec we expose
     the core UI, brand, status and mood halos that already drive styles.css.
     Scene/object tokens and art slots are added when the scene builder is
     refactored in the next spec. */
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

    /* mood / status halos */
    '--halo-working':'#6f93b5',
    '--halo-thinking':'#8a97bd',
    '--halo-waiting':'#d9962b',
    '--halo-error':'#bf5a50',

    /* scene (spec 036): today's desk scene literals, one token each */
    '--scene-shadow':'#2c3733',
    '--chair':'#cdc6b8',
    '--desk':'#d8c6a8',
    '--desk-front':'#e8dcc6',
    '--desk-drawer':'#dccdb1',
    '--monitor-stand':'#7c8791',
    '--monitor-frame':'#5f6d77',
    '--screen-working':'#eaf1f7',
    '--screen-thinking':'#eaeef6',
    '--screen-waiting':'#f8eed9',
    '--screen-idle':'#d4d8d6',
    '--screen-error':'#f6e3e0',
    '--screen-done':'#e2efe7',
    '--bar-sage':'#8fb09a',
    '--bar-blue':'#6f93b5',
    '--bar-blue-2':'#a8bfd2',
    '--face-dark':'#3b3330',
    '--mouth':'#7a4b3a',
    '--sweat':'#a9c6e3',
    '--sweat-line':'#7fa3c9',
    '--monster-skin':'#8fa98f',
    '--monster-horn':'#6e8a70',
    '--faint-mouth':'#7a4b3a',
    '--star':'#d9a441',
    '--laptop':'#8f99a1',
    '--wait-dot':'#d9962b',
    '--wait-note-stroke':'#e5be78',
    '--wait-note-line':'#e5cf9f',
    '--wait-note-line-2':'#efe0bb',
    '--wait-card':'#fff',
    '--idle-clock':'#b5b9b6',
    '--err-mark':'#e3b5af',
    '--done-bg':'#5f9a76',
    '--done-mark':'#fff',
    '--cup':'#f6f1e7',
    '--cup-line':'#cdbf9f',
    '--steam':'#b6b2a8',
    '--bubble':'#fff',
    '--bubble-line':'#c9d0e0',
    '--think-dot':'#8a97bd',
    '--amb-body':'#f7f4ee',
    '--amb-line':'#9aa59f',
    '--amb-window':'#bcd3e6',
    '--amb-stripe':'#bf5a50',
    '--amb-light':'#d9534f',
    '--amb-light-2':'#5b8fd1',
    '--amb-wheel':'#4a5560',
    '--plant-mid':'#9dbca6',
    '--plant-dark':'#86a98f',
    '--plant-light':'#aac6b2',
    '--pot':'#d4b99a',
    '--link':'#a9b6ad',
    '--siren-base':'#6b6f76',
    '--door-bg':'#efe8d8',
    '--door-line':'#b3a07c',
    '--door-leaf':'#d8c6a8',
    '--door-leaf-line':'#a89572',
    '--door-knob':'#8a7650',
    '--door-panel':'#e8dcc6',
    '--brand-mark':'#4f7f65',
    '--brand-bg':'#e4ece6',
    '--focus':'#4f7fa8',
    '--sel-border':'#7fa0bd',
    '--sel-ring':'#d9e6f0',
    '--sel-ring-2':'#dde8f1',
    '--avatar-bg':'#e7eee8',
    '--walker-bg':'#fffdf8',
    '--drop':'#7fa0bd',
    '--drop-bg':'rgb(233 241 248 / .93)',
    '--drop-ink':'#2a506c',
    '--stat-sel-border':'#8aa7be',
    '--stat-sel-ring':'#dde8f1',
    '--badge-idle':'#bdb9af',
    '--idle-stub':'#ece9e2','--idle-stub-ink':'#5c5f59',
    '--place-busy':'#b5c8d8',
    '--proto-line':'#f0d9a6',
    '--ic-read':'#5b7f94',
    '--ic-edit':'#7f8a5b',
    '--ic-run':'#4f7f65',
    '--ic-search':'#8a6f4a',
    '--ic-tool':'#7a7f8c',

    /* room tints / walls (spec 036): the four folder colours, full density and compact walls */
    '--tint-sage':'#eaf0e9',
    '--wall-sage':'#d3dfd3',
    '--tint-blue':'#e9eef3',
    '--wall-blue':'#d1dce6',
    '--tint-sand':'#f2ede1',
    '--wall-sand':'#e0d6c1',
    '--tint-clay':'#f3eae4',
    '--wall-clay':'#e4d3c9',
    '--cwall-sage':'#b7cdb9',
    '--cwall-blue':'#b5c8d8',
    '--cwall-sand':'#d2c4a4',
    '--cwall-clay':'#d8c1b3',

    /* status pills in cards and lists (background / ink pairs; contrast checked in test:theme) */
    '--pb-working':'#e3ecf4',
    '--pc-working':'#2f5a7a',
    '--pb-thinking':'#e8eaf3',
    '--pc-thinking':'#434f7a',
    '--pb-waiting':'#fbefd6',
    '--pc-waiting':'#80530a',
    '--pb-idle':'#ece9e2',
    '--pc-idle':'#5c5f59',
    '--pb-error':'#f6e2df',
    '--pc-error':'#8e3a32',
    '--pb-done':'#e0eee6',
    '--pc-done':'#2f6a47',
  };

  /* ---------- Art slot registry (foundation) ----------
     Slots are SVG fragments that the scene builder will assemble. For now
     the registry defines the contract and a few default shapes; slots are
     populated fully in spec 036. */
  const CLEAN_SLOTS={
    'chair-back':'<rect x="52" y="50" width="44" height="48" rx="13" fill="var(--chair)"/>',
    'desk':'<rect x="10" y="86" width="180" height="7" rx="3.5" fill="var(--desk)"/><rect x="15" y="93" width="170" height="21" rx="4" fill="var(--desk-front)"/><rect x="22" y="98" width="46" height="11" rx="3" fill="var(--desk-drawer)"/><rect x="142" y="98" width="36" height="11" rx="3" fill="var(--desk-drawer)"/>',
    'monitor':'<rect x="138.5" y="76" width="11" height="9" fill="var(--monitor-stand)"/><rect x="130" y="83" width="28" height="3.5" rx="1.75" fill="var(--monitor-stand)"/>',
    'plant':'<path d="M13 20C13 12 9 8 4 7c0 6 3 11 9 13z" fill="var(--plant-mid)"/><path d="M13 20c0-9 4-13 9-14 0 7-3 12-9 14z" fill="var(--plant-dark)"/><path d="M13 20C12 14 12 9 13 3c2 6 2 11 0 17z" fill="var(--plant-light)"/><path d="M7 21h12l-1.5 8h-9z" fill="var(--pot)"/>',
  };

  /* Scene words a theme may rename (035 FR-001, 036 FR-003). Status, permission and credit wording
     is never themeable; ids (`place-*` values, door ids) never change — only the display text. */
  const CLEAN_WORDS={
    'place-library':'Library',
    'place-software':'Software library',
    'place-terminal':'Terminal',
    'place-web':'Web',
    'place-other':'Other tools',
    'lobby-label':'Lobby: the places where agents work',
    'door-close':'Close room',
    'door-open':'Open room',
    'door-title-prefix':'Close the door',
    'door-plate-suffix':'becomes a compact plate',
  };

  /* Motion presets (036 FR-006): fixed per theme, `reduced` is forced when prefers-reduced-motion matches. */
  const CLEAN_MOTION={preset:'default'};
  const MOTION_PRESETS={
    'default':{bar:'3.4s ease-in-out infinite alternate',glow:'3.6s ease-in-out infinite alternate',halo:'3.6s ease-in-out infinite alternate',wave:'2.8s ease-in-out infinite',cursor:'1.6s ease-in-out infinite'},
    'calm':{bar:'6s ease-in-out infinite alternate',glow:'8s ease-in-out infinite alternate',halo:'7s ease-in-out infinite alternate',wave:'4.5s ease-in-out infinite',cursor:'2.4s ease-in-out infinite'},
    'arcade':{bar:'1.7s steps(4) infinite alternate',glow:'2.4s steps(2) infinite alternate',halo:'2.4s steps(3) infinite alternate',wave:'1.8s steps(2) infinite',cursor:'1.2s steps(2) infinite'},
    'court':{bar:'5s ease-in-out infinite alternate',glow:'7s ease-in-out infinite alternate',halo:'6s ease-in-out infinite alternate',wave:'4s ease-in-out infinite',cursor:'2.2s ease-in-out infinite'},
    'reduced':{bar:'none',glow:'none',halo:'none',wave:'none',cursor:'none'},
  };

  /* ---------- Manifest validation ---------- */
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
      const outside=svg.slice(lastIndex,m.index);
      if(outside.trim().length>0) return null;
      lastIndex=tagRe.lastIndex;
      const closing=m[1], tag=m[2].toLowerCase(), attrs=m[3], selfClose=m[4];
      if(!SLOT_TAG_RE.test(tag)) return null;
      const attrRe=/\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
      let am;
      while((am=attrRe.exec(attrs))!==null){
        const name=am[1].toLowerCase();
        const value=(am[2]!==undefined?am[2]:am[3]!==undefined?am[3]:am[4])||'';
        if(ATTR_BLACKLIST_RE.test(name)) return null;
        if(!SVG_WHITELIST.includes(name) && !name.startsWith('data-')) return null;
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
        const clean=sanitizeArtValue(v);
        if(clean!==null) out.art[k]=clean;
      }
    }
    out.motion=Object.assign({}, m.motion && typeof m.motion==='object'?m.motion:{});
    out.words=Object.assign({}, m.words && typeof m.words==='object'?m.words:{});
    return out;
  }

  /* Palette pixel maps (spec 038): {cell, palette:{a:'#rgb'}, rows:['..aab..']} compile to a grid of <rect>s,
     then the result goes through the same tag/attr sanitiser as any other slot. `.` / space = transparent. */
  const CELL_RE=/^[1-9]\d?$/;
  const PIXEL_KEY_RE=/^[a-z0-9]$/i;
  const COLOR_RE=/^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+|var\(--[a-z0-9-]+\))$/i;
  function compilePixelMap(v){
    if(!v||typeof v!=='object')return null;
    const cell=CELL_RE.test(String(v.cell||''))?parseInt(v.cell,10):3;
    const pal=v.palette&&typeof v.palette==='object'?v.palette:null;
    const rows=Array.isArray(v.rows)?v.rows:[];
    if(!pal||!rows.length||rows.length>24)return null;
    const colors={};
    for(const [k,c] of Object.entries(pal)){
      if(!PIXEL_KEY_RE.test(k)||typeof c!=='string'||!COLOR_RE.test(c))return null;
      colors[k]=c;
    }
    let out='';
    for(let y=0;y<rows.length;y++){
      const row=String(rows[y]);
      if(row.length>30)return null;
      for(let x=0;x<row.length;x++){
        const ch=row[x];
        if(ch==='.'||ch===' ')continue;
        const col=colors[ch];
        if(!col)return null;
        out+=`<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="${col}"/>`;
      }
    }
    return out||null;
  }

  function sanitizeArtValue(v){
    if(typeof v==='string')return sanitizeSlot(v);
    const pix=compilePixelMap(v);
    return pix?sanitizeSlot(pix):null;
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
    if(typeof document==='undefined' || !document.documentElement) return;
    const el=document.documentElement;
    for(const [k,v] of Object.entries(tokens)){ el.style.setProperty(k, v); }
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

  /* Register a built-in pack (validated and sanitized at registration; console warning on drops). */
  function registerBuiltIn(pack){
    const v=validateManifest(pack);
    if(!v||!pack||typeof pack!=='object'){console.warn('[theme] built-in pack dropped (bad manifest)',pack&&pack.id);return false;}
    if(v.id===CLEAN_ID){console.warn('[theme] a built-in cannot reuse the clean-office id');return false;}
    if(typeof pack.name!=='string'||!pack.name.trim()){console.warn('[theme] built-in '+v.id+' dropped (no name)');return false;}
    v.name=pack.name.trim().slice(0,60);
    if(pack.tokens&&typeof pack.tokens==='object'){
      for(const k of Object.keys(pack.tokens))if(!Object.prototype.hasOwnProperty.call(CLEAN_TOKENS,k))console.warn('[theme] '+v.id+': unknown token '+k+' (stored, ignored by the app)');
    }
    if(pack.art&&typeof pack.art==='object'){
      for(const k of Object.keys(pack.art))if(sanitizeArtValue(pack.art[k])===null)console.warn('[theme] '+v.id+': art slot '+k+' dropped (failed the sanitizer)');
    }
    BUILT_IN[v.id]=v;
    return true;
  }

  let USER_MANIFESTS={}; /* id -> sanitized manifest of a user theme (spec 040), applied like a built-in */

  function list(){ /* every available theme for the picker (user themes appear once loaded in stage E) */
    return Object.keys(BUILT_IN).map(id=>({id,name:BUILT_IN[id].name,author:BUILT_IN[id].author||''}));
  }

  function loadManifest(idOrManifest){
    if(typeof idOrManifest==='string'){if(BUILT_IN[idOrManifest])return validateManifest(BUILT_IN[idOrManifest]);if(USER_MANIFESTS[idOrManifest])return validateManifest(USER_MANIFESTS[idOrManifest]);return null;}
    if(typeof idOrManifest==='object')return validateManifest(idOrManifest);
    return null;
  }

  /* Apply a pack or id; unknown ids fall back to Clean Office (with a warning). Strings resolve
     synchronously when already known; a `resolveUser` hook (stage E) can fetch a user pack manifest. */
  function setTheme(idOrManifest){
    let manifest=loadManifest(idOrManifest);
    if(!manifest){
      if(typeof setTheme.resolveUser==='function'&&typeof idOrManifest==='string'&&/^[a-z0-9_-]+$/i.test(idOrManifest)){
        const want=idOrManifest.toLowerCase();
        Promise.resolve()
          .then(()=>setTheme.resolveUser(want))
          .then(m=>{if(m){USER_MANIFESTS[want]=m;setTheme(m);}})
          .catch(e=>{console.warn('[theme] could not load user theme',want,e);});
      }
      console.warn('[theme] unknown theme',idOrManifest,'— falling back to Clean Office');
      manifest=loadManifest(CLEAN_ID);
    }
    const id=manifest.id;
    if(id===currentId&&currentManifest)return id;
    currentId=id;
    currentManifest=manifest;
    applyTokens(resolveTokens(manifest));
    /* motion presets (036 FR-006): re-applied on every switch, reduced motion wins */
    for(const k of ['bar','glow','halo','wave','cursor']){
      if(typeof document!=='undefined'&&document.documentElement)document.documentElement.style.setProperty('--m-'+k,motion(k));
    }
    listeners.forEach(fn=>{ try{fn(currentId, manifest);}catch(e){console.warn('[theme] listener error',e);} });
    return id;
  }

  function current(){return {id:currentId, manifest:currentManifest};}
  function token(name){
    const key=name.startsWith('--')?name:'--'+name;
    const tokens=currentManifest&&currentManifest.tokens;
    if(tokens&&Object.prototype.hasOwnProperty.call(tokens,key))return tokens[key];
    return CLEAN_TOKENS[key]||null;
  }
  function slot(name){
    const art=currentManifest&&currentManifest.art;
    if(art&&Object.prototype.hasOwnProperty.call(art,name))return art[name];
    return CLEAN_SLOTS[name]||null;
  }
  function word(key){
    const w=currentManifest&&currentManifest.words;
    if(w&&typeof w[key]==='string'&&w[key])return w[key];
    return Object.prototype.hasOwnProperty.call(CLEAN_WORDS,key)?CLEAN_WORDS[key]:key;
  }
  function motion(name){
    const m=currentManifest&&currentManifest.motion;
    const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    const preset=reduced?'reduced':(m&&typeof m.preset==='string'&&MOTION_PRESETS[m.preset]?m.preset:'default');
    const p=MOTION_PRESETS[preset]||MOTION_PRESETS.default;
    return p[name]!==undefined?p[name]:(MOTION_PRESETS.default[name]||'none');
  }
  function onChange(fn){ listeners.push(fn); }
  /* User themes (spec 040): the main process passes validated manifests; id becomes selectable. */
  function registerUserThemes(listOrMap){
    USER_MANIFESTS={};
    if(listOrMap&&typeof listOrMap==='object'){
      for(const [id,m] of Object.entries(listOrMap)){
        const v=validateManifest(m);
        if(v&&v.id===id&&!BUILT_IN[id])USER_MANIFESTS[id]=v;
        else console.warn('[theme] user theme dropped on registration:',id);
      }
    }
  }
  function themeIdForCache(){ return currentId; }

  /* ================================= built-in packs (specs 037-039) =================================
     Data-only: tokens (only Clean Office keys are meaningful), sanitized art slots, scene words,
     one motion preset. Status/permission/credit wording never changes; layout is never themed. */

  /* ---- 037: Corporate — glass and steel, cool neutrals ---- */
  registerBuiltIn({
    id:'corporate', name:'Corporate', author:'Three Feathers', version:'1.0', extends:'clean-office',
    tokens:{
      '--bg':'#edf1f5','--surface':'#f8fafc','--surface-2':'#eef3f8','--line':'#d5dde5','--line-2':'#c2ccd6',
      '--ink':'#21303f','--ink-2':'#3d5468','--muted':'#5c6f80','--room-path':'#46586a',
      '--sage':'#7fa3b8','--sage-ink':'#2c5468','--blue':'#5b83ad','--blue-ink':'#2a5578',
      '--amber':'#c98f2b','--amber-ink':'#7a5505','--red':'#c05a50','--red-ink':'#8e382f','--green':'#4f8f6a','--gray':'#8f99a3',
      '--c-working':'#5b83ad','--c-thinking':'#7d8fb0','--c-waiting':'#c98f2b','--c-idle':'#97a1ab','--c-error':'#c05a50','--c-done':'#4f8f6a',
      '--halo-working':'#5b83ad','--halo-thinking':'#7d8fb0','--halo-waiting':'#c98f2b','--halo-error':'#c05a50',
      '--chair':'#c8d0d8','--desk':'#b9c2cb','--desk-front':'#cfd7de','--desk-drawer':'#c0c9d2',
      '--monitor-stand':'#66727e','--monitor-frame':'#49555f','--laptop':'#707d88',
      '--screen-working':'#e8f0f7','--screen-thinking':'#e9edf4','--screen-waiting':'#f7eeda','--screen-idle':'#d5dadd','--screen-error':'#f6e3e0','--screen-done':'#e2eee7',
      '--bar-sage':'#7fa3b8','--bar-blue':'#5b83ad','--bar-blue-2':'#9fb6cb',
      '--bubble-line':'#c6d0dd','--think-dot':'#7d8fb0',
      '--cup':'#eef2f5','--cup-line':'#b9c4cc','--steam':'#a4adb5',
      '--plant-mid':'#93ab9a','--plant-dark':'#7b9883','--plant-light':'#a4b7aa','--pot':'#a8b2ba',
      '--link':'#9aa9b4',
      '--door-bg':'#e9edf1','--door-line':'#a8b4bf','--door-leaf':'#c9d1d9','--door-leaf-line':'#9faab6','--door-knob':'#77828c','--door-panel':'#e1e7ec',
      '--brand-mark':'#37658a','--brand-bg':'#e0e9f0','--focus':'#3d6fa8',
      '--sel-border':'#6b93b8','--sel-ring':'#d3e0ec','--sel-ring-2':'#d7e3ee','--stat-sel-border':'#7d9ab5','--stat-sel-ring':'#d7e3ee',
      '--avatar-bg':'#dfe7ee','--walker-bg':'#fdfdfe','--drop':'#6b93b8','--drop-bg':'rgb(229 238 246 / .93)','--drop-ink':'#23415c',
      '--badge-idle':'#aab2ba','--place-busy':'#a7bdcd',
      '--tint-sage':'#e8eef1','--wall-sage':'#cfdbe0','--tint-blue':'#e6edf4','--wall-blue':'#cbd8e4','--tint-sand':'#ebf0f4','--wall-sand':'#d7dfe7','--tint-clay':'#e9edf2','--wall-clay':'#d2dbe3',
      '--cwall-sage':'#aec3cd','--cwall-blue':'#a9bfce','--cwall-sand':'#bcc9d4','--cwall-clay':'#b4c1cb',
      '--pb-working':'#dfe9f2','--pc-working':'#29506f','--pb-thinking':'#e6e9f1','--pc-thinking':'#3d4a72',
      '--pb-waiting':'#f7ecd2','--pc-waiting':'#7a5505','--pb-idle':'#e7eaeb','--pc-idle':'#50575c',
      '--pb-error':'#f6e2de','--pc-error':'#8e382f','--pb-done':'#dfeede','--pc-done':'#2d6142',
      '--proto-line':'#eed9ac',
      '--ic-read':'#4c6f8a','--ic-edit':'#6d7f52','--ic-run':'#37658a','--ic-search':'#7d6a44','--ic-tool':'#6c7683',
    },
    words:{'place-library':'Records','place-software':'Repository','place-terminal':'Server room','place-web':'Network','place-other':'Facilities','lobby-label':'Reception: the places where agents work'},
    motion:{preset:'calm'},
  });

  /* ---- 038: Retro — 8-bit palette, blocky slot art ---- */
  registerBuiltIn({
    id:'retro', name:'Retro Pixel', author:'Three Feathers', version:'1.0', extends:'clean-office',
    tokens:{
      '--bg':'#e8e4d8','--surface':'#f8f4e6','--surface-2':'#efe9d9','--line':'#c8c0aa','--line-2':'#b3a98f',
      '--ink':'#23233a','--ink-2':'#454566','--muted':'#66687f','--room-path':'#4a4c66',
      '--sage':'#5fae76','--sage-ink':'#2c6b40','--blue':'#5f87c8','--blue-ink':'#2c4f82','--amber':'#e0a92c','--amber-ink':'#7c5a06',
      '--red':'#d8564a','--red-ink':'#8e2f26','--green':'#4fa760','--gray':'#9a987e',
      '--c-working':'#5f87c8','--c-thinking':'#8b8fc9','--c-waiting':'#e0a92c','--c-idle':'#a3a08e','--c-error':'#d8564a','--c-done':'#4fa760',
      '--halo-working':'#5f87c8','--halo-thinking':'#8b8fc9','--halo-waiting':'#e0a92c','--halo-error':'#d8564a',
      '--chair':'#b0a88e','--desk':'#a8937a','--desk-front':'#c2b096','--desk-drawer':'#b09d82',
      '--monitor-stand':'#565c70','--monitor-frame':'#333652','--laptop':'#6d7390',
      '--screen-working':'#dfeaf8','--screen-thinking':'#e4e4f6','--screen-waiting':'#faedd2','--screen-idle':'#d2d2c6','--screen-error':'#f8e0d8','--screen-done':'#dcefdc',
      '--bar-sage':'#5fae76','--bar-blue':'#5f87c8','--bar-blue-2':'#93aede',
      '--face-dark':'#23233a','--mouth':'#8a4638',
      '--bubble-line':'#b9bce0','--think-dot':'#8b8fc9',
      '--cup':'#f2ecd9','--cup-line':'#b3a37c','--steam':'#9d987e',
      '--link':'#989e8a','--star':'#e0a92c',
      '--door-bg':'#e6dfd0','--door-line':'#a3967a','--door-leaf':'#c2b096','--door-leaf-line':'#988a6c','--door-knob':'#6e6248','--door-panel':'#ddd3ba',
      '--brand-mark':'#3d9b58','--brand-bg':'#dde8d4','--focus':'#3a6fae',
      '--sel-border':'#6d8cc2','--sel-ring':'#d2def0','--sel-ring-2':'#d8e2f2','--stat-sel-border':'#7f95c2','--stat-sel-ring':'#d8e2f2',
      '--avatar-bg':'#e0ead2','--walker-bg':'#fbf8ee','--drop':'#6d8cc2','--drop-bg':'rgb(230 236 248 / .93)','--drop-ink':'#26456e',
      '--badge-idle':'#b8b49c','--place-busy':'#a7b8d6',
      '--tint-sage':'#e2ead2','--wall-sage':'#c5d2ac','--tint-blue':'#dee6f2','--wall-blue':'#c1cfe6','--tint-sand':'#ece6d0','--wall-sand':'#d8cdaa','--tint-clay':'#efe2d6','--wall-clay':'#dcc8b2',
      '--cwall-sage':'#acc092','--cwall-blue':'#a7b8d6','--cwall-sand':'#c6b98e','--cwall-clay':'#cfb89e',
      '--pb-working':'#dce6f6','--pc-working':'#26456e','--pb-thinking':'#e4e3f6','--pc-thinking':'#3c3f78',
      '--pb-waiting':'#faecd0','--pc-waiting':'#7c5a06','--pb-idle':'#e6e4d6','--pc-idle':'#585647',
      '--pb-error':'#f8e1dc','--pc-error':'#8e2f26','--pb-done':'#daeede','--pc-done':'#2b6338',
      '--proto-line':'#ecd9a8',
      '--ic-read':'#4a6f92','--ic-edit':'#7a7f4a','--ic-run':'#3d9b58','--ic-search':'#8a6c3e','--ic-tool':'#6a6e80',
    },
    art:{
      'plant':'<rect x="10" y="6" width="6" height="15" fill="var(--plant-dark)"/><rect x="6" y="10" width="4" height="6" fill="var(--plant-dark)"/><rect x="16" y="9" width="4" height="5" fill="var(--plant-mid)"/><rect x="7" y="21" width="12" height="8" fill="var(--pot)"/><rect x="7" y="21" width="12" height="2" fill="var(--door-knob)"/>',
      'monitor':'<rect x="134.5" y="72" width="11" height="11" fill="var(--monitor-stand)"/><rect x="124" y="83" width="32" height="4" rx="1.75" fill="var(--monitor-stand)"/>',
      /* chunky CRT stand */
    },
    words:{'place-library':'Arcade','place-software':'Cartridge Bay','place-terminal':'Console','place-web':'Modem','place-other':'Gadgets','lobby-label':'Game lobby: the places where agents work'},
    motion:{preset:'arcade'},
  });

  /* ---- 039a: Durbar — Indian court (maroon, gold, sandalwood) ---- */
  registerBuiltIn({
    id:'durbar-indian', name:'Durbar · Indian Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    tokens:{
      '--bg':'#f6f0e6','--surface':'#fdf9f0','--surface-2':'#f8f1e2','--line':'#e3d6bc','--line-2':'#d4c2a2',
      '--ink':'#3a2e26','--ink-2':'#5d4c3e','--muted':'#756553','--room-path':'#655341',
      '--sage':'#8aab84','--sage-ink':'#3f6238','--blue':'#7d95b5','--blue-ink':'#3a5a80','--amber':'#d9962b','--amber-ink':'#80530a',
      '--red':'#b85448','--red-ink':'#8e3226','--green':'#5f9a76','--gray':'#a39a87',
      '--c-working':'#7d95b5','--c-thinking':'#9a8fbd','--c-waiting':'#d9962b','--c-idle':'#aca496','--c-error':'#b85448','--c-done':'#5f9a76',
      '--halo-working':'#7d95b5','--halo-thinking':'#9a8fbd','--halo-waiting':'#d9962b','--halo-error':'#b85448',
      '--chair':'#c4b49a','--desk':'#a8764a','--desk-front':'#c08a5c','--desk-drawer':'#b07c50',
      '--monitor-stand':'#6e6560','--monitor-frame':'#4a3f38','--laptop':'#7d746a',
      '--screen-working':'#f2ecdc','--screen-thinking':'#ece7f0','--screen-waiting':'#f8edd4','--screen-idle':'#d6d2c6','--screen-error':'#f6e0da','--screen-done':'#e2efe6',
      '--bar-sage':'#8aab84','--bar-blue':'#7d95b5','--bar-blue-2':'#b3c2d8',
      '--face-dark':'#3a2c26','--mouth':'#7c4638',
      '--plant-mid':'#a9bf92','--plant-dark':'#8aa474','--plant-light':'#bccba6','--pot':'#b8626a',
      '--link':'#b3a68c','--star':'#d99a2c',
      '--door-bg':'#f0e4cc','--door-line':'#a98b62','--door-leaf':'#cf9a5e','--door-leaf-line':'#a87b48','--door-knob':'#8a6436','--door-panel':'#e6d4ae',
      '--brand-mark':'#8c4a3c','--brand-bg':'#efe2c8','--focus':'#7d5aa8',
      '--sel-border':'#a87b48','--sel-ring':'#e8d6b8','--sel-ring-2':'#e3d2b6','--stat-sel-border':'#a8907a','--stat-sel-ring':'#e3d2b6',
      '--avatar-bg':'#eee2ca','--walker-bg':'#fdf8ec','--drop':'#a87b48','--drop-bg':'rgb(244 236 220 / .93)','--drop-ink':'#5c3c18',
      '--badge-idle':'#bfb49e','--place-busy':'#c2a574',
      '--tint-sage':'#ece8d8','--wall-sage':'#d6cfae','--tint-blue':'#e9edf2','--wall-blue':'#d0d9e5','--tint-sand':'#f2eadb','--wall-sand':'#e2d2b4','--tint-clay':'#f4e4d6','--wall-clay':'#e4c9b2',
      '--cwall-sage':'#c2b98e','--cwall-blue':'#b4c2d6','--cwall-sand':'#d0bc90','--cwall-clay':'#d6b493',
      '--pb-working':'#e2e9f2','--pc-working':'#315074','--pb-thinking':'#e8e4f2','--pc-thinking':'#4a3f80',
      '--pb-waiting':'#f8ebcf','--pc-waiting':'#80530a','--pb-idle':'#eae4d6','--pc-idle':'#5c544a',
      '--pb-error':'#f6e0dc','--pc-error':'#8e3226','--pb-done':'#ddeede','--pc-done':'#2f6240',
      '--proto-line':'#ecd3a2',
      '--ic-read':'#54749a','--ic-edit':'#7f8a54','--ic-run':'#8c4a3c','--ic-search':'#8a6f3c','--ic-tool':'#7c7286',
    },
    art:{
      /* a turban arc + jewel on the head (abstract, geometric); sits with every hairstyle */
      'hair-acc':'<path d="M60 36 Q74 24 88 36 L86 32 Q74 21 62 32 Z" fill="#8c2f3e"/><circle cx="74" cy="27" r="1.8" fill="#d9a441"/>',
      'plant':'<circle cx="13" cy="10" r="4.5" fill="var(--plant-mid)"/><circle cx="8" cy="14" r="3" fill="var(--plant-dark)"/><circle cx="18" cy="14" r="3" fill="var(--plant-light)"/><path d="M8 21h10l-1.5 8h-7z" fill="var(--pot)"/>',
    },
    words:{'place-library':'Records Kothi','place-software':'Shastra Ghar','place-terminal':'Yantra Kaksh','place-web':'Jaal Khidki','place-other':'Chhota Kaam','lobby-label':'The durbar: the places where agents work','door-close':'Close gate','door-open':'Open gate','door-title-prefix':'Close the gate'},
    motion:{preset:'court'},
  });

  /* ---- 039b: Durbar — European court (navy, silver, parchment) ---- */
  registerBuiltIn({
    id:'durbar-european', name:'Durbar · European Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    tokens:{
      '--bg':'#eef0f4','--surface':'#fafbfd','--surface-2':'#f2f4f8','--line':'#d8dce4','--line-2':'#c6ccd8',
      '--ink':'#2a2a44','--ink-2':'#4a4a68','--muted':'#66667f','--room-path':'#52526e',
      '--sage':'#8fa9a0','--sage-ink':'#3f6258','--blue':'#5f7fae','--blue-ink':'#2c4a78','--amber':'#d2a03c','--amber-ink':'#7a5c0e',
      '--red':'#bf5a6a','--red-ink':'#8e3642','--green':'#5f9a76','--gray':'#9a9884',
      '--c-working':'#5f7fae','--c-thinking':'#8a8fbd','--c-waiting':'#d2a03c','--c-idle':'#a6a29a','--c-error':'#bf5a6a','--c-done':'#5f9a76',
      '--halo-working':'#5f7fae','--halo-thinking':'#8a8fbd','--halo-waiting':'#d2a03c','--halo-error':'#bf5a6a',
      '--chair':'#c8c6b8','--desk':'#7d6238','--desk-front':'#96784c','--desk-drawer':'#866c42',
      '--monitor-stand':'#62687a','--monitor-frame':'#3e4156','--laptop':'#767b8e',
      '--screen-working':'#e6edf6','--screen-thinking':'#eae8f3','--screen-waiting':'#f6eed6','--screen-idle':'#d4d6d2','--screen-error':'#f6e2e2','--screen-done':'#e0eee4',
      '--bar-sage':'#8fa9a0','--bar-blue':'#5f7fae','--bar-blue-2':'#a2b4d0',
      '--bubble-line':'#c2c8e0','--think-dot':'#8a8fbd',
      '--cup':'#f2f0e6','--cup-line':'#b8ae8e','--steam':'#a2a096',
      '--plant-mid':'#92b294','--plant-dark':'#779c7a','--plant-light':'#a6c2a8','--pot':'#8a6f4c',
      '--link':'#9aa4b0','--star':'#d2a03c',
      '--door-bg':'#ece6d8','--door-line':'#a89a78','--door-leaf':'#b8a272','--door-leaf-line':'#96845c','--door-knob':'#6e5c34','--door-panel':'#e2d8bc',
      '--brand-mark':'#3e4f8e','--brand-bg':'#dde2ee','--focus':'#4a5fa0',
      '--sel-border':'#7d94c2','--sel-ring':'#d6deee','--sel-ring-2':'#dde4f0','--stat-sel-border':'#8b9cc0','--stat-sel-ring':'#dde4f0',
      '--avatar-bg':'#e2e4ec','--walker-bg':'#fbfaf6','--drop':'#7d94c2','--drop-bg':'rgb(232 236 246 / .93)','--drop-ink':'#2a3a66',
      '--badge-idle':'#b6b4a4','--place-busy':'#a8b8d4',
      '--tint-sage':'#e6ece6','--wall-sage':'#cfd8ce','--tint-blue':'#e6eaf2','--wall-blue':'#ccd5e4','--tint-sand':'#eeeade','--wall-sand':'#ddd6bc','--tint-clay':'#eee6e2','--wall-clay':'#ddd0c8',
      '--cwall-sage':'#b2c2b4','--cwall-blue':'#aebcce','--cwall-sand':'#c9c29e','--cwall-clay':'#c9bcb0',
      '--pb-working':'#dee6f2','--pc-working':'#2a4268','--pb-thinking':'#e6e4f2','--pc-thinking':'#41407a',
      '--pb-waiting':'#f6ecd0','--pc-waiting':'#7a5c0e','--pb-idle':'#e8e6dc','--pc-idle':'#585650',
      '--pb-error':'#f6e2e4','--pc-error':'#8e3642','--pb-done':'#ddeee0','--pc-done':'#2f6240',
      '--proto-line':'#ead5a8',
      '--ic-read':'#52688c','--ic-edit':'#7d814e','--ic-run':'#3e5f90','--ic-search':'#867040','--ic-tool':'#6e7286',
    },
    art:{
      /* a crown: three points and a base band */
      'hair-acc':'<path d="M66 32l2.6-6 3.6 4.4L74 25l1.8 5.4 3.6-4.4 2.6 6z" fill="#d9b23c"/><rect x="65.5" y="32" width="17" height="2.4" rx="1.2" fill="#c49a2e"/>',
      'plant':'<path d="M13 3l7 9h-14z" fill="var(--plant-dark)"/><path d="M13 8l6 8H7z" fill="var(--plant-mid)"/><path d="M8 21h10l-1.5 8h-7z" fill="var(--pot)"/>',
    },
    words:{'place-library':'The Archive','place-software':'The Atelier','place-terminal':'The Engine Room','place-web':'The Signal Tower','place-other':'The Pantry','lobby-label':'The court: the places where agents work'},
    motion:{preset:'court'},
  });

  /* ---- 039c: Durbar — Japanese court (indigo, vermilion, rice paper) ---- */
  registerBuiltIn({
    id:'durbar-japanese', name:'Durbar · Japanese Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    tokens:{
      '--bg':'#f3f1eb','--surface':'#fbfaf5','--surface-2':'#f5f3ec','--line':'#dcd8cc','--line-2':'#c8c3b4',
      '--ink':'#262a38','--ink-2':'#464c62','--muted':'#646878','--room-path':'#50546a',
      '--sage':'#8aa88e','--sage-ink':'#3c6244','--blue':'#5878ac','--blue-ink':'#2c4a78','--amber':'#d29838','--amber-ink':'#7a580e',
      '--red':'#c24a42','--red-ink':'#8c2e26','--green':'#5c9a70','--gray':'#9c9886',
      '--c-working':'#5878ac','--c-thinking':'#8b90bc','--c-waiting':'#d29838','--c-idle':'#a8a496','--c-error':'#c24a42','--c-done':'#5c9a70',
      '--halo-working':'#5878ac','--halo-thinking':'#8b90bc','--halo-waiting':'#d29838','--halo-error':'#c24a42',
      '--chair':'#c3bca8','--desk':'#3d3a34','--desk-front':'#54504a','--desk-drawer':'#484540',
      '--monitor-stand':'#5e626e','--monitor-frame':'#363a46','--laptop':'#6e7380',
      '--screen-working':'#e7eef8','--screen-thinking':'#eae9f2','--screen-waiting':'#f7eed4','--screen-idle':'#d5d6ce','--screen-error':'#f6e2dc','--screen-done':'#e1efe2',
      '--bar-sage':'#8aa88e','--bar-blue':'#5878ac','--bar-blue-2':'#9cb2d4',
      '--face-dark':'#262430','--mouth':'#7c443a',
      '--bubble-line':'#c4c8e0','--think-dot':'#8b90bc',
      '--plant-mid':'#96b296','--plant-dark':'#7a9a7a','--plant-light':'#aabf9f','--pot':'#9a4a44',
      '--link':'#9aa0ac','--star':'#d29838',
      '--door-bg':'#e9e3d3','--door-line':'#a39874','--door-leaf':'#c0ab7c','--door-leaf-line':'#9c8c62','--door-knob':'#6e5c36','--door-panel':'#ddd2b8',
      '--brand-mark':'#38498c','--brand-bg':'#dee0ec','--focus':'#3a6aa0',
      '--sel-border':'#7d90bc','--sel-ring':'#d8deea','--sel-ring-2':'#dee3ee','--stat-sel-border':'#8c9abc','--stat-sel-ring':'#dee3ee',
      '--avatar-bg':'#e2e2da','--walker-bg':'#fbfaf2','--drop':'#7d90bc','--drop-bg':'rgb(233 236 246 / .93)','--drop-ink':'#2a3c64',
      '--badge-idle':'#b8b4a2','--place-busy':'#aab6ce',
      '--tint-sage':'#e6ebe2','--wall-sage':'#ced6c4','--tint-blue':'#e6eaf2','--wall-blue':'#ccd4e4','--tint-sand':'#ece8dc','--wall-sand':'#dad4bc','--tint-clay':'#eee6e0','--wall-clay':'#dccec2',
      '--cwall-sage':'#b2c0a8','--cwall-blue':'#aebad0','--cwall-sand':'#c6bd9a','--cwall-clay':'#c8b8a6',
      '--pb-working':'#dfe6f2','--pc-working':'#28466e','--pb-thinking':'#e6e4f2','--pc-thinking':'#41427c',
      '--pb-waiting':'#f7ecd1','--pc-waiting':'#7a580e','--pb-idle':'#e8e5da','--pc-idle':'#565450',
      '--pb-error':'#f6e1dc','--pc-error':'#8c2e26','--pb-done':'#deeddc','--pc-done':'#2e6038',
      '--proto-line':'#ead3a4',
      '--ic-read':'#4e6c92','--ic-edit':'#7c804e','--ic-run':'#40548e','--ic-search':'#846c3c','--ic-tool':'#6c7080',
    },
    art:{
      /* a kanzashi hair pin: a bar across the bun line with a small blossom dot */
      'hair-acc':'<rect x="62" y="33" width="24" height="2.2" rx="1.1" fill="#c2a04a"/><circle cx="86.5" cy="30.5" r="2.6" fill="#c24a42"/><circle cx="86.5" cy="30.5" r="1.1" fill="#f2d98c"/>',
      'plant':'<path d="M13 4C10 10 8 14 8 18h10c0-4-2-8-5-14z" fill="var(--plant-dark)"/><circle cx="8" cy="15" r="2.4" fill="var(--plant-mid)"/><circle cx="18" cy="16" r="2.2" fill="var(--plant-light)"/><path d="M8 21h10l-1.5 8h-7z" fill="var(--pot)"/>',
    },
    words:{'place-library':'The Library','place-software':'The Workshop','place-terminal':'The Machine Room','place-web':'The Radio Room','place-other':'Odd Jobs','lobby-label':'The tea hall: the places where agents work'},
    motion:{preset:'court'},
  });

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
    motion,
    list,
    onChange,
    themeIdForCache,
    registerBuiltIn,
    registerUserThemes,
    MOTION_PRESETS,
    _sanitizeSlot:sanitizeSlot,
    _validateManifest:validateManifest,
    _compilePixelMap:compilePixelMap,
    _tokens(){return resolveTokens(currentManifest);},
    _builtins(){return BUILT_IN;},
  };
}));
