/*
 * Spec 045 FR-066 as changed and FR-434 (owner decision 2026-11-23, issue #2060 item 1): an error toast shows the real error text, masked, as
 * text, with a Copy details button. The simulator's bridge answers an Open with failure exactly as main now answers it: main's own built
 * `failText` (dist/main/ipcerror.js) on an EACCES whose path holds markup and whose message holds an invented token. Simulator only (no AI
 * credits, no agent app). At 1440x900 and 1280x800.
 *
 *   npm run check:ui -- --only check-error-text
 *   OUT=<folder>  (optional) also saves 045-error-text-{1440x900,1280x800}.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const OWNER = 'owner decision 2026-11-23 (#2060 item 1)';

module.exports = async (ctx) => {
  const { clipboard } = require('electron'); // read in main, after Electron is up (as check-chat-visibility does)
  const H = helpers(ctx);
  const { js, until } = H;
  const { failText, IPC_FAILED } = require(path.join(__dirname, '..', 'dist', 'main', 'ipcerror.js'));
  const token = ['g', 'hp', '_'].join('') + 'Q7wZ2xP9kM4nB8vC1'.repeat(3).slice(0, 36); // invented, built from pieces
  const where = "/srv/projects/q3/<img src=x onerror=window.__xss=1>plan.txt";
  const realWarn = console.warn;
  console.warn = () => undefined; // failText's own main log line (masked) is not this driver's output
  const shown = failText(new Error(`EACCES: permission denied, open '${where}' (${token})`), 'driver');
  const fixed = failText('not an Error', 'driver');
  console.warn = realWarn;
  assert.ok(shown.includes(where) && !shown.includes(token), `main's text keeps the path and masks the token: ${shown}`);
  assert.strictEqual(fixed, IPC_FAILED);
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform];

  const fail = async (error) => {
    await js(`(()=>{document.querySelectorAll('#toasts .toast').forEach(t=>t.remove());const b=window.__durbarSimUi.bridge(),r=${jsLiteral({ ok: false, error })};b.openWith=async()=>r;})()`);
    await js(`document.getElementById('vscodeBtn').click();0`);
    assert.ok(await until(`!!document.querySelector('#openWithMenu [data-ow="folder"]')`, 4000), 'the Open with menu lists the file manager');
    await js(`document.querySelector('#openWithMenu [data-ow="folder"]').click();0`);
    assert.ok(await until(`!!document.querySelector('#toasts .toast.err .toast-act')`, 4000), 'an error toast with its button');
    await js(`document.querySelector('#toasts .toast.err').dispatchEvent(new MouseEvent('mouseenter'));0`); // held while the pointer is on it
    return js(`(()=>{const t=document.querySelector('#toasts .toast.err'),b=t.querySelector('.toast-act');return {text:t.firstElementChild.textContent,els:t.firstElementChild.querySelectorAll('*').length,img:document.querySelectorAll('#toasts img').length,xss:window.__xss===undefined,btn:b.textContent,tag:b.tagName,type:b.type,name:b.getAttribute('aria-label')||b.textContent}})()`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, ready: 'fit', focus: true });
    const o = await H.openSimAgent(`a=>a.id==='sim-1'`, '#vscodeBtn');
    assert.ok(o.ok, `${w}: the chat with Open with is open: ${JSON.stringify(o.seen)}`);

    const t = await fail(shown);
    assert.ok(t.text.includes('/srv/projects/q3/') && t.text.includes('EACCES: permission denied'), `${w}: ${OWNER}: the toast shows the real error and its path: ${t.text}`);
    assert.ok(t.text.includes('<img src=x onerror=window.__xss=1>') && t.els === 0 && t.img === 0 && t.xss, `${w}: the error shows as text: no element or script comes from it: ${JSON.stringify(t)}`);
    assert.ok(!t.text.includes(token) && t.text.includes('[redacted'), `${w}: the token is masked on screen`);
    assert.deepStrictEqual([t.tag, t.type, t.btn, t.name], ['BUTTON', 'button', 'Copy details', 'Copy details'], `${w}: one real button named Copy details`);
    await H.shot(path.join(OUT, `045-error-text-${w}x${h}.png`), { prep: 'mouse', delay: 300, tag: '045', what: `045-error-text-${w}x${h}.png` });
    await js(`document.querySelector('#toasts .toast.err').dispatchEvent(new MouseEvent('mouseenter'));0`);

    await clipboard.writeText('before');
    await js(`document.querySelector('#toasts .toast.err .toast-act').click();0`);
    assert.ok(await until(`(document.querySelector('#toasts .toast.err .toast-act')||{}).textContent==='Copied ✓'`, 4000), `${w}: the button says Copied ✓ (spec 052 FR-049, copiedLabel)`);
    assert.ok(await until(`(document.querySelector('#toasts .toast.err .toast-act')||{}).textContent==='Copy details'`, 4000), `${w}: and then its own label again`);
    const copied = String(await clipboard.readText()).replace(/\r\n/g, '\n'); // Windows writes CRLF
    const [first, second] = copied.split('\n');
    assert.strictEqual(first, t.text.replace(/\s+/g, ' ').trim(), `${w}: the copy is the text as shown: ${JSON.stringify(copied)}`);
    assert.ok(new RegExp(`^Agent Durbar \\S+ on ${os}$`).test(second), `${w}: and one line with the version and the OS: ${JSON.stringify(second)}`);
    assert.ok(!copied.includes(token), `${w}: the copy never holds the token`);

    const f = await fail(fixed);
    assert.ok(f.text.endsWith(IPC_FAILED) && f.btn === 'Copy details', `${w}: an error with no words keeps the fixed text, with the button: ${f.text}`);
  }
  console.log('[045] error text checks passed');
};
