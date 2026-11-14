/*
 * Spec 058 FR-195..FR-203 (2026-11-03, T173): the MCP health strip at launch, and the chat's Sign in, Sign in again and a Restart for
 * every chat where a server failed, in Settings. Simulator only (no AI credits, no real runtime, no network).
 *
 *   npm run build
 *   OUT=/tmp DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-058-mcp-launch.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed, simmcplaunch=1: a Claude Code server whose command main did not find, a Codex list
 * that cannot be read; simmcpauth=1: "my-notes" asks Copilot and Claude Code chats for a sign-in):
 * - the strip is one line, takes no focus, and the office does not scroll; its headline counts exactly the problems the list holds;
 *   it also shows in the Real office look; List… opens the findings with a reason and a fix each, never an error text, at most 5
 *   lines, the list scrolls inside itself, Show stays in one right column, text >= 10.5px, the window never scrolls (FR-199..FR-203);
 * - a chat's server that runs again leaves the strip; a new failure and a policy-refused tool call join it (the policy line checked
 *   on its own item); a hostile server name and chat name render as text, nothing is injected (FR-202);
 * - Show on a chat's line opens that chat's MCP dialog; Show on a list's line opens Settings at MCP servers, with the top bar in view
 *   and no window scroll, where the row says the command was not found with FR-201's words (FR-198);
 * - Settings: no Restart where it failed for one failed chat; "(2 of 4)" with the reason for the Codex chat and the sign-in chat left
 *   out; the button is disabled while it runs; it restarts exactly the two chats (FR-196);
 * - a needs-sign-in chat row has Sign in, which opens the chat's dialog with that row's sign-in started (FR-195);
 * - Dismiss hides the strip and a later failure does not bring it back;
 * - simmcpauth=again: Sign in again in Settings opens the chat's dialog with its own confirmation (Cancel signs nothing in);
 * - without simmcplaunch the simulator shows no strip.
 * Shots (in DOC_SHOTS): 058-mcp-launch-closed-<w>x<h>.png (the one-line strip over the office), 058-mcp-launch-settings-<w>x<h>.png
 * (the list open over Settings, Restart where it failed (2 of 4)). Not linked: 058-mcp-launch-<w>x<h>.png (the list open over the office).
 * Photo Real office (issue #1424, FR-230): the list open and Settings with the list open are shown again there, after a labelled assert that html[data-world]
 * is photo and #stage .ro is photo/office; shots 058-mcp-launch-real-<w>x<h>.png and 058-mcp-launch-settings-real-<w>x<h>.png (not linked, not committed).
 * Issue #1566: first, in the Real office look (Photo; the arcade with DRIVER_WORLD=retro, which then runs only this part), at 1280x800 and 1440x900 with 15 agents: the office does
 * not scroll while the strip is shown (list closed) and after Dismiss, and the floor's lent padding (ro-tight) is gone with the strip.
 * Issue #1625 (T346): DRIVER_WORLD=retro DRIVER_CASE=strips: the restore, away, crash and follow strips alone, and away+follow and restore+away, at both sizes: no office scroll.
 * Prints "[058] launch PASS" ("[058] launch arcade office PASS" under DRIVER_WORLD=retro).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '058' });
  const emit = (id, servers) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:${jsLiteral(servers)}})`);
  const items = () => js(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].map(x=>({k:x.dataset.mlk,t:x.textContent}))`);
  const stripText = () => js(`document.getElementById('mcpStrip').textContent`);
  const done = () => js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(b=>b.textContent==='Done');if(b)b.click();})()`);
  const press = (n, id, act) => js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvs===${jsLiteral(n)}&&x.dataset.lvc===${jsLiteral(id)});const b=c&&c.querySelector(${jsLiteral(`[data-${act}]`)});if(!b)return false;b.focus();b.click();return true})()`);
  const toggle = (n) => js(`(()=>{const b=[...document.querySelectorAll('#liveList button[data-lv]')].find(x=>x.dataset.lv===${jsLiteral(n)});if(!b)return false;b.click();return true})()`);
  /* issue #1424 / FR-230: the Photo Real office, proven by the world itself (a fall back to the flat office fails here, it is not a picture of it) */
  const inReal = async (label, room = true) => {
    await js(`window.__durbarSimUi.setOfficeView('real');0`);
    const cond = "document.documentElement.dataset.world==='photo'&&!!document.getElementById('roWorldCss')" + (room ? "&&!!document.querySelector('#stage .ro')" : '');
    assert.ok(await until(cond, 8000), `${label}: the Photo Real office is shown (html[data-world] photo, its world CSS${room ? ', #stage .ro' : ''})`);
    /* Settings covers the room (it is not drawn behind a screen): there the world itself, html[data-world] and the Settings note, is the proof */
    if (room) assert.strictEqual(await js(`document.querySelector('#stage .ro').dataset.world+'/'+document.querySelector('#stage .ro').dataset.set`), 'photo/office', `${label}: the room draws the Photo office`);
    await settle();
  };
  const backToFlat = async () => {
    await js(`window.__durbarSimUi.setOfficeView('flat');0`);
    assert.ok(await until(`!document.documentElement.dataset.world`, 8000), 'back in the flat office');
    await settle();
  };
  const openSettingsMcp = async () => {
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('liveList')&&document.getElementById('advMcp').open`), 'Settings opened at MCP servers');
    await settle();
  };

  const LAY = `(()=>{const s=document.getElementById('mcpStrip').getBoundingClientRect(),f=document.getElementById('floor').getBoundingClientRect(),l=document.getElementById('mcpList');const cols=[...document.querySelectorAll('#mcpStrip [data-mlshow]')].map(b=>Math.round(b.getBoundingClientRect().right));let min=99;document.querySelectorAll('#mcpStrip, #mcpStrip *').forEach(e=>{if(!e.getClientRects().length)return;if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));});return {below:f.top>=s.bottom-1,min,pageX:document.documentElement.scrollWidth<=innerWidth,pageY:document.documentElement.scrollHeight<=innerHeight+1&&document.scrollingElement.scrollTop===0,capped:getComputedStyle(l).overflowY==='auto'&&l.getBoundingClientRect().height<=Math.min(innerHeight*0.34,210)+1,col:new Set(cols).size===1}})()`;
  /* issue #1566: the strip over the Real office (Photo; the arcade under DRIVER_WORLD=retro, which H.load draws and proves) never makes 15 agents scroll,
     at either size, with the strip shown (list closed) and after Dismiss; the arcade's hall takes the floor's padding rather than scroll (spec 102 delta 2026-11-11) */
  const REAL = process.env.DRIVER_WORLD === 'retro' ? 'arcade' : 'Photo';
  /* review of 2026-11-12 (T308, tests only): the three rules of the lend that the 15-agent loop below cannot show, each at 1280x800 with the strip shown:
     DRIVER_CASE=16 (16 agents: the lent layout still scrolls, so it is refused: ro-tight off, the office scrolls as before);
     DRIVER_CASE=filter (a status filter showing 11 to 15 agents: ro-tight is never set while the floor scrolls, and the note keeps its top padding);
     DRIVER_CASE=10 (issue #1598: DRIVER_AGENTS=10 DRIVER_ROOMS=3, DRIVER_H=769 (the 666 px room), three folders, strip shown: no folder of 4 or fewer is cut, no scroll);
     DRIVER_CASE=photo (18 agents in Photo at 1280x760 (DRIVER_H), where the strip leaves 636 px, Photo scrolls and the lend would rescue it: a world that is not `aisles` is never lent the padding) */
  const CASE = process.env.DRIVER_CASE || '';
  /* issue #1625 (spec 102 T346): the arcade does not scroll at 15 agents with each OTHER strip under the top bar (restore, away, crash, follow), alone and in the two pairs the
     lend can rescue, at both sizes. The mixed simulator always shows the restore strip, so a scene's other strips are dismissed (Keep as it is) and only the named ones are on show.
     Prints one line per scene with the strips' heights, the floor and the layout: those numbers are the measurement (Linux, 2026-11-14, in the spec delta).
     The scenes that still scroll (three strips at 1280x800, MCP list open, crash list plus restore) are DELIBERATELY not asserted here: they are the known gap of 1589, fixed by the approved, not yet merged 1685; add them when it lands, so this case covers only what passes today. */
  if (CASE === 'strips') {
    assert.strictEqual(REAL, 'arcade', 'DRIVER_CASE=strips runs in the arcade (DRIVER_WORLD=retro)');
    const IDS = { restore: 'restoreStrip', away: 'awayStrip', crash: 'crashStrip', follow: 'followStrip' };
    const SCENES = [['restore', {}], ['away', { simaway: '1' }], ['crash', { simcrash: '3' }], ['follow', {}], ['away+follow', { simaway: '1' }], ['restore+away', { simaway: '1' }]];
    const shownNow = `(()=>{const o={};for(const [k,i] of Object.entries(${jsLiteral(IDS)})){const e=document.getElementById(i);if(e&&!e.hidden&&e.getClientRects().length)o[k]=Math.round(e.getBoundingClientRect().height)}return o})()`;
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      for (const [name, q] of SCENES) {
        const want = name.split('+');
        await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', officeview: 'real', ...q } });
        assert.strictEqual(await js(`document.documentElement.dataset.world`), 'retro', `${name} ${w}: the arcade is drawn`);
        assert.ok(await until(`!!document.getElementById('restoreStrip')&&!document.getElementById('restoreStrip').hidden`, 8000), `${name} ${w}: the simulator's restore strip shows first`);
        if (!want.includes('restore')) {
          await js(`document.querySelector('#restoreStrip [data-ns="keep"]').click()`);
          assert.ok(await until(`document.getElementById('restoreStrip').hidden`, 4000), `${name} ${w}: Keep as it is closes the restore strip`);
        }
        if (want.includes('follow')) await js(`window.__durbarSimUi.afNotice.on(true);0`);
        for (const k of want) assert.ok(await until(`(()=>{const e=document.getElementById(${jsLiteral(IDS[k])});return !!e&&!e.hidden&&e.getClientRects().length>0})()`, 9000), `${name} ${w}: the ${k} strip shows`);
        await settle();
        const strips = await js(shownNow);
        assert.deepStrictEqual(Object.keys(strips).sort(), [...want].sort(), `${name} ${w}: exactly the named strips are on show: ${JSON.stringify(strips)}`);
        const F = JSON.parse(JSON.stringify(await js(`(()=>{const f=document.getElementById('floor'),r=document.querySelector('#stage .ro'),L=window.__durbarSimUi.realLayout();return {sh:f.scrollHeight,ch:f.clientHeight,roBottom:r?Math.round(r.getBoundingClientRect().bottom):0,fb:Math.round(f.getBoundingClientRect().bottom),fit:document.getElementById('stage').dataset.fit,tight:f.classList.contains('ro-tight'),scroll:!!(L&&L.scroll),lent:!!(L&&L.lent),H:L?Math.round(L.height):0}})()`)));
        const tell = JSON.stringify({ strips, ...F, font: await js(`getComputedStyle(document.body).fontFamily.split(',')[0]`) });
        console.log(`[058] strips ${w}x${h} ${name} ${tell}`);
        assert.ok(F.sh <= F.ch + 1 && F.fit === 'ok' && F.roBottom <= F.fb + 1 && !F.scroll, `arcade ${name} strip ${w}x${h}: the office does not scroll (scrollHeight ${F.sh} against clientHeight ${F.ch}, room ends ${F.roBottom} of ${F.fb}, layout scroll ${F.scroll}): ${tell}`);
      }
    }
    console.log('[058] launch arcade strips PASS');
    return;
  }
  if (CASE) {
    await H.load({ w: 1280, h: Number(process.env.DRIVER_H || 800), ready: 'fit', focus: true, query: { sim: String(Number(process.env.DRIVER_AGENTS || 15)), simkinds: 'mixed', simmcplaunch: '1', simmcpauth: '1', officeview: 'real', ...(process.env.DRIVER_ROOMS ? { simrooms: process.env.DRIVER_ROOMS } : {}) } });
    assert.strictEqual(await js(`document.documentElement.dataset.world`), REAL === 'arcade' ? 'retro' : 'photo', `${CASE}: the world is the one asked for`);
    const CNT = Number(process.env.DRIVER_AGENTS || 15); /* the case's agent count, passed as ?sim= */
    assert.strictEqual(await js(`window.__durbarSimUi.agents().filter(a=>!a.parent).length`), CNT, `${CASE}: the simulator shows ${CNT} main agents`);
    const A1 = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&a.info&&a.info.adapterId==='copilot')[0].id`);
    await emit(A1, [{ name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);
    assert.ok(await until(`!document.getElementById('mcpStrip').hidden`, 6000), `${CASE}: the strip shows over the Real office`);
    await settle();
    if (CASE === 'filter') {
      assert.ok(await js(`(()=>{const b=document.querySelector('.stat[data-k=${jsLiteral(process.env.DRIVER_STATUS || 'working')}]');if(!b)return false;b.click();return true})()`), 'filter: the status pill is there');
      assert.ok(await until(`document.getElementById('floor').classList.contains('has-fnote')&&!document.getElementById('filterNote').hidden`, 6000), 'filter: the filter note shows');
      await settle();
    }
    const S = JSON.parse(JSON.stringify(await js(`(()=>{const f=document.getElementById('floor'),r=document.querySelector('#stage .ro'),L=window.__durbarSimUi.realLayout();return {sh:f.scrollHeight,ch:f.clientHeight,roBottom:r?Math.round(r.getBoundingClientRect().bottom):0,fb:Math.round(f.getBoundingClientRect().bottom),tight:f.classList.contains('ro-tight'),note:f.classList.contains('has-fnote'),scroll:!!(L&&L.scroll),lent:!!(L&&L.lent),desks:document.querySelectorAll('#stage .ro .ro-plate:not(.lounge)').length,strip:!document.getElementById('mcpStrip').hidden,pt:getComputedStyle(f).paddingTop,pb:getComputedStyle(f).paddingBottom}})()`)));
    const tell = JSON.stringify(S);
    if (CASE === '16') {
      assert.ok(S.scroll && !S.lent && !S.tight, `arcade 16 agents MCP strip 1280: the lent layout still scrolls, so it is refused (ro-tight off, the layout not lent): ${tell}`);
      assert.ok(S.sh > S.ch + 1, `arcade 16 agents MCP strip 1280: the office scrolls as before (scrollHeight ${S.sh} against ${S.ch}): ${tell}`);
    } else if (CASE === 'filter') {
      assert.ok(S.note && S.desks >= 11 && S.desks <= 15, `arcade filter MCP strip 1280: the filter shows 11 to 15 agents under the note (${S.desks} drawn): ${tell}`);
      assert.ok(!(S.tight && S.sh > S.ch + 1), `arcade filter MCP strip 1280: the lent padding is not taken while the floor still scrolls (ro-tight with scrollHeight ${S.sh} against ${S.ch}): ${tell}`);
      assert.ok(S.pt !== '0px', `arcade filter MCP strip 1280: the note keeps its top padding (${S.pt}): ${tell}`);
    } else if (CASE === '10') {
      /* issue #1598 (spec 102 T342): 10 agents in 3 or 4 folders at 1280x800 with the strip (room 666 px): no folder of 4 or fewer is cut across rows, the office does not scroll; the lent padding is what makes the room (the hall is whole from 682) */
      const Z = JSON.parse(JSON.stringify(await js(`(()=>{const m={};for(const z of window.__durbarSimUi.realLayout().zones||[]){const e=m[z.id]||(m[z.id]={parts:0,desks:0});e.parts++;e.desks+=z.desks.length}return m})()`)));
      const ids = Object.keys(Z), cut = ids.filter((i) => Z[i].parts > 1 && Z[i].desks <= 4);
      assert.ok(ids.length >= 3 && ids.length <= 4, `arcade 10 agents MCP strip 1280: the simulator has 3 or 4 folders (${ids.length}): ${tell} ${JSON.stringify(Z)}`);
      assert.deepStrictEqual(cut, [], `arcade 10 agents MCP strip 1280: a folder of 4 or fewer is cut across rows (${cut}): ${tell} ${JSON.stringify(Z)}`);
      assert.ok(!S.scroll && S.sh <= S.ch + 1 && S.tight && S.lent, `arcade 10 agents MCP strip 1280: whole folders by the lent padding, no scroll: ${tell}`);
      await shot('102-1598-ten-strip-1280x769.png');
    } else {
      assert.ok(!S.tight && !S.lent, `Photo 18 agents MCP strip 1280x760: the padding is lent to the arcade only (ro-tight ${S.tight}, lent ${S.lent}): ${tell}`);
    }
    console.log(`[058] launch ${REAL} ${CASE} PASS ${tell}`);
    return;
  }
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simmcplaunch: '1', simmcpauth: '1', officeview: 'real' } });
    assert.strictEqual(await js(`document.documentElement.dataset.world`), REAL === 'arcade' ? 'retro' : 'photo', `${REAL} MCP strip ${w}: the world is the one asked for`);
    const A0 = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&a.info&&a.info.adapterId==='copilot')[0].id`);
    const FIT = `(()=>{const f=document.getElementById('floor'),r=document.querySelector('#stage .ro');return {sh:f.scrollHeight,ch:f.clientHeight,ro:r?Math.round(r.getBoundingClientRect().height):0,roBottom:r?Math.round(r.getBoundingClientRect().bottom):0,fb:Math.round(f.getBoundingClientRect().bottom),fit:document.getElementById('stage').dataset.fit,strip:!document.getElementById('mcpStrip').hidden,tight:f.classList.contains('ro-tight'),lay:(l=>l?[Math.round(l.height),!!l.scroll,!!l.lent]:null)(window.__durbarSimUi.realLayout())}})()`;
    const nofit = (f) => !(f.sh <= f.ch + 1 && f.fit === 'ok' && f.roBottom <= f.fb + 1);
    let fit;
    await emit(A0, [{ name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);
    assert.ok(await until(`!document.getElementById('mcpStrip').hidden`, 6000), `${REAL} MCP strip ${w}: the strip shows over the Real office`);
    await settle();
    /* the office stays put: five reads 100 ms apart are the same VALUES (floor, room, ro-tight, the layout's height, scroll and lent; not the layout object, which every legitimate draw replaces) (a floor that grows and shrinks again, as when the lent padding is not given back before the next measure, redraws for ever; settle() cannot see that) */
    await js(`(()=>{const w=window;w.__ro1566={n:0,last:w.__durbarSimUi.realLayout(),on:true};const t=()=>{if(!w.__ro1566.on)return;const l=w.__durbarSimUi.realLayout();if(l!==w.__ro1566.last){w.__ro1566.n++;w.__ro1566.last=l;}requestAnimationFrame(t);};requestAnimationFrame(t);return 0})()`); /* counts draws (a legitimate one, an art load or a status tick, replaces the layout object: a few are fine) */
    const reads = [];
    for (let i = 0; i < 5; i++) { reads.push(JSON.stringify(await js(FIT))); await ctx.sleep(100); }
    assert.ok(reads.every((r) => r === reads[0]), `${REAL} MCP strip ${w}: the office is steady while the strip is shown: ` + reads.join(' | '));
    const draws = await js(`(()=>{const r=window.__ro1566;r.on=false;return r.n})()`);
    assert.ok(draws <= 3, `${REAL} MCP strip ${w}: the office is drawn at most 3 times in 500 ms while the strip is shown (${draws}; a floor that changes size at every draw is a redraw loop)`);
    fit = JSON.parse(reads[0]);
    assert.ok(fit.strip && !nofit(fit), `${REAL} MCP strip ${w}: the strip is shown and the office does not scroll (scrollHeight ${fit.sh} against clientHeight ${fit.ch}, room ends ${fit.roBottom} of ${fit.fb}): ` + JSON.stringify(fit));
    const tight = await js(`document.getElementById('floor').classList.contains('ro-tight')`);
    assert.strictEqual(tight, REAL === 'arcade' && w === 1280, `${REAL} MCP strip ${w}: the floor's padding is lent only to the arcade at 1280x800 (ro-tight ${tight})`);
    await js(`document.querySelector('#mcpStrip [data-ml="close"]').click()`);
    assert.ok(await until(`document.getElementById('mcpStrip').hidden`, 6000), `${REAL} MCP strip ${w}: Dismiss hides the strip`);
    await settle();
    fit = await js(FIT);
    assert.ok(!fit.strip && !nofit(fit), `${REAL} MCP strip ${w}: after the strip closes the office does not scroll: ` + JSON.stringify(fit));
    assert.strictEqual(await js(`document.getElementById('floor').className.includes('ro-tight')`), false, `${REAL} MCP strip ${w}: the floor's padding is back once the strip is gone`);
  }
  console.log(`[058] launch ${REAL} office PASS`);
  if (REAL === 'arcade') return; /* DRIVER_WORLD=retro runs the Real office check only: the rest is the flat strip's and the same in every world */

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', simmcplaunch: '1', simmcpauth: '1' } });
    const chats = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent).map(a=>({id:a.id,name:a.name,kind:a.info&&a.info.adapterId}))`);
    const byKind = (k) => chats.filter((c) => c.kind === k);
    const A = byKind('copilot')[0], B = byKind('claude')[0], C = byKind('codex')[0];
    assert.ok(A && B && C, 'Copilot, Claude Code and Codex chats run: ' + JSON.stringify(chats));
    await emit(A.id, [{ name: 'browser', status: 'connected' }, { name: 'my-notes', status: 'needs-auth', error: 'The server answered 401 Unauthorized: sign in to use its tools.', errorClass: 'auth' }]);
    assert.ok(await until(`!document.getElementById('mcpStrip').hidden`, 6000), 'the strip shows');
    for (const c of chats) if (c.id !== A.id) await emit(c.id, [{ name: 'my-notes', status: 'connected' }]); // the other chats sign in: they leave the strip

    // ---- FR-199/FR-200: the strip, its findings, no error text ----
    assert.ok(await until(`!document.getElementById('mcpStrip').hidden`, 6000), 'the strip shows');
    // one line by default: the office keeps its room (no office scroll with 15 agents)
    const closed = await js(`(()=>{const s=document.getElementById('mcpStrip'),f=document.getElementById('floor');return {h:s.getBoundingClientRect().height,list:!!s.querySelector('[data-mlk]'),exp:s.querySelector('[data-ml="list"]').getAttribute('aria-expanded'),t:s.querySelector('.ns-t').textContent,fits:f.scrollHeight<=f.clientHeight+1}})()`);
    assert.ok(closed.h <= 40 && !closed.list && closed.exp === 'false', `${w}: one line, list closed: ` + JSON.stringify(closed));
    const head = /^(\d+) MCP problems need attention \(found since the app started\): Codex.s MCP list, github, playwright and others\. Nothing was changed/.exec(closed.t);
    assert.ok(head, 'the headline: ' + closed.t);
    assert.ok(closed.fits, `${w}: the office does not scroll with the strip closed`);
    assert.ok(!(await js(`document.getElementById('mcpStrip').contains(document.activeElement)`)), 'it took no focus');
    await shot(`058-mcp-launch-closed-${w}x${h}.png`);
    // the strip is window chrome, outside the office: it shows in the Real office look too (feature inventory)
    await js(`window.__durbarSimUi.setOfficeView('real');0`);
    await settle();
    assert.ok(await js(`(()=>{const s=document.getElementById('mcpStrip'),f=document.getElementById('floor');return !s.hidden&&s.getBoundingClientRect().height>0&&f.getBoundingClientRect().top>=s.getBoundingClientRect().bottom-1&&document.scrollingElement.scrollTop===0})()`), `${w}: the strip shows above the Real office`);
    await js(`window.__durbarSimUi.setOfficeView('flat');0`);
    await settle();
    await js(`document.querySelector('#mcpStrip [data-ml="list"]').click()`);
    assert.ok(await until(`!!document.querySelector('#mcpStrip [data-mlk]')&&document.activeElement===document.querySelector('#mcpStrip [data-ml="list"]')&&document.activeElement.getAttribute('aria-expanded')==='true'`), 'List… opens the list and keeps the focus');
    let it = await items();
    const moreN = await js(`(()=>{const m=/and (\\d+) more in Settings/.exec(document.getElementById('mcpStrip').textContent);return m?Number(m[1]):0})()`);
    assert.strictEqual(it.length + moreN, Number(head[1]), 'the headline counts what the list counts (lines + "and N more")');
    const keys = it.map((x) => x.k);
    assert.ok(keys.includes('list:codex'), 'the unreadable Codex list: ' + JSON.stringify(keys));
    assert.ok(keys.includes('cmd:playwright'), 'the missing command: ' + JSON.stringify(keys));
    assert.ok(keys.some((k) => k === 'chat:' + JSON.stringify([A.id, 'my-notes'])), 'the chat\'s needs-sign-in server: ' + JSON.stringify(keys));
    assert.ok(it.length <= 5, 'at most 5 lines');
    const pw = it.find((x) => x.k === 'cmd:playwright').t;
    assert.match(pw, /playwright.*Claude Code list.*Not installed \(command not found\)\. Install the command, or put its full path/);
    const mn = it.find((x) => x.k === 'chat:' + JSON.stringify([A.id, 'my-notes'])).t;
    assert.ok(mn.startsWith('my-notes ' + A.name + ' (') && /: Refused: needs sign-in\. Sign in again: Show opens the chat.s MCP list/.test(mn), 'name, chat and app, reason, fix: ' + mn);
    const all = await stripText();
    assert.match(all, /MCP problems need attention/);
    assert.ok(!/401|Unauthorized|ENOENT|could not be read\./.test(all), 'no error text in the strip: ' + all);
    assert.strictEqual(await js(`document.getElementById('mcpStrip').getAttribute('role')`), 'status', 'a status strip, not an alert or a modal');
    // FR-203: its own room, 10.5px, no page overflow
    const lay = await js(LAY);
    assert.ok(lay.below && lay.min >= 10.5 && lay.pageX && lay.pageY && lay.capped && lay.col, `${w}: the strip takes its own room, 10.5px, no page scroll: ` + JSON.stringify(lay));
    await shot(`058-mcp-launch-${w}x${h}.png`);
    // FR-230: the same list, open, over the Photo Real office (same layout asserts), then back to the flat office for the rest
    await inReal(`${w}: list open`);
    assert.ok(await js(`document.querySelectorAll('#mcpStrip [data-mlk]').length>0&&document.getElementById('mcpStrip').querySelector('[data-ml="list"]').getAttribute('aria-expanded')==='true'`), `${w}: the list is still open in the Real office`);
    const layR = await js(LAY);
    assert.ok(layR.below && layR.min >= 10.5 && layR.pageX && layR.pageY && layR.capped && layR.col, `${w}: Real office: the strip takes its own room, 10.5px, no page scroll: ` + JSON.stringify(layR));
    await shot(`058-mcp-launch-real-${w}x${h}.png`);
    await backToFlat();

    // ---- FR-199 part 2: a server that runs again leaves; a new failure and a policy refusal join ----
    await emit(A.id, [{ name: 'browser', status: 'connected' }, { name: 'my-notes', status: 'connected' }]);
    assert.ok(await until(`![...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral('chat:' + JSON.stringify([A.id, 'my-notes']))})`), 'my-notes left the strip when it ran');
    await emit(A.id, [{ name: 'browser', status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:3000' }, { name: 'my-notes', status: 'connected' }]);
    assert.ok(await until(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral('chat:' + JSON.stringify([A.id, 'browser']))}&&/Refused the connection\\. Check the server.s address or port/.test(x.textContent))`), 'a refused server joins with the port fix');
    // FR-202: a hostile server name and chat name render as text
    const D = chats.find((c) => c.id !== A.id && c.id !== B.id && (c.kind === 'copilot' || c.kind === 'claude'));
    assert.ok(D, 'a fourth Copilot or Claude Code chat');
    const EVIL = '<img src=x onerror="window.__pwn=1"><b>x</b>';
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(D.id)});window.__dName=a.name;a.name=${jsLiteral('Evil ' + EVIL)};})()`);
    await emit(D.id, [{ name: EVIL, status: 'failed', error: 'x' }]);
    const evilKey = 'chat:' + JSON.stringify([D.id, EVIL]);
    assert.ok(await until(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral(evilKey)})`), 'the hostile line shows');
    const ev = await js(`(()=>{const x=[...document.querySelectorAll('#mcpStrip [data-mlk]')].find(x=>x.dataset.mlk===${jsLiteral(evilKey)});return {t:x.textContent,img:document.querySelectorAll('#mcpStrip img').length,bs:x.querySelectorAll('b').length,pwn:window.__pwn===1}})()`);
    assert.ok(ev.t.startsWith(EVIL + ' Evil ' + EVIL) && ev.img === 0 && ev.bs === 1 && !ev.pwn, 'the names render literally, nothing injected: ' + JSON.stringify(ev));
    await emit(D.id, [{ name: EVIL, status: 'connected' }]);
    assert.ok(await until(`![...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral(evilKey)})`), 'the hostile line left');
    await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(D.id)});a.name=window.__dName;})()`);
    await js(`window.__durbarSimEmit({type:'toolCall',sessionId:${jsLiteral(B.id)},timestamp:Date.now(),callId:'pc1',tool:'teams_send',mcpServer:'agent365-teams',phase:'failed',output:'AADSTS530003: Your device is required to be managed to access this resource.'})`);
    const polKey = 'policy:' + JSON.stringify([B.id, 'agent365-teams']);
    assert.ok(await until(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral(polKey)}&&/^agent365-teams .*: Blocked by your organization.s access policy\\. Your organization.s sign-in rules refused it, usually a managed-device check\\./.test(x.textContent))`), 'the policy line, on its own item');
    // a later report of that server, with a marker in the same report: once the window holds the marker, the report was handled
    await emit(B.id, [{ name: 'agent365-teams', status: 'pending' }, { name: 'marker', status: 'failed', error: 'x' }]);
    assert.ok(await until(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(B.id)}).mcp||[]).some(x=>x.name==='marker')`), 'the window handled the report after the policy refusal');
    assert.ok(await js(`[...document.querySelectorAll('#mcpStrip [data-mlk]')].some(x=>x.dataset.mlk===${jsLiteral(polKey)})`), 'a later report of the server keeps the policy line');
    await emit(B.id, [{ name: 'marker', status: 'connected' }]);
    assert.ok(await until(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(B.id)}).mcp||[]).some(x=>x.name==='marker'&&x.status==='connected')`), 'the marker runs again (it leaves the strip)');
    assert.ok(!/AADSTS|managed to access/.test(await stripText()), 'the policy line has no vendor text');

    // ---- Show: a chat's line opens its MCP dialog; a list's line opens Settings, where the row says the command was not found ----
    await js(`[...document.querySelectorAll('#mcpStrip [data-mlshow]')].find(b=>b.dataset.mlshow===${jsLiteral('chat:' + JSON.stringify([A.id, 'browser']))}).click()`);
    assert.ok(await until(`document.querySelectorAll('#agMcp li.srv').length>0`), 'Show opened the chat MCP dialog');
    assert.ok((await js(`document.getElementById('scrDlgT').textContent`)).endsWith(A.name), 'that chat\'s dialog');
    await done();
    assert.ok(await until(`!document.getElementById('scrDlg')`), 'the dialog closed');
    // the chat stays open after its dialog (that view hides the top bar by design); leave it, as a person going to Settings would
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`), 'the chat closed');
    await js(`document.querySelector('#mcpStrip [data-mlshow="cmd:playwright"]').click()`);
    assert.ok(await until(`!!document.getElementById('liveList')&&document.getElementById('advMcp').open`), 'Show on a list line opened Settings at MCP servers');
    await settle();
    /* the window's own scroll (documentElement.scrollHeight also counts Settings' off-screen measuring nodes, which html clips) */
    const noScroll = `(()=>{const t=document.querySelector('.topbar').getBoundingClientRect(),sc=document.getElementById('screen').getBoundingClientRect();return {top:t.top>=0&&t.height>0,win:document.scrollingElement.scrollTop===0&&scrollY===0&&document.body.scrollHeight<=innerHeight+1&&sc.bottom<=innerHeight+1,st:document.scrollingElement.scrollTop,bh:document.body.scrollHeight,ih:innerHeight,scrBottom:Math.round(sc.bottom)}})()`;
    const ns = await js(noScroll);
    assert.ok(ns.top && ns.win, `${w}: Settings with the list open: the top bar is in view and the window does not scroll ` + JSON.stringify(ns));
    assert.strictEqual(await js(`(document.querySelector('#globList li[data-g="playwright"] [data-miss]')||{}).textContent||''`), 'Agent Durbar did not find this command on this computer. ' + (await js(`window.DurbarMcpWords.fixFor('not-found')`)), 'the list row says so, with FR-201\'s words');
    assert.ok(!(await js(`!!document.querySelector('#liveList [data-lvall="browser"]')`)), 'one failed chat: no Restart where it failed');
    assert.ok(!(await js(`!!document.querySelector('#globList li[data-g="sentry"] [data-miss]')`)), 'an http server has no such line');
    assert.ok(await js(`!!document.querySelector('#ambList li[data-amb="github"]')&&!document.querySelector('#ambList li[data-amb="github"] [data-miss]')`), 'the Copilot row of "github" (found there) has no not-found line, though Claude Code\'s "github" is missing');

    // ---- FR-196: Restart where it failed (2) restarts exactly the two failed chats ----
    await emit(B.id, [{ name: 'browser', status: 'failed', error: 'spawn browser-mcp ENOENT', errorClass: 'not-found' }, { name: 'my-notes', status: 'connected' }]);
    await emit(C.id, [{ name: 'browser', status: 'failed', error: 'spawn browser-mcp ENOENT', errorClass: 'not-found' }]);
    await emit(D.id, [{ name: 'browser', status: 'failed', error: 'SSE stream terminated: 401', errorClass: 'auth' }]);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__lvCalls=[];if(!b.__lvWrapped){b.__lvWrapped=true;const r=b.agentMcpRestart;b.agentMcpRestart=async(id,n)=>{window.__lvCalls.push([id,n]);await new Promise(z=>setTimeout(z,400));return r(id,n);};}})()`);
    assert.ok(await until(`/^Restart where it failed \\(2 of 4\\)$/.test((document.querySelector('#liveList [data-lvall="browser"]')||{}).textContent||'')`), 'Restart where it failed (2 of 4): not Codex, not the sign-in');
    assert.match(await js(`(document.querySelector('#liveList li[data-lvn="browser"] .lv-allwhy')||{}).textContent||''`), /^Codex can only restart the whole session: use Restart session with these servers in that chat\. A chat that needs a sign-in is left out: a restart does not sign in\.$/, 'it says why');
    await toggle('browser');
    await settle();
    await shot(`058-mcp-launch-settings-${w}x${h}.png`);
    // FR-230: Settings with the list open, over the Photo Real office (the world chrome of the Real office), then back to the flat office
    await inReal(`${w}: Settings`, false);
    const nsR = await js(noScroll);
    assert.ok(nsR.top && nsR.win, `${w}: Real office: Settings with the list open: the top bar is in view and the window does not scroll ` + JSON.stringify(nsR));
    assert.ok(await js(`!!document.getElementById('liveList')&&!!document.querySelector('#liveList [data-lvall="browser"]')`), `${w}: Real office: Restart where it failed is on the list`);
    await shot(`058-mcp-launch-settings-real-${w}x${h}.png`);
    await backToFlat();
    await js(`document.querySelector('#liveList [data-lvall="browser"]').click()`);
    assert.ok(await until(`!!document.querySelector('#liveList [data-lvall="browser"][disabled]')`, 2000), 'disabled while it runs');
    assert.ok(await until(`window.__lvCalls.length===2&&!document.querySelector('#liveList [data-lvall="browser"][disabled]')`, 8000), 'two restarts, then the button is free');
    assert.deepStrictEqual((await js(`window.__lvCalls`)).map((c) => c[0]).sort(), [A.id, B.id].sort(), 'only the failed chats that can restart one server');

    // ---- FR-195: Sign in from Settings starts the chat's own sign-in ----
    /* a Needs sign-in row (the simulator's sign-in, like main, starts only for a server that waits for one) */
    const pick = `[...document.querySelectorAll('#liveList li.lv-chat')].find(c=>c.querySelector('[data-lvsign]')&&c.querySelector('.mst-w').textContent==='Needs sign-in')`;
    if (!(await js(`!!${pick}`))) await toggle('my-notes');
    assert.ok(await until(`!!${pick}`), 'a needs-sign-in chat row has Sign in');
    const [signSrv, signRow] = await js(`(()=>{const c=${pick};return [c.dataset.lvs,c.dataset.lvc]})()`);
    const sr = await js(`(()=>{const c=[...document.querySelectorAll('#liveList li.lv-chat')].find(x=>x.dataset.lvc===${jsLiteral(signRow)}&&x.dataset.lvs===${jsLiteral(signSrv)});const b=c.querySelector('.lv-act > button');return {first:b&&b.dataset.lvsign!==undefined,primary:b&&b.classList.contains('primary'),open:!!c.querySelector('[data-lvopen]:not(.primary)'),note:(c.querySelector('.lv-auth')||{}).textContent}})()`);
    assert.ok(sr.first && sr.primary && sr.open, 'Sign in leads, Open in chat stays as a secondary button: ' + JSON.stringify(sr));
    assert.match(sr.note, /Sign in opens the chat's MCP list and starts the sign-in there/);
    await press(signSrv, signRow, 'lvsign');
    assert.ok(await until(`!document.body.classList.contains('screen-open')&&[...document.querySelectorAll('#agMcp button[data-signopen]')].some(b=>b.dataset.signopen===${jsLiteral(signSrv)})`, 6000), 'Settings closed; the chat dialog started its own sign-in (Open sign-in page)');
    await done();
    assert.ok(await until(`!document.getElementById('scrDlg')`), 'the dialog closed');

    // ---- Dismiss: gone for this run; a later failure does not bring it back ----
    await js(`document.querySelector('#mcpStrip [data-ml="close"]').click()`);
    assert.ok(await until(`document.getElementById('mcpStrip').hidden`), 'Dismiss hides the strip');
    await emit(A.id, [{ name: 'late', status: 'failed', error: 'x' }]);
    assert.ok(await until(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(A.id)}).mcp||[]).some(x=>x.name==='late'&&x.status==='failed')`), 'the window got the later failure');
    assert.ok(await js(`document.getElementById('mcpStrip').hidden`), 'nothing new shows after Dismiss');
  }

  // ---- FR-195: Sign in again from Settings opens the chat's own confirmation; Cancel signs nothing in ----
  await H.load({ w: 1280, h: 800, ready: 'fit', focus: true, query: { simmcpauth: 'again' } });
  {
    const id = await js(`window.__durbarSimUi.agents().find(a=>a.live&&!a.parent&&(a.info&&a.info.adapterId||'copilot')==='copilot').id`);
    await emit(id, [{ name: 'team-wiki', status: 'connected' }]);
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__sign=[];const o=b.agentMcpSignIn;b.agentMcpSignIn=(...a)=>{window.__sign.push(a);return o(...a);};})()`);
    await openSettingsMcp();
    await toggle('team-wiki');
    assert.ok(await until(`[...document.querySelectorAll('#liveList li.lv-chat')].some(x=>x.dataset.lvs==='team-wiki'&&x.dataset.lvc===${jsLiteral(id)}&&x.querySelector('[data-lvagain]'))`), 'Sign in again is on the row');
    await press('team-wiki', id, 'lvagain');
    assert.ok(await until(`!!document.getElementById('modeDlg')&&/Sign in again to team-wiki\\?/.test(document.getElementById('modeDlg').textContent)`, 6000), 'the chat dialog asks its own question');
    /* the dialog repaints once Sign in again has finished (its `finally`): count its reads, then Cancel */
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__reads=0;const o=b.agentMcp;b.agentMcp=(...a)=>{window.__reads++;return o(...a);};})()`);
    await js(`[...document.querySelectorAll('#modeDlg .btn')].find(b=>b.textContent==='Cancel').click()`);
    assert.ok(await until(`!document.getElementById('modeDlg')&&window.__reads>0`), 'Cancel closed the question and Sign in again finished (the dialog read the list again)');
    assert.deepStrictEqual(await js(`window.__sign`), [], 'Cancel: nothing signed in');
    assert.ok(await js(`document.getElementById('mcpStrip').hidden`), 'no strip without simmcplaunch');
    await done();
  }
  console.log('[058] launch PASS');
};
