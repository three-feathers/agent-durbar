/*
 * Spec 097 FR-191, FR-194 (2026-11-14 delta, issue #1743): every lobby visitor faces the fixture it stands at, in each Real office world, at 15 agents,
 * 1440x900 and 1280x800. Simulator only: no real agent session, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   node scripts/ui-suite.js --only "check-097-lobby-facing"
 *
 * The truth is read from the page, not from the layout's own word: for each visitor the side its picture faces on screen is the side the SET DREW it facing
 * (NATIVE below, written out here by looking at the pictures: a driver that asks the code what to expect cannot catch the code being wrong) flipped when the
 * element is mirrored (computed `scale` of -1), and the side its fixture lies on is read from the two boxes (the fixture's middle against the visitor's). It fails when
 *   - a visitor's shown facing points away from its fixture (a person right of the fixture's middle must face left, left of it right);
 *   - a visitor's `data-faces` is not that shown facing;
 *   - fewer than 3 visitors at 2 places are drawn (the simulator's visits come and go: the settled lobby is read until they are).
 * FACING_MUTANT=invert flips every visitor's mirror class just before the read; FACING_MUTANT=unmirror removes it. Both must fail in the arcade, and invert in the Photo office too (the cave's front-facing people have no native side to compare).
 * The Prehistoric cave's people (a crew, drawn facing us) have no native side: only the geometry and `data-faces` are read there (`front` below).
 * Screenshots: <SHOTS_OUT>/097-lobby-facing-<world>-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');

const MUTANT = process.env.FACING_MUTANT || '';
const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-facing-'));
const SIZES = [[1440, 900], [1280, 800]];
/* the side each set's standing pictures are drawn facing, by looking at them (raised hand, card and cup on the picture's side): the Office people face left, the Retro pixel people right */
const NATIVE = { office: 'left', retro: 'right', prehistoric: 'front' };
const WORLDS = [['photo', 'office'], ['retro', 'retro'], ['cave', 'prehistoric']].filter(([w]) => !process.env.FACING_WORLD || process.env.FACING_WORLD === w);

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const READ = `(()=>{const ro=document.querySelector('#stage .ro'),out=[];
    for(const im of document.querySelectorAll('#stage .ro-visitor')){
      ${MUTANT === 'invert' ? "im.classList.toggle('mir');" : MUTANT === 'unmirror' ? "im.classList.remove('mir');" : ''}
      const pl=im.dataset.place,fx=document.querySelector('#stage .ro-fx[data-place="'+pl+'"],#stage .ro-kiosk[data-place="'+pl+'"]');
      if(!im.complete||!im.naturalWidth||!fx)continue;
      const r=im.getBoundingClientRect(),q=fx.getBoundingClientRect();
      out.push({who:im.dataset.for,place:pl,faces:im.dataset.faces,mirrored:getComputedStyle(im).scale.split(' ')[0]==='-1',vx:r.left+r.width/2,fx:q.left+q.width/2});}
    return {set:ro&&ro.dataset.set,out};})()`;
  for (const [world, set] of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real', simfreeze: '1', ...(world === 'photo' ? {} : { worldflags: world, world }) }, ready: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'` });
    assert.ok(await H.until(`document.querySelectorAll('#stage .ro-visitor').length>=3&&[...document.querySelectorAll('#stage .ro-visitor')].every(i=>i.complete&&i.naturalWidth>0)`, 40000), `${tag}: three visitors with decoded pictures`);
    const seen = new Map();
    for (let i = 0; i < 40 && new Set([...seen.values()].map((x) => x.place)).size < 3; i++) {
      const r = await js(READ);
      assert.strictEqual(r.set, set, `${tag}: the room draws the ${set} people`);
      for (const x of r.out) seen.set(x.who + ':' + x.place, x);
      if (i < 39) await ctx.sleep(250);
    }
    const list = [...seen.values()];
    console.log('[facing]', tag, JSON.stringify(list.map((x) => `${x.place}:${x.who}:${x.faces}${x.mirrored ? ':mir' : ''}`)));
    assert.ok(list.length >= 3 && new Set(list.map((x) => x.place)).size >= 2, `${tag}: visitors at two places or more were read (${list.length})`);
    if (MUTANT === '') await H.shot(path.join(OUT, `097-lobby-facing-${world}-${w}x${h}.png`)); /* before the verdict, so a failing run still leaves the picture */
    for (const x of list) {
      const side = x.vx > x.fx ? 'left' : 'right'; /* the fixture lies on this side of the visitor */
      if (NATIVE[set] !== 'front') {
        const shown = x.mirrored ? (NATIVE[set] === 'left' ? 'right' : 'left') : NATIVE[set];
        assert.strictEqual(shown, side, `${tag}: ${x.who} at ${x.place} faces ${shown} on screen, but its fixture is to the ${side} (picture drawn facing ${NATIVE[set]}${x.mirrored ? ', mirrored' : ''})`);
      }
      assert.strictEqual(x.faces, side, `${tag}: ${x.who} at ${x.place} data-faces ${x.faces}, its fixture is to the ${side}`);
    }
  }
  console.log('check-097-lobby-facing: every lobby visitor faces its fixture in the Photo office, the arcade and the cave, at both sizes');
};
