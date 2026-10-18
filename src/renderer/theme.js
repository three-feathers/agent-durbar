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
  const CELL_RE=/^[1-9]\d{0,1}$/;
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
    art:{
      /* suit collar + tie under the neck, briefcase on the desk, glass wall with a skyline, blinds,
         floor sheen lanes, steel frame in the lobby, corporate signage on the place tiles */
      'char-body':'<path d="M65 99V86l9-13.5 4 2-5.6 10.4V99zM83 99V84.9l-5.6-10.4 4-2 9 13.5V99z" fill="#45566a"/><path d="M72.6 74.4 74 69.5l1.4 4.9-1.4 10.5z" fill="#7a2f3a"/><path d="M72.6 74.4 74 69.5l1.4 4.9" fill="#8e3a32"/>',
      'desk-art':'<rect x="160" y="70" width="20" height="13.5" rx="2" fill="#4b5563"/><rect x="160" y="70" width="20" height="2.2" fill="#5f6d77"/><rect x="168" y="67.5" width="4" height="2.8" rx="1.4" fill="#4b5563"/><rect x="174.5" y="72" width="3" height="4" rx="1" fill="#2c3733" opacity=".25"/>',
      'monitor-art':'<rect x="112" y="32" width="64" height="5" rx="2" fill="#3d4751" opacity=".6"/>',
      /* glass wall + skyline silhouette (right side) and blinds hints (left) */
      'room-back-wall':'<rect x="2" y="3" width="128" height="30" rx="2" fill="#cdd8e2" opacity=".55"/><path d="M2 33V20 33ZM8 33V16h6v17ZM17 33V11h5v22ZM25 33V18h7v15ZM35 33V8h5v25ZM43 33V15h6v18ZM52 33V21h5v12ZM60 33V12h4v21ZM67 33V17h6v16ZM76 33V23h4v10ZM83 33V14h5v19ZM91 33V19h6v14ZM100 33V10h4v23ZM107 33V17h6v16ZM116 33V22h5v11ZM124 33V15h6v18Z" fill="#8fa3b4" opacity=".5"/><path d="M0 3h132M0 12h132M0 22h132" stroke="#ffffff" stroke-width=".8" opacity=".5"/><path d="M2 6h38M2 9h38M2 12h38M2 15h38M2 18h38" stroke="#a7b7c4" stroke-width="1" opacity=".6"/>',
      'room-floor':'<path d="M4 112l40 -34h8l-40 34ZM300 112l-40 -34h-8l40 34ZM140 112l20 -34h4l-20 34ZM180 112l-20 -34h-4l20 34" fill="#ffffff" opacity=".35"/>',
      'door-art':'<rect x="6" y="5" width="8" height="1.4" rx=".7" fill="#a8b4bf"/><rect x="6" y="8.4" width="8" height="1.4" rx=".7" fill="#a8b4bf"/><rect x="6" y="11.8" width="8" height="1.4" rx=".7" fill="#a8b4bf"/><rect x="11.6" y="2.5" width="1.6" height="15" fill="#9aa9b8" opacity=".7"/>',
      'lobby-art':'<path d="M0 7h320M0 29h320" stroke="#b9c6d2" stroke-width="1" opacity=".6"/><path d="M12 7v22M308 7v22" stroke="#b9c6d2" stroke-width="1.2" opacity=".5"/>',
      'place-library':'<path d="M3 16.5V4h3.5v12.5zM6.5 16.5V6h3.5v10.5zM10.5 16.5l3-11.5 3.4.9-3 11.4zM2 16.5h16"/><path d="M15.5 4h2v12.5h-2z" opacity=".55"/>',
      'place-software':'<rect x="3" y="3.5" width="14" height="5" rx="1.5"/><rect x="3" y="11.5" width="14" height="5" rx="1.5"/><path d="M6 6h.01M6 14h.01M10 6h4M10 14h4"/><path d="M17 3.5v13" opacity=".4"/>',
      'place-terminal':'<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8l3 2.5L6 13M11 13h3.5"/><circle cx="15" cy="6" r="1" opacity=".7"/>',
      'place-web':'<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.2 2.5 11.8 0 14M10 3c-2.5 2.2-2.5 11.8 0 14"/><circle cx="14.5" cy="5.5" r="1.2" opacity=".7"/>',
      'place-other':'<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.4M10 15.1v2.4M2.5 10h2.4M15.1 10h2.4M4.7 4.7l1.7 1.7M13.6 13.6l1.7 1.7M15.3 4.7l-1.7 1.7M6.4 13.6l-1.7 1.7"/>',
    },
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
      /* Full PIXEL art (owner review, PR #137): an 8-bit figure over the torso (under the round head,
         so hair/hair-acc still work), a stepped pixel desk rim + floppy disk, a CRT monitor with
         scanlines, a scanline brick wall and an arcade-pattern floor, cabinet trim in the lobby. */
      'char-body':{cell:2,palette:{j:'#2f3455',b:'#23233a',s:'#f2d3a0',h:'#3a2e26',e:'#23233a'},rows:[
        '......hhhhh.......',
        '......hhhhh.......',
        '......sssss.......',
        '......sssss.......',
        '......essse.......',
        '......sssss.......',
        '.....jjjjjjj......',
        '....jbjjjjbj......',
        '....jjjjjjjj......',
        '....jsjjjjsj......',
        '....jjjjjjjj......',
        '....jjjjjjjj......',
        '....jjjjjjjj......',
        '.....jjjjjj.......',
        '.....jjjjjj.......',
        '.....bbbbb........',
        '.....bbbbb........',
      ]},
      'desk-back':{cell:2,palette:{d:'#5c4f3a',t:'#e0a92c'},rows:[
        'd'.repeat(30),
        'ttt'+'.'.repeat(24)+'ttt',
        'dddd'+'.'.repeat(26),
      ]},
      'desk-art':{cell:2,palette:{f:'#3c4266',l:'#e8e4d8',s:'#d8564a'},rows:[
        'fffffffff',
        'ffffffflf',
        'ffffffflf',
        'ffffffflf',
        'ffffffflf',
        'ffflfffsf',
      ]},
      'monitor-art':'<path d="M117 39h54M117 45h54M117 51h54M117 57h54M117 63h54M117 69h54" stroke="#000" stroke-width="1" opacity=".12"/><rect x="112" y="32" width="64" height="4" rx="2" fill="#333652"/><rect x="112" y="73" width="64" height="4" rx="2" fill="#333652"/><path d="M112 40v29M176 40v29" stroke="#23233a" stroke-width="2.4"/>',
      'room-back-wall':{cell:4,palette:{w:'#cfc6a8',k:'#b3a98f'},rows:[
        'w'.repeat(30),
        'wkwkwkwkwkwkwkwkwkwkwkwkwkwkwk',
        'w'.repeat(30),
        'kwkwkwkwkwkwkwkwkwkwkwkwkwkwkw',
        'w'.repeat(30),
        'wkwkwkwkwkwkwkwkwkwkwkwkwkwkwk',
        'w'.repeat(30),
        'kwkwkwkwkwkwkwkwkwkwkwkwkwkwkw',
        'w'.repeat(30),
        'wkwkwkwkwkwkwkwkwkwkwkwkwkwkwk',
      ]},
      'room-floor':{cell:3,palette:{f:'#c9bfa4',g:'#a89f86',a:'#3d9b58',r:'#d8564a',b:'#5f87c8'},rows:[
        'f'.repeat(30),
        'ffffgffffgffffgffffgffffgff',
        'f'.repeat(30),
        'fa'+'fffgffffgffffgfffffffr'.padEnd(28,'f'),
        'f'.repeat(30),
        'ffffgffffgffffgffffgffffgff',
        'f'.repeat(14)+'b'+'f'.repeat(15),
        'ffffgffffgffffgffffgffffgff',
        'f'.repeat(30),
        'fffffffr'+'fgffffgffffgffffgff',
        'f'.repeat(30),
        'ffffgffffgffffgffffgffffgff',
        'f'.repeat(22)+'a'+'f'.repeat(7),
        'ffffgffffgffffgffffgffffgff',
        'f'.repeat(30),
        'ffffgffffbffffgffffgffffgff',
        'f'.repeat(30),
      ]},
      'door-art':{cell:1,palette:{c:'#e0a92c',s:'#988a6c',b:'#23233a'},rows:[
        '..ccccccccc....',
        '.cssssssssc....',
        '.scsssssssc....',
        '.scssscsssc....',
        '.scsssssssc....',
        '.scsscssssc....',
        '.ccsscssscc....',
        '..ccccccccc....',
        '.........b.....',
        '.........bb....',
      ]},
      'lobby-art':{cell:3,palette:{l:'#a89f86',k:'#3a3c52',g:'#5fae76'},rows:[
        'l'.repeat(30),
        'k'+'.'.repeat(28)+'k',
        'g'.repeat(8)+'.'.repeat(22),
      ]},
      'place-library':'<rect x="3" y="11" width="14" height="3" fill="currentColor"/><rect x="5" y="7" width="10" height="3" fill="currentColor"/><rect x="7" y="3.5" width="6" height="3" fill="currentColor"/>',
      'place-software':'<rect x="3" y="4" width="4" height="4" fill="currentColor"/><rect x="9" y="4" width="4" height="4" fill="currentColor"/><rect x="3" y="10" width="4" height="4" fill="currentColor"/><rect x="9" y="10" width="4" height="4" fill="currentColor"/><rect x="15" y="4" width="2" height="10" fill="currentColor"/>',
      'place-terminal':'<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8h3v2.5H6zM9 10.5h3V13H9z"/><rect x="13" y="5" width="1.5" height="1.5" fill="currentColor"/>',
      'place-web':'<rect x="3" y="5" width="4" height="4" fill="currentColor"/><rect x="13" y="5" width="4" height="4" fill="currentColor"/><rect x="8" y="2.5" width="4" height="4" fill="currentColor"/><path d="M7 7h3v3H7zM13 7h-3v3h3z"/>',
      'place-other':'<circle cx="10" cy="10" r="2.6"/><rect x="9" y="2.5" width="2" height="2.4" fill="currentColor"/><rect x="9" y="15.1" width="2" height="2.4" fill="currentColor"/><rect x="2.5" y="9" width="2.4" height="2" fill="currentColor"/><rect x="15.1" y="9" width="2.4" height="2" fill="currentColor"/>',
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
      /* court attire: a sherwani/robe silhouette over the torso + sash; drawn before the head so hair/turban stay on top */
      'char-robe':'<path d="M60 99V79q0-9 9-12l5-1.5 5 1.5q9 3 9 12v20z" fill="#8c2f3e"/><path d="M69 66.5h10l-1 5h-8z" fill="#d9a441"/><path d="M59 97V85m30 12V85" stroke="#d9a441" stroke-width="1.4" opacity=".8"/><path d="M63 81l5 17M85 81l-5 17" stroke="#6e2230" stroke-width="1" opacity=".6"/>',
      'char-collar':'<path d="M71 66.4 74 70l3-3.6V99h-6V66.4z" fill="#f2e4c8" opacity=".92"/><circle cx="74" cy="70.5" r="1.1" fill="#8c2f3e"/>',
      'desk-art':'<rect x="112" y="80" width="64" height="6" rx="2" fill="#d9a441" opacity=".85"/><rect x="118" y="81.5" width="52" height="3" rx="1.5" fill="#8c2f3e" opacity=".8"/><path d="M112 86h64" stroke="#6e2230" stroke-width="1"/>',
      'desk-back':'<circle cx="14" cy="96" r="3.5" fill="#d9a441"/><circle cx="186" cy="96" r="3.5" fill="#d9a441"/><circle cx="14" cy="96" r="1.6" fill="#8c2f3e"/><circle cx="186" cy="96" r="1.6" fill="#8c2f3e"/>',
      'monitor-art':'<rect x="112" y="32" width="64" height="5" rx="2.5" fill="#6e5a2c" opacity=".5"/><circle cx="118" cy="34.5" r="1.2" fill="#d9a441"/><circle cx="170" cy="34.5" r="1.2" fill="#d9a441"/>',
      /* royal durbar hall: arched colonnade + jharokha panels on the wall, a rich carpet below */
      'room-back-wall':'<g fill="none" stroke="#b98a3c" stroke-width="2.4" opacity=".75"><path d="M8 118V50Q8 22 30 22Q52 22 52 50V118"/><path d="M134 118V50Q134 22 160 22Q186 22 186 50V118"/><path d="M268 118V50Q268 22 290 22Q312 22 312 50V118"/></g><path d="M8 44Q30 36 52 44M134 44Q160 36 186 44M268 44Q290 36 312 44" fill="none" stroke="#8c2f3e" stroke-width="1.6" opacity=".8"/><circle cx="30" cy="28" r="2.6" fill="#d9a441"/><circle cx="160" cy="28" r="2.6" fill="#d9a441"/><circle cx="290" cy="28" r="2.6" fill="#d9a441"/><path d="M60 30h62v16H60zM196 30h62v16h-62z" fill="#efe0c0" stroke="#b98a3c" stroke-width="1.2" opacity=".8"/><path d="M64 34h54M64 38h54M64 42h54M200 34h50M200 38h50M200 42h50" stroke="#c9a85c" stroke-width=".8" opacity=".7"/>',
      'room-floor':'<path d="M40 118L80 52h168l40 66z" fill="#8c2f3e" opacity=".9"/><path d="M50 118L86 58h156l36 60" fill="none" stroke="#d9a441" stroke-width="2.4"/><path d="M58 118L90 64h148l32 54" fill="none" stroke="#e8d0a0" stroke-width="1.2" stroke-dasharray="6 4" opacity=".8"/><path d="M78 94h172" stroke="#d9a441" stroke-width="1.4" opacity=".7"/><path d="M70 106h188" stroke="#d9a441" stroke-width="1.1" opacity=".55"/>',
      'door-art':'<path d="M9.6 2.5Q9.6 6.6 6.4 8.2M10.2 2.5Q10.2 6.9 7.4 9" fill="none" stroke="#a98b62" stroke-width=".9"/><circle cx="13.6" cy="4.4" r=".9" fill="#d9a441"/><circle cx="13.6" cy="4.4" r=".45" fill="#8c2f3e"/>',
      'lobby-art':'<path d="M0 33h320" stroke="#b98a3c" stroke-width="1.6" opacity=".7"/><path d="M0 30h320" stroke="#e3d0a8" stroke-width=".9" stroke-dasharray="10 6" opacity=".7"/><path d="M20 30Q24 18 30 30M290 30Q296 18 300 30" fill="none" stroke="#8c2f3e" stroke-width="1.4" opacity=".8"/>',
      'place-library':'<path d="M4 17V8Q10 4 16 8v9z"/><path d="M4 17h12M7 8v9M13 8v9"/><circle cx="10" cy="6.4" r="1" opacity=".8"/>',
      'place-software':'<path d="M4 17V7q6-3.6 12 0v10z"/><path d="M4 12h12M8 4.5V17M12 4.5V17"/>',
      'place-terminal':'<path d="M3 17V9Q10 3.5 17 9v8z"/><path d="M6.5 11h7M6.5 14h7"/>',
      'place-web':'<circle cx="10" cy="10" r="6.6"/><path d="M3.4 10h13.2M10 3.4q3.6 3.2 0 13.2M10 3.4q-3.6 3.2 0 13.2"/>',
      'place-other':'<path d="M10 3l2.2 4.6L17 8.6l-3.7 3.4 1 5-4.3-2.6L5.7 17l1-5L3 8.6l4.8-1z"/>',
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
      /* ermine-look collar + a gown skirt over the torso (fur spots are abstract dots, no heraldry) */
      'char-collar':'<path d="M66 68q4-4.4 8-4.4t8 4.4l-3.5 4.5h-9z" fill="#efe9dc"/><circle cx="68.5" cy="67" r="1" fill="#4a4a68"/><circle cx="74" cy="69" r="1" fill="#4a4a68"/><circle cx="79.5" cy="67" r="1" fill="#4a4a68"/>',
      'char-robe':'<path d="M61 99V84q0-10 13-11 13 1 13 11v15z" fill="#4a3060" opacity=".9"/><path d="M63 82q11-7 22 0" fill="none" stroke="#d9b23c" stroke-width="1.8"/><path d="M61 96q13-4 26 0" fill="none" stroke="#d9b23c" stroke-width="1.2" opacity=".8"/>',
      'desk-art':'<rect x="112" y="81" width="64" height="4.6" rx="2" fill="#d9b23c" opacity=".8"/><path d="M120 83.3h13M141 83.3h13M162 83.3h10" stroke="#7d6238" stroke-width="1.4"/>',
      'desk-back':'<circle cx="14" cy="96" r="3.2" fill="#7d6238"/><circle cx="186" cy="96" r="3.2" fill="#7d6238"/><circle cx="14" cy="96" r="1.4" fill="#d9b23c"/><circle cx="186" cy="96" r="1.4" fill="#d9b23c"/>',
      'monitor-art':'<rect x="112" y="32" width="64" height="4.4" rx="2" fill="#3e4156" opacity=".7"/><circle cx="118" cy="34.2" r="1.1" fill="#d9b23c"/><circle cx="170" cy="34.2" r="1.1" fill="#d9b23c"/>',
      /* English royal courtroom: panelled walls + portrait frames + chandelier hints, a long carpet aisle */
      'room-back-wall':'<g fill="none" stroke="#9aa4b8" stroke-width="1.4" opacity=".6"><rect x="14" y="16" width="86" height="44" rx="2"/><rect x="118" y="16" width="86" height="44" rx="2"/><rect x="222" y="16" width="86" height="44" rx="2"/></g><g fill="#e4d9c0" stroke="#8a7a52" stroke-width="1.2"><rect x="34" y="24" width="20" height="26" rx="1.5"/><rect x="138" y="24" width="20" height="26" rx="1.5"/><rect x="242" y="24" width="20" height="26" rx="1.5"/><rect x="290" y="24" width="12" height="26" rx="1.5"/></g><circle cx="44" cy="37" r="4" fill="#b9ab8a"/><circle cx="148" cy="37" r="4" fill="#b9ab8a"/><circle cx="252" cy="37" r="4" fill="#b9ab8a"/><path d="M150 6q10 4 20 0M150 6q10 4 20 0" fill="none" stroke="#c9a85c" stroke-width="1.2"/><path d="M160 4v8M156 12l4-4 4 4" fill="none" stroke="#c9a85c" stroke-width="1.2"/><circle cx="156" cy="13" r="1.4" fill="#e8d9a8"/><circle cx="164" cy="13" r="1.4" fill="#e8d9a8"/><circle cx="160" cy="15" r="1.4" fill="#e8d9a8"/>',
      'room-floor':'<path d="M50 118L92 54h144l42 64z" fill="#37527a" opacity=".9"/><path d="M60 118L98 62h132l38 56" fill="none" stroke="#d9b23c" stroke-width="2.6"/><path d="M68 118L102 68h124l34 50" fill="none" stroke="#e8d9a8" stroke-width="1.1" stroke-dasharray="8 5" opacity=".75"/><path d="M84 96h160" stroke="#d9b23c" stroke-width="1.3" opacity=".65"/>',
      'door-art':'<path d="M5.6 6.4h8.8M5.6 9h8.8" stroke="#96845c" stroke-width=".9"/><rect x="5.2" y="3.6" width="9.6" height="8.2" rx=".8" fill="none" stroke="#96845c" stroke-width=".8"/><circle cx="13.2" cy="13.2" r=".8" fill="#d9b23c"/>',
      'lobby-art':'<path d="M0 32h320" stroke="#c9a85c" stroke-width="1.5" opacity=".7"/><path d="M0 29h320" stroke="#8a7a52" stroke-width=".8" stroke-dasharray="12 6" opacity=".6"/><rect x="18" y="8" width="16" height="12" rx="1.5" fill="#e4d9c0" stroke="#8a7a52" stroke-width="1"/><rect x="286" y="8" width="16" height="12" rx="1.5" fill="#e4d9c0" stroke="#8a7a52" stroke-width="1"/>',
      'place-library':'<path d="M4 17V5h5v12zM9 17V7h5v10M14 17l2.8-11 2.6 1-2.8 10"/><path d="M3 17h14"/>',
      'place-software':'<rect x="4" y="4" width="12" height="4.4" rx="1.4"/><rect x="4" y="11.6" width="12" height="4.4" rx="1.4"/><path d="M6.5 6.2h.01M6.5 13.8h.01"/>',
      'place-terminal':'<path d="M3 17V6h14v11z"/><path d="M6 9l3 2.6-3 2.6M11 14h3.4"/>',
      'place-web':'<circle cx="10" cy="10" r="6.4"/><path d="M3.6 10h12.8M10 3.6q3.4 3 0 12.8M10 3.6q-3.4 3 0 12.8"/>',
      'place-other':'<path d="M10 4.2l1.8 3.8 4.2.6-3 3 .7 4.2-3.7-2-3.7 2 .7-4.2-3-3 4.2-.6z"/>',
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
      /* kimono silhouette over the torso: wide sleeves and an obi band */
      'char-robe':'<path d="M57 84q0-10 17-11 17 1 17 11l3 15H54z" fill="#38498c"/><path d="M54 84.5q9.5-5.6 20-5.6t20 5.6" fill="none" stroke="#c24a42" stroke-width="1.6" opacity=".85"/><rect x="66" y="86" width="16" height="6.6" rx="1" fill="#c2a04a"/><rect x="72.6" y="86" width="2.8" height="6.6" fill="#c24a42" opacity=".85"/>',
      'char-collar':'<path d="M69.4 66.2 74 70.4l4.6-4.2-1 5.4h-7.2z" fill="#e8e2d2"/>',
      /* low desk: a flat lacquer slab under the drawn desk; no height change */
      'desk-art':'<rect x="112" y="82.5" width="64" height="10.5" rx="2.4" fill="#2c2a26"/><rect x="114" y="84.5" width="60" height="1.6" rx=".8" fill="#c24a42" opacity=".8"/><rect x="114" y="88" width="60" height="1.2" rx=".6" fill="#c2a04a" opacity=".6"/>',
      'desk-back':'<circle cx="14" cy="97" r="3" fill="#2c2a26"/><circle cx="186" cy="97" r="3" fill="#2c2a26"/><circle cx="14" cy="97" r="1.3" fill="#c2a04a"/><circle cx="186" cy="97" r="1.3" fill="#c2a04a"/>',
      'monitor-art':'<rect x="112" y="32" width="64" height="4.2" rx="2" fill="#2c2a26" opacity=".8"/><rect x="118" y="33.4" width="8" height="1.4" rx=".7" fill="#c24a42" opacity=".9"/><rect x="162" y="33.4" width="8" height="1.4" rx=".7" fill="#c2a04a" opacity=".8"/>',
      /* tatami floor (woven mats), shoji screen wall panels, hanging scroll hints */
      'room-back-wall':'<g fill="#f3efe2" stroke="#a89a74" stroke-width="1.6" opacity=".92"><rect x="16" y="14" width="76" height="52" rx="1.5"/><rect x="104" y="14" width="76" height="52" rx="1.5"/><rect x="192" y="14" width="76" height="52" rx="1.5"/><rect x="280" y="14" width="28" height="52" rx="1.5"/></g><g stroke="#c2b48e" stroke-width=".8" opacity=".75"><path d="M35 14v52M54 14v52M73 14v52M123 14v52M142 14v52M161 14v52M211 14v52M230 14v52M249 14v52M290 14v52M299 14v52M16 31h76M16 48h76M104 31h76M104 48h76M192 31h76M192 48h76M280 31h28M280 48h28"/></g><rect x="94" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/><rect x="182" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/><rect x="270" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/>',
      'room-floor':'<g opacity=".9"><rect x="24" y="74" width="120" height="22" rx="2" fill="#d8cfae" stroke="#a89a74" stroke-width="1.4"/><rect x="156" y="74" width="120" height="22" rx="2" fill="#cfc5a0" stroke="#a89a74" stroke-width="1.4"/><rect x="24" y="98" width="120" height="22" rx="2" fill="#cfc5a0" stroke="#a89a74" stroke-width="1.4"/><rect x="156" y="98" width="120" height="22" rx="2" fill="#d8cfae" stroke="#a89a74" stroke-width="1.4"/></g><path d="M84 74v22M84 98v22M216 74v22M216 98v22" stroke="#b3a582" stroke-width=".9" stroke-dasharray="4 4" opacity=".8"/>',
      'door-art':'<rect x="5.6" y="3.8" width="8.8" height="12.4" rx=".8" fill="none" stroke="#9c8c62" stroke-width=".9"/><path d="M8 3.8v12.4M11.6 3.8v12.4M5.6 8h8.8M5.6 12.2h8.8" stroke="#c2b48e" stroke-width=".6"/>',
      'lobby-art':'<path d="M0 32h320" stroke="#a89a74" stroke-width="1.5" opacity=".7"/><path d="M30 32V12M60 32V12M90 32V12M230 32V12M260 32V12M290 32V12" stroke="#c2b48e" stroke-width=".9" opacity=".55"/><rect x="140" y="6" width="40" height="10" rx="2" fill="none" stroke="#8a7a52" stroke-width="1.1" opacity=".7"/><path d="M144 11h32" stroke="#c24a42" stroke-width="1.3" opacity=".75"/>',
      'place-library':'<path d="M4 17V6h5v11zM9 17V8h5v9z"/><path d="M14 16.6l1.5-9.4 2.8 1-1.6 9.4"/><path d="M3.4 17h13.4"/>',
      'place-software':'<rect x="4" y="5" width="12" height="3.6" rx="1.2"/><rect x="4" y="11" width="12" height="3.6" rx="1.2"/><path d="M6.5 6.8h.01M6.5 12.8h.01M10 6.8h3.4M10 12.8h3.4"/>',
      'place-terminal':'<rect x="3" y="5.5" width="14" height="9.5" rx="1.6"/><path d="M6 8.6l2.8 2.4-2.8 2.4M10.6 13.4h3"/>',
      'place-web':'<circle cx="10" cy="10" r="6.2"/><path d="M4 10h12M10 3.8q3.3 3 0 12.4M10 3.8q-3.3 3 0 12.4"/>',
      'place-other':'<path d="M7 16.6V9.8L10 5.4l3 4.4v6.8"/><path d="M7 13h6"/>',
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
