/*
 * Spec 030 FR-042..FR-045 (issue #409): continue a conversation in another agent app. Simulator only (mixed agent apps), no credits.
 * Linux with xvfb-run, one Electron at a time:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-030-handover.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800: a Copilot agent's More menu offers "Continue in another app…"; it opens the New session dialog as a
 * preset (its own title, another ready app preselected, the summary ticked); the review step starts with the provenance line and
 * names the target app; Start opens a session of the other app whose first message is that text. With only one ready app the
 * entry is not there. Writes docs/screenshots/030-handover-*.png.
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const { helpers } = require('./driver-helpers');

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `030-handover-${name}-${w}x${h}.png`));
  const openMore = async () => {
    await js(`document.getElementById('moreBtn').click()`);
    await ctx.waitFor(`!!document.getElementById('moreMenu')&&!document.getElementById('moreMenu').hidden`, 5000);
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { simkinds: 'mixed' } });
    // sim-2 is a Copilot agent in the mixed office; Claude Code, Codex and a basic app are ready too
    await js(`document.querySelector('#stage .desk[data-id="sim-2"]').click()`);
    await ctx.waitFor(`!!document.getElementById('moreBtn')`, 8000);
    await openMore();
    const item = await js(`(()=>{const b=document.getElementById('handoverBtn');if(!b)return null;const r=b.getBoundingClientRect();return {t:b.textContent,font:parseFloat(getComputedStyle(b).fontSize),h:r.height}})()`);
    assert.ok(item && item.t.startsWith('Continue in another app…'), `${w}: the More menu offers Continue in another app…`);
    assert.ok(item.font >= 10.5, `${w}: legible`);
    await shot('menu', w, h);
    await js(`document.getElementById('handoverBtn').click()`);
    await ctx.waitFor(`!!document.getElementById('sessDlg')`, 5000);
    const dlg = await js(`({t:document.getElementById('sdT').textContent,kind:(document.getElementById('sdKind')||{}).value,sum:!!(document.getElementById('sdSum')||{}).checked,sub:document.querySelector('#sessDlg .dsub').textContent})`);
    assert.strictEqual(dlg.t, 'Continue in another agent app', `${w}: the preset's title`);
    assert.ok(dlg.kind && dlg.kind !== 'copilot', `${w}: another ready app is preselected (${dlg.kind})`);
    assert.ok(dlg.sum, `${w}: the summary is ticked`);
    assert.match(dlg.sub, /keeps its history/);
    await shot('dialog', w, h);
    await js(`document.getElementById('sdGo').click()`);
    await ctx.waitFor(`!!document.getElementById('hoDlg')`, 8000);
    const rev = await js(`({text:document.getElementById('hoText').value,sub:document.querySelector('#hoDlg .dsub').textContent})`);
    assert.match(rev.text, /^Continued from a Copilot session \([^)]+\) in this folder\. Its summary:\n\n## Goal/, `${w}: the provenance line leads the editable summary`);
    assert.match(rev.sub, /\(Claude Code\)/, `${w}: the review names the target app`);
    assert.strictEqual(await js(`document.getElementById('hoGo').textContent`), 'Start in Claude Code', `${w}: the button says where it starts`);
    await shot('review', w, h);
    const before = await js(`document.querySelectorAll('#stage .desk[data-id]').length`);
    await js(`document.getElementById('hoGo').click()`);
    await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>${before}||!!document.querySelector('#chat .msg.user')`, 8000);
    await ctx.waitFor(`[...document.querySelectorAll('#chat .msg.user')].some(m=>/Continued from a Copilot session/.test(m.textContent))`, 8000);
    const now = await js(`(()=>{const t=document.getElementById('panelTitle');return {title:t&&t.textContent}})()`);
    assert.ok(now.title, `${w}: the new session's chat is open`);
    await shot('continued', w, h);
    await js(`document.getElementById('backBtn').click()`);
    await ctx.sleep(300);
  }
  // one ready app only: nothing to continue in, so the entry is not there
  await H.load({ w: 1440, h: 900 });
  await js(`document.querySelector('#stage .desk[data-id="sim-2"]').click()`);
  await ctx.waitFor(`!!document.getElementById('moreBtn')`, 8000);
  await openMore();
  assert.ok(await js(`!document.getElementById('handoverBtn')`), 'one ready app: no entry');
  console.log('[030-handover] PASS');
};
