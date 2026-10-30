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
    'court':{bar:'5s ease-in-out infinite alternate',glow:'7s ease-in-out infinite alternate',halo:'6s ease-in-out infinite alternate',wave:'4s ease-in-out infinite',cursor:'2.2s ease-in-out infinite'},
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
  const UI_STYLES=['clean','corporate','retro','court-indian','court-european','court-japanese'];
  /* Scene kits (spec 035 FR-013): how people and desks are drawn; the drawing code is the app's (scenekits.js). */
  const SCENE_KITS=['office','corporate','pixel','court-indian','court-european','court-japanese','crew'];
  /* Characters, separate from themes (spec 077 FR-064, FR-065): who sits at the desks. 'theme' is the theme's own kit (the default);
     the others name a kit that is drawn on top of any theme. The same list and rule as src/shared/characters.ts (test:characters). */
  const CHARACTERS=['theme','minimalist','cheeky','prehistoric'];
  const CHARACTER_KITS={minimalist:'office',cheeky:'crew',prehistoric:'crew'};
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
    .concat([['--drop-ink','--drop-bg',4.5],['--brand-mark','--brand-bg',3],['--idle-stub-ink','--idle-stub',3],['--desk-new','--card',3],['--desk-needs','--card-waiting',3]]);
  const HEX_ANY=/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  function lum(hex){
    let h=HEX_ANY.exec(hex)[1]; if(h.length===3)h=h.split('').map(c=>c+c).join(''); h=h.slice(0,6);
    const ch=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4));
    return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];
  }
  function ratio(a,b){const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);}
  /* spec 070 FR-023: the surfaces a theme is built on. A failing pair never changes them, so a dark theme stays dark and a light one light */
  const BASE_SURFACE=/^--(bg|surface|surface-2|raised|card(-[a-z]+)?|soft|note|pb-[a-z]+|drop-bg|brand-bg|idle-stub)$/;
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
        const k=BASE_SURFACE.test(fg)&&!BASE_SURFACE.test(bg)?bg:fg;
        const v=readableOn(t[k],t[k===fg?bg:fg],min);
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
  /* User themes (spec 040): the main process passes validated manifests; id becomes selectable. */
  function registerUserThemes(listOrMap){
    USER_MANIFESTS={};
    if(listOrMap&&typeof listOrMap==='object'){
      for(const [id,m] of Object.entries(listOrMap)){
        const v=validateManifest(m);
        if(v&&v.id===id&&!own(BUILT_IN,id))USER_MANIFESTS[id]=v;
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

  /* ================================= built-in packs (specs 037-039) =================================
     Data-only: tokens (only Clean Office keys are meaningful), sanitized art slots, scene words,
     one motion preset. Status/permission/credit wording never changes; layout is never themed. */

  /* ---- 037: Corporate — glass and steel, cool neutrals ---- */
  registerBuiltIn({
    id:'corporate', name:'Corporate', author:'Three Feathers', version:'1.0', extends:'clean-office',
    ui:'corporate',
    scene:'corporate',
    tokens:{
      '--bg':'#e6eaef','--surface':'#ffffff','--surface-2':'#eceff3' /* spec 052 FR-032: a greyer 1997-office panel */,'--line':'#d2d9e1','--line-2':'#b4bfcc',
      '--ink':'#142131','--ink-2':'#33455a','--muted':'#55677b','--room-path':'#4b5d71',
      '--sage':'#7fa3b8','--sage-ink':'#2c5468','--blue':'#5b83ad','--blue-ink':'#2a5578',
      '--amber':'#c98f2b','--amber-ink':'#7a5505','--red':'#c05a50','--red-ink':'#8e382f','--green':'#4f8f6a','--gray':'#8f99a3',
      '--c-working':'#5b83ad','--c-thinking':'#7d8fb0','--c-waiting':'#c98f2b','--c-idle':'#97a1ab','--c-error':'#c05a50','--c-done':'#4f8f6a',
      '--halo-working':'#5b83ad','--halo-thinking':'#7d8fb0','--halo-waiting':'#c98f2b','--halo-error':'#c05a50',
      '--chair':'#2f3946','--desk':'#bcd4e6','--desk-front':'#cfd7de','--desk-drawer':'#c0c9d2',
      '--monitor-stand':'#8a96a3','--monitor-frame':'#1d232b','--laptop':'#c7cfd8',
      '--screen-working':'#e8f0f7','--screen-thinking':'#e9edf4','--screen-waiting':'#f7eeda','--screen-idle':'#d5dadd','--screen-error':'#f6e3e0','--screen-done':'#e2eee7',
      '--bar-sage':'#7fa3b8','--bar-blue':'#5b83ad','--bar-blue-2':'#9fb6cb',
      '--bubble-line':'#c6d0dd','--think-dot':'#7d8fb0',
      '--cup':'#eef2f5','--cup-line':'#b9c4cc','--steam':'#a4adb5',
      '--plant-mid':'#93ab9a','--plant-dark':'#7b9883','--plant-light':'#a4b7aa','--pot':'#a8b2ba',
      '--link':'#9aa9b4',
      '--door-bg':'#e9edf1','--door-line':'#a8b4bf','--door-leaf':'#c9d1d9','--door-leaf-line':'#9faab6','--door-knob':'#77828c','--door-panel':'#e1e7ec',
      '--brand-mark':'#ffffff','--brand-bg':'#1f5fa8','--focus':'#1f6fc5','--line-ctl':'#77838f',
      '--sel-border':'#2f74c0','--sel-ring':'#cfe0f4','--sel-ring-2':'#d6e5f5','--stat-sel-border':'#2f74c0','--stat-sel-ring':'#d6e5f5',
      '--avatar-bg':'#dfe7ee','--walker-bg':'#ffffff','--drop':'#6b93b8','--drop-bg':'rgb(229 238 246 / .93)','--drop-ink':'#23415c',
      '--badge-idle':'#aab2ba','--place-busy':'#7fa7d1',
      '--tint-sage':'#eef6f3','--wall-sage':'#1f8a70','--tint-blue':'#edf3fa','--wall-blue':'#2f6fb5','--tint-sand':'#f8f3e6','--wall-sand':'#b08427','--tint-clay':'#f9efed','--wall-clay':'#b0524a',
      '--cwall-sage':'#1f8a70','--cwall-blue':'#2f6fb5','--cwall-sand':'#b08427','--cwall-clay':'#b0524a',
      '--pb-working':'#dfe9f2','--pc-working':'#29506f','--pb-thinking':'#e6e9f1','--pc-thinking':'#3d4a72',
      '--pb-waiting':'#f7ecd2','--pc-waiting':'#7a5505','--pb-idle':'#e7eaeb','--pc-idle':'#50575c',
      '--pb-error':'#f6e2de','--pc-error':'#8e382f','--pb-done':'#dfeede','--pc-done':'#2d6142',
      '--proto-line':'#eed9ac',
      '--ic-read':'#4c6f8a','--ic-edit':'#6d7f52','--ic-run':'#37658a','--ic-search':'#7d6a44','--ic-tool':'#6c7683',
    },
    words:{'place-library':'Records','place-coffee':'Break room','place-boss':'Corner office','place-bank':'Finance','place-postbox':'Mailroom','boss-note':'Went to the corner office','place-software':'Repository','place-terminal':'Server room','place-web':'Network','place-other':'Facilities','lobby-label':'Reception: the places where agents work'},
    motion:{preset:'calm'},
    art:{
      /* suit collar + tie under the neck, briefcase on the desk, glass wall with a skyline, blinds,
         floor sheen lanes, steel frame in the lobby, corporate signage on the place tiles */
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

  /* ---- 039a: Durbar — Indian court (maroon, gold, sandalwood) ---- */
  registerBuiltIn({
    id:'durbar-indian', name:'Durbar · Indian Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    ui:'court-indian',
    scene:'court-indian',
    tokens:{
      '--bg':'#f3e6cc','--surface':'#fffaf0','--surface-2':'#fbf1dd','--line':'#e2c991','--line-2':'#b8892f',
      '--ink':'#3b1d14','--ink-2':'#5e3424','--muted':'#76503e','--room-path':'#6b4130',
      '--sage':'#8aab84','--sage-ink':'#3f6238','--blue':'#7d95b5','--blue-ink':'#3a5a80','--amber':'#d9962b','--amber-ink':'#80530a',
      '--red':'#b85448','--red-ink':'#8e3226','--green':'#5f9a76','--gray':'#a39a87',
      '--c-working':'#7d95b5','--c-thinking':'#9a8fbd','--c-waiting':'#d9962b','--c-idle':'#aca496','--c-error':'#b85448','--c-done':'#5f9a76',
      '--halo-working':'#7d95b5','--halo-thinking':'#9a8fbd','--halo-waiting':'#d9962b','--halo-error':'#b85448',
      '--chair':'#8a1c2c','--desk':'#9a6436','--desk-front':'#b07a45','--desk-drawer':'#b07c50',
      '--monitor-stand':'#6e6560','--monitor-frame':'#5a2a1c','--laptop':'#7d746a',
      '--screen-working':'#f2ecdc','--screen-thinking':'#ece7f0','--screen-waiting':'#f8edd4','--screen-idle':'#d6d2c6','--screen-error':'#f6e0da','--screen-done':'#e2efe6',
      '--bar-sage':'#8aab84','--bar-blue':'#7d95b5','--bar-blue-2':'#b3c2d8',
      '--face-dark':'#3a2c26','--mouth':'#7c4638',
      '--plant-mid':'#a9bf92','--plant-dark':'#8aa474','--plant-light':'#bccba6','--pot':'#b8626a',
      '--link':'#b3a68c','--star':'#d99a2c',
      '--door-bg':'#f0e4cc','--door-line':'#a98b62','--door-leaf':'#cf9a5e','--door-leaf-line':'#a87b48','--door-knob':'#8a6436','--door-panel':'#e6d4ae',
      '--brand-mark':'#f2c75c','--brand-bg':'#8a1c2c','--focus':'#0f6e6e','--line-ctl':'#9a7228',
      '--sel-border':'#b5302f','--sel-ring':'#f3d9a8','--sel-ring-2':'#f3d9a8','--stat-sel-border':'#b5302f','--stat-sel-ring':'#f3d9a8',
      '--avatar-bg':'#eee2ca','--walker-bg':'#fffaf0','--drop':'#a87b48','--drop-bg':'rgb(244 236 220 / .93)','--drop-ink':'#5c3c18',
      '--badge-idle':'#bfb49e','--place-busy':'#d4a240',
      '--tint-sage':'#eef0d8','--wall-sage':'#8a9a3a','--tint-blue':'#ddeeed','--wall-blue':'#0f6e6e','--tint-sand':'#fbe7c4','--wall-sand':'#d9822b','--tint-clay':'#f8dfdb','--wall-clay':'#a8343f',
      '--cwall-sage':'#8a9a3a','--cwall-blue':'#0f6e6e','--cwall-sand':'#d9822b','--cwall-clay':'#a8343f',
      '--pb-working':'#e2e9f2','--pc-working':'#315074','--pb-thinking':'#e8e4f2','--pc-thinking':'#4a3f80',
      '--pb-waiting':'#f8ebcf','--pc-waiting':'#80530a','--pb-idle':'#eae4d6','--pc-idle':'#5c544a',
      '--pb-error':'#f6e0dc','--pc-error':'#8e3226','--pb-done':'#ddeede','--pc-done':'#2f6240',
      '--proto-line':'#ecd3a2',
      '--ic-read':'#54749a','--ic-edit':'#7f8a54','--ic-run':'#8c4a3c','--ic-search':'#8a6f3c','--ic-tool':'#7c7286',
    },
    art:{
      /* a turban arc + jewel on the head (abstract, geometric); sits with every hairstyle */
      'plant':'<circle cx="13" cy="10" r="4.5" fill="var(--plant-mid)"/><circle cx="8" cy="14" r="3" fill="var(--plant-dark)"/><circle cx="18" cy="14" r="3" fill="var(--plant-light)"/><path d="M8 21h10l-1.5 8h-7z" fill="var(--pot)"/>',
      /* court attire: a sherwani/robe silhouette over the torso + sash; drawn before the head so hair/turban stay on top */
      /* royal durbar hall: arched colonnade + jharokha panels on the wall, a rich carpet below */
      /* spec 052 FR-032: the colonnade is pale gold (--line) and faint, so its pillars read as the wall behind the cards, not table legs */
      'room-back-wall':'<g fill="none" stroke="#e2c991" stroke-width="2.4" opacity=".45"><path d="M8 118V50Q8 22 30 22Q52 22 52 50V118"/><path d="M134 118V50Q134 22 160 22Q186 22 186 50V118"/><path d="M268 118V50Q268 22 290 22Q312 22 312 50V118"/></g><path d="M8 44Q30 36 52 44M134 44Q160 36 186 44M268 44Q290 36 312 44" fill="none" stroke="#8c2f3e" stroke-width="1.6" opacity=".8"/><circle cx="30" cy="28" r="2.6" fill="#d9a441"/><circle cx="160" cy="28" r="2.6" fill="#d9a441"/><circle cx="290" cy="28" r="2.6" fill="#d9a441"/><path d="M60 30h62v16H60zM196 30h62v16h-62z" fill="#efe0c0" stroke="#b98a3c" stroke-width="1.2" opacity=".8"/><path d="M64 34h54M64 38h54M64 42h54M200 34h50M200 38h50M200 42h50" stroke="#c9a85c" stroke-width=".8" opacity=".7"/>',
      'room-floor':'<path d="M40 118L80 52h168l40 66z" fill="#8c2f3e" opacity=".9"/><path d="M50 118L86 58h156l36 60" fill="none" stroke="#d9a441" stroke-width="2.4"/><path d="M58 118L90 64h148l32 54" fill="none" stroke="#e8d0a0" stroke-width="1.2" stroke-dasharray="6 4" opacity=".8"/><path d="M78 94h172" stroke="#d9a441" stroke-width="1.4" opacity=".7"/><path d="M70 106h188" stroke="#d9a441" stroke-width="1.1" opacity=".55"/>',
      'door-art':'<path d="M9.6 2.5Q9.6 6.6 6.4 8.2M10.2 2.5Q10.2 6.9 7.4 9" fill="none" stroke="#a98b62" stroke-width=".9"/><circle cx="13.6" cy="4.4" r=".9" fill="#d9a441"/><circle cx="13.6" cy="4.4" r=".45" fill="#8c2f3e"/>',
      'lobby-art':'<path d="M0 33h320" stroke="#b98a3c" stroke-width="1.6" opacity=".7"/><path d="M0 30h320" stroke="#e3d0a8" stroke-width=".9" stroke-dasharray="10 6" opacity=".7"/><path d="M20 30Q24 18 30 30M290 30Q296 18 300 30" fill="none" stroke="#8c2f3e" stroke-width="1.4" opacity=".8"/>',
      'place-library':'<path d="M4 17V8Q10 4 16 8v9z"/><path d="M4 17h12M7 8v9M13 8v9"/><circle cx="10" cy="6.4" r="1" opacity=".8"/>',
      'place-software':'<path d="M4 17V7q6-3.6 12 0v10z"/><path d="M4 12h12M8 4.5V17M12 4.5V17"/>',
      'place-terminal':'<path d="M3 17V9Q10 3.5 17 9v8z"/><path d="M6.5 11h7M6.5 14h7"/>',
      'place-web':'<circle cx="10" cy="10" r="6.6"/><path d="M3.4 10h13.2M10 3.4q3.6 3.2 0 13.2M10 3.4q-3.6 3.2 0 13.2"/>',
      'place-other':'<path d="M10 3l2.2 4.6L17 8.6l-3.7 3.4 1 5-4.3-2.6L5.7 17l1-5L3 8.6l4.8-1z"/>',
    },
    words:{'place-library':'Records Kothi','place-coffee':'Chai stall','place-boss':'Diwan-e-Khas','place-bank':'Khazana','place-postbox':'Dak ghar','boss-note':'Went to the Diwan-e-Khas','place-software':'Shastra Ghar','place-terminal':'Yantra Kaksh','place-web':'Jaal Khidki','place-other':'Chhota Kaam','lobby-label':'The durbar: the places where agents work','door-close':'Close gate','door-open':'Open gate','door-title-prefix':'Close the gate'},
    motion:{preset:'court'},
  });

  /* ---- 039b: Durbar — European court (navy, silver, parchment) ---- */
  registerBuiltIn({
    id:'durbar-european', name:'Durbar · European Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    ui:'court-european',
    scene:'court-european',
    tokens:{
      '--bg':'#e9e2d1','--surface':'#fffdf7','--surface-2':'#f6f1e4','--line':'#d9cba6','--line-2':'#b8995a',
      '--ink':'#1b2240','--ink-2':'#3b4266','--muted':'#585d7c','--room-path':'#4c5274',
      '--sage':'#8fa9a0','--sage-ink':'#3f6258','--blue':'#5f7fae','--blue-ink':'#2c4a78','--amber':'#d2a03c','--amber-ink':'#7a5c0e',
      '--red':'#bf5a6a','--red-ink':'#8e3642','--green':'#5f9a76','--gray':'#9a9884',
      '--c-working':'#5f7fae','--c-thinking':'#8a8fbd','--c-waiting':'#d2a03c','--c-idle':'#a6a29a','--c-error':'#bf5a6a','--c-done':'#5f9a76',
      '--halo-working':'#5f7fae','--halo-thinking':'#8a8fbd','--halo-waiting':'#d2a03c','--halo-error':'#bf5a6a',
      '--chair':'#8e2a3a','--desk':'#6b2f1f','--desk-front':'#7a3a26','--desk-drawer':'#866c42',
      '--monitor-stand':'#62687a','--monitor-frame':'#2a1f18','--laptop':'#767b8e',
      '--screen-working':'#e6edf6','--screen-thinking':'#eae8f3','--screen-waiting':'#f6eed6','--screen-idle':'#d4d6d2','--screen-error':'#f6e2e2','--screen-done':'#e0eee4',
      '--bar-sage':'#8fa9a0','--bar-blue':'#5f7fae','--bar-blue-2':'#a2b4d0',
      '--bubble-line':'#c2c8e0','--think-dot':'#8a8fbd',
      '--cup':'#f2f0e6','--cup-line':'#b8ae8e','--steam':'#a2a096',
      '--plant-mid':'#92b294','--plant-dark':'#779c7a','--plant-light':'#a6c2a8','--pot':'#8a6f4c',
      '--link':'#9aa4b0','--star':'#d2a03c',
      '--door-bg':'#ece6d8','--door-line':'#a89a78','--door-leaf':'#b8a272','--door-leaf-line':'#96845c','--door-knob':'#6e5c34','--door-panel':'#e2d8bc',
      '--brand-mark':'#e2bf63','--brand-bg':'#1b2a4e','--focus':'#2b4c9a','--line-ctl':'#8f7642',
      '--sel-border':'#7a1f35','--sel-ring':'#ead9b0','--sel-ring-2':'#ead9b0','--stat-sel-border':'#7a1f35','--stat-sel-ring':'#ead9b0',
      '--avatar-bg':'#e2e4ec','--walker-bg':'#fffdf7','--drop':'#7d94c2','--drop-bg':'rgb(232 236 246 / .93)','--drop-ink':'#2a3a66',
      '--badge-idle':'#b6b4a4','--place-busy':'#b8995a',
      '--tint-sage':'#e5ece2','--wall-sage':'#3f6b4f','--tint-blue':'#e4e9f4','--wall-blue':'#2b3f7a','--tint-sand':'#f4ebd3','--wall-sand':'#b08a35','--tint-clay':'#f2e2e2','--wall-clay':'#7a1f35',
      '--cwall-sage':'#3f6b4f','--cwall-blue':'#2b3f7a','--cwall-sand':'#b08a35','--cwall-clay':'#7a1f35',
      '--pb-working':'#dee6f2','--pc-working':'#2a4268','--pb-thinking':'#e6e4f2','--pc-thinking':'#41407a',
      '--pb-waiting':'#f6ecd0','--pc-waiting':'#7a5c0e','--pb-idle':'#e8e6dc','--pc-idle':'#585650',
      '--pb-error':'#f6e2e4','--pc-error':'#8e3642','--pb-done':'#ddeee0','--pc-done':'#2f6240',
      '--proto-line':'#ead5a8',
      '--ic-read':'#52688c','--ic-edit':'#7d814e','--ic-run':'#3e5f90','--ic-search':'#867040','--ic-tool':'#6e7286',
    },
    art:{
      /* a crown: three points and a base band */
      'plant':'<path d="M13 3l7 9h-14z" fill="var(--plant-dark)"/><path d="M13 8l6 8H7z" fill="var(--plant-mid)"/><path d="M8 21h10l-1.5 8h-7z" fill="var(--pot)"/>',
      /* ermine-look collar + a gown skirt over the torso (fur spots are abstract dots, no heraldry) */
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
    words:{'place-library':'The Archive','place-coffee':'The Tea Room','place-boss':'The Chancellor','place-bank':'The Treasury','place-postbox':'The Post','boss-note':'Went to see the Chancellor','place-software':'The Atelier','place-terminal':'The Forge','place-web':'The Messenger Hall','place-other':'The Household', /* spec 052 FR-023: court words, not Victorian industry */'lobby-label':'The court: the places where agents work'},
    motion:{preset:'court'},
  });

  /* ---- 039c: Durbar — Japanese court (indigo, vermilion, rice paper) ---- */
  registerBuiltIn({
    id:'durbar-japanese', name:'Durbar · Japanese Court', author:'Three Feathers', version:'1.0', extends:'clean-office',
    ui:'court-japanese',
    scene:'court-japanese',
    tokens:{
      '--bg':'#ede6d8','--surface':'#fdfbf5','--surface-2':'#f6f1e6','--line':'#d6cdb9','--line-2':'#a99c80',
      '--ink':'#1c1a17','--ink-2':'#3f3a33','--muted':'#5f584e','--room-path':'#575047',
      '--sage':'#8aa88e','--sage-ink':'#3c6244','--blue':'#5878ac','--blue-ink':'#2c4a78','--amber':'#d29838','--amber-ink':'#7a580e',
      '--red':'#c24a42','--red-ink':'#8c2e26','--green':'#5c9a70','--gray':'#9c9886',
      '--c-working':'#5878ac','--c-thinking':'#8b90bc','--c-waiting':'#d29838','--c-idle':'#a8a496','--c-error':'#c24a42','--c-done':'#5c9a70',
      '--halo-working':'#5878ac','--halo-thinking':'#8b90bc','--halo-waiting':'#d29838','--halo-error':'#c24a42',
      '--chair':'#c3bca8','--desk':'#4a3b2c','--desk-front':'#5c4936','--desk-drawer':'#3f3226', /* spec 052 FR-032: warm lacquer */
      '--monitor-stand':'#2b2420','--monitor-frame':'#1c1a17','--laptop':'#4a3b2c' /* lacquer, not office grey */,
      '--screen-working':'#e7eef8','--screen-thinking':'#eae9f2','--screen-waiting':'#f7eed4','--screen-idle':'#d5d6ce','--screen-error':'#f6e2dc','--screen-done':'#e1efe2',
      '--bar-sage':'#8aa88e','--bar-blue':'#5878ac','--bar-blue-2':'#9cb2d4',
      '--face-dark':'#262430','--mouth':'#7c443a',
      '--bubble-line':'#c4c8e0','--think-dot':'#8b90bc',
      '--plant-mid':'#96b296','--plant-dark':'#7a9a7a','--plant-light':'#aabf9f','--pot':'#c23b22' /* shu vermilion */,
      '--link':'#9aa0ac','--star':'#d29838',
      '--door-bg':'#e9e3d3','--door-line':'#a39874','--door-leaf':'#c0ab7c','--door-leaf-line':'#9c8c62','--door-knob':'#6e5c36','--door-panel':'#ddd2b8',
      '--brand-mark':'#fdfbf5','--brand-bg':'#c23b22','--focus':'#2c4a7e','--line-ctl':'#857a63',
      '--sel-border':'#c23b22','--sel-ring':'#f0d5cc','--sel-ring-2':'#f0d5cc','--stat-sel-border':'#c23b22','--stat-sel-ring':'#f0d5cc',
      '--avatar-bg':'#e2e2da','--walker-bg':'#fdfbf5','--drop':'#7d90bc','--drop-bg':'rgb(233 236 246 / .93)','--drop-ink':'#2a3c64',
      '--badge-idle':'#b8b4a2','--place-busy':'#8c9db8',
      '--tint-sage':'#e8ecdd','--wall-sage':'#6b7d4a','--tint-blue':'#e3e8f0','--wall-blue':'#2c4a7e','--tint-sand':'#f3ecdb','--wall-sand':'#a88a52','--tint-clay':'#efe4dc','--wall-clay':'#b5432e',
      '--cwall-sage':'#6b7d4a','--cwall-blue':'#2c4a7e','--cwall-sand':'#a88a52','--cwall-clay':'#b5432e',
      '--pb-working':'#dfe6f2','--pc-working':'#28466e','--pb-thinking':'#e6e4f2','--pc-thinking':'#41427c',
      '--pb-waiting':'#f7ecd1','--pc-waiting':'#7a580e','--pb-idle':'#e8e5da','--pc-idle':'#565450',
      '--pb-error':'#f6e1dc','--pc-error':'#8c2e26','--pb-done':'#deeddc','--pc-done':'#2e6038',
      '--proto-line':'#ead3a4',
      '--ic-read':'#4e6c92','--ic-edit':'#7c804e','--ic-run':'#40548e','--ic-search':'#846c3c','--ic-tool':'#6c7080',
    },
    art:{
      /* a small bonsai pine: a short twisted trunk, three flat cloud pads, a shallow vermilion pot */
      'plant':'<path d="M12.4 23.4c-1.8-2.4 1.6-4 .2-6.4c-.9-1.7 1.2-3.2 1.6-6" fill="none" stroke="#4a3424" stroke-width="2.2" stroke-linecap="round"/><path d="M12.4 17.6c-1.8-.7-3.6-.4-5.2.6M13.8 13.4c1.8-.5 3.6-.2 5 .9" fill="none" stroke="#4a3424" stroke-width="1.2" stroke-linecap="round"/><g fill="#2f5233"><ellipse cx="7" cy="17.6" rx="4.6" ry="1.9"/><ellipse cx="19.4" cy="13.8" rx="4.4" ry="1.8"/><ellipse cx="13.6" cy="8.8" rx="5.2" ry="2.2"/></g><g fill="#4a6e44"><ellipse cx="7.4" cy="16.9" rx="3" ry=".9"/><ellipse cx="19.6" cy="13.1" rx="2.8" ry=".8"/><ellipse cx="13.8" cy="8" rx="3.4" ry="1"/></g><rect x="5" y="23" width="16" height="1.6" rx=".4" fill="var(--pot)"/><rect x="6.5" y="24.4" width="13" height="3.6" fill="var(--pot)"/><rect x="7.5" y="28" width="2" height="1" fill="#2b2420"/><rect x="16.5" y="28" width="2" height="1" fill="#2b2420"/>',
      /* tatami floor (woven mats), shoji screen wall panels, hanging scroll hints */
      'room-back-wall':'<g fill="#f3efe2" stroke="#a89a74" stroke-width="1.6" opacity=".92"><rect x="16" y="14" width="76" height="52" rx="1.5"/><rect x="104" y="14" width="76" height="52" rx="1.5"/><rect x="192" y="14" width="76" height="52" rx="1.5"/><rect x="280" y="14" width="28" height="52" rx="1.5"/></g><g stroke="#c2b48e" stroke-width=".8" opacity=".75"><path d="M35 14v52M54 14v52M73 14v52M123 14v52M142 14v52M161 14v52M211 14v52M230 14v52M249 14v52M290 14v52M299 14v52M16 31h76M16 48h76M104 31h76M104 48h76M192 31h76M192 48h76M280 31h28M280 48h28"/></g><rect x="94" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/><rect x="182" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/><rect x="270" y="8" width="3.4" height="58" fill="#8a7a52" opacity=".6"/>',
      /* spec 052 FR-032: tatami, not beige strips: rush-straw mats (#d9cfa8) with a thin darker edge, a dark cloth
         border (heri, #3a2f22, full opacity) on the long sides and a faint weave */
      'room-floor':'<g stroke="#8f7f58" stroke-width=".8"><rect x="24" y="74" width="120" height="22" rx="1" fill="#d9cfa8"/><rect x="156" y="74" width="120" height="22" rx="1" fill="#d3c89f"/><rect x="24" y="98" width="120" height="22" rx="1" fill="#d3c89f"/><rect x="156" y="98" width="120" height="22" rx="1" fill="#d9cfa8"/></g><path d="M30 74v22M30 98v22M36 74v22M36 98v22M42 74v22M42 98v22M48 74v22M48 98v22M54 74v22M54 98v22M60 74v22M60 98v22M66 74v22M66 98v22M72 74v22M72 98v22M78 74v22M78 98v22M84 74v22M84 98v22M90 74v22M90 98v22M96 74v22M96 98v22M102 74v22M102 98v22M108 74v22M108 98v22M114 74v22M114 98v22M120 74v22M120 98v22M126 74v22M126 98v22M132 74v22M132 98v22M138 74v22M138 98v22M162 74v22M162 98v22M168 74v22M168 98v22M174 74v22M174 98v22M180 74v22M180 98v22M186 74v22M186 98v22M192 74v22M192 98v22M198 74v22M198 98v22M204 74v22M204 98v22M210 74v22M210 98v22M216 74v22M216 98v22M222 74v22M222 98v22M228 74v22M228 98v22M234 74v22M234 98v22M240 74v22M240 98v22M246 74v22M246 98v22M252 74v22M252 98v22M258 74v22M258 98v22M264 74v22M264 98v22M270 74v22M270 98v22" stroke="#b5a77e" stroke-width=".5" opacity=".6"/><g fill="#3a2f22"><rect x="24" y="74" width="120" height="2"/><rect x="24" y="94" width="120" height="2"/><rect x="156" y="74" width="120" height="2"/><rect x="156" y="94" width="120" height="2"/><rect x="24" y="98" width="120" height="2"/><rect x="24" y="118" width="120" height="2"/><rect x="156" y="98" width="120" height="2"/><rect x="156" y="118" width="120" height="2"/></g>',
      'door-art':'<rect x="5.6" y="3.8" width="8.8" height="12.4" rx=".8" fill="none" stroke="#9c8c62" stroke-width=".9"/><path d="M8 3.8v12.4M11.6 3.8v12.4M5.6 8h8.8M5.6 12.2h8.8" stroke="#c2b48e" stroke-width=".6"/>',
      'lobby-art':'<path d="M0 32h320" stroke="#a89a74" stroke-width="1.5" opacity=".7"/><path d="M30 32V12M60 32V12M90 32V12M230 32V12M260 32V12M290 32V12" stroke="#c2b48e" stroke-width=".9" opacity=".55"/><rect x="140" y="6" width="40" height="10" rx="2" fill="none" stroke="#8a7a52" stroke-width="1.1" opacity=".7"/><path d="M144 11h32" stroke="#c24a42" stroke-width="1.3" opacity=".75"/>',
      'place-library':'<path d="M4 17V6h5v11zM9 17V8h5v9z"/><path d="M14 16.6l1.5-9.4 2.8 1-1.6 9.4"/><path d="M3.4 17h13.4"/>',
      'place-software':'<rect x="4" y="5" width="12" height="3.6" rx="1.2"/><rect x="4" y="11" width="12" height="3.6" rx="1.2"/><path d="M6.5 6.8h.01M6.5 12.8h.01M10 6.8h3.4M10 12.8h3.4"/>',
      'place-terminal':'<rect x="3" y="5.5" width="14" height="9.5" rx="1.6"/><path d="M6 8.6l2.8 2.4-2.8 2.4M10.6 13.4h3"/>',
      'place-web':'<circle cx="10" cy="10" r="6.2"/><path d="M4 10h12M10 3.8q3.3 3 0 12.4M10 3.8q-3.3 3 0 12.4"/>',
      'place-other':'<path d="M7 16.6V9.8L10 5.4l3 4.4v6.8"/><path d="M7 13h6"/>',
    },
    words:{'place-library':'Bunko','place-coffee':'Chashitsu','place-boss':'Tono','place-bank':'Kura','place-postbox':'Yūbinkyoku','boss-note':'Went to see the Tono','place-software':'Kōbō','place-terminal':'Tanmatsu-shitsu','place-web':'Tsūshinjo','place-other':'Dōgu-beya', /* spec 052 FR-023: Japanese words in the Japanese court (the plain names are in the tooltips, FR-013) */'lobby-label':'The Ō-hiroma: the places where agents work','door-close':'Slide shut','door-open':'Slide open','door-title-prefix':'Slide the fusuma shut'},
    motion:{preset:'court'},
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
    _validateManifest:validateManifest,
    _compilePixelMap:compilePixelMap,
    _tokens(){return resolveTokens(currentManifest);},
    _builtins(){return BUILT_IN;},
  };
}));
