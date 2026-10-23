/** Scene kits (spec 035 FR-013): every kit draws a valid SVG for every status, mood and look, keeps the status cues
 *  and animation hooks, and the office kit is not in this module (app.js draws it). jsdom, no credits: `npm run test:scenekits`. */
import * as assert from 'node:assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const K = require('../../src/renderer/scenekits.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const THEME = require('../../src/renderer/theme.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../../src/renderer/crew.js');

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
// spec 077: the crew kit draws a portrait per pose with the shared cues over it, falls back to the plain figure, and keeps its id in the signature
{
  const base = { st: 'working', mood: { body: 'normal' }, k: { shirt: '#336699', skin: '#e0b090', hair: '#222222', style: 'short', glasses: true }, mini: false, c: false, T, shade, reduced: false };
  const plain: string = K.draw('crew', { id: 'c1' }, base);
  assert.ok(/\|crew\|"/.test(plain) && !plain.includes('<image'), 'no character: the plain figure, no picture, an empty id at the end of the signature');
  assert.ok(/stroke-width="1\.1"><circle/.test(plain), 'the fallback figure keeps the agent\'s own glasses (FR-017: the office figure with the agent\'s look)');
  for (const [st, pose] of [['working', 'working'], ['thinking', 'working'], ['waiting', 'waiting'], ['error', 'waiting'], ['idle', 'resting'], ['done', 'resting']]) {
    const svg: string = K.draw('crew', { id: 'c1' }, { ...base, st, crew: 'punk' });
    assert.ok(svg.includes(`<image class="crew-pic" href="crew/art/punk-${pose}.webp" x="24" y="22" width="88" height="88"`), `${st}: the ${pose} picture in its box`);
    assert.strictEqual((svg.match(/<image/g) || []).length, 1, st + ': one picture');
    assert.ok(/\|crew\|punk"/.test(svg), st + ': the character id ends the signature');
    assert.ok(CUE[st].test(svg) && svg.includes('class="pp"'), st + ': the status cue is still drawn over, and the person can be hidden (.pp)');
    assert.ok(!svg.includes('M67.5 45.6q2') && !svg.includes('r="1.35"'), st + ': the shared face is not drawn over the portrait');
    assert.ok(svg.indexOf('<image') < svg.indexOf('x="116" y="36"') && svg.indexOf('<image') < svg.indexOf('<rect x="58" y="82"'), st + ': the desk, screen and keyboard are drawn after (over) the picture');
    assert.ok(!/NaN|undefined/.test(svg), st + ': no NaN');
    assert.strictEqual(parser.parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length, 0, st + ': valid SVG');
  }
  // the moods are overlays over the portrait; the art has its own hands (FR-059)
  for (const [mood, re] of [[{ body: 'heavy' }, /class="sweat"/], [{ body: 'monster' }, /M64\.5 35\.5l-4\.2-9\.5/], [{ body: 'normal', trouble: 'dizzy' }, /class="dizzy"/], [{ body: 'normal', trouble: 'ambulance' }, /class="amb"/]] as [object, RegExp][])
    assert.ok(re.test(K.draw('crew', { id: 'c1' }, { ...base, mood, crew: 'punk' })), JSON.stringify(mood) + ': drawn over the portrait');
  const typing: string = K.draw('crew', { id: 'c1' }, { ...base, crew: 'punk' });
  const ARM = /<line [^>]*stroke-width="8"/;
  assert.ok(!ARM.test(typing) && !ARM.test(K.draw('crew', { id: 'c1' }, { ...base, st: 'waiting', crew: 'gamer' })), 'no code arm or hand over a portrait: the picture carries them (FR-059)');
  assert.ok(ARM.test(K.draw('crew', { id: 'c1' }, { ...base, crew: 'punk', crewFb: true })), 'the plain figure keeps its arms');
  // FR-017/FR-055: an unknown id, or a character whose pictures did not load, draws the plain figure on the same furniture, never an empty chair
  for (const [label, extra] of [['unknown id', { crew: 'nope' }], ['failed pictures', { crew: 'punk', crewFb: true }]] as [string, object][]) {
    const fb: string = K.draw('crew', { id: 'c1' }, { ...base, ...extra });
    assert.ok(!fb.includes('<image') && fb.includes('<circle cx="74" cy="44" r="12.5"') && fb.includes('r="1.35"'), label + ': the plain figure with its own face, no picture');
    assert.ok(parser.parseFromString(fb, 'image/svg+xml').getElementsByTagName('parsererror').length === 0 && CUE.working.test(fb), label + ': valid, cues kept');
  }
  const bad: string = K.draw('crew', { id: 'c1' }, { ...base, crew: 'punk', crewFb: true }), ok: string = K.draw('crew', { id: 'c1' }, { ...base, crew: 'punk' });
  assert.ok(/\|crew\|punk\|fb"/.test(bad) && bad !== ok, 'the fallback has its own signature, so the desk is redrawn when a picture fails');
  const a: string = K.draw('crew', { id: 'c1' }, { ...base, crew: 'punk' }), b: string = K.draw('crew', { id: 'c1' }, { ...base, crew: 'gamer' });
  assert.ok(/\|crew\|punk"/.test(a) && /\|crew\|gamer"/.test(b) && a !== b, 'another character is another signature');
  // the walking figure: the same portrait, cropped by its view box, with no face drawn over it; the fallback has the face
  const av: string = K.avatar('crew', { id: 'c1' }, { k: base.k, T, shade, crew: 'punk' });
  assert.ok(av.includes('crew/art/punk-working.webp') && !av.includes('r="1.35"'), 'the walking figure wears the portrait');
  // FR-060: the round avatar crops the face of the picture, a seat shows the whole bust, the fallback keeps the old crop
  const vbOf = (svg: string) => (/viewBox="([^"]+)"/.exec(svg) || [])[1];
  const seat: string = K.avatar('crew', { id: 'c1' }, { k: base.k, T, shade, crew: 'punk', view: 'seat' });
  assert.ok(/^[\d.]+ 22 66 66$/.test(vbOf(seat)), 'a seat shows the top three quarters of the bust, from the top edge');
  assert.notStrictEqual(vbOf(av), vbOf(seat), 'a chip crops the face, a seat shows more of the bust');
  assert.ok(vbOf(av).split(' ').map(Number).every((n) => Number.isFinite(n)), 'a numeric view box');
  assert.notStrictEqual(vbOf(K.avatar('crew', { id: 'c1' }, { k: base.k, T, shade, crew: 'gamer' })), vbOf(av), 'each character has its own face crop');
  assert.strictEqual(vbOf(K.avatar('crew', { id: 'c1' }, { k: base.k, T, shade, crew: 'punk', crewFb: true })), '50 20 48 48', 'the plain figure keeps the old crop');
  const avFb: string = K.avatar('crew', { id: 'c1' }, { k: base.k, T, shade, crew: 'punk', crewFb: true });
  assert.ok(!avFb.includes('<image') && avFb.includes('r="1.35"'), 'and the plain face when the pictures failed');
  assert.ok(T('--crew-accent') && T('--crew-ink') && T('--crew-accent-2'), 'the crew tokens exist');
  // every character, every pose, from the real pictures' names
  for (const id of ['punk', 'gamer', 'hacker', 'rocker', 'buzzcut', 'bookworm', 'scientist', 'metalhead', 'bob-glasses', 'skater', 'surfer', 'disco', 'sporty']) for (const st of STATUS) assert.ok(K.draw('crew', { id: 'x' }, { ...base, st, crew: id }).includes(`crew/art/${id}-`), id + '/' + st);
}
// every built-in pack names its kit; Clean Office stays on the office kit
for (const [id, kit] of [['clean-office', 'office'], ['corporate', 'corporate'], ['retro', 'pixel'], ['durbar-indian', 'court-indian'], ['durbar-european', 'court-european'], ['durbar-japanese', 'court-japanese'], ['cheeky-crew', 'crew']]) {
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
