/*
 * Spec 003 FR-117..FR-119 (issue #1300, T046): lookalike letters on a pending permission card. Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-permission-lookalike.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800, with the 15 simulated agents: scenario 1 (a url with a Cyrillic letter: the marker in the summary, the line names the
 * punycode host, the session button names the key), scenario 2 (a lookalike program name: the session tooltip holds the whole marked command, no
 * any-arguments button; a long command: the label says "this exact command" and the tooltip is not cut before the marker), scenario 3 (an MCP tool
 * name: the chip's tooltip and accessible name say it, the why-allowed sentence too), scenario 10 (lookalike.js gone: the could-not-check line), and
 * scenario 11 (the line is legible, whole, inside the card, no page scroll). Every Allow button stays enabled (owner decision 1). Behaviour asserts only.
 * Made-up names (`.invalid` hosts, invented programs and tools); every non-ASCII character is a \u escape. Also in `npm run check:ui` (scripts/ui-suite.js).
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
    // every announcement, in order (a later one may replace the region's text)
    await js(`(()=>{window.__ann=[];if(window.__annObs)window.__annObs.disconnect();window.__annObs=new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(t)window.__ann.push(t);});window.__annObs.observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});})()`);
    const emit = (e) => js(`window.__durbarSimUi.emit(Object.assign({sessionId:${jsLiteral(id)},timestamp:Date.now()},${jsLiteral(e)}))`);
    const ask = (requestId, kind, summary, extra) => emit({ type: 'status', status: 'needs-permission', intent: 'Waiting', permission: Object.assign({ requestId, kind, summary, state: 'pending' }, extra) });
    const card = () => js(`(()=>{const n=[...document.querySelectorAll('#chat .note.perm.pending')].pop();if(!n)return null;n.scrollIntoView({block:'nearest'});const p=n.querySelector('.plook');
      const r=p&&p.getBoundingClientRect(),R=n.getBoundingClientRect(),cs=p&&getComputedStyle(p),acts=n.querySelector('.note-actions'),de=document.documentElement;
      return {sum:(n.querySelector('.psum')||{}).textContent||'',text:p?p.textContent:'',px:p?parseFloat(cs.fontSize):0,whole:!!p&&p.scrollWidth<=p.clientWidth+0.5&&cs.textOverflow!=='ellipsis'&&cs.display!=='none',
        inside:!!p&&r.left>=R.left-0.5&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5,before:!!p&&!!acts&&!!(p.compareDocumentPosition(acts)&Node.DOCUMENT_POSITION_FOLLOWING),
        noScroll:de.scrollWidth<=innerWidth&&de.scrollHeight<=innerHeight,
        buttons:[...n.querySelectorAll('.note-actions button')].map(b=>({t:b.textContent,title:b.title||'',disabled:b.disabled,act:b.dataset.act||''}))}})()`);
    const deny = async () => {
      await js(`[...document.querySelectorAll('#chat .note.perm.pending .note-actions button')].find(b=>b.textContent==='Deny').click()`);
      assert.ok(await until(`!document.querySelector('#chat .note.perm.pending')`, 8000), `${w}: denied`);
    };
    const allEnabled = (c, what) => assert.ok(c.buttons.length >= 3 && c.buttons.every((b) => !b.disabled), `${w}: ${what}: every button stays enabled (warn, not block): ${JSON.stringify(c.buttons)}`);
    const legible = (c, what) => assert.ok(c.px >= 10.5 && c.whole && c.inside && c.before && c.noScroll, `${w}: ${what}: the line is legible, whole, inside the card, before the buttons, no page scroll: ${JSON.stringify(c)}`);

    // the agent is at work when it asks (as a real one is): the turn's own "Working..." announcement comes first and does not replace the card's
    await emit({ type: 'status', status: 'working', intent: 'Working' });
    await until(`window.__ann.length>0`, 3000);
    await js(`window.__ann=[];0`);
    // scenario 1: a url request with a Cyrillic letter in the host
    await ask('look-u-' + w, 'url', 'fetch https://exampl\u0435.invalid/x', { scopeKey: 'url:xn--exampl-8of.invalid', scopeLabel: 'fetch xn--exampl-8of.invalid' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .plook')`, 8000), `${w}: scenario 1: the card has its lookalike line`);
    const c1 = await card();
    assert.ok(c1.sum.includes('exampl\u0435\u27e6U+0435 Cyrillic\u27e7.invalid'), `${w}: scenario 1: the summary marks the letter: ${c1.sum}`);
    assert.ok(c1.text.startsWith('Lookalike letters: "exampl\u0435\u27e6U+0435 Cyrillic\u27e7" has U+0435, a Cyrillic letter, not the Latin one.') && c1.text.includes('host is xn--exampl-8of.invalid:'), `${w}: scenario 1: the line: ${c1.text}`);
    assert.strictEqual((c1.buttons.find((b) => b.act === 'session') || {}).t, 'Allow \u201cfetch xn--exampl-8of.invalid\u201d for this session', `${w}: scenario 1: the session button names the key`);
    allEnabled(c1, 'scenario 1');
    legible(c1, 'scenario 1');
    const said = await until(`window.__ann.some(t=>t.includes(' needs your OK: Lookalike letters: "exampl\\u0435\\u27e6U+0435 Cyrillic\\u27e7"'))`, 3000);
    const ann = await js('window.__ann');
    assert.ok(said, `${w}: scenario 1: the announcement carries the line: ${JSON.stringify(ann)}`);
    assert.ok((await js(`window.__durbarSimUi.requestText([...document.querySelectorAll('#chat .note.perm.pending')].pop().textContent)`)).includes('host is xn--exampl-8of.invalid'), `${w}: scenario 1: the card's text (answer bar, inbox, notifications) carries the line`);
    await H.shot(path.join(OUT, `003-lookalike-url-${w}x${h}.png`), { prep: 'mouse' });
    await deny();
    assert.strictEqual(await js(`[...document.querySelectorAll('#chat .note.perm .plook')].filter(p=>p.offsetParent!==null).length`), 0, `${w}: a settled card shows no lookalike line`);

    // scenario 2: a lookalike program name (Cyrillic palochka): no any-arguments grant, the tooltip holds the whole marked command
    await ask('look-s-' + w, 'shell', 'run durbtoo\u04cf --sync', { scopeKey: 'shell-exact:durbtoo\u04cf --sync', scopeLabel: 'run durbtoo\u04cf --sync' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .plook')`, 8000), `${w}: scenario 2: the line`);
    const c2 = await card();
    const s2 = c2.buttons.find((b) => b.act === 'session') || {};
    assert.ok(s2.title.includes('"run durbtoo\u04cf\u27e6U+04CF Cyrillic\u27e7 --sync"'), `${w}: scenario 2: the tooltip holds the marked command: ${s2.title}`);
    assert.ok(!c2.buttons.some((b) => /any arguments/.test(b.t)), `${w}: scenario 2: no any-arguments button`);
    allEnabled(c2, 'scenario 2');
    legible(c2, 'scenario 2');
    await deny();
    // a long command with the letter after the label's 28-character cut: the button names the exact command, the tooltip keeps the marker
    const long = 'durbtool --first-flag --second-flag --third exampl\u0435';
    await ask('look-l-' + w, 'shell', 'run ' + long, { scopeKey: 'shell-exact:' + long, scopeLabel: 'run ' + long.slice(0, 27) + '\u2026' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .plook')`, 8000), `${w}: long command: the line`);
    const c3 = await card();
    const s3 = c3.buttons.find((b) => b.act === 'session') || {};
    assert.strictEqual(s3.t, 'Allow this exact command for this session', `${w}: long command: the label (not the cut one)`);
    assert.ok(s3.title.includes('exampl\u0435\u27e6U+0435 Cyrillic\u27e7"'), `${w}: long command: the tooltip is not cut before the marker: ${s3.title}`);
    allEnabled(c3, 'long command');
    await deny();

    // scenario 3: an MCP tool name; after Allow for this session, the chip, its tooltip and accessible name, and the why-allowed sentence
    await ask('look-m-' + w, 'mcp', 'mcp srv-demo \u203a re\u0430d_notes', { scopeKey: 'mcp:srv-demo/re\u0430d_notes', scopeLabel: 'srv-demo \u203a re\u0430d_notes' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .plook')`, 8000), `${w}: scenario 3: the line`);
    const c4 = await card();
    assert.ok(c4.text.includes('"re\u0430\u27e6U+0430 Cyrillic\u27e7d" has U+0430'), `${w}: scenario 3: the tool name is named: ${c4.text}`);
    const s4 = c4.buttons.find((b) => b.act === 'session') || {};
    assert.ok(s4.t.startsWith('Allow \u201csrv-demo \u203a re\u0430\u27e6U+0430 Cyrillic\u27e7') && s4.title.includes('"srv-demo \u203a re\u0430\u27e6U+0430 Cyrillic\u27e7d_notes"'), `${w}: scenario 3: the session button and its tooltip (the key, marked): ${JSON.stringify(s4)}`);
    allEnabled(c4, 'scenario 3');
    legible(c4, 'scenario 3');
    await H.shot(path.join(OUT, `003-lookalike-mcp-${w}x${h}.png`), { prep: 'mouse' });
    await deny();
    await emit({ type: 'grants', grants: [{ key: 'mcp:srv-demo/re\u0430d_notes', label: 'srv-demo \u203a re\u0430d_notes' }] });
    assert.ok(await until(`document.querySelectorAll('#grants .gchip').length===1`, 8000), `${w}: scenario 3: the grant chip`);
    const chip = await js(`(()=>{const c=document.querySelector('#grants .gchip');const b=c&&c.querySelector('button[data-revoke]');return {title:c?c.title:'',name:b?b.getAttribute('aria-label'):''};})()`);
    assert.ok(chip.title.endsWith('Revoke to be asked again. Has lookalike letters.'), `${w}: scenario 3: the chip tooltip: ${chip.title}`);
    assert.ok(chip.name.endsWith('. Has lookalike letters.'), `${w}: scenario 3: the chip accessible name: ${chip.name}`);
    // three grants: the list row's tooltip and its revoke button
    await emit({ type: 'grants', grants: [{ key: 'mcp:srv-demo/re\u0430d_notes', label: 'srv-demo \u203a re\u0430d_notes' }, { key: 'shell-exact:npm test', label: 'run npm test' }, { key: 'url:example.invalid', label: 'fetch example.invalid' }] });
    assert.ok(await until(`!!document.getElementById('grantsBtn')`, 8000), `${w}: the grants list button`);
    const rows = await js(`[...document.querySelectorAll('#grantsPop .gp-row')].map(r=>({title:r.title,name:r.querySelector('button[data-revoke]').getAttribute('aria-label')}))`);
    assert.ok(rows.length === 3 && rows.filter((r) => /Has lookalike letters\.$/.test(r.title) && /Has lookalike letters\.$/.test(r.name)).length === 1, `${w}: only the lookalike row says so: ${JSON.stringify(rows)}`);
    assert.ok(rows.some((r) => r.name === 'Revoke permission: run npm test'), `${w}: a clean row's accessible name is unchanged: ${JSON.stringify(rows)}`);
    // the why-allowed sentence of a call this rule allowed
    await emit({ type: 'permission', permission: { requestId: 'look-w-' + w, kind: 'mcp', summary: 'mcp srv-demo \u203a re\u0430d_notes', state: 'approved', via: 'session', allowedBy: { kind: 'session-grant', key: 'mcp:srv-demo/re\u0430d_notes', label: 'srv-demo \u203a re\u0430d_notes' } } });
    await emit({ type: 'toolCall', callId: 'look-w-' + w, tool: 're\u0430d_notes', phase: 'start', args: {} });
    const whySaid = await until(`[...document.querySelectorAll('#chat .chip > .why')].some(p=>/The rule has lookalike letters\\./.test(p.title))`, 8000);
    const whys = await js(`[...document.querySelectorAll('#chat .chip > .why')].map(p=>p.title)`);
    assert.ok(whySaid, `${w}: the why-allowed sentence says the rule has lookalike letters: ${JSON.stringify(whys)}`);
    await emit({ type: 'grants', grants: [] });

    // scenario 10: lookalike.js did not load: the could-not-check line, every button kept (owner decision 4)
    await js(`window.__lookSaved=window.DurbarLookalike;delete window.DurbarLookalike;0`);
    try {
      await ask('look-x-' + w, 'url', 'fetch https://exampl\u0435.invalid/x', { scopeKey: 'url:xn--exampl-8of.invalid', scopeLabel: 'fetch xn--exampl-8of.invalid' });
      assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .plook')`, 8000), `${w}: scenario 10: a line without the module`);
      const c5 = await card();
      assert.strictEqual(c5.text, 'Durbar could not check this request for lookalike letters.', `${w}: scenario 10: the line`);
      assert.ok(c5.sum.includes('exampl\u0435.invalid') && !c5.sum.includes('\u27e6U+0435'), `${w}: scenario 10: the text is still shown: ${c5.sum}`);
      allEnabled(c5, 'scenario 10');
      legible(c5, 'scenario 10');
      await H.shot(path.join(OUT, `003-lookalike-unchecked-${w}x${h}.png`), { prep: 'mouse' });
      await deny();
    } finally {
      await js(`window.DurbarLookalike=window.__lookSaved;0`);
    }
    // a clean card has no lookalike line
    await ask('look-c-' + w, 'shell', 'run npm test', { scopeKey: 'shell-exact:npm test', scopeLabel: 'run npm test' });
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.pending .note-actions')`, 8000), `${w}: the clean card`);
    const c6 = await card();
    assert.strictEqual(c6.text, '', `${w}: a clean card has no lookalike line`);
    assert.strictEqual((c6.buttons.find((b) => b.act === 'session') || {}).t, 'Allow \u201crun npm test\u201d for this session', `${w}: a clean session button is as before`);
    await deny();
  }
};
