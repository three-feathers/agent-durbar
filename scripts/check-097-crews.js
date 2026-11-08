/*
 * Spec 097 FR-335, FR-336 (issue #1154): every Characters value in Real office, at 15 agents, 1440x900 and 1280x800. Simulator only: no
 * real agent session, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   node scripts/ui-suite.js --only "check-097-crews"
 *
 * For each Characters value (picked in Settings, the real path, then the page is loaded again so what was fetched is only what Real
 * office asks for) it fails when:
 *   - the room does not draw the people set `peopleFor` names (data-set on the room): the Office people for the default, Minimalist,
 *     Cheeky, Pirate, Monster, Royal and Rebels, and for Prehistoric while the cave gate is closed; the Prehistoric set when the
 *     simulator opens the gate (worldflags=cave);
 *   - a person or visitor picture of the scene is not from that set's folder, or there are fewer than 12 of them;
 *   - a crew picture (crew/art/) is in the Real office scene, or was requested by the page at all, or a set's pack other than the Office people's (the page starts on them) and the chosen set's, or any
 *     world but the Photo office, was requested (spec 102 FR-205);
 *   - the line under Office layout (#dsR) is not the true one: "... until <Crew> has Real office poses." for a crew with heads only
 *     and Minimalist, "... until Prehistoric is open in Real office." with the gate closed, empty for the default and for a set that is drawn;
 *   - the room scrolls or a plate overlaps another (spec 001's 15-agent fit).
 * Screenshots: <SHOTS_OUT>/097-crews-<value>-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-crews-'));
const SIZES = [[1440, 900], [1280, 800]];
/* value, gate open in the simulator, set drawn, Settings line */
const CASES = [
  ['theme', false, 'office', ''],
  ['minimalist', false, 'office', 'Real office shows Office people until Minimalist has Real office poses.'],
  ['cheeky', false, 'office', 'Real office shows Office people until Cheeky has Real office poses.'],
  ['pirate', false, 'office', 'Real office shows Office people until Pirate has Real office poses.'],
  ['monster', false, 'office', 'Real office shows Office people until Monster has Real office poses.'],
  ['royal', false, 'office', 'Real office shows Office people until Royal has Real office poses.'],
  ['rebels', false, 'office', 'Real office shows Office people until Rebels has Real office poses.'],
  ['prehistoric', false, 'office', 'Real office shows Office people until Prehistoric is open in Real office.'],
  ['prehistoric', true, 'prehistoric', ''],
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const q = (gate) => ({ officeview: 'real', simfreeze: '1', ...(gate ? { worldflags: 'cave' } : {}) });
  const pick = async (value, gate) => { // the real path: Settings > Characters
    await js(`window.DurbarScreens.openSettings()`);
    await must(`!!document.querySelector('#chList [data-characters=${jsLiteral(value)}]')`, `the ${value} button`);
    await js(`document.querySelector('#chList [data-characters=${jsLiteral(value)}]').click()`);
    await must(`window.THEME.characters()===${jsLiteral(value)}`, `${value} chosen`);
    const note = await js(`(document.getElementById('dsR')||{}).textContent`);
    await js(`document.getElementById('scrClose').click()`);
    return note;
  };

  for (const [w, h] of SIZES) for (const [value, gate, set, line] of CASES) {
    const tag = `${value}${gate ? ' (cave gate open)' : ''} ${w}x${h}`;
    await H.load({ w, h, query: q(gate), ready: REAL, settle: false });
    const note = await pick(value, gate);
    assert.strictEqual(note, line, `${tag}: the line under Office layout: ${JSON.stringify(note)}`);
    /* Settings showed the crew's portraits as swatches; from here on only the office's own requests count */
    await js(`performance.clearResourceTimings();window.__durbarSimUi.render();true`);
    await must(`document.querySelector('#stage .ro .ro-plate')&&${PICS}&&document.querySelector('#stage .ro').dataset.set===${jsLiteral(set)}`, `${tag}: the pictures`);
    assert.strictEqual(await js(`window.THEME.characters()`), value, `${tag}: the choice is kept`);
    const r = await js(`(()=>{const ro=document.querySelector('#stage .ro'),pics=[...document.querySelectorAll('#stage .ro-person,#stage .ro-visitor')].filter(i=>i.tagName==='IMG'),
      res=[...performance.getEntriesByType('resource').map(e=>e.name),...[...document.querySelectorAll('script[src],link[href],img[src],image')].map(e=>e.getAttribute('src')||e.getAttribute('href'))],
      packs=[...new Set(res.map(n=>/realoffice\\/(worlds|sets)\\/([a-z0-9-]+)\\//.exec(n)).filter(Boolean).map(m=>m[1]+'/'+m[2]))].sort(),
      L=window.__durbarSimUi.realLayout();
      return {set:ro.dataset.set,world:ro.dataset.world,n:pics.length,foreign:pics.filter(i=>!i.getAttribute('src').includes('sets/'+ro.dataset.set+'/')).map(i=>i.getAttribute('src')),
        crewInScene:document.querySelectorAll('#stage image[href*="crew/art/"],#stage img[src*="crew/art/"]').length,crewReq:res.filter(n=>/crew\\/art\\//.test(n)).length,packs,
        scroll:L.scroll,plates:document.querySelectorAll('#stage .ro-plate').length}})()`);
    assert.strictEqual(r.set, set, `${tag}: the room draws the ${set} people, not ${r.set}`);
    assert.strictEqual(r.world, 'photo', `${tag}: the Photo office is the world`);
    assert.ok(r.n >= 12, `${tag}: ${r.n} people drawn at 15 agents`);
    assert.deepStrictEqual(r.foreign, [], `${tag}: a person picture from another set`);
    assert.strictEqual(r.crewInScene, 0, `${tag}: a crew picture is in the Real office scene`);
    assert.strictEqual(r.crewReq, 0, `${tag}: the page requested ${r.crewReq} crew pictures in Real office`);
    /* the page started on the default, so the Office people's pack was loaded before the pick; no other set's, no other world's */
    assert.deepStrictEqual(r.packs, [...new Set(['sets/office', `sets/${set}`])].concat('worlds/photo').sort(), `${tag}: packs requested: ${r.packs.join(' ')}`);
    assert.ok(!r.scroll, `${tag}: the office scrolls`);
    assert.ok(r.plates >= 15, `${tag}: ${r.plates} plates at 15 agents`);
    await H.shot(path.join(OUT, `097-crews-${value}${gate ? '-open' : ''}-${w}x${h}.png`), { prep: 'calm' });
    console.log(`[crews] ${tag}: set ${r.set}, ${r.n} people, packs ${r.packs.join(' ')}`);
  }
  console.log('check-097-crews: every Characters value draws its set or the Office people, and says why');
};
