/*
 * Screenshots + check for spec 059 FR-019 (issue #536): a desk whose name is one long URL-like token stays inside its card in the full layout.
 * Simulator only (no AI credits). Three agents give the full layout; `simnames=long` gives agent 3 the URL-like name.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=3 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=$PWD/scripts/shots-059-long-url.js \
 *     npx electron . --no-sandbox        (xvfb-run -a on Linux)
 *
 * OUT_SUFFIX (default empty) is added to the file names (`before`/`after`). A miss prints DRIVER FAILED (Electron still exits 0):
 * look for '[059-url] all checks passed'.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const SUF = process.env.OUT_SUFFIX ? '-' + process.env.OUT_SUFFIX : '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const URL_PREFIX = 'https://example.invalid/'; // the fake address of the simulator's URL-like first prompt (never a real one)
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { sim: '3', simfreeze: '1', simnames: 'long', density: 'full' }, ready: 'fit', settle: false }); // density=full: a forced density never grows (spec 001, #532)
    await ctx.sleep(800);
    const r = await H.js(`(()=>{const e=[...document.querySelectorAll('#stage .desk .name')].find(n=>n.textContent.includes(${jsLiteral(URL_PREFIX)}));if(!e)return null;const c=e.closest('.desk').getBoundingClientRect(),b=e.getBoundingClientRect(),lh=parseFloat(getComputedStyle(e).lineHeight);return {d:document.getElementById('stage').dataset.d,out:b.right>c.right+0.5||b.left<c.left-0.5||b.bottom>c.bottom+0.5||(e.matches('.who .name')&&e.scrollWidth>e.clientWidth+1),lh:lh,lines:Math.round(b.height/lh),tip:e.title.length>60}})()`);
    assert.ok(r, `${w}x${h}: the URL-like name is on a card`);
    if (process.env.OUT_SUFFIX !== 'before') assert.strictEqual(r.d, 'full', `${w}x${h}: three agents use the full layout`);
    await H.shot(path.join(OUT, `059-long-url-name${SUF}-${w}x${h}.png`), { prep: 'mouse', delay: 300, tag: '059-url', what: `059-long-url-name${SUF}-${w}x${h}.png` });
    console.log(`[059-url] ${w}x${h} ${JSON.stringify(r)}`);
    if (!process.env.OUT_SUFFIX || process.env.OUT_SUFFIX !== 'before') { assert.ok(!r.out && r.tip, `${w}x${h}: the name stays in its card and keeps its tooltip: ${JSON.stringify(r)}`); assert.ok(r.lh > 0 && r.lines <= 2, `${w}x${h}: the full card name takes at most 2 lines: ${JSON.stringify(r)}`); }
  }
  // The other surfaces with the same name (15 agents, roomy/compact layouts): the Needs you inbox, and the Schedules dialog and Settings rows
  /** names of the elements (text holds the URL) that stick out of their box: right, left or bottom edge */
  const outside = (sel, box) => H.js(`(()=>{try{const out=[];for(const e of document.querySelectorAll(${jsLiteral(sel)})){if(!e.textContent.includes(${jsLiteral(URL_PREFIX)})&&!(e.title||'').includes(${jsLiteral(URL_PREFIX)}))continue;const c=e.closest(${jsLiteral(box)});if(!c)continue;const a=e.getBoundingClientRect(),b=c.getBoundingClientRect();if(a.right>b.right+0.5||a.left<b.left-0.5||a.bottom>b.bottom+0.5)out.push(${jsLiteral(sel)}+' '+Math.round(a.right)+'>'+Math.round(b.right))}return out}catch(err){return ['ERR '+String(err)]}})()`);
  const W = async (expr, what) => assert.ok(await ctx.waitFor(expr, 8000), 'timed out waiting for ' + what);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simnames: 'long' }, ready: 'fit', settle: false });
    await ctx.sleep(800);
    const tag = `${w}x${h}`;
    const made = await H.js(`(()=>{const a=__durbarSimUi.agents().find(x=>!x.parent&&x.name.includes(${jsLiteral(URL_PREFIX)}));return a?{id:a.id,name:a.name}:null})()`);
    assert.ok(made, `${tag}: the URL-named agent exists`);
    assert.ok(!made.name.includes('…') && made.name.length > 60, `${tag}: it shows its long first prompt (no alias): ${made.name}`);
    // Needs you inbox
    await H.js(`document.activeElement&&document.activeElement.blur()`); await H.key('I'); await W(`!!document.getElementById('inboxDlg')`, 'the inbox');
    await W(`!!document.querySelector('#inboxBody .inbox-row[data-id=${jsLiteral(made.id)}]')`, 'the URL-named agent in the inbox');
    const ib = await outside('#inboxBody .inbox-row[data-id=' + JSON.stringify(made.id) + '] .ib-n', '.inbox-row');
    assert.deepStrictEqual(ib, [], `${tag}: the inbox name stays in its row`);
    const ibd = await outside('#inboxBody .inbox-row[data-id=' + JSON.stringify(made.id) + '] .ib-n', '.inbox-dlg');
    assert.deepStrictEqual(ibd, [], `${tag}: the inbox name stays in its dialog`);
    await H.shot(path.join(OUT, `059-long-url-name-inbox-${w}x${h}.png`), { prep: 'mouse', delay: 300, tag: '059-url', what: `inbox ${tag}` });
    await H.key('Escape');
    await W(`!document.getElementById('inboxBody')`, 'the inbox to close');
    // Schedules dialog of that session
    await H.click('#stage .desk[data-id=' + JSON.stringify(made.id) + ']');
    await W(`document.body.classList.contains('panel-open')&&!!document.getElementById('schedHdrBtn')`, 'the panel');
    await H.click('#schedHdrBtn');
    await W(`!!document.getElementById('scTarget')`, 'the Schedules dialog');
    // one schedule whose prompt is one long token, sent to this session (through the dialog, as a user would)
    await H.js(`(()=>{const s=document.getElementById('scTarget');const o=[...s.options].find(x=>x.value);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}const p=document.getElementById('scPrompt');p.value=${jsLiteral('https://example.invalid/teams/consumer-sites/SitePages/Consumer-Onboarding-Checklist-Overview/Details-2026-Q4-Planning/Appendix-A-Long-Token')};p.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('scAdd').click()})()`);
    await W(`!!document.querySelector('#schedDlg .sc-row .sc-p')`, 'the schedule row in the dialog');
    const sd = [...await outside('#schedDlg .sc-row .sc-p', '.sc-row'), ...await outside('#scToHint', '.dlg'), ...await outside('#schedDlg .sc-row .sc-p', '.dlg')];
    assert.deepStrictEqual(sd, [], `${tag}: the Schedules dialog row and hint stay in their boxes`);
    const hint = await H.js(`(()=>{const h=document.getElementById('scToHint');return {hidden:h.hidden,tip:h.title}})()`);
    assert.ok(!hint.hidden && hint.tip.includes(made.name), `${tag}: the hint shows the session and keeps its tooltip: ${JSON.stringify(hint)}`);
    await H.click('#scClose');
    // Settings > Schedules
    await H.click('#backBtn');
    await H.click('#settingsBtn');
    await W(`!!document.querySelector('#schedSet .sc-row .sc-p')`, 'the Settings schedule row');
    const ss = [...await outside('#schedSet .sc-row .sc-p', '.sc-row'), ...await outside('#schedSet .sc-row .sc-p', '#schedSet')];
    assert.deepStrictEqual(ss, [], `${tag}: the Settings schedule row stays in its box`);
    console.log(`[059-url] ${tag} inbox, Schedules dialog and Settings rows ok`);
  }
  console.log('[059-url] all checks passed');
};
