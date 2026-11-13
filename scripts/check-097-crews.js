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
 *   - the room does not draw the people set `peopleFor` names (data-set on the room): the Office people for the default and Minimalist;
 *     the crew's own set for Cheeky, Pirate, Monster, Royal and Rebels (T240..T244: each a REAL_SETS row, no flag) and the Prehistoric set, also with the cave
 *     gate closed (owner 2026-11-08, Q12: only the cave world is gated; its frames are requested, no Office people picture is, and the
 *     cave world is not offered); the same with the simulator's worldflags=cave;
 *   - a person or visitor picture of the scene is not from that set's folder, or there are fewer than 12 of them;
 *   - a picture of the scene did not load (`complete` and `naturalWidth > 0`: a 404 is complete too), or a frame the page requested
 *     is not a file on disk (the browser reports no status for file://, so the requested path is checked against the pack);
 *   - the Office people's frames are requested for any other set, or are not requested for the default (12 at least);
 *   - a crew picture (crew/art/) is in the Real office scene, or was requested by the page at all, or a set's pack other than the chosen
 *     set's, or any world but the Photo office, was requested (spec 102 FR-205; after the reload the page starts on the chosen set);
 *   - the line under Office layout (#dsR) is not the true one: "... until Minimalist has Real office poses." for Minimalist
 *     (no set yet), "Real office draws the <Crew> people." for every crew with a set, empty for the default;
 *   - the room scrolls or a name plate overlaps another (spec 001's 15-agent fit; every pair of plates is compared).
 *   - a requested file is missing, or did not complete with status 200. A request the browser cancelled because the page swapped a frame's file (net::ERR_ABORTED, no status)
 *     is not a failure when the file is on disk, and every picture on screen must have a request that completed with status 200;
 *   - the log is read before the page is quiet (the pictures complete with the same files for 600 ms and no request open).
 *   CREWS_MUTANT=missing|abortmissing|abort: a request of a file that is not in the pack (completes with an error) / one that is cancelled at once (no such file) / one that is
 *   cancelled at once (a file in the pack). `missing` and `abortmissing` must fail; `abort` must pass (the tolerated case).
 *   CREWS_MUTANT=failed (issue #1459): the log gets net::ERR_FAILED for a file that is on disk and in the scene; it must fail at "requested Real office files that did not load with status 200".
 *   CREWS_MUTANT=latevisit|latevisit-nowait (issue #1459): once the scene is quiet, three agents at their desks start a terminal, a web and a library call (each a visit 600 ms later, which
 *   swaps the lobby's visitor pose frames). `latevisit` passes (quiet() first waits for the visits to settle, the condition H.load's settle uses); `latevisit-nowait` skips that wait and must fail
 *   at "the scene changed between the quiet point and the read". ERR_FAILED is not tolerated; a `bad` entry prints its request's times and type.
 * Worlds (T247, T248): the same in the Retro arcade and the Prehistoric cave (each with its own simulator flag), 15 agents, both sizes; CREWS_WORLD=photo|retro|cave runs one.
 * Screenshots: <SHOTS_OUT>/097-crews-[<world>-]<value>-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const MUTANT = process.env.CREWS_MUTANT || '';
const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-crews-'));
const SIZES = [[1440, 900], [1280, 800]];
/* the worlds drawn (T247, T248): the Photo office, the Retro arcade (a pixel-art world; `worldflags=retro`) and the Prehistoric cave (`worldflags=cave`), each with the people set it
   takes for the default and for Minimalist (the world's default set: spec 102 FR-202); every crew with a set draws its own people in every world. CREWS_WORLD=photo|retro|cave runs one. */
const WORLDS = [['photo', 'office', 'Office people'], ['retro', 'retro', 'Retro pixel'], ['cave', 'prehistoric', 'Prehistoric']].filter(([w]) => !process.env.CREWS_WORLD || process.env.CREWS_WORLD === w);
/* value, gate open in the simulator, set drawn ('' = the world's default set), Settings line ('{def}' = the world's default set's name) */
const CASES = [
  ['theme', false, '', ''],
  ['minimalist', false, '', 'Real office shows {def} until Minimalist has Real office poses.'],
  ['cheeky', false, 'cheeky', 'Real office draws the Cheeky people.'],
  ['pirate', false, 'pirate', 'Real office draws the Pirate people.'],
  ['monster', false, 'monster', 'Real office draws the Monster people.'],
  ['royal', false, 'royal', 'Real office draws the Royal people.'],
  ['rebels', false, 'rebels', 'Real office draws the Rebels people.'],
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
  let T0 = Date.now(); /* the reload's start: request times in the diagnostics */
  const ses = ctx.win.webContents.session;
  ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (d, cb) => { reqs.set(d.id, { url: decodeURIComponent(d.url), raw: d.url, status: 0, error: '', t0: Date.now() - T0, type: d.resourceType });
    /* spec 097 FR-363 (T320): a world's stylesheet answers 400 ms late in every load, so the room is drawn before it applies on any machine (on CI's slow disk it was only sometimes): a base rule that names another world's floor then requests that world's pack */
    if (/\/realoffice\/worlds\/[a-z0-9-]+\/world\.css$/.test(d.url)) setTimeout(() => cb({}), 400); else cb({}); });
  ses.webRequest.onCompleted({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) { e.status = d.statusCode; e.t1 = Date.now() - T0; } });
  ses.webRequest.onErrorOccurred({ urls: ['file://*/*'] }, (d) => { const e = reqs.get(d.id); if (e) { e.error = d.error; e.t1 = Date.now() - T0; } });
  /* the page picks a frame's file by srcset and sizes (img() in realoffice.js: the half-size .h.webp or the full one); when `sizes` or `srcset` changes as the layout settles (slow Windows CI),
     the browser cancels the request in flight and asks for the other file: that request is logged as net::ERR_ABORTED with no status, and the picture still loads. Seen on Windows CI only
     (#1243, run 42540310573: p02-book.h.webp, p05-book.h.webp, p07-runA.h.webp). It is not a missing file: a missing file is net::ERR_FILE_NOT_FOUND, or a status other than 200. */
  const onDisk = (e) => { try { return fs.statSync(require('url').fileURLToPath(e.raw)).isFile(); } catch (err) { return false; } };
  const aborted = (e) => e.status === 0 && e.error === 'net::ERR_ABORTED' && onDisk(e);
  const pending = () => [...reqs.values()].filter((e) => e.status === 0 && !e.error).length;
  /* quiet: the pictures are complete with the same files for 600 ms, and no request of the log is still open (so the log is read after the swaps, not during them) */
  const QUIET = `(()=>{const l=[...document.querySelectorAll('#stage .ro img')],k=l.map(i=>i.currentSrc).join('|');if(window.__crK!==k){window.__crK=k;window.__crAt=Date.now();}return l.length>0&&l.every(i=>i.complete&&i.naturalWidth>0)&&Date.now()-window.__crAt>600})()`;
  /* issue #1459: a visit (an agent at a lobby place: the library's book, the terminal's runA) starts 600 ms after its call and ends 2 s after it, on the wall clock, with
     the simulator frozen too (places.js, app.js's 250 ms VISITS.tick); H.load's settle waits for that, this driver loads with settle: false. A bounded wait, never a retry:
     the visits settled and the last render drawn (the condition H.load's settle uses), then the quiet point; on a timeout it prints what the lobby holds and fails with its own text. */
  const SETTLE_MS = 5000;
  const SETTLED = H.SETTLED; /* driver-helpers' one expression: H.load's settle uses it too */
  const SCENE = `[...document.querySelectorAll('#stage .ro img')].map(i=>i.currentSrc).join('|')`;
  const diag = async (tag, why) => {
    const d = await js(`(()=>{const U=window.__durbarSimUi;return {replayed:!!window.__durbarSimReplayed,visitsSettled:!!(U&&U.visitsSettled()),away:U?U.awayIds().length:null,visitors:[...document.querySelectorAll('#stage .ro-visitor')].map(i=>(i.getAttribute('src')||'').split('realoffice/').pop()+(i.complete&&i.naturalWidth>0?'':' (loading)'))}})()`);
    const open = [...reqs.values()].filter((e) => e.status === 0 && !e.error).map((e) => e.url.replace(/^.*realoffice\//, ''));
    console.log(`[crews] ${tag}: ${why}`, JSON.stringify({ ...d, open }));
  };
  const quiet = async (tag) => {
    /* CREWS_MUTANT=latevisit|latevisit-nowait: once the scene is quiet, three agents at their desks start a terminal, a web and a library call (each a visit 600 ms later):
       with the wait the check passes; latevisit-nowait skips it and must fail at 'the scene changed between the quiet point and the read' */
    if (MUTANT === 'latevisit' || MUTANT === 'latevisit-nowait') await must(QUIET, `${tag}: the pictures stopped changing (before the mutant)`);
    if (MUTANT === 'latevisit' || MUTANT === 'latevisit-nowait') await js(`(()=>{const away=new Set(window.__durbarSimUi.awayIds()),ids=[...document.querySelectorAll('#stage .ro-person[data-for]')].map(e=>e.dataset.for).filter(id=>!away.has(id)),ev=[{tool:'bash',args:{command:'npm test'}},{tool:'web_fetch',args:{url:'https://example.com'}},{tool:'search',mcpServer:'notion',args:{}}];ids.slice(0,3).forEach((id,n)=>window.__durbarSimUi.emit({type:'toolCall',sessionId:id,timestamp:Date.now(),callId:'crews-mutant-'+n,phase:'start',...ev[n]}));return ids.length})()`);
    if (MUTANT !== 'latevisit-nowait' && !(await H.until(SETTLED, SETTLE_MS))) { await diag(tag, `the lobby's visits not settled after ${SETTLE_MS} ms`); assert.fail(`${tag}: the lobby's visits never settled`); }
    await must(QUIET, `${tag}: the pictures stopped changing`);
    for (let i = 0; i < 100 && pending(); i++) await ctx.sleep(100);
    assert.strictEqual(pending(), 0, `${tag}: requests of the page still open`);
    return js(SCENE);
  };
  const q = (gate, world) => ({ officeview: 'real', simfreeze: '1', ...(world === 'cave' || world === 'retro' ? { worldflags: world, world } : gate ? { worldflags: 'cave' } : {}) });
  const pick = async (value, gate) => { // the real path: Settings > Characters
    await js(`window.DurbarScreens.openSettings()`);
    await must(`!!document.querySelector('#chList [data-characters=${jsLiteral(value)}]')`, `the ${value} button`);
    await js(`document.querySelector('#chList [data-characters=${jsLiteral(value)}]').click()`);
    await must(`window.THEME.characters()===${jsLiteral(value)}`, `${value} chosen`);
    const note = await js(`(document.getElementById('dsR')||{}).textContent`);
    await js(`document.getElementById('scrClose').click()`);
    return note;
  };

  for (const [world, defSet, defName] of WORLDS) for (const [w, h] of SIZES) for (const [value, gate, set0, line0] of CASES) {
    if (gate && world !== 'photo') continue; /* the gate case is the Photo office with the cave flag; the other worlds open their own flag */
    const set = set0 || defSet, line = line0.replace('{def}', defName);
    const tag = `${world}: ${value}${gate ? ' (cave gate open)' : ''} ${w}x${h}`;
    await H.load({ w, h, query: q(gate, world), ready: REAL, settle: false });
    const note = await pick(value, gate);
    assert.strictEqual(note, line, `${tag}: the line under the World cards: ${JSON.stringify(note)}`);
    /* the choice loads its set's pack on this page (ensurePack adds set.js); wait until this page draws the set and its pictures, so no
       request of this page is still in flight when the log is cleared and the page reloads (a reload aborts it: net::ERR_ABORTED, seen on
       Windows CI only, where the script started after the clear) */
    await must(`document.querySelector('#stage .ro .ro-plate')&&document.querySelector('#stage .ro').dataset.set===${jsLiteral(set)}`, `${tag}: the chosen set is drawn before the reload`);
    await must(PICS, `${tag}: the chosen set's pictures loaded before the reload`);
    /* the simulator keeps the choice in memory only, so the new load is given it as a saved choice would give it (`characters=`, spec 077
       FR-070); the page starts on it, and the session's log from here holds every request of that load */
    await ses.clearCache(); /* a picture cached by the last case would not be requested (or logged) again */
    reqs.clear(); T0 = Date.now();
    await H.load({ w, h, query: { ...q(gate, world), characters: value }, ready: REAL, settle: false });
    await must(`window.THEME.characters()===${jsLiteral(value)}`, `${tag}: the choice kept across the reload`);
    await must(`document.querySelector('#stage .ro .ro-plate')&&document.querySelector('#stage .ro').dataset.set===${jsLiteral(set)}`, `${tag}: the room draws ${set}`);
    await must(PICS, `${tag}: the pictures loaded (complete and naturalWidth > 0)`);
    /* the mutants (CREWS_MUTANT, see the header) act here, on this page, before the log is read */
    if (/^(missing|abortmissing|abort)$/.test(MUTANT)) await js(`(()=>{const b=document.querySelector('#stage .ro img').src.replace(/[^/]*$/,'');const u=${jsLiteral(MUTANT)}==='missing'||${jsLiteral(MUTANT)}==='abortmissing'?b+'no-such-frame.webp':document.querySelector('#stage .ro img').currentSrc+'?q='+Math.random();const i=new Image();i.src=u;if(${jsLiteral(MUTANT)}!=='missing')setTimeout(()=>{i.src=''},0);window.__crMut=i;return 1})()`);
    /* CREWS_MUTANT=failed: the log gets a request of a file that IS on disk and in the scene, ended with net::ERR_FAILED (the error seen on CI; injected into the log, as no
       way to make the browser itself report it is known): it must fail at 'requested Real office files that did not load with status 200', never be tolerated like ERR_ABORTED */
    if (MUTANT === 'failed') await js(`document.querySelector('#stage .ro img').currentSrc`).then((u) => reqs.set(-1, { url: decodeURIComponent(u), raw: u, status: 0, error: 'net::ERR_FAILED', t0: 0, t1: 1, type: 'image' }));
    const at = await quiet(tag);
    if (MUTANT === 'latevisit-nowait') await ctx.sleep(1200);
    const r = await js(`(()=>{const ro=document.querySelector('#stage .ro'),pics=[...document.querySelectorAll('#stage .ro-person,#stage .ro-visitor')].filter(i=>i.tagName==='IMG'),
      L=window.__durbarSimUi.realLayout(),
      plates=[...document.querySelectorAll('#stage .ro-plate')].map(e=>e.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0),
      overlaps=[];
      for(let i=0;i<plates.length;i++)for(let j=i+1;j<plates.length;j++){const a=plates[i],b=plates[j],ox=Math.min(a.right,b.right)-Math.max(a.left,b.left),oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(ox>1&&oy>1)overlaps.push(i+'x'+j+' '+Math.round(ox)+'x'+Math.round(oy));}
      return {shown:[...new Set([...document.querySelectorAll('#stage .ro img')].map(i=>decodeURIComponent(i.currentSrc||i.src)))],overlaps,unloaded:[...document.querySelectorAll('#stage .ro img')].filter(i=>!(i.complete&&i.naturalWidth>0)).map(i=>i.getAttribute('src')),set:ro.dataset.set,world:ro.dataset.world,n:pics.length,foreign:pics.filter(i=>!i.getAttribute('src').includes('sets/'+ro.dataset.set+'/')).map(i=>i.getAttribute('src')),
        crewInScene:document.querySelectorAll('#stage image[href*="crew/art/"],#stage img[src*="crew/art/"]').length,        worlds:window.DurbarCrew.offeredWorlds().map(x=>x.id),scroll:L.scroll,plates:document.querySelectorAll('#stage .ro-plate').length}})()`);
    assert.deepStrictEqual(r.worlds, world === 'photo' ? (gate ? ['photo', 'cave'] : ['photo']) : ['photo', world], `${tag}: a world other than the Photo office is offered only with its own flag: ${r.worlds}`);
    /* the picture first, so a failed case leaves what the room looked like */
    await H.shot(path.join(OUT, `097-crews-${world === 'photo' ? '' : world + '-'}${value}${gate ? '-open' : ''}-${w}x${h}.png`), { prep: 'calm' });
    const log = [...reqs.values()], urls = log.map((e) => e.url), webps = log.filter((e) => /\.webp(\?|$)/.test(e.url));
    assert.ok(log.some((e) => e.url.includes(`realoffice/worlds/${world}/`)), `${tag}: the session saw no Real office request (${log.length} in all): the request checks would see nothing`);
    const packs = [...new Set(urls.map((n) => /realoffice\/(worlds|sets)\/([a-z0-9-]+)\//.exec(n)).filter(Boolean).map((m) => m[1] + '/' + m[2]))].sort();
    const crewReq = urls.filter((n) => /crew\/art\//.test(n)).length;
    const officeReq = webps.filter((e) => /sets\/office\//.test(e.url)).length, setReq = webps.filter((e) => e.url.includes(`/sets/${set}/`)).length;
    const now = await js(SCENE);
    if (now !== at) await diag(tag, 'the scene changed after the quiet point');
    assert.strictEqual(now, at, `${tag}: the scene changed between the quiet point and the read`);
    assert.deepStrictEqual(r.unloaded, [], `${tag}: pictures of the scene that did not load`);
    /* a requested picture that is missing is a failure, whatever the page does with it (an <img> that fails is `complete` too) */
    const failed = log.filter((e) => /\.(webp|png|json|js)(\?|$)/.test(e.url) && /realoffice\//.test(e.url) && (e.status !== 200 || e.error) && !aborted(e));
    const bad = failed.map((e) => `${e.url.replace(/^.*realoffice\//, '')} ${e.status} ${e.error}`);
    const badWhen = failed.map((e) => `${e.url.replace(/^.*realoffice\//, '')} ${e.type} +${e.t0}..+${e.t1} ms, same file: ${log.filter((x) => x.url === e.url).map((x) => (x.error || x.status) + '@+' + x.t0).join(' ')}`);
    if (badWhen.length) console.log(`[crews] ${tag}: ${badWhen.join('; ')}`);
    if (bad.length) await diag(tag, 'requested files that did not load with status 200 (request t0..t1 ms after the reload, type; net::ERR_FAILED on a file on disk = the load stopped after it began)');
    assert.deepStrictEqual(bad, [], `${tag}: requested Real office files that did not load with status 200`);
    /* the independent expectation: every frame the scene shows was requested from the set's folder (so the requests are the pictures on
       screen, none missing from the log), and the Office people's frames are requested for no other set */
    const shownSet = r.shown.filter((u) => u.includes(`sets/${set}/`)).length;
    assert.ok(shownSet >= 6, `${tag}: the scene shows ${shownSet} distinct ${set} frames`);
    const notAsked = r.shown.filter((u) => !webps.some((e) => e.url === u && e.status === 200 && !e.error)); /* shown (the file the img loaded: half-size or full) but never in the log */
    assert.deepStrictEqual(notAsked, [], `${tag}: pictures on screen that the log has no completed request for`);
    assert.ok(setReq >= shownSet, `${tag}: ${setReq} ${set} frames requested, ${shownSet} shown`);
    if (set !== 'office') assert.strictEqual(officeReq, 0, `${tag}: Office people pictures requested for the ${set} set: ${officeReq}`);
    assert.strictEqual(r.set, set, `${tag}: the room draws the ${set} people, not ${r.set}`);
    assert.strictEqual(r.world, world, `${tag}: the ${world} world is drawn`);
    assert.ok(r.n >= 12, `${tag}: ${r.n} people drawn at 15 agents`);
    assert.deepStrictEqual(r.foreign, [], `${tag}: a person picture from another set`);
    assert.strictEqual(r.crewInScene, 0, `${tag}: a crew picture is in the Real office scene`);
    assert.strictEqual(crewReq, 0, `${tag}: the page requested ${crewReq} crew pictures in Real office`);
    /* the page starts on the saved choice: its set's pack and the Photo office's, no other set's, no other world's */
    assert.deepStrictEqual(packs, [`sets/${set}`, `worlds/${world}`].sort(), `${tag}: packs requested: ${packs.join(' ')}`);
    assert.deepStrictEqual(r.overlaps, [], `${tag}: name plates overlap (pair, px)`);
    assert.ok(!r.scroll, `${tag}: the office scrolls`);
    assert.ok(r.plates >= 15, `${tag}: ${r.plates} plates at 15 agents`);
    console.log(`[crews] ${tag}: set ${r.set}, ${r.n} people, packs ${packs.join(' ')}`);
  }
  console.log('check-097-crews: every Characters value draws its own set (or the default set of the world for the default and Minimalist) in the Photo office, the arcade and the cave, and says why');
};
