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
    '--bg':'#f7f6f3', // spec 052 FR-024: warm neutral (was #f6f3ee)
    '--surface':'#fffdf9','--raised':'#ffffff','--card':'#fffdf9','--card-waiting':'#fef5e0','--card-waiting-line':'#e3bd75','--card-error':'#fcefec','--card-error-line':'#e2b6b0','--soft':'#fbf9f4','--note':'#f4f0e6','--warn-bg':'#fdf3df','--bad-bg':'#f9ece9',
    '--surface-2':'#faf7f1',
    '--line':'#e7e3dc', // spec 052 FR-024: warm neutral (was #e2dbcf)
    '--line-2':'#d3cabb',
    '--line-ctl':'#8a8272', // spec 052 FR-052: input, select and add-button borders at 3:1 on every surface
    '--focus-halo':'transparent', // spec 052 FR-052: the second tone of the focus ring (retro sets it)
    '--ink':'#2c3733',
    '--ink-2':'#56605b',
    '--muted':'#535a55', // spec 052 FR-009: 4.5:1 on every room wall (was #6a716c)
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
    '--desk-needs':'#b45309', // spec 001 FR-178: the outline of a desk that needs you (amber-orange, 4.4:1 or more on every card; not the green of New, not the red of an error)
    '--desk-new':'#12783a', // spec 001 FR-178: the outline of a desk with a new reply (4.3:1 or more on every card and room tint)

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
    '--focus':'#2f5f8a', // spec 052 FR-009: 3:1 on every surface (was #4f7fa8)
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

    /* the crew kit's own accents (spec 077, Characters = Cheeky): trim and outline colours of its furniture and, later, its characters */
    '--crew-ink':'#3a3331',
    '--crew-accent':'#d9577a',
    '--crew-accent-2':'#2f9c95',
  };

  /* ---------- Art slots: Clean Office defaults ----------
     Only the room plant has a default drawing here; every other slot (ART_SLOTS) is empty in Clean Office, so the
     renderer draws its own default. People and furniture come from scene kits (spec 035 FR-013). */
  const CLEAN_SLOTS={
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
    'place-coffee':'Coffee corner',  /* spec 068: where an agent waits while its usage limit resets */
    'place-boss':'Boss',             /* spec 001 FR-034: where agents with a question or a permission queue */
    'place-bank':'Bank',             /* spec 001 FR-035: where an agent waits at Durbar's spending limit */
    'place-postbox':'Postbox',       /* spec 001 FR-038: the next scheduled runs */
    'boss-note':'Went to see the boss', /* spec 001 FR-034: the empty desk's note */
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
    'reduced':{bar:'none',glow:'none',halo:'none',wave:'none',cursor:'none'},
  };

  /* ---------- Manifest validation ---------- */
  const SLOT_TAG_RE=/^\s*(g|path|rect|circle|ellipse|line|polyline|polygon|text)\s*$/i;
  const VOID_TAG_RE=/^\s*(rect|circle|ellipse|line|polyline|polygon|path)\s*$/i;
  const ATTR_BLACKLIST_RE=/^(on[a-z]+|href|xlink:href|style)$/i;
  const SVG_WHITELIST=['xmlns','viewBox','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','opacity','rx','ry','cx','cy','r','x','y','x1','y1','x2','y2','points','d','transform','class','aria-hidden','focusable'];

  /* Art slots come from user themes too (spec 040 FR-005), so the fragment is never passed through: it is
     tokenized, every tag and attribute checked, and the output rebuilt from the parts with values escaped.
     Only whitespace may sit between tags (kept as is, so canonical built-ins come out byte-identical). */
  const SLOT_TOKEN_RE=/<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"<>`]*"|'[^'<>`]*'))*)\s*(\/?)>/y;
  const SLOT_ATTR_RE=/\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const escAttr=v=>v.replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function sanitizeSlot(svg){
    if(typeof svg!=='string' || !svg.trim()) return null;
    const src=svg.trim();
    const stack=[];
    let i=0, out='';
    while(i<src.length){
      const ws=/^\s*/.exec(src.slice(i))[0];
      out+=ws; i+=ws.length;
      if(i>=src.length) break;
      SLOT_TOKEN_RE.lastIndex=i;
      const m=SLOT_TOKEN_RE.exec(src);
      if(!m) return null; /* text, an unquoted value, a comment, CDATA, a stray < or > */
      i=SLOT_TOKEN_RE.lastIndex;
      const closing=m[1], tag=m[2].toLowerCase(), attrs=m[3], selfClose=m[4];
      if(!SLOT_TAG_RE.test(tag)) return null;
      if(closing){
        if(attrs.trim()||selfClose||stack.pop()!==tag) return null;
        out+='</'+m[2]+'>';
        continue;
      }
      let rebuilt='<'+m[2];
      SLOT_ATTR_RE.lastIndex=0;
      let am;
      while((am=SLOT_ATTR_RE.exec(attrs))!==null){
        const name=am[1].toLowerCase();
        const value=am[2]!==undefined?am[2]:am[3];
        if(ATTR_BLACKLIST_RE.test(name)) return null;
        if(!SVG_WHITELIST.includes(name) && !name.startsWith('data-')) return null;
        if(/javascript:/i.test(value) || /\bon\w+\s*=/i.test(value)) return null;
        if(/url\s*\(/i.test(value) && !/^\s*url\(#[A-Za-z][\w-]*\)\s*$/.test(value)) return null; /* local paint references only */
        rebuilt+=' '+am[1]+'="'+escAttr(value)+'"';
      }
      if(selfClose) out+=rebuilt+'/>';
      else if(VOID_TAG_RE.test(tag)) return null; /* an unclosed <rect> would swallow what follows in innerHTML */
      else { stack.push(tag); out+=rebuilt+'>'; }
    }
    if(stack.length) return null;
    return out||null;
  }

  /* A token value (spec 040 FR-006): a colour, a number with an optional unit, or one keyword. No quotes, <, >, ;, braces or url(). */
  const TOKEN_VALUE_RE=/^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9a-z., %\/+-]*\)|-?[0-9]*\.?[0-9]+(px|em|rem|%|s|ms|deg)?|[a-z][a-z-]*)$/i;
  const isTokenValue=v=>typeof v==='string' && v.trim().length<=64 && TOKEN_VALUE_RE.test(v.trim());

  /* ---------- spec 070: typed tokens besides the colours ----------
     Fonts (system fonts from an allow-list only: no URL, no font file), the title weight, radii and shadows. They are set on <html>
     only when a pack gives them, so the CSS defaults (styles.css :root) and a UI style's display font (themes.css) apply otherwise.
     Sizes, spacing and borders are not themeable (spec 070 D2). Same lists and grammar as src/shared/themetokens.ts (test:theme-tokens). */
  const FONT_GENERIC=['system-ui','sans-serif','serif','monospace','ui-monospace','ui-serif','ui-sans-serif','ui-rounded'];
  const FONT_ALLOW=FONT_GENERIC.concat(['-apple-system','BlinkMacSystemFont','Segoe UI','Helvetica Neue','Helvetica','Arial','Verdana','Tahoma',
    'Trebuchet MS','Georgia','Palatino Linotype','Palatino','Book Antiqua','URW Palladio L','P052','Times New Roman','Garamond','EB Garamond',
    'Baskerville','Baskerville Old Face','Libre Baskerville','Cambria','Calibri','Candara','Corbel','Gill Sans','Optima','Futura','Avenir',
    'Avenir Next','Didot','American Typewriter','Courier New','Consolas','Menlo','Monaco','SF Mono','SFMono-Regular','Cascadia Mono',
    'Cascadia Code','Roboto','Noto Sans','Noto Serif','DejaVu Sans','DejaVu Serif','DejaVu Sans Mono','Liberation Sans','Liberation Serif',
    'Liberation Mono','Ubuntu','Ubuntu Mono','Cantarell','Comic Neue','Hiragino Mincho ProN','Yu Mincho','YuMincho','Noto Serif CJK JP',
    'Noto Serif JP','Source Han Serif']);
  /* own-property lookups only: a name such as constructor or __proto__ must not reach Object.prototype (review on #500) */
  const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
  const FONT_INDEX=Object.create(null);FONT_ALLOW.forEach(f=>{FONT_INDEX[f.toLowerCase()]=f;});
  const TYPED_TOKENS={
    '--font':{type:'font',def:'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',generic:'sans-serif'},
    '--ui-display':{type:'font',def:'system-ui',generic:'system-ui'},
    '--font-mono':{type:'font',def:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',generic:'monospace'},
    '--t1-weight':{type:'weight',def:'650'},
    '--r-sm':{type:'radius',def:'6px'},'--r-md':{type:'radius',def:'10px'},'--r-lg':{type:'radius',def:'14px'},'--r-xl':{type:'radius',def:'18px'},
    '--radius':{type:'radius',def:'16px'},
    '--shadow-card':{type:'shadow',def:'none'},'--shadow-pop':{type:'shadow',def:'0 14px 40px rgba(40,35,25,.22)'},
  };
  const TCOLOR_RE=/^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgb|rgba|hsl|hsla)\((?:[0-9.%\s,\/+-]|deg)+\)|transparent)$/i;
  const LEN_RE=/^(-?\d{1,2}(?:\.\d{1,2})?px|0)$/;
  const lenPx=v=>v==='0'?0:parseFloat(v);
  function fontStack(v,generic){
    const names=String(v).split(',').map(x=>x.trim()).filter(Boolean);
    if(!names.length||names.length>8)return null;
    const out=[];
    for(let n of names){
      const q=/^(["'])(.*)\1$/.exec(n); if(q)n=q[2].trim();
      if(!/^[A-Za-z0-9 -]{1,40}$/.test(n))return null;
      const canon=own(FONT_INDEX,n.toLowerCase())?FONT_INDEX[n.toLowerCase()]:null; if(!canon)return null;
      out.push(/\s/.test(canon)?'"'+canon+'"':canon);
    }
    if(!out.some(n=>FONT_GENERIC.includes(n)))out.push(generic);
    return out.join(',');
  }
  function shadowValue(v){
    if(v==='none')return v;
    const layers=v.split(/,(?![^(]*\))/).map(x=>x.trim());
    if(!layers.length||layers.length>2)return null;
    for(const l of layers){
      const parts=l.split(/\s+(?![^(]*\))/);
      if(parts[0]==='inset')parts.shift();
      const color=parts.pop(), lens=parts;
      if(!color||!TCOLOR_RE.test(color)||(lens.length!==3&&lens.length!==4)||!lens.every(x=>LEN_RE.test(x)))return null;
      const [x,y,b,sp]=lens.map(lenPx);
      if(Math.abs(x)>40||Math.abs(y)>40||b<0||b>64||(sp!==undefined&&Math.abs(sp)>24))return null;
    }
    return layers.join(',');
  }
  /* markup or CSS syntax in a value (spec 070 D6, FR-020); equal to themetokens.ts HOSTILE_RE (test:theme-tokens) */
  const HOSTILE_RE=/[<>{};\\@]|url\s*\(|expression\s*\(|var\s*\(/i;
  /* a typed token's value as it is applied, or null (wrong type, out of range, a font not on the list) */
  function typedValue(key,v){
    const spec=own(TYPED_TOKENS,key)?TYPED_TOKENS[key]:null;
    if(!spec||typeof v!=='string')return null;
    const t=v.trim();
    if(!t||t.length>160||HOSTILE_RE.test(t))return null;
    if(spec.type==='font')return fontStack(t,spec.generic);
    if(spec.type==='weight')return /^(500|550|600|650|700|750|800)$/.test(t)?t:null;
    if(spec.type==='radius')return LEN_RE.test(t)&&lenPx(t)>=0&&lenPx(t)<=24?t:null;
    if(spec.type==='shadow')return shadowValue(t);
    return null;
  }

  /* UI styles (spec 035 FR-009): the app owns their CSS (themes.css); a manifest only names one. */
  /* Art slots the renderer draws (spec 040 FR-010); any other key is dropped. char-*, desk-*, monitor-art and hair-acc
     are overlays of the office kit only (spec 035 FR-013). */
  const ART_SLOTS=['plant','room-back-wall','room-back-window','room-floor','lobby-art','door-art',
    'place-library','place-software','place-terminal','place-web','place-other',
    'char-body','char-robe','char-headwear','char-collar','desk-back','desk-art','monitor-art','hair-acc',
    'gadget-cup','gadget-laptop']; /* spec 070 FR-011: replace the idle cup and the laptop */
  const UI_STYLES=['clean','retro'];
  /* Scene kits (spec 035 FR-013): how people and desks are drawn; the drawing code is the app's (scenekits.js). */
  const SCENE_KITS=['office','pixel','crew'];
  /* Characters, separate from themes (spec 077 FR-064, FR-065): who sits at the desks. 'theme' is the theme's own kit (the default);
     the others name a kit that is drawn on top of any theme. The same list and rule as src/shared/characters.ts (test:characters). */
  const CHARACTERS=['theme','minimalist','cheeky','prehistoric'];
  const CHARACTER_KITS={minimalist:'office',cheeky:'crew',prehistoric:'crew'};
  const REMOVED_THEMES=['corporate','durbar-indian','durbar-european','durbar-japanese']; /* spec 035 FR-017: removed built-ins; FR-018 maps them to Clean Office, same list as src/shared/themes.ts (test:theme) */
  const LEGACY_CREW_THEME='cheeky-crew'; /* FR-066: no longer a theme; FR-067 maps it to Clean Office with Characters = Cheeky */
  function parseCharacters(v){return typeof v==='string'&&CHARACTERS.includes(v)?v:undefined;}
  function kitFor(themeKit,choice){const c=parseCharacters(choice);if(c&&c!=='theme')return CHARACTER_KITS[c];return themeKit||'office';}

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
    out.tokens={}; /* only Clean Office keys, only token-grammar values (spec 040 FR-006): never raw CSS on <html> or in SVG attributes */
    /* spec 070 FR-020: what was dropped, for the note on the theme's card (kept across a second validation of a validated pack) */
    const dropped=Array.isArray(m.dropped)?m.dropped.filter(x=>typeof x==='string'&&x.length<=64).slice(0,200):[];
    const drop=k=>{if(dropped.length<200&&!dropped.includes(k))dropped.push(String(k).slice(0,64));};
    if(m.tokens && typeof m.tokens==='object'){
      for(const [k,v] of Object.entries(m.tokens)){
        if(Object.prototype.hasOwnProperty.call(CLEAN_TOKENS,k)){ if(isTokenValue(v)) out.tokens[k]=v.trim(); else drop(k); }
        else if(Object.prototype.hasOwnProperty.call(TYPED_TOKENS,k)){ const t=typedValue(k,v); if(t!==null) out.tokens[k]=t; else drop(k); } /* spec 070 FR-002 */
        else drop(k);
      }
    }
    /* spec 070 FR-010: the people's clothes and hair; skins stay the app's (D3). #rgb or #rrggbb, kept as #rrggbb (shading needs it) */
    out.figures={};
    if(m.figures&&typeof m.figures==='object'){
      for(const part of ['shirts','hairs']){
        const list=Array.isArray(m.figures[part])?m.figures[part]:[];
        const ok=[];
        list.slice(0,8).forEach((c,i)=>{const h=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof c==='string'?c.trim():'');if(h)ok.push('#'+(h[1].length===3?h[1].split('').map(x=>x+x).join(''):h[1]).toLowerCase());else drop('figures.'+part+'.'+i);});
        if(list.length>8)drop('figures.'+part+'.8+');
        if(ok.length)out.figures[part]=ok;
      }
    }
    out.art={};
    if(m.art && typeof m.art==='object'){
      for(const [k,v] of Object.entries(m.art)){
        if(!ART_SLOTS.includes(k)) { drop('art.'+k); continue; }
        const clean=sanitizeArtValue(v);
        if(clean!==null) out.art[k]=clean; else drop('art.'+k);
      }
    }
    out.motion=Object.assign({}, m.motion && typeof m.motion==='object'?m.motion:{});
    out.ui=UI_STYLES.includes(m.ui)?m.ui:'clean';
    out.scene=SCENE_KITS.includes(m.scene)?m.scene:'office';
    /* spec 035 FR-018: a saved theme naming a removed style or kit (Corporate, the courts) keeps working; that one value falls back, with a note */
    if(m.ui!==undefined&&out.ui!==m.ui)drop('ui');
    if(m.scene!==undefined&&out.scene!==m.scene)drop('scene');
    out.words={}; /* only scene words, short, no control characters (spec 040 FR-007) */
    if(m.words && typeof m.words==='object'){
      for(const [k,v] of Object.entries(m.words)){
        // eslint-disable-next-line no-control-regex
        if(Object.prototype.hasOwnProperty.call(CLEAN_WORDS,k) && typeof v==='string' && v.trim() && v.length<=60 && !/[\u0000-\u001f\u007f-\u009f]/.test(v)) out.words[k]=v;
      }
    }
    out.dropped=dropped;
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

  const MAX_SLOT_CHARS=24000; /* spec 070 FR-011: one slot's fragment (a compiled pixel map of a built-in reaches about 17,000) */
  function sanitizeArtValue(v){
    if(typeof v==='string')return v.length<=MAX_SLOT_CHARS?sanitizeSlot(v):null;
    const pix=compilePixelMap(v);
    return pix?sanitizeSlot(pix):null;
  }

  /* spec 070 FR-021: the text pairs of the AI maker's checks (themegen.ts CONTRAST_PAIRS; test:theme-tokens keeps them equal) */
  const CONTRAST_PAIRS=[['--ink','--bg',4.5],['--ink','--surface',4.5],['--ink','--raised',4.5],['--ink','--card',4.5],['--ink','--card-waiting',4.5],['--ink','--card-error',4.5],['--ink-2','--soft',4.5],['--ink-2','--note',4.5],['--ink-2','--surface',4.5],['--muted','--surface',4.5],['--room-path','--bg',3]]
    .concat(['working','thinking','waiting','idle','error','done'].map(s=>['--pc-'+s,'--pb-'+s,4.5]))
    .concat([['--surface','--sage-ink',4.5],['--surface','--red-ink',4.5],['--surface','--amber-ink',4.5]]) /* spec 052 FR-169: primary, danger and warn button text */
    .concat([['--drop-ink','--drop-bg',4.5],['--brand-mark','--brand-bg',3],['--idle-stub-ink','--idle-stub',3],['--desk-new','--card',3],['--desk-needs','--card-waiting',3]])
    .concat(['sage','blue','sand','clay'].flatMap(t=>[['--room-path','--tint-'+t,4.5],['--muted','--tint-'+t,4.5],['--ink','--tint-'+t,4.5]])); /* spec 040 FR-027: header text sits on the room tints */
  const HEX_ANY=/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  function lum(hex){
    let h=HEX_ANY.exec(hex)[1]; if(h.length===3)h=h.split('').map(c=>c+c).join(''); h=h.slice(0,6);
    const ch=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4));
    return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];
  }
  function ratio(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
  /* spec 070 FR-023: the surfaces a theme is built on. A failing pair never changes them, so a dark theme stays dark and a light one light */
  const BASE_SURFACE=/^--(bg|surface|surface-2|raised|card(-[a-z]+)?|soft|note|pb-[a-z]+|drop-bg|brand-bg|idle-stub)$/;
  const TINT=/^--tint-[a-z]+$/;
  function hex6(v){let h=HEX_ANY.exec(v)[1];if(h.length===3)h=h.split('').map(c=>c+c).join('');return h;}
  function mixHex(v,to,w){
    const h=hex6(v),t=hex6(to);
    const ch=[0,2,4].map(i=>Math.round(parseInt(h.slice(i,i+2),16)*(1-w)+parseInt(t.slice(i,i+2),16)*w));
    return '#'+ch.map(c=>c.toString(16).padStart(2,'0')).join('')+h.slice(6);
  }
  /* the least mix of `v` toward white or black (whichever reads better on `on`) that reaches `min`: the hue stays */
  function readableOn(v,on,min){
    const to=ratio('#ffffff',on)>=ratio('#000000',on)?'#ffffff':'#000000';
    if(ratio(mixHex(v,to,1),on)<min)return mixHex(v,to,1);
    let lo=0,hi=1;
    for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(ratio(mixHex(v,to,mid),on)>=min)hi=mid;else lo=mid;}
    return mixHex(v,to,hi);
  }
  /* fixes failing pairs in place, minimally, on the side that is not a base surface (FR-023); returns the keys it changed */
  function contrastFix(t){
    const back=[];
    for(let pass=0;pass<4;pass++){
      let changed=false;
      for(const [fg,bg,min] of CONTRAST_PAIRS){
        const a=t[fg],b=t[bg];
        if(!HEX_ANY.test(String(a||''))||!HEX_ANY.test(String(b||'')))continue;
        if(ratio(a,b)>=min)continue;
        /* a room tint paints only the rooms, but --ink, --muted and --room-path are also read on the page, cards and tooltips (spec 040 FR-027):
           move the text token only when the result keeps every non-tint pair it is part of; else repair the tint, and the text only if no tint can reach the ratio */
        let k=BASE_SURFACE.test(fg)&&!BASE_SURFACE.test(bg)?bg:fg;
        let v;
        if(TINT.test(bg)){
          k=fg;v=readableOn(a,b,min);
          const keeps=CONTRAST_PAIRS.every(([f,g,m])=>f!==fg||TINT.test(g)||!HEX_ANY.test(String(t[g]||''))||ratio(v,t[g])>=m);
          if(!keeps){
            const tv=readableOn(b,a,min);
            if(ratio(a,tv)>=min){k=bg;v=tv;}
          }
        }else v=readableOn(t[k],t[k===fg?bg:fg],min);
        if(v===t[k])continue;
        t[k]=v;changed=true;
        if(!back.includes(k))back.push(k);
      }
      if(!changed)break;
    }
    return back;
  }

  /* ---------- Theme store ---------- */
  let currentId=CLEAN_ID;
  let currentManifest=null;
  let currentResolved=null; /* the applied token map (spec 070 FR-021) */
  let currentCharacters='theme'; /* spec 077 FR-064 */
  let themeRev=0; /* +1 on every applied theme: drawings made with another theme's tokens and art are stale (spec 040 FR-023) */
  let listeners=[];

  function resolveTokens(manifest){
    const t=Object.assign({}, CLEAN_TOKENS);
    if(manifest && manifest.tokens) Object.assign(t, manifest.tokens);
    return t;
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

  /* spec 037 FR-014: a few of a theme's own colours for its swatch in the picker (validated tokens, Clean Office as fallback) */
  function preview(id){
    const m=typeof id==='string'?loadManifest(id):null, t=(m&&m.tokens)||{};
    const pick=k=>{const v=t[k]!==undefined?t[k]:CLEAN_TOKENS[k];return typeof v==='string'&&/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\))$/.test(v.trim())?v.trim():null;};
    return ['--bg','--tint-sage','--wall-blue'].map(pick).filter(Boolean);
  }
  /* FR-030 (#309): the colours of a theme's mini room on its Settings card; every value passes the colour grammar (Clean Office as fallback) */
  const ROOM_KEYS={bg:'--bg',tint:'--tint-blue',wall:'--wall-blue',desk:'--desk',chair:'--chair',ink:'--ink',agent:'--sage'};
  function previewRoom(id){
    const m=typeof id==='string'?loadManifest(id):null, t=(m&&m.tokens)||{}, ok=v=>typeof v==='string'&&/^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\))$/.test(v.trim());
    const out={};
    for(const [k,tok] of Object.entries(ROOM_KEYS)){const v=ok(t[tok])?t[tok]:CLEAN_TOKENS[tok];if(ok(v))out[k]=v.trim();}
    return out;
  }

  function loadManifest(idOrManifest){
    if(typeof idOrManifest==='string'){if(own(BUILT_IN,idOrManifest))return validateManifest(BUILT_IN[idOrManifest]);if(own(USER_MANIFESTS,idOrManifest))return validateManifest(USER_MANIFESTS[idOrManifest]);return null;}
    if(typeof idOrManifest==='object')return validateManifest(idOrManifest);
    return null;
  }

  /* Apply a pack or id; unknown ids fall back to Clean Office (with a warning). Strings resolve
     synchronously when already known; a `resolveUser` hook (stage E) can fetch a user pack manifest. */
  /* relative luminance below 0.35 for a #rgb/#rrggbb colour; anything else counts as light */
  function isDarkColor(v){
    const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v||'').trim());
    if(!m)return false;
    let h=m[1]; if(h.length===3)h=h.split('').map(c=>c+c).join('');
    const ch=[0,2,4].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
    return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2]<0.35;
  }
  function setTheme(idOrManifest){
    /* spec 077 FR-067: the old Cheeky Crew id is Clean Office with Characters = Cheeky (unless another choice is in force), no warning */
    if(idOrManifest===LEGACY_CREW_THEME){if(currentCharacters==='theme')setCharacters('cheeky');idOrManifest=CLEAN_ID;}
    if(typeof idOrManifest==='string'&&REMOVED_THEMES.includes(idOrManifest))idOrManifest=CLEAN_ID; /* spec 035 FR-018 */
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
    /* the same pack again: nothing to do. A manifest with the same id but other content (an AI theme regenerated with Try again,
       previewed before it is saved, spec 040 FR-023) is applied like a new theme */
    if(id===currentId&&currentManifest&&JSON.stringify(manifest)===JSON.stringify(currentManifest))return id;
    currentId=id;
    currentManifest=manifest;
    themeRev++;
    /* spec 070 FR-021/FR-023: a text pair that is hard to read is fixed minimally on its text or accent side */
    const resolved=resolveTokens(manifest);
    if(!own(BUILT_IN,id))contrastFix(resolved); /* built-in packs are designed and tested by hand (test:theme); retro's ink is a fill, not text on --bg */
    currentResolved=resolved;
    applyTokens(resolved);
    /* spec 070 FR-001: a typed token the pack does not give is removed, so the CSS default (and the UI style's display font) applies */
    if(typeof document!=='undefined'&&document.documentElement){
      for(const k of Object.keys(TYPED_TOKENS))if(!Object.prototype.hasOwnProperty.call(manifest.tokens||{},k))document.documentElement.style.removeProperty(k);
      if(Object.prototype.hasOwnProperty.call(manifest.tokens||{},'--ui-display'))document.documentElement.dataset.display='';else delete document.documentElement.dataset.display;
    }
    /* Clean Office itself has no data-ui (as at startup), so its `html:not([data-ui])` polish in styles.css also returns
       after switching back from another theme (spec 052 FR-053); other themes, generated ones too, name their style */
    if(typeof document!=='undefined'&&document.documentElement){
      if(id===CLEAN_ID)delete document.documentElement.dataset.ui;
      else document.documentElement.dataset.ui=manifest.ui||'clean';
    }
    /* spec 052 FR-052: mark a dark surface, so rules meant for light themes (prefers-contrast:more) skip it */
    if(typeof document!=='undefined'&&document.documentElement){
      const dark=isDarkColor(resolved['--surface']);
      if(dark)document.documentElement.dataset.dark='';else delete document.documentElement.dataset.dark;
    }
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
    /* the resolved map: the pack's values after the contrast fallback (spec 070 FR-021), so the scenes draw what the CSS shows */
    if(currentResolved&&Object.prototype.hasOwnProperty.call(currentResolved,key))return currentResolved[key];
    return own(CLEAN_TOKENS,key)?CLEAN_TOKENS[key]:(own(TYPED_TOKENS,key)?TYPED_TOKENS[key].def:null);
  }
  /* spec 070 FR-010: the pack's shirt and hair palettes, or null */
  function figures(){const f=currentManifest&&currentManifest.figures;return f&&(f.shirts||f.hairs)?f:null;}
  /* spec 070 FR-022: what a theme could not use: dropped values and text pairs set back to Clean Office */
  function fallbacks(id){
    const m=loadManifest(id);
    if(!m)return {dropped:[],contrast:[]};
    return {dropped:(m.dropped||[]).slice(),contrast:own(BUILT_IN,m.id)?[]:contrastFix(resolveTokens(m))};
  }
  /* spec 070 FR-024: the colours the fix would adjust in a manifest not saved yet (the AI dialog's preview) */
  function contrastCheck(manifest){
    const m=loadManifest(manifest);
    return m?contrastFix(resolveTokens(m)):[];
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
  /* Is this id one of the built-in packs (asked directly, so it stays right once list() also holds user themes)? */
  function isBuiltIn(id){ return own(BUILT_IN,id); }
  /* spec 040 FR-030: a user theme's lobby band keeps its proportions and covers the lobby; built-in bands were drawn to be stretched */
  function lobbyArtAspect(id){ return isBuiltIn(id)?'none':'xMidYMid slice'; }
  /* User themes (spec 040): the main process passes validated manifests; id becomes selectable. */
  function registerUserThemes(listOrMap){
    USER_MANIFESTS={};
    if(listOrMap&&typeof listOrMap==='object'){
      for(const [id,m] of Object.entries(listOrMap)){
        const v=validateManifest(m);
        if(v&&v.id===id&&!own(BUILT_IN,id)&&!REMOVED_THEMES.includes(id))USER_MANIFESTS[id]=v; /* spec 035 FR-018: a removed id stays reserved */
        else console.warn('[theme] user theme dropped on registration:',id);
      }
    }
  }
  /* spec 040 FR-023: the key of everything drawn with the active theme's tokens and art (scene cache, scene signature, walkers).
     The revision changes on every applied theme, so a regenerated pack with the same id never reuses an old drawing. */
  function themeIdForCache(){ return currentId+'.'+themeRev; }
  /* spec 077 FR-065: the theme's own kit, and the kit drawn (the Characters choice on top of the theme) */
  function themeKit(){ return (currentManifest&&currentManifest.scene)||'office'; }
  function sceneKit(){ return kitFor(themeKit(),currentCharacters); }
  function characters(){ return currentCharacters; }
  /* an unknown value is the default; a change bumps the revision so every scene, walker and avatar keyed on themeIdForCache redraws */
  function setCharacters(v){
    const c=parseCharacters(v)||'theme';
    if(c!==currentCharacters){currentCharacters=c;themeRev++;}
    return c;
  }

  /* ================================= built-in packs (spec 038) =================================
     Data-only: tokens (only Clean Office keys are meaningful), sanitized art slots, scene words,
     one motion preset. Status/permission/credit wording never changes; layout is never themed. */

  /* ---- 038: Retro — 8-bit palette, blocky slot art ---- */
  registerBuiltIn({
    id:'retro', name:'Retro Pixel', author:'Three Feathers', version:'1.0', extends:'clean-office',
    ui:'retro',
    scene:'pixel',
    tokens:{
      '--bg':'#1d2b53','--surface':'#fff1e8','--surface-2':'#f7e2cf','--line':'#111122','--line-2':'#111122',
      '--ink':'#111122','--ink-2':'#2b2b44','--muted':'#46465f','--room-path':'#36364f',
      '--sage':'#5fae76','--sage-ink':'#2c6b40','--blue':'#5f87c8','--blue-ink':'#2c4f82','--amber':'#e0a92c','--amber-ink':'#7c5a06',
      '--red':'#d8564a','--red-ink':'#8e2f26','--green':'#4fa760','--gray':'#9a987e',
      '--c-working':'#5f87c8','--c-thinking':'#8b8fc9','--c-waiting':'#e0a92c','--c-idle':'#a3a08e','--c-error':'#d8564a','--c-done':'#4fa760','--desk-new':'#0a6b32',
      '--halo-working':'#5f87c8','--halo-thinking':'#8b8fc9','--halo-waiting':'#e0a92c','--halo-error':'#d8564a',
      '--chair':'#83769c','--desk':'#ab5236','--desk-front':'#c97d45','--desk-drawer':'#c97d45',
      '--monitor-stand':'#5f574f','--monitor-frame':'#c2c3c7','--laptop':'#5f574f',
      '--screen-working':'#dfeaf8','--screen-thinking':'#e4e4f6','--screen-waiting':'#faedd2','--screen-idle':'#d2d2c6','--screen-error':'#f8e0d8','--screen-done':'#dcefdc',
      '--bar-sage':'#5fae76','--bar-blue':'#5f87c8','--bar-blue-2':'#93aede',
      '--face-dark':'#23233a','--mouth':'#8a4638',
      '--bubble-line':'#b9bce0','--think-dot':'#8b8fc9',
      '--cup':'#f2ecd9','--cup-line':'#b3a37c','--steam':'#9d987e',
      '--link':'#989e8a','--star':'#e0a92c',
      '--door-bg':'#e6dfd0','--door-line':'#a3967a','--door-leaf':'#c2b096','--door-leaf-line':'#988a6c','--door-knob':'#6e6248','--door-panel':'#ddd3ba',
      '--brand-mark':'#111122','--brand-bg':'#ffec27','--focus':'#111122','--focus-halo':'#ffec27' /* spec 052 FR-052: dark ring, yellow halo: shows on cream and on navy */,'--line-ctl':'#111122',
      '--sel-border':'#ff004d','--sel-ring':'#ffccaa','--sel-ring-2':'#ffccaa','--stat-sel-border':'#ff004d','--stat-sel-ring':'#ffccaa',
      '--avatar-bg':'#e0ead2','--walker-bg':'#fff1e8','--drop':'#6d8cc2','--drop-bg':'rgb(230 236 248 / .93)','--drop-ink':'#26456e',
      '--badge-idle':'#b8b49c','--place-busy':'#29adff',
      '--tint-sage':'#a8e4a0','--wall-sage':'#111122','--tint-blue':'#9fc3e8','--wall-blue':'#111122','--tint-sand':'#f2d48a','--wall-sand':'#111122','--tint-clay':'#f0b8a8','--wall-clay':'#111122',
      '--cwall-sage':'#111122','--cwall-blue':'#111122','--cwall-sand':'#111122','--cwall-clay':'#111122',
      '--pb-working':'#dce6f6','--pc-working':'#26456e','--pb-thinking':'#e4e3f6','--pc-thinking':'#3c3f78',
      '--pb-waiting':'#faecd0','--pc-waiting':'#7c5a06','--pb-idle':'#e6e4d6','--pc-idle':'#585647',
      '--pb-error':'#f8e1dc','--pc-error':'#8e2f26','--pb-done':'#daeede','--pc-done':'#2b6338',
      '--proto-line':'#ecd9a8',
      '--ic-read':'#4a6f92','--ic-edit':'#7a7f4a','--ic-run':'#3d9b58','--ic-search':'#8a6c3e','--ic-tool':'#6a6e80',
    },
    art:{
      'plant':'<rect x="10" y="6" width="6" height="15" fill="var(--plant-dark)"/><rect x="6" y="10" width="4" height="6" fill="var(--plant-dark)"/><rect x="16" y="9" width="4" height="5" fill="var(--plant-mid)"/><rect x="7" y="21" width="12" height="8" fill="var(--pot)"/><rect x="7" y="21" width="12" height="2" fill="var(--door-knob)"/>',
      /* chunky CRT stand */
      /* Full PIXEL art (owner review, PR #137): an 8-bit figure over the torso (under the round head,
         so hair/hair-acc still work), a stepped pixel desk rim + floppy disk, a CRT monitor with
         scanlines, a scanline brick wall and an arcade-pattern floor, cabinet trim in the lobby. */
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
      /* spec 052 FR-032: the old 90x51 map filled only a corner of the 320x118 floor and stretched into faint smeared
         stripes. Now a checkerboard that covers the whole floor in two opaque palette colours, with a few dark studs. */
      'room-floor':{cell:11,palette:{s:'var(--surface-2)',k:'var(--line)'},rows:(()=>{
        const a='ss..'.repeat(7)+'ss', b='..ss'.repeat(7)+'..', a2='ss..ss.kss..ss..ss..ss..ss.kss';
        return [a,a2,b,b,a,a2,b,b,a,a2,b];
      })()},
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
    words:{'place-library':'Arcade','place-coffee':'Snack bar','place-boss':'Boss level','place-bank':'Coin bank','place-postbox':'Mailbox','boss-note':'Went to the boss level','place-software':'Cartridge Bay','place-terminal':'Console','place-web':'Modem','place-other':'Gadgets','lobby-label':'Game lobby: the places where agents work'},
    motion:{preset:'arcade'},
  });

  /* spec 077 FR-066: Cheeky Crew is no longer a theme: its characters are Settings > Characters > Cheeky (the crew kit) on any theme */

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
    /* spec 052 FR-013: the plain (Clean Office) word, so a themed place can still say what it is */
    plainWord: (key) => (Object.prototype.hasOwnProperty.call(CLEAN_WORDS, key) ? CLEAN_WORDS[key] : key),
    motion,
    list,
    preview,
    previewRoom,
    onChange,
    themeIdForCache,
    figures,
    fallbacks,
    contrastCheck,
    TYPED_TOKENS:JSON.parse(JSON.stringify(TYPED_TOKENS)),
    FONT_ALLOW:FONT_ALLOW.slice(),
    CONTRAST_PAIRS:CONTRAST_PAIRS.map(p=>p.slice()),
    _typedValue:typedValue,
    _HOSTILE_RE:HOSTILE_RE,
    registerBuiltIn,
    registerUserThemes,
    MOTION_PRESETS,
    _sanitizeSlot:sanitizeSlot,
    _isTokenValue:isTokenValue,
    UI_STYLES:UI_STYLES.slice(),
    SCENE_KITS:SCENE_KITS.slice(),
    ART_SLOTS:ART_SLOTS.slice(),
    sceneKit,
    themeKit,
    characters,
    setCharacters,
    kitFor,
    parseCharacters,
    CHARACTERS:CHARACTERS.slice(),
    CHARACTER_KITS:Object.assign({},CHARACTER_KITS),
    LEGACY_CREW_THEME,
    REMOVED_THEMES:REMOVED_THEMES.slice(),
    _validateManifest:validateManifest,
    _compilePixelMap:compilePixelMap,
    _tokens(){return resolveTokens(currentManifest);},
    isBuiltIn,
    lobbyArtAspect,
    _builtins(){return BUILT_IN;},
  };
}));
