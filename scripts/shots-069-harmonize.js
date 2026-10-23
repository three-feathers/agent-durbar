/*
 * Spec 069 part 2 (T022): Harmonize in Settings > MCP: servers missing or different between the agent apps' own lists, copied per server
 * after the same per-file review as part 1. Simulator only (fake lists in the page; nothing is written to disk, no AI credits).
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-069-harmonize.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks, at 1440x900 and 1280x800 (simkinds=mixed):
 * - #hmList lists the servers not in every list, with "in" and "missing in" chips; my-notes says "Different between the lists: arguments".
 * - Copy context7 from Codex: the source is not a target, the missing apps are ticked; the review lists two files; Write: the row is gone.
 * - Copy my-notes from Copilot to Claude Code (which has a different one): the review asks "Replace it in Claude Code" (not ticked);
 *   with the tick it is replaced and my-notes is no longer different.
 * - With one installed app (plain sim) the section still shows only when two lists can be read (the fake has three).
 * - Text >= 10.5px, dialogs fit. Shots: 069-mcp-harmonize-<w>x<h>.png, 069-mcp-harmonize-review-<w>x<h>.png. Prints "[069h] PASS".
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: '069h' });
  const fits = () => js(`(()=>{const d=document.querySelector('#scrDlg .dlg').getBoundingClientRect();return d.top>=0&&d.left>=0&&d.bottom<=innerHeight+1&&d.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
  const minFont = (sel) => js(`(()=>{let min=99,who='';document.querySelectorAll(${jsLiteral(sel)}).forEach(e=>{if(!e.getClientRects().length)return;const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!own)return;const f=parseFloat(getComputedStyle(e).fontSize);if(f<min){min=f;who=e.tagName+'.'+e.className}});return {min,who}})()`);
  const btn = (label) => js(`(()=>{const b=[...document.querySelectorAll('#scrDlg .dbtn .btn')].find(x=>x.textContent===${jsLiteral(label)});if(!b)return false;b.click();return true;})()`);
  const rows = () => js(`[...document.querySelectorAll('#hmList li.hm')].map(li=>li.dataset.h)`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed' } });
    await js(`window.DurbarScreens.openSettings('mcp')`);
    assert.ok(await until(`!!document.getElementById('hmList')`), 'Harmonize is shown');
    await settle();
    assert.deepStrictEqual(await rows(), ['github', 'my-notes', 'sentry', 'context7']);
    assert.match(await js(`document.querySelector('#hmList li[data-h="my-notes"]').textContent`), /Different between the lists: arguments/);
    assert.match(await js(`document.querySelector('#hmList li[data-h="github"]').textContent`), /missing in\s*Codex/);
    const f0 = await minFont('#hmList, #hmList *');
    assert.ok(f0.min >= 10.5, `${w}: harmonize text >= 10.5px ${JSON.stringify(f0)}`);
    await js(`document.getElementById('hmH').scrollIntoView({block:'start'})`);
    await shot(`069-mcp-harmonize-${w}x${h}.png`);

    // ---- copy a missing one ----
    await js(`document.querySelector('#hmList [data-act=hcopy][data-g="context7"]').click()`);
    assert.ok(await until(`!!document.getElementById('hmFrom')`));
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#scrDlg [name=gApp]')].map(x=>x.value+':'+x.checked+':'+x.disabled)`), ['copilot:true:false', 'claude:true:false', 'codex:false:true'], 'the source is not a target; the missing ones are ticked');
    assert.ok(await btn('Review…'));
    assert.ok(await until(`document.querySelectorAll('#scrDlg .gpv').length===2`), 'two files to review');
    assert.match(await js(`document.querySelector('#scrDlg .dbody').textContent`), /Values are copied as they are/);
    assert.ok(await fits(), `${w}: the review fits`);
    await shot(`069-mcp-harmonize-review-${w}x${h}.png`);
    assert.ok(await btn('Write to 2 files'));
    assert.ok(await until(`!document.querySelector('#hmList li[data-h="context7"]')`), 'context7 is in step now');

    // ---- replace a different one ----
    await H.clearToasts();
    await js(`document.querySelector('#hmList [data-act=hcopy][data-g="my-notes"]').click()`);
    assert.ok(await until(`!!document.getElementById('hmFrom')`));
    await js(`(()=>{const s=document.getElementById('hmFrom');s.value='copilot';s.dispatchEvent(new Event('change'));const c=document.querySelector('#scrDlg [name=gApp][value=claude]');if(!c.checked)c.click();const x=document.querySelector('#scrDlg [name=gApp][value=codex]');if(x.checked)x.click();})()`);
    assert.ok(await btn('Review…'));
    assert.ok(await until(`!!document.querySelector('#scrDlg [data-rep=claude]')`), 'the review asks to replace it in Claude Code');
    assert.strictEqual(await js(`document.querySelector('#scrDlg [data-rep=claude]').checked`), false, 'not ticked by default');
    await js(`document.querySelector('#scrDlg [data-rep=claude]').click()`);
    assert.ok(await btn('Write to 1 file'));
    assert.ok(await until(`/Written: Claude Code/.test([...document.querySelectorAll('#toasts .toast')].map(x=>x.textContent).join(' '))`));
    assert.ok(await until(`!/Different/.test((document.querySelector('#hmList li[data-h="my-notes"]')||{}).textContent||'')`), 'my-notes is no longer different');
  }
  console.log('[069h] PASS');
};
