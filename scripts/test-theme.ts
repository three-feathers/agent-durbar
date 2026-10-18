/* test-theme.ts — unit tests for src/renderer/theme.js (spec 035) */

import * as assert from 'node:assert';
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
  words: { room: 'office' },
});
assert.strictEqual(good.id, 'corporate');
assert.strictEqual(good.extends, 'clean-office');
assert.strictEqual(good.tokens['--bg'], '#eef1f4');
assert.ok(good.art['chair-back']);
assert.strictEqual(good.words.room, 'office');

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
