/* test-theme.ts — unit tests for src/renderer/theme.js (spec 035) */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const T = require(path.resolve(process.cwd(), 'src', 'renderer', 'theme.js'));

// --- Clean Office defaults ---
assert.strictEqual(T.CLEAN_ID, 'clean-office');
assert.ok(T.token('--bg'), 'Clean Office has --bg token');
assert.strictEqual(T.token('--bg'), '#f6f3ee');
assert.strictEqual(T.token('bg'), '#f6f3ee');
assert.strictEqual(T.token('--made-up'), null);
assert.ok(T.slot('chair-back'), 'chair-back slot exists');
assert.ok(T.slot('desk'), 'desk slot exists');
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
  id: 'corporate',
  name: 'Corporate Office',
  author: 'Test',
  version: '0.1',
  extends: 'clean-office',
  tokens: { '--bg': '#eef1f4' },
  art: { 'chair-back': '<rect x="0" y="0" width="10" height="10" fill="#333"/>' },
  words: { 'place-terminal': 'Server room', room: 'office' },
});
assert.strictEqual(good.id, 'corporate');
assert.strictEqual(good.extends, 'clean-office');
assert.strictEqual(good.tokens['--bg'], '#eef1f4');
assert.ok(good.art['chair-back']);
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

// themes.css changes looks, never sizes (spec 035 FR-010): no width/height/padding/margin/gap/font-size/border-width rules
{
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/min-width:0\b/g, ''); // min-width:0 only lets display text ellipsize
  const sized = css.match(/(?:^|[;{])\s*(?:(?:min-|max-)?(?:width|height)|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|font-size|line-height|border(?:-(?:top|right|bottom|left))?-width|border(?:-(?:top|right|bottom|left))?\s*:\s*[0-9.]+px)\s*:?/g);
  assert.strictEqual(sized, null, 'themes.css sets a size: ' + (sized || []).join(' '));
}
// UI styles (spec 035 FR-009): a fixed list; anything else is clean
assert.strictEqual(T._validateManifest({ id: 'u1' }).ui, 'clean', 'no ui = clean');
assert.strictEqual(T._validateManifest({ id: 'u2', ui: 'retro' }).ui, 'retro');
assert.strictEqual(T._validateManifest({ id: 'u3', ui: 'x"><style>' }).ui, 'clean', 'unknown ui = clean');
assert.deepStrictEqual(T.UI_STYLES, ['clean', 'corporate', 'retro', 'court-indian', 'court-european', 'court-japanese']);
for (const [id, ui] of [['corporate', 'corporate'], ['retro', 'retro'], ['durbar-indian', 'court-indian'], ['durbar-european', 'court-european'], ['durbar-japanese', 'court-japanese'], ['clean-office', 'clean']]) {
  T.setTheme(id);
  assert.strictEqual(T.current().manifest.ui, ui, id + ' uses the ' + ui + ' UI style');
}
T.setTheme('clean-office');

// Words (spec 040 FR-007): scene keys only, short, no control characters
const wd = T._validateManifest({ id: 'wd', words: { 'place-web': 'Radio', 'status-working': 'Sleeping', 'place-other': 'x'.repeat(61), 'place-library': 'a\u0007b' } });
assert.deepStrictEqual(wd.words, { 'place-web': 'Radio' }, 'only short scene words without control characters are kept');

// --- Pixel maps (spec 038) ---
assert.ok(T._compilePixelMap({cell:2,palette:{a:'#fff'},rows:['a.a','.a.']}),'pixel map compiles');
assert.strictEqual(T._compilePixelMap({palette:{a:'#fff'},rows:['a']}),T._compilePixelMap({palette:{a:'#fff'},rows:['a']}),'default cell size');
assert.strictEqual(T._compilePixelMap({palette:{a:'red'},rows:['z']}),null,'unknown palette key rejected');
assert.strictEqual(T._compilePixelMap({palette:{a:'url(x)'},rows:['a']}),null,'non-colour palette value rejected');
assert.strictEqual(T._compilePixelMap({palette:{},rows:['a']}),null,'empty palette rejected');
assert.ok(T._sanitizeSlot(T._compilePixelMap({cell:3,palette:{a:'#112'},rows:['..a']}))) ;
const pixPack=T._validateManifest({id:'px',art:{'hair-front':{cell:4,palette:{a:'#123'},rows:['aa','aa']}}});
assert.ok(pixPack.art['hair-front']&&pixPack.art['hair-front'].includes('<rect'),'pixel map survives manifest validation as rect grid');

// --- Every built-in pack (specs 036-039) ---
const packs=T.list().map((t:any)=>t.id);
assert.deepStrictEqual(packs,['clean-office','corporate','retro','durbar-indian','durbar-european','durbar-japanese'],'all six built-in packs registered');
for(const id of packs){
  T.setTheme(id);
  assert.strictEqual(T.current().id,id);
  assert.ok(T.token('--bg'),id+': --bg');
  assert.ok(T.token('--pc-error'),id+': pill ink');
  assert.ok(T.word('place-terminal'),id+': word map');
  assert.ok(T.motion('wave'),id+': motion preset');
}
/* durbar packs carry the head accessory; retro carries none */
assert.ok(T._builtins()['durbar-indian'].art['hair-acc'],'indian turban slot');
assert.ok(T._builtins()['durbar-european'].art['hair-acc'],'european crown slot');
assert.ok(T._builtins()['durbar-japanese'].art['hair-acc'],'japanese kanzashi slot');
assert.ok(!T._builtins()['retro'].art['hair-acc'],'retro: no accessory');
assert.ok(!T._builtins()['clean-office'].art||!T._builtins()['clean-office'].art['hair-acc'],'clean: no accessory');

/* --- Art slot expansion (stage D, PR #137): characters + room looks per theme --- */
const CHAR_SLOTS=['char-body','char-robe','char-headwear','char-collar'];
const ROOM_SLOTS=['room-back-wall','room-back-window','room-floor'];
const OBJECT_SLOTS=['desk-back','desk-art','monitor-art','door-art','lobby-art'];
const ICON_SLOTS=['place-library','place-software','place-terminal','place-web','place-other'];
const NEW_SLOTS=[...CHAR_SLOTS,...ROOM_SLOTS,...OBJECT_SLOTS,...ICON_SLOTS];
const THEMED_PACKS=['corporate','retro','durbar-indian','durbar-european','durbar-japanese'];

/* Clean Office omits every expansion slot: THEME.slot() must return null (the renderer draws the default). */
T.setTheme('clean-office');
for(const n of NEW_SLOTS)assert.strictEqual(T.slot(n),null,'clean-office omits art slot '+n);

/* Every themed pack ships at least: one character-art slot, all three room slots, desk art, door art and lobby art. */
for(const id of THEMED_PACKS){
  const art=T._builtins()[id].art||{};
  const charNow=[...CHAR_SLOTS,'hair-acc'].some(s=>art[s]!==undefined);
  assert.ok(charNow,id+': a character body/outfit/headwear slot');
  for(const s of ROOM_SLOTS.slice(0,1).concat(ROOM_SLOTS[2]))assert.ok(art[s]!==undefined,id+': '+s+' present');
  for(const s of ['desk-art','door-art','lobby-art'])assert.ok(art[s]!==undefined,id+': '+s+' present');
  T.setTheme(id);
  for(const [k,v] of Object.entries(art)){
    assert.strictEqual(typeof v,'string',id+':'+k+' compiled to a sanitized string at registration');
    assert.strictEqual(T._sanitizeSlot(v as string),v,id+':'+k+' survives the sanitizer byte-for-byte');
    assert.ok(!/<script|<foreignObject|on\w+=|javascript:/i.test(v as string),id+':'+k+' has no active content');
  }
}

/* slots resolve through THEME.slot() and fall back independently per slot */
T.setTheme('durbar-indian');
assert.ok(T.slot('char-robe'),'indian robe');
assert.ok(T.slot('char-collar'),'indian collar');
assert.strictEqual(T.slot('char-headwear'),null,'indian omits char-headwear (independent fallback)');
assert.strictEqual(T.slot('char-body'),null,'indian omits char-body');
assert.strictEqual(T.slot('room-back-window'),null,'indian omits room-back-window');
T.setTheme('retro');
assert.ok(T.slot('char-body'),'retro pixel body');
assert.ok(T.slot('room-back-wall'),'retro wall pixels');
assert.ok(T.slot('room-floor'),'retro floor pixels');
assert.ok(T.slot('door-art'),'retro door pixels');
assert.ok(T.slot('lobby-art'),'retro lobby pixels');
assert.ok(T.slot('char-body').includes('<rect'),'pixel-map slot compiles to rects');
T.setTheme('corporate');
assert.ok(T.slot('char-body'),'corporate suit-collar overlay');
assert.ok(T.slot('room-back-wall'),'corporate skyline glass');
T.setTheme('durbar-european');
assert.ok(T.slot('char-robe'),'european gown');
assert.ok(T.slot('char-collar'),'european ermine collar');
assert.ok(T.slot('room-floor'),'european carpet aisle');
T.setTheme('durbar-japanese');
assert.ok(T.slot('char-robe'),'japanese kimono');
assert.ok(T.slot('room-back-wall'),'japanese shoji wall');
assert.ok(T.slot('room-floor'),'japanese tatami');
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
  'room-wall':'<rect x="0" y="0" width="320" height="40" fill="#456"/>',
  'room-floor':{cell:2,palette:{c:'#789'},rows:['cc','..']},
  'desk-art':'<circle onclick="x" cx="5" cy="5" r="5"/>',
  'char-robe':'<path d="M0 0h10v10z" fill="#123"/>',
}});
assert.ok(artManifest.art['room-wall'],'user room-wall accepted');
assert.ok(artManifest.art['room-floor'].includes('<rect'),'user pixel map compiled');
assert.strictEqual(artManifest.art['desk-art'],undefined,'user desk-art with onclick dropped');
assert.ok(artManifest.art['char-robe'],'user char-robe accepted');

/* scene words of each pack differ from Clean Office where they claim to */
assert.strictEqual(T._builtins()['corporate'].words['place-library'],'Records');
assert.strictEqual(T._builtins()['retro'].words['place-web'],'Modem');
assert.strictEqual(T._builtins()['durbar-indian'].words['door-close'],'Close gate');

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
  art: { bad: '<script/>', good: '<circle cx="5" cy="5" r="5"/>' },
});
assert.deepStrictEqual(partial.tokens, {});
assert.strictEqual(partial.art.bad, undefined);
assert.ok(partial.art.good);

console.log('theme tests passed');
