/* test-theme.ts — unit tests for src/renderer/theme.js (spec 035) */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REMOVED_THEMES } from '../src/shared/themes';

const T = require(path.resolve(process.cwd(), 'src', 'renderer', 'theme.js'));

// --- Clean Office defaults ---
assert.strictEqual(T.CLEAN_ID, 'clean-office');
assert.ok(T.token('--bg'), 'Clean Office has --bg token');
assert.strictEqual(T.token('--bg'), '#f7f6f3'); // spec 052 FR-024
assert.strictEqual(T.token('bg'), '#f7f6f3');
assert.strictEqual(T.token('--made-up'), null);
assert.ok(T.slot('plant'), 'Clean Office draws the room plant from a slot');
assert.strictEqual(T.slot('chair-back'), null, 'no dead registry defaults (spec 040 FR-010)');
assert.strictEqual(T.slot('nonexistent'), null);
assert.strictEqual(T.word('room'), 'room');

// --- setTheme / current ---
const id = T.setTheme('clean-office');
assert.strictEqual(id, 'clean-office');
const cur = T.current();
assert.strictEqual(cur.id, 'clean-office');
assert.ok(cur.manifest);

// Unknown theme falls back to Clean Office
const id2 = T.setTheme('nope');
assert.strictEqual(id2, 'clean-office');

// --- Manifest validation ---
const good = T._validateManifest({
  id: 'paper-office',
  name: 'Paper Office',
  author: 'Test',
  version: '0.1',
  extends: 'clean-office',
  tokens: { '--bg': '#eef1f4' },
  art: { 'desk-art': '<rect x="0" y="0" width="10" height="10" fill="#333"/>', 'chair-back': '<rect width="1" height="1"/>' },
  words: { 'place-terminal': 'Server room', room: 'office' },
});
assert.strictEqual(good.id, 'paper-office');
assert.strictEqual(good.extends, 'clean-office');
assert.strictEqual(good.tokens['--bg'], '#eef1f4');
assert.ok(good.art['desk-art']);
assert.strictEqual(good.art['chair-back'], undefined, 'an art key the renderer never draws is dropped (spec 040 FR-010)');
assert.strictEqual(good.words['place-terminal'], 'Server room');
assert.strictEqual(good.words.room, undefined, 'a word key that is not a scene word is dropped (spec 040 FR-007)');

// Invalid extends is normalized to clean-office
assert.strictEqual(T._validateManifest({ extends: 'something-else' }).extends, 'clean-office');

// --- Token fallback ---
T.setTheme(good);
assert.strictEqual(T.token('--bg'), '#eef1f4');
assert.strictEqual(T.token('--surface'), '#fffdf9'); // falls back to Clean Office
T.setTheme('clean-office'); // reset

// --- Slot sanitization ---
assert.ok(T._sanitizeSlot('<rect width="10" height="10" fill="red"/>'), 'basic rect allowed');
assert.strictEqual(T._sanitizeSlot('<script>alert(1)</script>'), null, 'script rejected');
assert.strictEqual(T._sanitizeSlot('<rect onclick="x" width="10"/>'), null, 'event handler rejected');
assert.strictEqual(T._sanitizeSlot('<rect href="http://x" width="10"/>'), null, 'href rejected');
assert.strictEqual(T._sanitizeSlot('<rect style="fill:red" width="10"/>'), null, 'style attr rejected');
assert.strictEqual(T._sanitizeSlot('<foreignObject>bad</foreignObject>'), null, 'foreignObject rejected');
assert.strictEqual(T._sanitizeSlot('not svg'), null, 'garbage rejected');

// Only whitelisted tags allowed
assert.strictEqual(T._sanitizeSlot('<iframe src="x"/>'), null, 'iframe rejected');
assert.ok(T._sanitizeSlot('<g><path d="M0 0h10" fill="#000"/></g>'), 'g + path allowed');

// The fragment is rebuilt, never passed through (spec 040 FR-005; bypasses from the PR #137 review)
assert.strictEqual(T._sanitizeSlot('<rect fill=x><style>body{display:none}</style>'), null, 'unquoted value cannot swallow a <style>');
assert.strictEqual(T._sanitizeSlot('<rect fill=x><iframe/srcdoc=&lt;b&gt;hi&lt;/b&gt;>'), null, 'unquoted value cannot swallow an <iframe>');
assert.strictEqual(T._sanitizeSlot('<rect fill=x><img/src=y/onerror=alert(1)>'), null, 'unquoted value cannot swallow an <img>');
assert.strictEqual(T._sanitizeSlot('<rect fill=red/>'), null, 'unquoted values are refused');
assert.strictEqual(T._sanitizeSlot('<rect fill="a>b"/>'), null, '> inside a value is refused');
assert.strictEqual(T._sanitizeSlot("<rect fill='x\"/><style>a{}</style>'/>"), null, 'a quote trick cannot open a tag');
assert.strictEqual(T._sanitizeSlot("<rect fill='a\"b'/>"), '<rect fill="a&quot;b"/>', 'values are re-serialized with " escaped');
assert.strictEqual(T._sanitizeSlot('<rect width="1"/><!-- x -->'), null, 'comments are refused');
assert.strictEqual(T._sanitizeSlot('<rect width="1">'), null, 'an unclosed rect is refused');
assert.strictEqual(T._sanitizeSlot('<g><rect width="1"/></path>'), null, 'mismatched close tag refused');
assert.strictEqual(T._sanitizeSlot('<rect fill="url(http://x/y)"/>'), null, 'external url() refused');
assert.strictEqual(T._sanitizeSlot('<rect fill="url(#grad)"/>'), '<rect fill="url(#grad)"/>', 'local url(#id) allowed');
assert.strictEqual(T._sanitizeSlot('<g>\n  <rect width="1"/>\n</g>'), '<g>\n  <rect width="1"/>\n</g>', 'whitespace between tags is kept');

// Tokens (spec 040 FR-006): only Clean Office keys, only token-grammar values
for (const v of ['#fff', '#a1b2c3d4', 'rgb(233 241 248 / .93)', 'rgba(0,0,0,.5)', 'hsl(210 40% 50%)', '12px', '.5', '-2', '1.5s', 'transparent', 'currentColor'])
  assert.ok(T._isTokenValue(v), 'token value allowed: ' + v);
for (const v of ['red;display:none', 'x"/><style>a{}</style>', 'url(x)', 'var(--x)', 'expression(1)', '{}', 'a b', '#fff' + ' '.repeat(70) + 'x', 12])
  assert.ok(!T._isTokenValue(v), 'token value refused: ' + String(v));
const tk = T._validateManifest({ id: 'tk', tokens: { '--surface': '#123456', '--chair': 'x"/><style>*{display:none}</style><rect fill="x', display: 'none', '--not-a-clean-token': '#fff' } });
assert.deepStrictEqual(tk.tokens, { '--surface': '#123456' }, 'bad values, non-custom-property keys and unknown keys are dropped');
T.setTheme('clean-office');
const cleanChair = T.token('--chair');
T.setTheme(tk);
assert.strictEqual(T.token('--chair'), cleanChair, 'a dropped token falls back to Clean Office');
assert.ok(!String(T.token('--chair')).includes('<'), 'no markup reaches a token');
T.setTheme('clean-office');

// themes.css changes looks, never sizes (spec 035 FR-010, FR-015): an allow-list of properties, so a new way to size or move
// something (flex, transform: scale, top/left, a custom property) is refused by default. DURBAR_THEMES_CSS points the test at a mutant copy.
{
  const cssPath = process.env.DURBAR_THEMES_CSS || path.join(__dirname, '..', '..', 'src', 'renderer', 'themes.css');
  // Properties that only paint (colour, texture, shape of the corner, shadow, font face, case, ellipsis); any value.
  const PAINT = new Set(['color', 'background', 'background-color', 'background-image', 'background-size', 'border-color', 'border-top-color', 'border-bottom-color',
    'border-radius', 'box-shadow', 'text-shadow', 'outline-color', 'font-family', 'text-transform', 'z-index']);
  // Properties allowed with one exact kind of value: they would size or move things with any other value.
  const VALUE: Record<string, RegExp> = {
    position: /^relative$/, // stacking only (z-index); never absolute/fixed + top/left
    'min-width': /^0$/, // lets display text ellipsize
    overflow: /^hidden$/, // clips for the ellipsis; auto/scroll would add scrollbars and change the layout
    'text-overflow': /^(?:ellipsis|clip)$/,
    'font-weight': /^(?:normal|bold|[4-8]00)$/, // a heavier face widens text a little; 900 and bolder/lighter are refused
    'letter-spacing': /^(?:normal|0|0?\.(?:0[0-9]?|10?)em)$/, // at most .1em: it widens text, like a font change; today's uses are .01-.08em
    flex: /^0 1 auto$/, // the initial value; no flex-basis or grow
    transform: /^translate\(-?[0-2]px,-?[0-2]px\)$/, // retro button press nudge (today 2px and -1px); no scale, rotate or bigger moves
  };
  // Custom properties a style may declare (colours and a font family); a length in their value would feed a size.
  const CUSTOM = new Set(['--ui-display', '--ui-top-ink', '--ui-top-ink-2', '--st-glyph']);
  const LENGTH = /[0-9.]\s*(?:px|em|rem|%|ch|vw|vh|vmin|vmax|pt|cm|mm|in|ex)\b/i;
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad: string[] = [];
  // Structure (review on #751): declarations only inside a plain rule, so the per-block check below sees every one of them.
  // Refused: a rule nested in a rule (CSS nesting would hide its parent's declarations from the block regex), a declaration
  // directly in an @-block, and any top-level statement ending in ';' (@import, @namespace, @charset).
  {
    const stack: string[] = [];
    let buf = '', q = '', paren = 0;
    for (const ch of css) {
      if (q) { buf += ch; if (ch === q) q = ''; continue; }
      if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
      if (ch === '(') paren++;
      if (ch === ')') paren--;
      if (paren > 0) { buf += ch; continue; }
      if (ch === '{') {
        const prelude = buf.trim(), parent = stack[stack.length - 1];
        if (parent !== undefined && !parent.startsWith('@')) bad.push(`nested rule "${prelude}" inside "${parent}"`);
        if (parent !== undefined && parent.startsWith('@') && buf.includes(';')) bad.push(`declaration directly in "${parent}"`);
        stack.push(prelude); buf = '';
      } else if (ch === '}') {
        const top = stack.pop();
        if (top !== undefined && top.startsWith('@') && buf.trim()) bad.push(`declaration directly in "${top}"`);
        buf = '';
      } else if (ch === ';' && (stack.length === 0 || stack[stack.length - 1].startsWith('@'))) {
        bad.push(`statement "${buf.trim()};" ${stack.length ? 'directly in ' + stack[stack.length - 1] : 'at the top level'}`); buf = '';
      } else buf += ch;
    }
  }
  let nRules = 0, nDecls = 0;
  for (const m of css.matchAll(/\{([^{}]*)\}/g)) {
    nRules++;
    // split on ';' outside quotes and parentheses (data: URLs hold ';')
    const decls: string[] = [];
    let cur = '', depth = 0, q = '';
    for (const ch of m[1]) {
      if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ';' && !q && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
    }
    decls.push(cur);
    for (const d of decls) {
      if (!d.trim()) continue;
      nDecls++;
      const i = d.indexOf(':');
      const prop = (i < 0 ? d : d.slice(0, i)).trim().toLowerCase();
      const val = (i < 0 ? '' : d.slice(i + 1)).replace(/!important\s*$/i, '').replace(/\s+/g, ' ').replace(/ ?, ?/g, ',').trim();
      if (prop.startsWith('--')) { if (!CUSTOM.has(prop) || LENGTH.test(val)) bad.push(prop + ':' + val); }
      else if (VALUE[prop]) { if (!VALUE[prop].test(val)) bad.push(prop + ':' + val); }
      else if (!PAINT.has(prop)) bad.push(prop + ':' + val);
    }
  }
  assert.ok(nRules > 50 && nDecls > 100, 'the themes.css parse found rules (' + nRules + ' rules, ' + nDecls + ' declarations)');
  assert.deepStrictEqual(bad, [], 'themes.css sets a property or value that is not allowed (spec 035 FR-015): ' + bad.join(' | '));
}
// UI styles (spec 035 FR-009): a fixed list; anything else is clean
assert.strictEqual(T._validateManifest({ id: 'u1' }).ui, 'clean', 'no ui = clean');
assert.strictEqual(T._validateManifest({ id: 'u2', ui: 'retro' }).ui, 'retro');
assert.strictEqual(T._validateManifest({ id: 'u3', ui: 'x"><style>' }).ui, 'clean', 'unknown ui = clean');
assert.deepStrictEqual(T.UI_STYLES, ['clean', 'retro']);
for (const [id, ui] of [['retro', 'retro'], ['clean-office', 'clean']]) {
  T.setTheme(id);
  assert.strictEqual(T.current().manifest.ui, ui, id + ' uses the ' + ui + ' UI style');
}
T.setTheme('clean-office');

// Removed built-ins (spec 035 FR-017, FR-018): the ids apply Clean Office without a warning, the lists are gone, a saved theme that names a removed
// style or kit keeps working with that one value back to clean / office and a note
const REMOVED = ['corporate', 'durbar-indian', 'durbar-european', 'durbar-japanese'];
assert.deepStrictEqual(T.REMOVED_THEMES, REMOVED, 'the renderer names the removed ids');
assert.deepStrictEqual([...REMOVED_THEMES], REMOVED, 'src/shared/themes.ts names the same removed ids');
for (const id of REMOVED) {
  T.setTheme('retro');
  assert.strictEqual(T.setTheme(id), 'clean-office', id + ' applies Clean Office');
  assert.ok(!T.list().some((t: { id: string }) => t.id === id), id + ' is not listed');
  assert.strictEqual(T._builtins()[id], undefined, id + ' has no pack');
}
for (const k of ['corporate', 'court-indian', 'court-european', 'court-japanese']) {
  assert.ok(!T.UI_STYLES.includes(k) && !T.SCENE_KITS.includes(k), k + ' is not a UI style or scene kit');
  const old = T._validateManifest({ id: 'old-' + k, ui: k, scene: k });
  assert.strictEqual(old.ui, 'clean', k + ': ui falls back to clean');
  assert.strictEqual(old.scene, 'office', k + ': scene falls back to office');
  assert.deepStrictEqual(old.dropped, ['ui', 'scene'], k + ': both values are named in the note (spec 070 FR-022)');
}
assert.deepStrictEqual(T._validateManifest({ id: 'old-ok', ui: 'retro', scene: 'pixel' }).dropped, [], 'a kept style and kit make no note');
assert.ok(T.MOTION_PRESETS.court === undefined, 'the court motion preset is gone');
// a user theme folder named after a removed id stays refused at registration (FR-018: the ids stay reserved)
for (const id of REMOVED) {
  const warned: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
  T.registerUserThemes({ [id]: { id, name: 'Mine' } });
  console.warn = realWarn;
  assert.ok(warned.some((w) => w.includes('dropped on registration') && w.includes(id)), id + ': a saved folder of that name is dropped at registration');
  assert.strictEqual(T.setTheme(id), 'clean-office', id + ': a saved folder of that name is never applied');
}
T.registerUserThemes({ 'fine-one': { id: 'fine-one', name: 'Fine' } });
assert.strictEqual(T.setTheme('fine-one'), 'fine-one', 'a normal saved theme still registers');
T.registerUserThemes({});
T.setTheme('clean-office');

// Words (spec 040 FR-007): scene keys only, short, no control characters
const wd = T._validateManifest({ id: 'wd', words: { 'place-web': 'Radio', 'status-working': 'Sleeping', 'place-other': 'x'.repeat(61), 'place-library': 'a\u0007b' } });
assert.deepStrictEqual(wd.words, { 'place-web': 'Radio' }, 'only short scene words without control characters are kept');

// --- Pixel maps (spec 038) ---
assert.ok(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:['a.a','.a.']}),'pixel map compiles');
assert.strictEqual(T._compilePixelMap({palette:{a:'#fff'},rows:['a']}),'<rect x="0" y="0" width="3" height="3" fill="#fff"/>','default cell size is 3');
assert.strictEqual(T._compilePixelMap({palette:{a:'red'},rows:['z']}),null,'unknown palette key rejected');
assert.strictEqual(T._compilePixelMap({palette:{a:'url(x)'},rows:['a']}),null,'non-colour palette value rejected');
assert.strictEqual(T._compilePixelMap({palette:{},rows:['a']}),null,'empty palette rejected');
assert.ok(T._sanitizeSlot(T._compilePixelMap({cell:3,palette:{a:'#112'},rows:['..a']}))) ;
const pixPack=T._validateManifest({id:'px',art:{'hair-acc':{cell:4,palette:{a:'#123'},rows:['aa','aa']}}});
assert.ok(pixPack.art['hair-acc']&&pixPack.art['hair-acc'].includes('<rect'),'pixel map survives manifest validation as rect grid');

// --- Every built-in pack (specs 036-039) ---
const packs=T.list().map((t:any)=>t.id);
assert.deepStrictEqual(packs,['clean-office','retro'],'two built-in packs registered (spec 035 FR-017: Corporate and the courts are removed, FR-019: Retro stays; spec 077 FR-066: Cheeky Crew is a Characters choice)');
for(const id of packs){
  T.setTheme(id);
  assert.strictEqual(T.current().id,id);
  assert.ok(T.token('--bg'),id+': --bg');
  assert.ok(T.token('--pc-error'),id+': pill ink');
  assert.ok(T.word('place-terminal'),id+': word map');
  assert.ok(T.motion('wave'),id+': motion preset');
}
/* --- Art slots (stage D, spec 035 FR-013): built-in packs draw their people and furniture with a scene kit and carry
   only room, door, lobby, place and plant art; the overlay slots stay for user themes on the office kit --- */
const OVERLAY_SLOTS=['char-body','char-robe','char-headwear','char-collar','desk-back','desk-art','monitor-art','hair-acc'];
const ROOM_SLOTS=['room-back-wall','room-back-window','room-floor'];
const ICON_SLOTS=['place-library','place-software','place-terminal','place-web','place-other'];
const THEMED_PACKS=['retro'];
assert.deepStrictEqual([...T.ART_SLOTS].sort(),['plant',...ROOM_SLOTS,'lobby-art','door-art',...ICON_SLOTS,...OVERLAY_SLOTS,'gadget-cup','gadget-laptop'].sort(),'the whitelist is exactly what the renderer draws');

/* Clean Office omits every slot but the plant: THEME.slot() returns null (the renderer draws the default). */
T.setTheme('clean-office');
for(const n of T.ART_SLOTS.filter((x:string)=>x!=='plant'))assert.strictEqual(T.slot(n),null,'clean-office omits art slot '+n);

/* Every themed pack: no dead overlay data, its room look (back wall and floor), door and lobby art, all sanitized */
for(const id of THEMED_PACKS){
  const art=T._builtins()[id].art||{};
  for(const s of OVERLAY_SLOTS)assert.strictEqual(art[s],undefined,id+': no '+s+' (its scene kit draws the people and furniture)');
  for(const s of ['room-back-wall','room-floor','door-art','lobby-art'])assert.ok(art[s]!==undefined,id+': '+s+' present');
  for(const k of Object.keys(art))assert.ok(T.ART_SLOTS.includes(k),id+': '+k+' is a slot the renderer draws');
  T.setTheme(id);
  for(const [k,v] of Object.entries(art)){
    assert.strictEqual(typeof v,'string',id+':'+k+' compiled to a sanitized string at registration');
    assert.strictEqual(T._sanitizeSlot(v as string),v,id+':'+k+' survives the sanitizer byte-for-byte');
    assert.ok(!/<script|<foreignObject|on\w+=|javascript:/i.test(v as string),id+':'+k+' has no active content');
  }
}
T.setTheme('retro');
assert.ok(T.slot('room-back-wall').includes('<rect'),'retro: pixel-map wall compiles to rects');

/* overlays on the office kit: a user pack (fixture) resolves each slot through THEME.slot() and falls back per slot */
const overlayPack=T._validateManifest({id:'u-overlay',art:{
  'char-robe':'<path d="M60 99V79q0-9 9-12l5-1.5 5 1.5q9 3 9 12v20z" fill="#8c2f3e"/>',
  'hair-acc':{cell:2,palette:{a:'#c2a04a'},rows:['aaaa']},
  'desk-art':'<rect x="112" y="80" width="64" height="6" rx="2" fill="#d9a441"/>',
}});
assert.strictEqual(overlayPack.scene,'office','a user pack without scene stays on the office kit, where overlays are drawn');
T.setTheme(overlayPack);
assert.ok(T.slot('char-robe'),'overlay: robe');
assert.ok(T.slot('hair-acc').includes('<rect'),'overlay: pixel-map accessory compiles to rects');
assert.ok(T.slot('desk-art'),'overlay: desk art');
assert.strictEqual(T.slot('char-body'),null,'overlay: char-body omitted, falls back on its own');
assert.strictEqual(T.slot('monitor-art'),null,'overlay: monitor-art omitted, falls back on its own');
T.setTheme('clean-office');

/* Pixel-map validation: new limits and malformed maps */
assert.ok(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:Array.from({length:24},()=>'a'.repeat(30))}),'24x30 map compiles');
assert.strictEqual(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:Array.from({length:25},()=>'a')}),null,'over 24 rows rejected');
assert.strictEqual(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:['a'.repeat(31)]}),null,'row over 30 cells rejected');
assert.ok(T._compilePixelMap({cell:100,palette:{a:'#fff'},rows:['a']}),'cell 100 falls back to the default cell size');
assert.ok(T._compilePixelMap({cell:0,palette:{a:'#fff'},rows:['a']}),'cell 0 falls back to the default cell size');
assert.ok(T._compilePixelMap({cell:2,palette:{a:'var(--ink)'},rows:['a']}),'var(--token) palette colour allowed');
assert.strictEqual(T._compilePixelMap({cell:2,palette:{a:'var(--bad..)'},rows:['a']}),null,'malformed var name rejected');
assert.strictEqual(T._compilePixelMap({cell:2,palette:{a:'var(--x);color:red'},rows:['a']}),null,'var with payload rejected');
assert.ok(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:['a ']}).includes('rect'),'trailing transparent cell ok');

/* a user theme manifest with the new slots validates and sanitizes the same as a built-in */
const artManifest=T._validateManifest({id:'u-art',art:{
  'room-back-wall':'<rect x="0" y="0" width="320" height="40" fill="#456"/>',
  'room-wall':'<rect x="0" y="0" width="320" height="40" fill="#456"/>',
  'room-floor':{cell:2,palette:{c:'#789'},rows:['cc','..']},
  'desk-art':'<circle onclick="x" cx="5" cy="5" r="5"/>',
  'char-robe':'<path d="M0 0h10v10z" fill="#123"/>',
}});
assert.ok(artManifest.art['room-back-wall'],'user room-back-wall accepted');
assert.strictEqual(artManifest.art['room-wall'],undefined,'a made-up slot name is dropped');
assert.ok(artManifest.art['room-floor'].includes('<rect'),'user pixel map compiled');
assert.strictEqual(artManifest.art['desk-art'],undefined,'user desk-art with onclick dropped');
assert.ok(artManifest.art['char-robe'],'user char-robe accepted');

/* scene words of each pack differ from Clean Office where they claim to */
assert.strictEqual(T._builtins()['retro'].words['place-web'],'Modem');

/* status/permission/credit wording is never a scene word: no pack may define those keys */
const FORBIDDEN=['working','thinking','waiting','idle','error','done','read-only','ask','allow','aiu','credits'];
for(const id of packs){
  const w=T._builtins()[id].words||{};
  for(const f of FORBIDDEN)assert.ok(!(f in w),id+' must not rename '+f);
}

/* --- Contrast: every pill ink meets 4.5:1 on its pill background (spec 037 FR-003) --- */
function lum(hex:any){const n=parseInt(hex.slice(1),16);const f=(v:any)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(n>>16)+0.7152*f((n>>8)&255)+0.0722*f(n&255);}
function contrast(a:any,b:any){const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
for(const id of packs){
  T.setTheme(id);
  for(const st of ['working','thinking','waiting','idle','error','done']){
    const ink=T.token('--pc-'+st), bg=T.token('--pb-'+st);
    const c=contrast(ink,bg);
    assert.ok(c>=4.5,`${id}: --pc-${st} on --pb-${st} = ${c.toFixed(2)}:1`);
  }
}
T.setTheme('clean-office');

// --- Reduced motion at switch time (spec 036 FR-006) ---
T.setTheme('retro');
assert.ok(/steps/.test(T.motion('bar')),'arcade preset uses steps');
T.setTheme('clean-office');

// --- Invalid manifest values ignored ---
const partial = T._validateManifest({
  id: 'partial',
  tokens: 'not-an-object',
  art: { 'door-art': '<script/>', 'lobby-art': '<circle cx="5" cy="5" r="5"/>' },
});
assert.deepStrictEqual(partial.tokens, {});
assert.strictEqual(partial.art['door-art'], undefined, 'unsafe art is dropped');
assert.ok(partial.art['lobby-art'], 'safe art on a real slot is kept');

// spec 037 FR-014: each built-in theme previews its own colours; unknown ids fall back to Clean Office; only colour values
{
  const ids = T.list().map((x: any) => x.id);
  const prev = ids.map((id: string) => JSON.stringify(T.preview(id)));
  assert.strictEqual(new Set(prev).size, ids.length, 'every built-in theme has its own swatch colours');
  for (const id of ids) { const c = T.preview(id); assert.strictEqual(c.length, 3, id + ': three colours'); for (const v of c) assert.ok(/^(#|rgb|hsl)/.test(v), id + ': ' + v); }
  assert.deepStrictEqual(T.preview('no-such-theme'), T.preview(T.CLEAN_ID));
  assert.deepStrictEqual(T.preview(42 as any), T.preview(T.CLEAN_ID));
}

// spec 052 FR-030: each Settings card draws a mini room from validated colours only; unknown ids fall back to Clean Office
{
  const ids = T.list().map((x: any) => x.id);
  const rooms = ids.map((id: string) => JSON.stringify(T.previewRoom(id)));
  assert.strictEqual(new Set(rooms).size, ids.length, 'every built-in theme has its own mini room');
  for (const id of ids) { const r = T.previewRoom(id); assert.deepStrictEqual(Object.keys(r).sort(), ['agent', 'bg', 'chair', 'desk', 'ink', 'tint', 'wall'], id + ': all parts'); for (const v of Object.values(r) as string[]) assert.ok(/^(#|rgb|hsl)/.test(v) && !/[;:{}]|url/i.test(v), id + ': ' + v); }
  assert.deepStrictEqual(T.previewRoom('no-such-theme'), T.previewRoom(T.CLEAN_ID));
  assert.deepStrictEqual(T.previewRoom(42 as any), T.previewRoom(T.CLEAN_ID));
}
// spec 040 FR-023: every applied theme gets a new cache key (scene cache, scene signature, walkers), and a manifest with the same
// id but other content (an AI theme made again with Try again, previewed before saving) is applied, not skipped
{
  T.setTheme(T.CLEAN_ID);
  const k0 = T.themeIdForCache();
  const pink = { id: 'ai-pink', name: 'Pink', tokens: { '--chair': '#c2185b' }, art: { 'char-robe': '<rect x="55" y="63" width="38" height="36" fill="#e0218a"/>' } };
  assert.strictEqual(T.setTheme(pink), 'ai-pink');
  const k1 = T.themeIdForCache();
  assert.notStrictEqual(k1, k0, 'a theme switch changes the cache key');
  assert.ok(k1.startsWith('ai-pink'), 'the key names the theme');
  T.setTheme(pink);
  assert.strictEqual(T.themeIdForCache(), k1, 'the same pack again changes nothing');
  T.setTheme({ ...pink, tokens: { '--chair': '#880e4f' }, art: { 'char-robe': '<rect x="55" y="63" width="38" height="36" fill="#880e4f"/>' } });
  assert.notStrictEqual(T.themeIdForCache(), k1, 'same id, other content: applied as a new theme');
  assert.strictEqual(T.token('--chair'), '#880e4f', 'the new tokens are live');
  assert.ok(String(T.slot('char-robe')).includes('#880e4f'), 'the new art is live');
  T.setTheme(T.CLEAN_ID);
}
/* spec 040 FR-030: the lobby band is stretched only for built-in packs; a user theme keeps its proportions, whatever list() holds */
{
  assert.strictEqual(T.isBuiltIn('retro'), true);
  assert.strictEqual(T.lobbyArtAspect('retro'), 'none', 'a built-in pack keeps none');
  assert.strictEqual(T.lobbyArtAspect(T.CLEAN_ID), 'none');
  assert.strictEqual(T.isBuiltIn('ai-pink'), false);
  assert.strictEqual(T.lobbyArtAspect('ai-pink'), 'xMidYMid slice', 'a user theme is sliced, not stretched');
  assert.strictEqual(T.lobbyArtAspect('__proto__'), 'xMidYMid slice', 'inherited keys are not built-ins');
}
console.log('theme tests passed');
