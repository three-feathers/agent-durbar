/*
 * Spec 097 FR-335, FR-336 (issue #1154): every Characters value in Real office, at 15 agents, 1440x900 and 1280x800. Simulator only: no
 * real agent session, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   node scripts/ui-suite.js --only "check-097-crews"
 *
 * For each Characters value (picked in Settings, the real path, for the line under Office layout; the page is then loaded again on that choice
 * (the simulator's `characters=`, as a saved choice) and the main process's request log is read from that load on, so every request Real
 * office makes is seen, not only what is left in the DOM; `performance` resource timings are empty on a file:// page) it fails when:
 *   - the room does not draw the people set `peopleFor` names (data-set on the room): the Office people for the default, Minimalist,
 *     Cheeky, Pirate, Monster, Royal and Rebels; the Prehistoric set, also with the cave
 *     gate closed (owner 2026-11-08, Q12: only the cave world is gated; its frames are requested, no Office people picture is, and the
 *     cave world is not offered); the same with the simulator's worldflags=cave;
 *   - a person or visitor picture of the scene is not from that set's folder, or there are fewer than 12 of them;
 *   - a picture of the scene did not load (`complete` and `naturalWidth > 0`: a 404 is complete too), or a frame the page requested
 *     is not a file on disk (the browser reports no status for file://, so the requested path is checked against the pack);
 *   - the Office people's frames are requested for any other set, or are not requested for the default (12 at least);
 *   - a crew picture (crew/art/) is in the Real office scene, or was requested by the page at all, or a set's pack other than the chosen
 *     set's, or any world but the Photo office, was requested (spec 102 FR-205; after the reload the page starts on the chosen set);
 *   - the line under Office layout (#dsR) is not the true one: "... until <Crew> has Real office poses." for a crew with heads only
 *     and Minimalist, "Real office draws the Prehistoric people." for Prehistoric, empty for the default;
 *   - the room scrolls or a name plate overlaps another (spec 001's 15-agent fit; every pair of plates is compared).
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
  /* owner 2026-11-08 (097 Q12): the full Prehistoric set has no gate of its own; only the cave world is gated */
  ['prehistoric', false, 'prehistoric', 'Real office draws the Prehistoric people.'],
  ['prehistoric', true, 'prehistoric', 'Real office draws the Prehistoric people.'],
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `(()=>{const l=[...document.querySelectorAll('#stage .ro img')];return l.length>0&&l.every(i=>i.complete&&i.naturalWidth>0)})()`;
  /* every request of the page, seen by the session (main process): `performance.getEntriesByType('resource')` is empty on a file:// page, so
     the page cannot report its own requests. Entry: { url, status, error }; a frame counts only with status 200 and no error. */
  const reqs = new Map();
  const ses = ctx.win.webContents.session;
  ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (d, cb) => { reqs.set(d.id, { url: decodeURIComponent(d.url), status: 0, error: '' }); cb({}); });
  ses.webRequest.onCompleted({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) e.status = d.statusCode; });
  ses.webRequest.onErrorOccurred({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) e.error = d.error; });
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
    /* the simulator keeps the choice in memory only, so the new load is given it as a saved choice would give it (`characters=`, spec 077
       FR-070); the page starts on it, and the session's log from here holds every request of that load */
    await ses.clearCache(); /* a picture cached by the last case would not be requested (or logged) again */
    reqs.clear();
    await H.load({ w, h, query: { ...q(gate), characters: value }, ready: REAL, settle: false });
    await must(`window.THEME.characters()===${jsLiteral(value)}`, `${tag}: the choice kept across the reload`);
    await must(`document.querySelector('#stage .ro .ro-plate')&&document.querySelector('#stage .ro').dataset.set===${jsLiteral(set)}`, `${tag}: the room draws ${set}`);
    await must(PICS, `${tag}: the pictures loaded (complete and naturalWidth > 0)`);
    const r = await js(`(()=>{const ro=document.querySelector('#stage .ro'),pics=[...document.querySelectorAll('#stage .ro-person,#stage .ro-visitor')].filter(i=>i.tagName==='IMG'),
      L=window.__durbarSimUi.realLayout(),
      plates=[...document.querySelectorAll('#stage .ro-plate')].map(e=>e.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0),
      overlaps=[];
      for(let i=0;i<plates.length;i++)for(let j=i+1;j<plates.length;j++){const a=plates[i],b=plates[j],ox=Math.min(a.right,b.right)-Math.max(a.left,b.left),oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(ox>1&&oy>1)overlaps.push(i+'x'+j+' '+Math.round(ox)+'x'+Math.round(oy));}
      return {shown:[...new Set([...document.querySelectorAll('#stage .ro img')].map(i=>decodeURIComponent(i.currentSrc||i.src)))],overlaps,unloaded:[...document.querySelectorAll('#stage .ro img')].filter(i=>!(i.complete&&i.naturalWidth>0)).map(i=>i.getAttribute('src')),set:ro.dataset.set,world:ro.dataset.world,n:pics.length,foreign:pics.filter(i=>!i.getAttribute('src').includes('sets/'+ro.dataset.set+'/')).map(i=>i.getAttribute('src')),
        crewInScene:document.querySelectorAll('#stage image[href*="crew/art/"],#stage img[src*="crew/art/"]').length,        worlds:window.DurbarCrew.offeredWorlds().map(x=>x.id),scroll:L.scroll,plates:document.querySelectorAll('#stage .ro-plate').length}})()`);
    assert.deepStrictEqual(r.worlds, gate ? ['photo', 'cave'] : ['photo'], `${tag}: the cave world is offered only with its own flag: ${r.worlds}`);
    const log = [...reqs.values()], urls = log.map((e) => e.url), webps = log.filter((e) => /\.webp(\?|$)/.test(e.url));
    assert.ok(log.some((e) => /realoffice\/worlds\/photo\//.test(e.url)), `${tag}: the session saw no Real office request (${log.length} in all): the request checks would see nothing`);
    const packs = [...new Set(urls.map((n) => /realoffice\/(worlds|sets)\/([a-z0-9-]+)\//.exec(n)).filter(Boolean).map((m) => m[1] + '/' + m[2]))].sort();
    const crewReq = urls.filter((n) => /crew\/art\//.test(n)).length;
    const officeReq = webps.filter((e) => /sets\/office\//.test(e.url)).length, setReq = webps.filter((e) => e.url.includes(`/sets/${set}/`)).length;
    assert.deepStrictEqual(r.unloaded, [], `${tag}: pictures of the scene that did not load`);
    /* a requested picture that is missing is a failure, whatever the page does with it (an <img> that fails is `complete` too) */
    const bad = log.filter((e) => /\.(webp|png|json|js)(\?|$)/.test(e.url) && /realoffice\//.test(e.url) && (e.status !== 200 || e.error)).map((e) => `${e.url.replace(/^.*realoffice\//, '')} ${e.status} ${e.error}`);
    assert.deepStrictEqual(bad, [], `${tag}: requested Real office files that did not load with status 200`);
    /* the independent expectation: every frame the scene shows was requested from the set's folder (so the requests are the pictures on
       screen, none missing from the log), and the Office people's frames are requested for no other set */
    const shownSet = r.shown.filter((u) => u.includes(`sets/${set}/`)).length;
    assert.ok(shownSet >= 6, `${tag}: the scene shows ${shownSet} distinct ${set} frames`);
    const notAsked = r.shown.filter((u) => !webps.some((e) => e.url === u)); /* shown (the file the img loaded: half-size or full) but never in the log */
    assert.deepStrictEqual(notAsked, [], `${tag}: pictures on screen that the log has no request for`);
    assert.ok(setReq >= shownSet, `${tag}: ${setReq} ${set} frames requested, ${shownSet} shown`);
    if (set !== 'office') assert.strictEqual(officeReq, 0, `${tag}: Office people pictures requested for the ${set} set: ${officeReq}`);
    assert.strictEqual(r.set, set, `${tag}: the room draws the ${set} people, not ${r.set}`);
    assert.strictEqual(r.world, 'photo', `${tag}: the Photo office is the world`);
    assert.ok(r.n >= 12, `${tag}: ${r.n} people drawn at 15 agents`);
    assert.deepStrictEqual(r.foreign, [], `${tag}: a person picture from another set`);
    assert.strictEqual(r.crewInScene, 0, `${tag}: a crew picture is in the Real office scene`);
    assert.strictEqual(crewReq, 0, `${tag}: the page requested ${crewReq} crew pictures in Real office`);
    /* the page starts on the saved choice: its set's pack and the Photo office's, no other set's, no other world's */
    assert.deepStrictEqual(packs, [`sets/${set}`, 'worlds/photo'].sort(), `${tag}: packs requested: ${packs.join(' ')}`);
    assert.deepStrictEqual(r.overlaps, [], `${tag}: name plates overlap (pair, px)`);
    assert.ok(!r.scroll, `${tag}: the office scrolls`);
    assert.ok(r.plates >= 15, `${tag}: ${r.plates} plates at 15 agents`);
    await H.shot(path.join(OUT, `097-crews-${value}${gate ? '-open' : ''}-${w}x${h}.png`), { prep: 'calm' });
    console.log(`[crews] ${tag}: set ${r.set}, ${r.n} people, packs ${packs.join(' ')}`);
  }
  console.log('check-097-crews: every Characters value draws its set or the Office people, and says why');
};
