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
     is never themeable; ids (`place-*` values) never change — only the display text. */
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
  };

  /* Motion presets (036 FR-006): fixed per theme, `reduced` is forced when prefers-reduced-motion matches. */
  const CLEAN_MOTION={preset:'default'};
  const MOTION_PRESETS={
    'default':{bar:'3.4s ease-in-out infinite alternate',glow:'3.6s ease-in-out infinite alternate',wave:'2.8s ease-in-out infinite',cursor:'1.6s ease-in-out infinite'},
    'calm':{bar:'6s ease-in-out infinite alternate',glow:'8s ease-in-out infinite alternate',wave:'4.5s ease-in-out infinite',cursor:'2.4s ease-in-out infinite'},
    'arcade':{bar:'1.7s steps(4) infinite alternate',glow:'2.4s steps(2) infinite alternate',wave:'1.8s steps(2) infinite',cursor:'1.2s steps(2) infinite'},
    'reduced':{bar:'none',glow:'none',wave:'none',cursor:'none'},
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
  const TOKEN_VALUE_MAX=64; /* the longest token value, also the cap of parseColor (themes.ts TOKEN_VALUE_MAX, test:theme-tokens) */
  const isTokenValue=v=>typeof v==='string' && v.trim().length<=TOKEN_VALUE_MAX && TOKEN_VALUE_RE.test(v.trim());

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
  /* spec 070 FR-053: the top bar's colours, a closed list a world pack may set (the names themes.css and realoffice-world.css re-scope the bar with).
     Defaults are Flat's light bar: the page values. Set on <html> only when a pack gives one; src/shared/themetokens.ts BAR_TOKENS is the same list. */
  const BAR_TOKENS={'--wb-bg':'#f7f6f3','--wb-bg-2':'#efece6','--wb-surface':'#fffdf9','--wb-surface-2':'#faf7f1','--wb-ink':'#2c3733','--wb-ink-2':'#56605b','--wb-muted':'#535a55',
    '--wb-line':'#e7e3dc','--wb-line-2':'#d3cabb','--wb-line-ctl':'#8a8272','--wb-focus':'#2f5f8a','--wb-warn-bg':'#fdf3df','--wb-warn-ink':'#80530a'};
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
  const ART_SLOTS=['plant','room-back-wall','room-back-window','room-floor','lobby-art',
    'place-library','place-software','place-terminal','place-web','place-other',
    'char-body','char-robe','char-headwear','char-collar','desk-back','desk-art','monitor-art','hair-acc',
    'gadget-cup','gadget-laptop']; /* spec 070 FR-011: replace the idle cup and the laptop */
  const UI_STYLES=['clean','retro'];
  /* Scene kits (spec 035 FR-013): how people and desks are drawn; the drawing code is the app's (scenekits.js). */
  const SCENE_KITS=['office','pixel','crew'];
  /* Characters, separate from themes (spec 077 FR-064, FR-065): who sits at the desks. 'theme' is the theme's own kit (the default);
     the others name a kit that is drawn on top of any theme. The same list and rule as src/shared/characters.ts (test:characters). */
  const CHARACTERS=['theme','office','minimalist','cheeky','prehistoric','pirate','monster','royal','rebels','retro'];
  const SET_CHOICES=['office','retro']; /* spec 102 FR-320, FR-321: Real office people sets; Flat draws the theme's own figures until T294 */
  const CHARACTER_KITS={minimalist:'office',cheeky:'crew',prehistoric:'crew',pirate:'crew',monster:'crew',royal:'crew',rebels:'crew'};
  const REMOVED_THEMES=['corporate','durbar-indian','durbar-european','durbar-japanese']; /* spec 035 FR-017: removed built-ins; FR-018 maps them to Clean Office, same list as src/shared/themes.ts (test:theme) */
  const LEGACY_CREW_THEME='cheeky-crew'; /* FR-066: no longer a theme; FR-067 maps it to Clean Office with Characters = Cheeky */
  function parseCharacters(v){return typeof v==='string'&&CHARACTERS.includes(v)?v:undefined;}
  function kitFor(themeKit,choice){const c=parseCharacters(choice);if(c&&c!=='theme'&&!SET_CHOICES.includes(c))return CHARACTER_KITS[c];return themeKit||'office';}

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
        else if(Object.prototype.hasOwnProperty.call(BAR_TOKENS,k)){ if(isTokenValue(v)) out.tokens[k]=v.trim(); else drop(k); } /* spec 070 FR-053 */
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

  /* spec 070 FR-021: the text pairs of themegen.ts CONTRAST_PAIRS (test:theme-tokens keeps them equal) */
  const CONTRAST_PAIRS=[['--ink','--bg',4.5],['--ink','--surface',4.5],['--ink','--raised',4.5],['--ink','--card',4.5],['--ink','--card-waiting',4.5],['--ink','--card-error',4.5],['--ink-2','--soft',4.5],['--ink-2','--note',4.5],['--ink-2','--surface',4.5],['--muted','--surface',4.5],['--room-path','--bg',3]]
    .concat(['working','thinking','waiting','idle','error','done'].map(s=>['--pc-'+s,'--pb-'+s,4.5]))
    .concat([['--surface','--sage-ink',4.5],['--surface','--red-ink',4.5],['--surface','--amber-ink',4.5]]) /* spec 052 FR-169: primary, danger and warn button text */
    .concat([['--drop-ink','--drop-bg',4.5],['--brand-mark','--brand-bg',3],['--idle-stub-ink','--idle-stub',3],['--desk-new','--card',3],['--desk-needs','--card-waiting',3]])
    .concat(['sage','blue','sand','clay'].flatMap(t=>[['--room-path','--tint-'+t,4.5],['--muted','--tint-'+t,4.5],['--ink','--tint-'+t,4.5]])); /* spec 040 FR-027: header text sits on the room tints */
  const HEX_ANY=/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  /* spec 070 FR-080: every colour form a token may take, as themegen.ts parseColor / resolveColor (test:theme-tokens keeps them equal): #hex of 3, 4, 6 and 8 digits,
     rgb()/rgba() and hsl()/hsla() (comma or space-and-slash syntax), a named colour, transparent. Anything else (currentColor, inherit, ...) is null = unmeasured */
  const NAMED=Object.fromEntries('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32'.split(',').map(p=>p.split(':')));
  const clampN=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));
  /* a CSS number (with an optional %) and a hue (with an optional deg): `1.` is not one (Chromium rejects it), and no two branches match the same
     text, so a long input is linear (themegen.ts COLOUR_NUM_RE and COLOUR_HUE_RE, test:theme-tokens) */
  const COLOUR_NUM_RE=/^[+-]?(\d+(?:\.\d+)?|\.\d+)(%?)$/, COLOUR_HUE_RE=/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(deg)?$/;
  function parseColor(v){
    const s=String(v).trim().toLowerCase();
    if(s.length>TOKEN_VALUE_MAX)return null; /* longer than any token value: keeps every regex below on a short input */
    if(s==='transparent')return [0,0,0,0];
    let m=/^#([0-9a-f]+)$/.exec(s);
    if(m){
      let h=m[1];
      if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');
      if(h.length!==6&&h.length!==8)return null;
      return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat([h.length===8?parseInt(h.slice(6),16)/255:1]);
    }
    if(/^[a-z]+$/.test(s)){const h=own(NAMED,s)?NAMED[s]:null;return h?[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat([1]):null;}
    m=/^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
    if(!m)return null;
    /* CSS has two grammars and never mixes them: `a, b, c[, alpha]` or `a b c[ / alpha]` */
    const body=m[2].trim();
    let args;
    if(body.includes(',')){
      if(body.includes('/'))return null;
      args=body.split(',').map(x=>x.trim());
      if(args.some(x=>!x))return null;
    }else{
      const sp=/^([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)(?:\s*\/\s*([^\s/]+))?$/.exec(body);
      if(!sp)return null;
      args=sp.slice(1).filter(x=>x!==undefined);
    }
    if(args.length!==3&&args.length!==4)return null;
    const num=a=>{const n=COLOUR_NUM_RE.exec(a);return n?[parseFloat(a),n[2]==='%']:null;};
    let alpha=1;
    if(args.length===4){const a=num(args[3]);if(!a)return null;alpha=clampN(a[1]?a[0]/100:a[0],0,1);}
    if(m[1].startsWith('rgb')){
      const rgb=[];
      const ns=args.slice(0,3).map(num);
      if(ns.some(n=>!n))return null;
      /* the comma syntax takes three numbers or three percentages, never a mix (Chromium rejects it); the space syntax may mix */
      if(body.includes(',')&&new Set(ns.map(n=>n[1])).size>1)return null;
      for(const n of ns)rgb.push(clampN(Math.round(n[1]?n[0]*255/100:n[0]),0,255));
      return [rgb[0],rgb[1],rgb[2],alpha];
    }
    const hm=COLOUR_HUE_RE.exec(args[0]);
    const sm=num(args[1]),lm=num(args[2]);
    if(!hm||!sm||!lm||!sm[1]||!lm[1])return null;
    const h=(((parseFloat(hm[1])%360)+360)%360)/360,sat=clampN(sm[0],0,100)/100,l=clampN(lm[0],0,100)/100;
    const q=l<0.5?l*(1+sat):l+sat-l*sat,p=2*l-q;
    const ch=t0=>{const t=(t0+1)%1;return t<1/6?p+(q-p)*6*t:t<0.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};
    return [ch(h+1/3),ch(h),ch(h-1/3)].map(x=>Math.round(x*255)).concat([alpha]);
  }
  /* a colour as opaque #rrggbb, its alpha composited over `over` (the page background); null when it cannot be resolved */
  function colorHex(v,over){
    if(v===undefined||v===null)return null;
    const c=parseColor(v);
    if(!c)return null;
    const o=parseColor(over||'#ffffff')||[255,255,255,1];
    return '#'+[0,1,2].map(i=>Math.round(c[i]*c[3]+o[i]*(1-c[3])).toString(16).padStart(2,'0')).join('');
  }
  function lum(hex){
    let h=HEX_ANY.exec(hex)[1]; if(h.length===3)h=h.split('').map(c=>c+c).join(''); h=h.slice(0,6);
    const ch=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4));
    return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];
  }
  function ratio(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
  /* spec 070 FR-023: the surfaces a theme is built on. A failing pair never changes them, so a dark theme stays dark and a light one light */
  const BASE_SURFACE=/^--(bg|surface|surface-2|raised|card(-[a-z]+)?|soft|note|pb-[a-z]+|drop-bg|brand-bg|idle-stub|wb-bg|wb-bg-2|wb-surface|wb-surface-2|wb-warn-bg)$/;
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
      const page=colorHex(t['--bg'],'#ffffff')||'#ffffff'; /* what a translucent colour is composited over (spec 070 FR-080) */
      const hexOf=(k,over)=>colorHex(t[k],k==='--bg'?'#ffffff':(over||page)); /* the page is --bg over white, never over itself */
      for(const [fg,bg,min,over] of CONTRAST_PAIRS.concat(BAR_PAIRS)){
        const b0=hexOf(bg),b=b0&&(over?glassOver(b0,over):b0); /* a bar pair is measured on the glass fill as it shows (FR-053) */
        const a=b&&hexOf(fg,b); /* the text is composited over what it is read on, glass included, as themeIssues does; a form that cannot be resolved is skipped here and listed by unmeasured() */
        if(!a||!b0)continue;
        if(ratio(a,b)>=min)continue;
        /* a room tint paints only the rooms, but --ink, --muted and --room-path are also read on the page, cards and tooltips (spec 040 FR-027):
           move the text token only when the result keeps every non-tint pair it is part of; else repair the tint, and the text only if no tint can reach the ratio */
        let k=BASE_SURFACE.test(fg)&&!BASE_SURFACE.test(bg)?bg:fg;
        let v;
        if(TINT.test(bg)){
          k=fg;v=readableOn(a,b,min);
          const keeps=CONTRAST_PAIRS.every(([f,g,m])=>f!==fg||TINT.test(g)||!hexOf(g)||ratio(v,hexOf(g))>=m);
          if(!keeps){
            const tv=readableOn(b,a,min);
            if(ratio(a,tv)>=min){k=bg;v=tv;}
          }
        }else v=k===fg?readableOn(a,b,min):readableOn(b0,a,min);
        if(v===t[k])continue;
        t[k]=v;changed=true;
        if(!back.includes(k))back.push(k);
      }
      if(!changed)break;
    }
    return back;
  }
  /* spec 070 FR-080: the tokens of a contrast pair whose value is set but is not a colour the check can measure (currentColor, inherit, a made-up keyword):
     reported, not passed silently. The renderer never repairs them (there is no colour to move) */
  function unmeasured(t){
    const out=[];
    for(const [fg,bg] of CONTRAST_PAIRS.concat(BAR_PAIRS))for(const k of [fg,bg])
      if(t[k]!==undefined&&parseColor(t[k])===null&&!out.includes(k))out.push(k);
    return out;
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
    if(manifest && manifest.tokens){
      if(Object.keys(manifest.tokens).some(k=>own(BAR_TOKENS,k)))Object.assign(t, BAR_TOKENS); /* a pack that sets part of the bar is repaired against the rest at Flat's values */
      Object.assign(t, manifest.tokens);
    }
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
  /* relative luminance below 0.35 for any colour form `parseColor` reads (alpha over white); anything else counts as light */
  function isDarkColor(v){
    const x=colorHex(v,'#ffffff'); /* spec 070 FR-080: any colour form, alpha over white */
    if(!x)return false;
    return lum(x)<0.35;
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
      for(const k of Object.keys(BAR_TOKENS))if(!Object.prototype.hasOwnProperty.call(resolved,k))document.documentElement.style.removeProperty(k);
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
    for(const k of ['bar','glow','wave','cursor']){
      if(typeof document!=='undefined'&&document.documentElement)document.documentElement.style.setProperty('--m-'+k,motion(k));
    }
    paintWorld(); /* spec 097 FR-113: a theme chosen while Real office is shown applies on leaving it; the world's set stays on top */
    listeners.forEach(fn=>{ try{fn(currentId, manifest);}catch(e){console.warn('[theme] listener error',e);} });
    return id;
  }

  /* ---------- spec 097 FR-100, FR-113: a Real office world's chrome token set ----------
     While Real office is shown, its world's token set replaces the theme's COLOURS and its two shadows on the whole page (the top
     bar, menus, popovers, dialogs, toasts, Settings, the List view and every other tool surface), so nothing keeps the old flat look
     next to the photo office (owner, 2026-10-31 10:46). The theme's fonts, title weight and radii stay (070 D2: same fonts, same
     sizes); leaving Real office applies the user's theme again, exactly as before. Colours: the Clean Office set with the world's
     `page` values on top, so the set is complete and its contrast does not depend on the user's theme. `bar` is the top bar's dark
     glass: themes.css gives the .topbar subtree these values as its own --surface, --ink, ... (custom properties cascade), and the
     bar's own menu gets the page values back through the --wp-* copies. Panels and the bar are glass: their fill is the token mixed
     WORLD_GLASS with what is behind (themes.css, color-mix), so contrast is checked on that fill over black (panels, dark text) and
     over white (the bar, light text), the worst backdrops. Status colours never change (070 FR-050). */
  const WORLD_GLASS=0.9; /* the opaque share of a glass fill; themes.css uses the same 90% (test:theme-tokens pins it) */
  const WORLD_SETS={
    photo:{
      name:'Photo office', ui:'clean', /* #1144: the world's chrome is plain, so a theme's hard button shadows (Retro Pixel) never reach it */
      /* warm neutrals of the photo office: cream panels, greige page, espresso ink; oak and amber for the primary button, focus and selection */
      page:{'--bg':'#ece4d8','--surface':'#fbf7f0','--surface-2':'#f3ece1','--raised':'#fffcf6','--card':'#fbf7f0','--soft':'#f8f2e8','--note':'#f3ece1',
        '--line':'#e0d4c2','--line-2':'#c9b79c','--line-ctl':'#8e7a60','--ink':'#2b231d','--ink-2':'#54473b','--muted':'#5c4f43',
        '--sage':'#c4934f','--sage-ink':'#7b4a1e','--focus':'#9a5b12','--sel-border':'#b07a3c','--sel-ring':'#f0e0c8','--sel-ring-2':'#f3e6d2',
        '--stat-sel-border':'#b07a3c','--stat-sel-ring':'#f0e0c8','--brand-mark':'#fff6e8','--brand-bg':'#8a5a28','--avatar-bg':'#efe3d0'},
      /* the top bar: dark wood / charcoal glass with light warm text and an amber focus ring */
      bar:{'--world-tint':'#c9a77c','--wb-bg':'#2a231e','--wb-bg-2':'#1f1a16','--wb-surface':'#3a3029','--wb-surface-2':'#463a31','--wb-ink':'#f7efe4','--wb-ink-2':'#e6d6c2',
        '--wb-muted':'#dccab4','--wb-line':'#5c4d40','--wb-line-2':'#6e5c4c','--wb-line-ctl':'#a8927a','--wb-focus':'#f2b35c',
        '--wb-warn-bg':'#4e3618','--wb-warn-ink':'#f7cf8a'}, /* a counter or the inbox that needs you: amber glass with amber text */
      shadow:{'--shadow-card':'0 1px 3px rgba(46,32,18,.10)','--shadow-pop':'0 18px 48px rgba(46,32,18,.30), 0 2px 6px rgba(46,32,18,.12)'},
    },
    /* spec 102 FR-263, owner 2026-11-03: the arcade is night only and dark everywhere (page, bar, cards, plates, Settings), plainly not
       Flat. A dark world keeps every status hue and lightens only the status `-ink` shades, same hue, so they read at AA on its dark
       surfaces (070 FR-050, amended 2026-11-03). `ui`: the arcade's chrome style while it is shown; `dark`: the page is dark */
    retro:{
      name:'Retro arcade', ui:'retro', dark:true,
      page:{'--bg':'#0b0a1a','--surface':'#17142b','--surface-2':'#1e1a36','--raised':'#221d3d','--card':'#17142b','--soft':'#1b1731','--note':'#262044',
        '--warn-bg':'#2e2410','--card-waiting':'#2a2112','--card-waiting-line':'#7a5a1e','--card-error':'#2c1518','--card-error-line':'#7a3a38',
        '--line':'#3a3360','--line-2':'#4f4680','--line-ctl':'#8c84c0','--ink':'#f4eefc','--ink-2':'#d8d0ec','--muted':'#bdb5d6','--room-path':'#bdb5d6',
        '--sage':'#3d7a55','--sage-ink':'#ff77a8','--focus':'#ffec27','--focus-halo':'#ff004d','--sel-border':'#ff77a8','--sel-ring':'#3a2350','--sel-ring-2':'#33204a',
        '--stat-sel-border':'#ff77a8','--stat-sel-ring':'#3a2350','--brand-mark':'#111122','--brand-bg':'#ffec27','--avatar-bg':'#262044',
        '--idle-stub':'#221d3d','--idle-stub-ink':'#bdb5d6','--drop':'#29adff','--drop-ink':'#cfe3ff',
        /* the info tone (file chips, ask tags, a selected row) is not a status colour: styles.css derives it from the light --pb-/--pc-working, which here gave 2.16:1 on a dark panel (#1278), so the arcade sets its own, in the working blue (spec 070 FR-081) */
        /* the 1px borders: 3:1 or more on the page and each fill (#1283's dark status pair made the derived border 2.2:1) */
        '--tone-info-ink':'#8fc3ff','--tone-info-bg':'#22335a','--tone-info-soft':'#1e2c4e','--tone-info-faint':'#1a2140','--tone-info-hover':'#2a3b66','--tone-info-line':'#6991c5',
        '--tone-ok-ink':'#8fe3ab','--tone-ok-bg':'#1f4332','--tone-ok-soft':'#1b3a2c','--tone-ok-faint':'#162e24','--tone-ok-hover':'#26503b','--tone-ok-line':'#68ab81', /* the ok tone (image chips .att.img, .chip.att-chip.img) the same way: its derived fill was 1.9:1 under the dark green ink */
        /* the other three tones the same way (#1309 review): each ink is painted on its own -bg, -soft, -faint, -hover or the dark page (.fl-focus, .sub-st.done, .mtag.*, .quick, .chip.fail, .scr-warn, .srv-org, .fl-err); derived from the light status pair they were 1.0 to 2.7:1 */
        '--tone-warn-ink':'#ffc35c','--tone-warn-bg':'#3a2c0e','--tone-warn-soft':'#2e2410','--tone-warn-faint':'#241d10','--tone-warn-hover':'#4a3a14','--tone-warn-line':'#ba8e41',
        '--tone-bad-ink':'#ff9a8f','--tone-bad-bg':'#3a1a1d','--tone-bad-soft':'#2c1518','--tone-bad-faint':'#22121a','--tone-bad-hover':'#4a2024','--tone-bad-line':'#ba6d67',
        '--tone-idea-ink':'#b9c0ff','--tone-idea-bg':'#262a52','--tone-idea-soft':'#202444','--tone-idea-faint':'#1b1e3a','--tone-idea-hover':'#30366a','--tone-idea-line':'#868cc2',
        '--tint-sage':'#162420','--wall-sage':'#2c4a3c','--tint-blue':'#141d30','--wall-blue':'#2c3f66','--tint-sand':'#241f14','--wall-sand':'#4d4128','--tint-clay':'#291a1a','--wall-clay':'#55332f',
        '--cwall-sage':'#3c6a54','--cwall-blue':'#3c5a92','--cwall-sand':'#6e5c36','--cwall-clay':'#7a4842',
        '--red-ink':'#ff9a8f','--amber-ink':'#ffc35c','--blue-ink':'#8fc3ff',
        /* the status fills of pills, tags and every .note card (permission, question, limit): a dark tint of each hue with a light ink (spec 102 RA6; the Clean Office
           values are cream, which put the page's light ink on cream, 1.4:1) */
        '--pb-working':'#142534','--pc-working':'#9dcdf1','--pb-thinking':'#161a36','--pc-thinking':'#9daff1','--pb-waiting':'#2e2410','--pc-waiting':'#f1d19d',
        '--pb-idle':'#25232f','--pc-idle':'#c9c6d6','--pb-error':'#2e1814','--pc-error':'#f1a49d','--pb-done':'#10281a','--pc-done':'#9df1bf',
        /* the other pale Clean Office fills still read by the arcade: a denied card, the limit chip, attachment notes (`--bad-bg`) and the drop overlay (`--drop-bg`, light `--drop-ink`) */
        '--bad-bg':'#2c1518','--drop-bg':'#141d30'},
      bar:{'--world-tint':'#ff77a8','--wb-bg':'#07060f','--wb-bg-2':'#000000','--wb-surface':'#16132b','--wb-surface-2':'#201b3c','--wb-ink':'#f4eefc','--wb-ink-2':'#d8d0ec',
        '--wb-muted':'#bdb5d6','--wb-line':'#2e2850','--wb-line-2':'#3f3768','--wb-line-ctl':'#8c84c0','--wb-focus':'#ffec27',
        '--wb-warn-bg':'#3a2a08','--wb-warn-ink':'#ffd166'},
      shadow:{'--shadow-card':'0 2px 0 rgba(0,0,0,.5)','--shadow-pop':'4px 4px 0 rgba(0,0,0,.6)'},
    },
    /* the cave: parchment-and-stone page, a bar of dark cave brown with torchlight gold (the logo's cave palette, spec 101 FR-033) */
    cave:{
      name:'Prehistoric cave', ui:'clean',
      page:{'--bg':'#e4d6bf','--surface':'#f7efe0','--surface-2':'#efe3cc','--raised':'#fbf5e8','--card':'#f7efe0','--soft':'#f3e9d6','--note':'#efe3cc',
        '--line':'#d9c6a6','--line-2':'#c2a87f','--line-ctl':'#86704f','--ink':'#2a1a10','--ink-2':'#4f3a28','--muted':'#5a4430',
        '--sage':'#b8793a','--sage-ink':'#7a3f14','--focus':'#8f4a10','--sel-border':'#a8672c','--sel-ring':'#efd9bb','--sel-ring-2':'#f1dfc4',
        '--stat-sel-border':'#a8672c','--stat-sel-ring':'#efd9bb','--brand-mark':'#fff1dc','--brand-bg':'#7a4420','--avatar-bg':'#ecdcc0'},
      bar:{'--world-tint':'#4a3524','--wb-bg':'#2a1710','--wb-bg-2':'#1c0f0a','--wb-surface':'#3b2418','--wb-surface-2':'#4a2f20','--wb-ink':'#f6e3c4','--wb-ink-2':'#e8cfa6',
        '--wb-muted':'#dcc29a','--wb-line':'#5c4030','--wb-line-2':'#6e4e3a','--wb-line-ctl':'#b08e6c','--wb-focus':'#f2b46e',
        '--wb-warn-bg':'#4e3010','--wb-warn-ink':'#f7cf8a'},
      shadow:{'--shadow-card':'0 1px 3px rgba(40,22,10,.12)','--shadow-pop':'0 18px 48px rgba(40,22,10,.34), 0 2px 6px rgba(40,22,10,.14)'},
    },
  };
  /* the tokens themes.css re-scopes inside the top bar ([--x, --wb-x]); the bar's menu gets the page values back as --wp-x */
  const WORLD_BAR_MAP=[['--bg','--wb-bg'],['--surface','--wb-surface'],['--surface-2','--wb-surface-2'],['--raised','--wb-surface'],['--ink','--wb-ink'],['--ink-2','--wb-ink-2'],
    ['--muted','--wb-muted'],['--line','--wb-line'],['--line-2','--wb-line-2'],['--line-ctl','--wb-line-ctl'],['--focus','--wb-focus'],
    ['--warn-bg','--wb-warn-bg'],['--amber-ink','--wb-warn-ink']];
  /* the text and mark pairs a world adds to 070 D4's (CONTRAST_PAIRS, and themegen's UI_PAIRS in the test): [fg, bg, minimum, over] where
     `over` composites the background as glass over black (panels) or white (the bar) */
  const WORLD_PAIRS=[['--wb-ink','--wb-bg',4.5,'#ffffff'],['--wb-ink','--wb-bg-2',4.5,'#ffffff'],['--wb-ink','--wb-surface',4.5,'#ffffff'],['--wb-ink','--wb-surface-2',4.5,'#ffffff'],
    ['--wb-ink-2','--wb-bg',4.5,'#ffffff'],['--wb-ink-2','--wb-surface',4.5,'#ffffff'],['--wb-muted','--wb-bg',4.5,'#ffffff'],['--wb-muted','--wb-surface',4.5,'#ffffff'],['--wb-muted','--wb-surface-2',4.5,'#ffffff'],
    ['--wb-line-ctl','--wb-surface',3,'#ffffff'],['--wb-warn-ink','--wb-warn-bg',4.5,'#ffffff'],['--wb-ink','--wb-warn-bg',4.5,'#ffffff'],['--wb-focus','--wb-bg',3,'#ffffff'],['--wb-focus','--wb-surface',3,'#ffffff'],
    ['--ink','--surface',4.5,'#000000'],['--ink-2','--surface',4.5,'#000000'],['--muted','--surface',4.5,'#000000'],['--ink','--surface-2',4.5,'#000000'],['--muted','--surface-2',4.5,'#000000'],
    ['--line-ctl','--surface',3,'#000000'],
    /* spec 070 FR-081 (#1278): the info tone's text pairs: the file chip (.att, .chip.att-chip, .btn.session), the ask tag (.mode-ask, .mtag), the plain text on a soft row (.note.mcpre, .pico-opt) */
    ['--tone-ok-ink','--tone-ok-soft',4.5,null],['--tone-ok-ink','--tone-ok-faint',4.5,null],['--tone-ok-ink','--tone-ok-hover',4.5,null],
    /* #1309 review: every other tone pair the CSS paints (.fl-focus and .sub-st.done: ok ink on ok bg; .mtag.extra, .hs-ok; .mtag.warn, .imp-block; .dlg .derr, .note.limit; .mtag.src; .scr-warn; .quick; .chip.fail, .btn.danger:hover), and the tone inks on the page they sit on (.scr-note.ok, .srv-org, .fl-err, .bnote) */
    ['--tone-ok-ink','--tone-ok-bg',4.5,null],['--tone-warn-ink','--tone-warn-bg',4.5,null],['--tone-warn-ink','--tone-warn-faint',4.5,null],['--tone-warn-ink','--tone-warn-soft',4.5,null],['--tone-warn-ink','--tone-warn-hover',4.5,null],
    ['--tone-bad-ink','--tone-bad-bg',4.5,null],['--tone-bad-ink','--tone-bad-soft',4.5,null],['--tone-idea-ink','--tone-idea-bg',4.5,null],
    ['--tone-ok-ink','--surface',4.5,null],['--tone-warn-ink','--surface',4.5,null],['--tone-bad-ink','--surface',4.5,null],
    ['--tone-info-ink','--tone-info-soft',4.5,null],['--tone-info-ink','--tone-info-faint',4.5,null],['--tone-info-ink','--tone-info-hover',4.5,null],['--ink','--tone-info-soft',4.5,null],['--ink-2','--tone-info-soft',4.5,null],
    /* a status card (.note: ink-2 on pb-waiting, .note.err: red-ink on pb-error) and the status pills (pc on pb), on the fill itself, no glass (spec 102 RA6) */
    ['--ink-2','--pb-waiting',4.5,null],['--ink','--pb-waiting',4.5,null],['--ink-2','--pb-error',4.5,null],['--amber-ink','--pb-waiting',4.5,null],['--red-ink','--pb-error',4.5,null],['--red-ink','--bad-bg',4.5,null],['--ink-2','--bad-bg',4.5,null],['--ink','--bad-bg',4.5,null],
    ['--pc-working','--pb-working',4.5,null],['--pc-thinking','--pb-thinking',4.5,null],['--pc-waiting','--pb-waiting',4.5,null],['--pc-idle','--pb-idle',4.5,null],['--pc-error','--pb-error',4.5,null],['--pc-done','--pb-done',4.5,null],
    ['--focus','--surface',3,null],['--focus','--bg',3,null],['--brand-bg','--wb-bg',1.5,null]];
  /* spec 070 FR-053: the bar's own pairs of WORLD_PAIRS, in the shared contrast check too (themegen.ts BAR_PAIRS) */
  const BAR_PAIRS=WORLD_PAIRS.filter(p=>p[0].startsWith('--wb-')&&p[1].startsWith('--wb-'));
  let currentWorld=null, worldResolved=null;
  function worldTokens(id){
    if(!own(WORLD_SETS,id))return null;
    const w=WORLD_SETS[id], t=Object.assign({},CLEAN_TOKENS,w.page,w.bar);
    for(const [k] of WORLD_BAR_MAP)t['--wp-'+k.slice(2)]=t[k];
    t['--wb-bar-shadow']='inset 0 1px 0 color-mix(in srgb,var(--wb-ink) 9%,transparent),0 6px 18px -8px color-mix(in srgb,var(--wb-bg-2) 85%,transparent)'; /* FR-226: the top bar's one shadow */
    return t;
  }
  function glassOver(v,over){const a=hex6(v),b=hex6(over);return '#'+[0,2,4].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*WORLD_GLASS+parseInt(b.slice(i,i+2),16)*(1-WORLD_GLASS)).toString(16).padStart(2,'0')).join('');}
  /* every pair of a world's set with its ratio: 070 D4's pairs on the resolved set, then the world's own (glass composited) */
  /* the tones (info, ok, warn, bad, idea) of styles.css :root as hex, from a token map: ink = --pc-working; soft, faint and hover = color-mix(in srgb, ...) of --pb-working with --surface (55%, 28%) and of --pb-working with --pc-working (12%).
     A world or theme that sets its own --tone-info-* keeps it (spec 070 FR-081); the guard measures what the CSS would show */
  function toneInfo(t){
    const d={};
    for(const [n,s] of [['info','working'],['ok','done'],['warn','waiting'],['bad','error'],['idea','thinking']]){
      const pb=t['--pb-'+s],pc=t['--pc-'+s];
      d['--tone-'+n+'-ink']=pc; d['--tone-'+n+'-bg']=pb; d['--tone-'+n+'-soft']=mixHex(t['--surface'],pb,0.55); d['--tone-'+n+'-faint']=mixHex(t['--surface'],pb,0.28);
      d['--tone-'+n+'-hover']=mixHex(pb,pc,0.12); d['--tone-'+n+'-line']=mixHex(pb,pc,0.26);
    }
    for(const k of Object.keys(d))if(own(t,k))d[k]=t[k];
    return Object.assign({},t,d);
  }
  function worldContrast(id){
    const t=worldTokens(id)&&toneInfo(worldTokens(id)); if(!t)return null;
    const out=[];
    const page=colorHex(t['--bg'],'#ffffff')||'#ffffff'; /* spec 070 FR-080: every colour form, a translucent one over the page (as contrastFix measures) */
    const hx=(k,over)=>colorHex(t[k],k==='--bg'?'#ffffff':(over||page));
    for(const [fg,bg,min] of CONTRAST_PAIRS){const b=hx(bg),a=b&&hx(fg,b);if(a&&b)out.push({fg,bg,min,ratio:ratio(a,b)});}
    const dark=!!WORLD_SETS[id].dark; /* a dark world's panels hold light ink: their worst backdrop is white, not black */
    for(const [fg,bg,min,o] of WORLD_PAIRS)for(const over of dark&&o==='#000000'?['#000000','#ffffff']:[o]){const b0=hx(bg),b=b0&&(over?glassOver(b0,over):b0),a=b&&hx(fg,b);if(!a||!b)continue;out.push({fg,bg:bg+(over?' (glass over '+over+')':''),min,ratio:ratio(a,b)});} /* a dark world: over black and over white, both (pre-review of #1079) */
    return out;
  }
  /* the UI style while a world is shown: the world's own, else the theme's (as setTheme sets it) */
  function uiNow(){
    if(typeof document==='undefined'||!document.documentElement)return;
    const el=document.documentElement, w=currentWorld&&WORLD_SETS[currentWorld].ui;
    if(w)el.dataset.ui=w;
    else if(currentId===CLEAN_ID||!currentManifest)delete el.dataset.ui;
    else el.dataset.ui=currentManifest.ui||'clean';
  }
  function paintWorld(){
    if(typeof document==='undefined'||!document.documentElement)return;
    const el=document.documentElement;
    if(currentWorld){
      applyTokens(worldResolved);
      for(const [k,v] of Object.entries(WORLD_SETS[currentWorld].shadow))el.style.setProperty(k,v);
      el.dataset.world=currentWorld;
      if(WORLD_SETS[currentWorld].dark)el.dataset.dark='';else delete el.dataset.dark; /* a light world's bar is dark by its own rules */
      uiNow();
    }
  }
  /* FR-100: Real office shows `id`'s world (null: flat, the user's theme again). Unknown ids are null. Returns the world shown. */
  function setWorld(id){
    const want=id!=null&&own(WORLD_SETS,id)?id:null;
    if(want===currentWorld)return currentWorld;
    const was=currentWorld;
    currentWorld=want; worldResolved=want?worldTokens(want):null;
    if(want){
      /* retro to photo or cave: keys only the world just left sets (the arcade's --tone-*) must not stay on <html> (#1309 review) */
      if(was&&typeof document!=='undefined'&&document.documentElement){const keep=worldTokens(want);for(const k of Object.keys(worldTokens(was)))if(!own(CLEAN_TOKENS,k)&&!own(keep,k))document.documentElement.style.removeProperty(k);}
      paintWorld();
    }
    else if(was&&typeof document!=='undefined'&&document.documentElement){
      const el=document.documentElement;
      for(const k of Object.keys(worldTokens(was)))if(!own(CLEAN_TOKENS,k))el.style.removeProperty(k);
      delete el.dataset.world;
      uiNow();
      applyTokens(currentResolved||resolveTokens(currentManifest));
      for(const k of Object.keys(WORLD_SETS[was].shadow)){const m=currentManifest&&currentManifest.tokens;if(own(m,k))el.style.setProperty(k,m[k]);else el.style.removeProperty(k);}
      if(isDarkColor((currentResolved||{})['--surface']))el.dataset.dark='';else delete el.dataset.dark;
    }
    themeRev++;
    listeners.forEach(fn=>{ try{fn(currentId, currentManifest);}catch(e){console.warn('[theme] listener error',e);} });
    return currentWorld;
  }
  function world(){return currentWorld;}
  function worldName(id){return own(WORLD_SETS,id)?WORLD_SETS[id].name:'';}

  function current(){return {id:currentId, manifest:currentManifest};}
  function token(name){
    const key=name.startsWith('--')?name:'--'+name;
    /* the resolved map: the pack's values after the contrast fallback (spec 070 FR-021), so the scenes draw what the CSS shows */
    if(worldResolved&&Object.prototype.hasOwnProperty.call(worldResolved,key))return worldResolved[key]; /* spec 097 FR-113: Real office's world set */
    if(currentResolved&&Object.prototype.hasOwnProperty.call(currentResolved,key))return currentResolved[key];
    return own(CLEAN_TOKENS,key)?CLEAN_TOKENS[key]:(own(TYPED_TOKENS,key)?TYPED_TOKENS[key].def:null);
  }
  /* spec 070 FR-010: the pack's shirt and hair palettes, or null */
  function figures(){const f=currentManifest&&currentManifest.figures;return f&&(f.shirts||f.hairs)?f:null;}
  /* spec 070 FR-022: what a theme could not use: dropped values and text pairs set back to Clean Office */
  function fallbacks(id){
    const m=loadManifest(id);
    if(!m)return {dropped:[],contrast:[],unmeasured:[]};
    const r=resolveTokens(m),user=!own(BUILT_IN,m.id);
    return {dropped:(m.dropped||[]).slice(),contrast:user?contrastFix(r):[],unmeasured:user?unmeasured(r):[]}; /* spec 070 FR-080: unmeasured = the colours a pair could not measure */
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
  /* spec 040 FR-032: a removed theme is forgotten at once (the picker lists what main has, but a stale id must not resolve) */
  function forgetUser(id){if(typeof id==='string')delete USER_MANIFESTS[id];}
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
    toneInfo, /* spec 070 FR-081: test:theme-tokens measures the info tone of every built-in theme too */
    parseColor, colorHex, NAMED_COLOURS:NAMED, unmeasured, /* spec 070 FR-080: test:theme-tokens */
    setWorld,
    world,
    worldName,
    worldTokens,
    worldContrast,
    WORLD_IDS:Object.keys(WORLD_SETS),
    WORLD_GLASS,
    WORLD_BAR_MAP:WORLD_BAR_MAP.map(p=>p.slice()),
    TYPED_TOKENS:JSON.parse(JSON.stringify(TYPED_TOKENS)),
    BAR_TOKENS:Object.assign({},BAR_TOKENS),
    BAR_PAIRS:BAR_PAIRS.map(p=>p.slice()),
    FONT_ALLOW:FONT_ALLOW.slice(),
    CONTRAST_PAIRS:CONTRAST_PAIRS.map(p=>p.slice()),
    _typedValue:typedValue,
    _HOSTILE_RE:HOSTILE_RE,
    registerBuiltIn,
    registerUserThemes,
    forgetUser,
    MOTION_PRESETS,
    _sanitizeSlot:sanitizeSlot,
    _isTokenValue:isTokenValue, _TOKEN_VALUE_MAX:TOKEN_VALUE_MAX, _COLOUR_NUM_RE:COLOUR_NUM_RE, _COLOUR_HUE_RE:COLOUR_HUE_RE,
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
    SET_CHOICES:SET_CHOICES.slice(),
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
