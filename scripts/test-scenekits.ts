/** Scene kits (spec 035 FR-013): every kit draws a valid SVG for every status, mood and look, keeps the status cues
 *  and animation hooks, and the office kit is not in this module (app.js draws it). jsdom, no credits: `npm run test:scenekits`. */
import * as assert from 'node:assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const K = require('../../src/renderer/scenekits.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const THEME = require('../../src/renderer/theme.js');

const parser = new (new JSDOM('').window.DOMParser)();
const shade = (hex: string, p: number) => {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; const f = p < 0 ? 0 : 255, t = Math.abs(p);
  r = Math.round((f - r) * t) + r; g = Math.round((f - g) * t) + g; b = Math.round((f - b) * t) + b;
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};
const T = (n: string) => THEME.token(n);

assert.deepStrictEqual(K.KITS, THEME.SCENE_KITS, 'theme.js and scenekits.js list the same kits');
assert.strictEqual(K.draw('office', {}, {}), null, 'the office kit is app.js, not this module');
assert.strictEqual(K.draw('nope', {}, {}), null, 'an unknown kit draws nothing (app.js falls back to the office)');

const STATUS = ['working', 'thinking', 'waiting', 'idle', 'error', 'done'];
const CUE: Record<string, RegExp> = { working: /class="bar"/, thinking: /class="bubble-g"/, waiting: /animateTransform|class="wave"/, idle: /class="steam"/, error: /M144 47\.5v5\.5/, done: /M139 54\.5l3\.6 3\.6/ };
let n = 0;
for (const kit of K.KITS.slice(1)) {
  for (const st of STATUS) for (const body of ['normal', 'heavy', 'monster']) for (const trouble of ['', 'faint', 'dizzy', 'ambulance', 'impatient'])
    for (const style of ['short', 'long', 'bun', 'curly']) for (const c of [false, true]) {
      const svg: string = K.draw(kit, { id: 'a' + n }, { st, mood: { body, trouble }, k: { shirt: '#336699', skin: '#e0b090', hair: '#222222', style, glasses: n % 2 === 0 }, mini: false, c, T, shade, reduced: false });
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      assert.strictEqual(doc.getElementsByTagName('parsererror').length, 0, `${kit}/${st}/${body}/${trouble}/${style}/${c}: valid SVG`);
      assert.ok(svg.includes('class="pp"'), kit + ': the person can be hidden while away (.pp)');
      if (!(st === 'waiting' && (trouble === 'impatient' || trouble === 'faint'))) assert.ok(CUE[st].test(svg), `${kit}/${st}/${trouble}: keeps the ${st} cue`);
      if (st === 'working') assert.ok(svg.includes('class="head"') && svg.includes('hand-l') && (trouble === 'faint' || svg.includes('hand-r')), kit + ': typing hooks (a fainted agent drops its right arm, as in the office kit)');
      if (trouble === 'dizzy') assert.ok(svg.includes('class="dizzy"'), kit + ': dizzy stars');
      if (trouble === 'ambulance') assert.ok(svg.includes('class="amb"'), kit + ': ambulance');
      if (body === 'heavy') assert.ok(svg.includes('class="sweat"'), kit + ': heavy sweats');
      assert.ok(!/NaN|undefined/.test(svg), kit + ': no NaN or undefined in the drawing');
      n++;
    }
  const av: string = K.avatar(kit, { id: 'w' }, { k: { shirt: '#336699', skin: '#e0b090', hair: '#222222', style: 'short' }, T, shade });
  assert.strictEqual(parser.parseFromString(av, 'image/svg+xml').getElementsByTagName('parsererror').length, 0, kit + ': avatar is valid SVG');
  // a user theme colour that is not #rrggbb is used as is, never NaN
  const odd: string = K.draw(kit, { id: 'o' }, { st: 'working', mood: { body: 'normal' }, k: { shirt: '#369', skin: 'peru', hair: 'rgb(1 2 3)', style: 'short' }, mini: false, c: false, T, shade, reduced: false });
  assert.ok(!/NaN/.test(odd), kit + ': short or named colours do not break shading');
}
// every built-in pack names its kit; Clean Office stays on the office kit
for (const [id, kit] of [['clean-office', 'office'], ['corporate', 'corporate'], ['retro', 'pixel'], ['durbar-indian', 'court-indian'], ['durbar-european', 'court-european'], ['durbar-japanese', 'court-japanese']]) {
  THEME.setTheme(id);
  assert.strictEqual(THEME.sceneKit(), kit, id + ' draws with the ' + kit + ' kit');
}
assert.strictEqual(THEME._validateManifest({ id: 'k', scene: 'x"/>' }).scene, 'office', 'unknown scene = office');
// spec 040 FR-023: a theme's character, desk and monitor art is drawn over every kit (scene and walking figure), the headwear over
// the hair, and the theme key is part of the signature (a theme switch redraws the desk instead of keeping the old SVG)
{
  const art = { body: '<g class="art-slot" data-slot="char-robe"><rect/></g>', head: '<g class="art-slot" data-slot="char-headwear"><rect/></g>', desk: '<g class="art-slot" data-slot="desk-art"><rect/></g>', monitor: '<g class="art-slot" data-slot="monitor-art"><rect/></g>' };
  for (const kit of K.KITS.slice(1)) {
    const base = { st: 'working', mood: { body: 'normal' }, k: { shirt: '#336699', skin: '#e0b090', hair: '#222222', style: 'short' }, mini: false, c: false, T, shade, reduced: true };
    const plainSvg: string = K.draw(kit, { id: 'p' }, base);
    assert.ok(!plainSvg.includes('art-slot'), kit + ': no art without a theme that has some');
    const svg: string = K.draw(kit, { id: 'p' }, { ...base, art, themeKey: 'ai-pink.3' });
    for (const s of ['char-robe', 'char-headwear', 'desk-art', 'monitor-art']) assert.ok(svg.includes(`data-slot="${s}"`), kit + ': draws ' + s);
    assert.ok(svg.indexOf('char-headwear') > svg.indexOf('class="head"'), kit + ': the headwear is inside the head');
    // over the hair: the headwear is the last thing in the head group, after the head, the hair, the face and any head top
    const hw = svg.indexOf(art.head);
    assert.ok(hw > svg.indexOf('class="head"') && svg.startsWith('</g></g>', hw + art.head.length), kit + ': the headwear closes the head group, over the hair');
    assert.ok(svg.indexOf('monitor-art') > svg.indexOf('x="116" y="36"'), kit + ': the monitor art is over the screen');
    assert.strictEqual(parser.parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length, 0, kit + ': valid SVG with art');
    assert.ok(/data-sig="[^"]*\|ai-pink\.3\|/.test(svg), kit + ': the theme key is in the signature');
    const av: string = K.avatar(kit, { id: 'w' }, { k: base.k, T, shade, art });
    assert.ok(av.includes('char-robe') && av.includes('char-headwear'), kit + ': the walking figure wears the art too');
    assert.ok(av.indexOf('char-headwear') > av.indexOf('char-robe'), kit + ': headwear after the body');
    assert.ok(av.endsWith(art.head + '</svg>'), kit + ': the walking figure wears the headwear over the hair (drawn last)');
  }
}
// spec 070 FR-011: a pack's cup and laptop replace the kit's; the steam (a status cue) stays
{
  for (const kit of K.KITS.slice(1)) {
    const base = { st: 'idle', mood: { body: 'normal' }, k: { shirt: '#336699', skin: '#e0b090', hair: '#222222', style: 'short' }, mini: false, c: false, T, shade, reduced: true };
    const svg: string = K.draw(kit, { id: 'g' }, { ...base, art: { cup: '<g data-slot="gadget-cup"><rect/></g>', laptop: '<g data-slot="gadget-laptop"><rect/></g>' } });
    assert.ok(svg.includes('gadget-cup') && svg.includes('gadget-laptop') && svg.includes('class="steam"'), kit + ': gadgets drawn, steam kept');
    const plainSvg: string = K.draw(kit, { id: 'g' }, base);
    assert.ok(!plainSvg.includes('gadget-'), kit + ': the kit\'s own cup and laptop otherwise');
  }
}
console.log('scene kit tests passed (' + n + ' scenes)');
