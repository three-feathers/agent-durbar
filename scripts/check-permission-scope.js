/*
 * Spec 003 FR-108 (FR-013): a pending approval card says, in plain text next to its buttons, how far "for this session" reaches: a write grant
 * covers every file in the folder; "any arguments" covers every simple command of that name (git also git push). The exact-command card has no
 * such line. Text at least 10.5px, whole (not cut), inside the card. Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-permission-scope.js xvfb-run -a npx electron . --no-sandbox
 *
 * Also in `npm run check:ui` (scripts/ui-suite.js). Mutation check: dropping the `pscope` paragraph from showPerm fails it.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, focus: true });
    const ro = await H.openSimAgent(`a=>!a.parent&&a.info&&a.live&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(ro.ok, `${w}: opened an idle agent's chat ${jsLiteral(ro.seen)}`);
    const id = ro.id;
    const ask = (requestId, kind, summary, extra) => js(`window.__durbarSimUi.emit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'needs-permission',intent:'Waiting',permission:Object.assign({requestId:${jsLiteral(requestId)},kind:${jsLiteral(kind)},summary:${jsLiteral(summary)},state:'pending'},${JSON.stringify(extra)})})`);
    const card = (rid) => js(`(()=>{const n=[...document.querySelectorAll('#chat .note.perm.pending')].pop();if(!n)return null;const p=n.querySelector('.pscope');n.scrollIntoView({block:'nearest'});
      const r=p&&p.getBoundingClientRect(),R=n.getBoundingClientRect(),cs=p&&getComputedStyle(p);
      return {text:p?p.textContent:'',px:p?parseFloat(cs.fontSize):0,whole:!!p&&p.scrollWidth<=p.clientWidth+0.5&&cs.textOverflow!=='ellipsis',inside:!!p&&r.left>=R.left-0.5&&r.right<=R.right+0.5,
        before:!!p&&!!n.querySelector('.note-actions')&&!!(p.compareDocumentPosition(n.querySelector('.note-actions'))&Node.DOCUMENT_POSITION_FOLLOWING),buttons:[...n.querySelectorAll('.note-actions button')].map(b=>b.textContent)}})()`);
    // a write: every file in the folder
    await ask('scope-w-' + w, 'write', 'write src/app.ts', { scopeKey: 'write:/work/src', scopeLabel: 'write in src/' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .pscope')`, 8000), `${w}: the write card has its scope line`);
    const a = await card();
    assert.strictEqual(a.text, 'Allow for this session covers every file in src/, not only this one.', `${w}: write line: ${a.text}`);
    assert.ok(a.px >= 10.5 && a.whole && a.inside && a.before, `${w}: write line is legible, whole, inside, before the buttons: ${JSON.stringify(a)}`);
    await H.shot(path.join(OUT, `003-scope-write-${w}x${h}.png`), { prep: 'mouse' });
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
    assert.ok(await until(`!document.querySelector('#chat .note.perm.pending')`, 8000), `${w}: denied`);
    assert.strictEqual(await js(`[...document.querySelectorAll('#chat .note.perm .pscope')].filter(p=>p.offsetParent!==null).length`), 0, `${w}: a settled card shows no scope line`);
    // any arguments: git also covers git push
    await ask('scope-g-' + w, 'shell', 'Run git status', { scopeKey: 'shell-exact:git status', scopeLabel: 'run git status', broadScopeKey: 'shell:git', broadScopeLabel: 'run git (any arguments)' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .pscope')`, 8000), `${w}: the git card has its scope line`);
    const b = await card();
    assert.strictEqual(b.text, 'Any arguments allows every simple “git” command, not only this one, also “git push”.', `${w}: git line: ${b.text}`);
    assert.ok(b.px >= 10.5 && b.whole && b.inside && b.before, `${w}: git line is legible: ${JSON.stringify(b)}`);
    assert.ok(b.buttons.some((t) => /any arguments/.test(t)), `${w}: the broad button is there: ${b.buttons}`);
    await H.shot(path.join(OUT, `003-scope-git-${w}x${h}.png`), { prep: 'mouse' });
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
    assert.ok(await until(`!document.querySelector('#chat .note.perm.pending')`, 8000), `${w}: denied`);
    // an exact-command card (no broad grant offered): no line
    await ask('scope-x-' + w, 'shell', 'Run python x.py', { scopeKey: 'shell-exact:python x.py', scopeLabel: 'run python x.py' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .note-actions')`, 8000), `${w}: the exact card`);
    assert.strictEqual((await card()).text, '', `${w}: an exact-command card has no scope line`);
    await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
  }
};
