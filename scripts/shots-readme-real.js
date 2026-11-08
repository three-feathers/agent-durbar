/*
 * The README's lead pictures (spec 008 delta 2026-11-08, issue #1256): the Real office with 15 agents, and the same office with the "Needs you" inbox open. Simulator only: no agent app, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-readme-real.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *   node scripts/shots-docs.js --only shots-readme-real
 *
 * Writes <SHOTS_OUT>/readme-real-office-1440x900.png (the office) and readme-real-inbox-1440x900.png (the inbox opened over it). Fails (exit 1) when the Real office is not drawn, a
 * picture has not decoded, the inbox has no row, or any text in the inbox is under 10.5 px (constitution V). Reduced motion is on, so the
 * lights stand still and the picture is the same every run.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-readme-real-'));

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const PICS = `[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`;
  const shot = (name) => H.shot(path.join(OUT, `readme-${name}-1440x900.png`), { prep: 'calm', settle: true, delay: 250, tag: 'readme-real', what: name });

  await H.load({ w: 1440, h: 900, query: { officeview: 'real', romotion: '1' }, ready: REAL, settle: false });
  await must(PICS, 'the pictures');
  await must(`document.querySelectorAll('#stage .ro-plate').length>=15`, '15 desks');
  await H.settle();

  await shot('real-office');

  await must(`window.__durbarSimUi.needsCount()>=2`, 'agents waiting for an answer');
  await js(`document.getElementById('inboxBtn').click()`);
  await must(`!!document.querySelector('#inboxDlg .inbox-row')`, 'the inbox');
  await H.settle();
  const small = await js(`[...document.querySelectorAll('#inboxDlg *')].filter(x=>x.children.length===0&&x.textContent.trim()&&parseFloat(getComputedStyle(x).fontSize)<10.5).length`);
  assert.strictEqual(small, 0, 'inbox text >= 10.5px');
  await shot('real-inbox');
};
