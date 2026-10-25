/*
 * Spec 003 FR-099..FR-105 (issue #605): the "Why was this allowed?" tag on tool cards, with undo of Durbar's own session rule.
 * Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-why-allowed.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800: an Ask first agent edits (asks), "Allow ... for this session", edits again (no tag on the first card: the
 * user answered; the session rule tag on the second); the open card names the rule and offers "Undo this rule"; Undo removes the
 * grant chip, the tag turns into "Rule removed", focus stays on the card, and the next edit asks again. An Allow all agent's edit
 * says so and offers no undo. Hostile input: an event with a markup label shows text only; a rule key the broker never held changes
 * nothing; a malformed reason shows no tag. Also in `npm run check:ui` (scripts/ui-suite.js).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const send = (text) => js(`(()=>{const i=document.getElementById('msgInput');i.value=${jsLiteral(text)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  // the simulator also draws a read card per turn: the edit cards are the ones this check is about
  const defs = () => js(`window.__wa={edits:()=>[...document.querySelectorAll('#chat .chip')].filter(c=>!c.classList.contains('att-chip')&&/edit/i.test((c.querySelector('b')||c).textContent)),last:()=>{const l=window.__wa.edits();return l[l.length-1]}};0`);
  const chips = () => js(`window.__wa.edits().map(c=>({name:(c.querySelector('b')||c).textContent,why:(c.querySelector(':scope>.why')||{}).textContent||''}))`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, focus: true });
    await defs();
    // the simulator's idle agents are Read-only: two of them are switched (the way the mode menu does) so each starts a quiet chat
    const ids = await js(`window.__durbarSimUi.agents().filter(a=>!a.parent&&a.info&&a.info.permMode==='read-only'&&a.live&&(a.state==='idle'||a.state==='done')).map(a=>a.id)`);
    assert.ok(ids.length >= 2, `${w}: two idle agents: ${JSON.stringify(ids)}`);
    const setMode = (aid, mode) => js(`window.__durbarSimUi.bridge().setPermMode(${jsLiteral(aid)},${jsLiteral(mode)},{})`);
    await setMode(ids[0], 'ask');
    await setMode(ids[1], 'allow');
    const ask = await H.openSimAgent(`a=>a.id===${jsLiteral(ids[0])}`, '#msgInput');
    assert.ok(ask.ok, `${w}: opened an Ask first agent ${JSON.stringify(ask.seen)}`);
    const id = ask.id;

    // 1) the first edit asks; the user chooses "for this session": the card has no tag (Durbar asked)
    await send('Please edit the file.');
    assert.ok(await until(`!!document.querySelector('#chat .note.perm .note-actions .btn')`, 15000), `${w}: the edit asks`);
    await js(`[...document.querySelectorAll('#chat .note.perm .note-actions .btn')].find(b=>/for this session/.test(b.textContent)).click()`);
    assert.ok(await until(`document.querySelectorAll('#grants .gchip').length===1&&!!document.querySelector('#chat .chip')`, 15000), `${w}: the rule shows as a chip`);
    assert.ok(await until(`document.getElementById('sendBtn')&&!document.getElementById('sendBtn').disabled`, 15000), `${w}: the first turn ended`);
    assert.deepStrictEqual((await chips()).map((c) => c.why), [''], `${w}: a call the user approved has no tag: ${JSON.stringify(await chips())}`);

    // 2) the second edit runs under the rule: tag on its card
    await send('Please edit it again.');
    const okTag = await until(`window.__wa.edits().length>=2&&!!window.__wa.last().querySelector('.why')`, 15000);
    assert.ok(okTag, `${w}: the second card is tagged ` + JSON.stringify(await js(`(()=>{const a=window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)});return {why:[...(a.why||new Map()).entries()],chips:window.__wa.edits().map(c=>c.id+'|'+c.className+'|'+c.textContent.slice(0,60)),keys:Object.keys(a.turn?a.turn.T.chipEls:{}),grants:(a.grants||[]).length}})()`)));
    const t = await js(`(()=>{const c=window.__wa.last(),p=c.querySelector(':scope>.why'),r=p.getBoundingClientRect(),R=document.getElementById('chat').getBoundingClientRect();
      return {text:p.textContent,kind:p.dataset.why,font:parseFloat(getComputedStyle(p).fontSize),inside:r.right<=R.right+0.5&&r.left>=R.left-0.5,undoVisible:!!c.querySelector('.why-undo')&&c.querySelector('.why-undo').offsetParent!==null}})()`);
    assert.strictEqual(t.text, 'Allowed: session rule', `${w}: the tag words`);
    assert.strictEqual(t.kind, 'session-grant');
    assert.ok(t.font >= 10.5, `${w}: legible (${t.font}px)`);
    assert.ok(t.inside, `${w}: the tag stays inside the chat`);
    assert.strictEqual(t.undoVisible, false, `${w}: the undo is in the open card, not the row`);
    assert.strictEqual(await js(`window.__wa.last().querySelectorAll('.why').length`), 1, `${w}: one tag per card`);

    // 3) open card: the sentence, the rule's label, the Undo button (a real button, named)
    assert.ok(await until(`document.getElementById('sendBtn')&&!document.getElementById('sendBtn').disabled`, 15000), `${w}: the second turn ended`);
    await js(`window.__wa.last().click()`);
    assert.ok(await until(`window.__wa.last().classList.contains('open')&&window.__wa.last().querySelector('.why-undo').offsetParent!==null`, 5000), `${w}: the open card shows Undo`);
    const o = await js(`(()=>{const c=window.__wa.last(),b=c.querySelector('.why-undo'),r=b.getBoundingClientRect(),R=c.getBoundingClientRect();
      return {sentence:c.querySelector('.why-t').textContent,label:c.querySelector('.why-l').textContent,btn:b.tagName,name:b.getAttribute('aria-label'),font:parseFloat(getComputedStyle(b).fontSize),h:r.height,inside:r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5}})()`);
    assert.ok(/Approve for this session/.test(o.sentence), `${w}: the sentence names the choice: ${o.sentence}`);
    assert.ok(/^write in /.test(o.label), `${w}: the rule's own label: ${o.label}`);
    assert.strictEqual(o.btn, 'BUTTON');
    assert.ok(/^Undo this rule: write in /.test(o.name), `${w}: the button's accessible name: ${o.name}`);
    assert.ok(o.font >= 10.5 && o.h >= 24 && o.inside, `${w}: the button is legible and inside the card: ${JSON.stringify(o)}`);
    await H.shot(path.join(OUT, `003-why-allowed-${w}x${h}.png`), { prep: 'calm', delay: 150 });

    // 4) Undo: the same revoke as the grant chip's x: the chip goes, the tag says so, the focus stays on the card
    await js(`window.__wa.last().querySelector('.why-undo').click()`);
    assert.ok(await until(`document.querySelectorAll('#grants .gchip').length===0`, 8000), `${w}: the grant chip is gone (the existing revoke ran)`);
    assert.ok(await until(`(window.__wa.last().querySelector(':scope>.why')||{}).textContent==='Rule removed'&&!window.__wa.last().querySelector('.why-undo')`, 8000), `${w}: the tag says the rule is removed and offers no second undo`);
    assert.ok(await until(`document.activeElement===window.__wa.last()`, 3000), `${w}: focus stays on the card`);
    const both = await chips();
    assert.deepStrictEqual(both.map((c) => c.why), ['', 'Rule removed'], `${w}: the first card is untouched, the second says the rule is gone: ${JSON.stringify(both)}`);
    // the next edit asks again
    await send('Please edit once more.');
    assert.ok(await until(`!!document.querySelector('#chat .note.perm:not(.settled) .note-actions .btn')`, 15000), `${w}: with the rule gone the next edit asks`);
    await js(`document.querySelector('#chat .note.perm:not(.settled) .note-actions .btn').click()`); // Allow once
    assert.ok(await until(`document.getElementById('sendBtn')&&!document.getElementById('sendBtn').disabled`, 15000), `${w}: that turn ended`);

    // 5) hostile input: markup label, a key the broker never held, a malformed reason
    const ev = (extra) => js(`window.__durbarSimUi.emit(Object.assign({type:'permission',sessionId:${jsLiteral(id)},timestamp:Date.now()},${jsLiteral(extra)}))`);
    const call = (cid) => js(`window.__durbarSimUi.emit({type:'toolCall',sessionId:${jsLiteral(id)},timestamp:Date.now(),callId:${jsLiteral(cid)},tool:'bash',phase:'start',args:{command:'echo hi'}})`);
    const evil = '<img src=x onerror="window.__pwn=1">';
    await ev({ type: 'grants', grants: [{ key: 'ghost:key', kind: 'write', label: evil }] }); // a rule the simulator's broker never held
    await ev({ permission: { requestId: 'hx1', kind: 'shell', summary: 'run echo', state: 'approved', via: 'session', allowedBy: { kind: 'session-grant', key: 'ghost:key', label: evil } } });
    await call('hx1');
    await ev({ permission: { requestId: 'hx2', kind: 'shell', summary: 'run echo', state: 'approved', via: 'session', allowedBy: { kind: 'root', key: 'k', label: 'l' } } });
    await call('hx2');
    await ev({ permission: { requestId: 'hx3', kind: 'shell', summary: 'run echo', state: 'approved', via: 'session', allowedBy: { kind: 'app', source: '__proto__' } } });
    await call('hx3');
    assert.ok(await until(`document.querySelectorAll('#chat .chip .why').length>=1`, 5000), `${w}: the hostile-label card is tagged`);
    const hs = await js(`(()=>{const l=[...document.querySelectorAll('#chat .chip')].filter(c=>!c.classList.contains('att-chip')).slice(-3);return l.map(c=>({why:(c.querySelector(':scope>.why')||{}).textContent||'',imgs:c.querySelectorAll('img').length}))})()`);
    assert.strictEqual(hs[0].why, "Allowed: session rule", `${w}: shown as text ${JSON.stringify(hs)}`);
    assert.deepStrictEqual(hs.map((x) => x.imgs), [0, 0, 0], `${w}: no markup became an element`);
    assert.strictEqual(hs[1].why, '', `${w}: an unknown reason kind shows no tag`);
    assert.strictEqual(hs[2].why, '', `${w}: an unknown app source shows no tag`);
    assert.strictEqual(await js(`window.__pwn===undefined`), true, `${w}: the label ran nothing`);
    // its Undo asks main to revoke a key nobody holds: nothing changes, nothing breaks
    await js(`(()=>{const c=[...document.querySelectorAll('#chat .chip')].filter(c=>!c.classList.contains('att-chip')).slice(-3)[0];if(!c.classList.contains('open'))c.click();})()`);
    assert.ok(await until(`!!document.querySelector('#chat .chip.open .why-undo')`, 5000), `${w}: the hostile card offers Undo`);
    await js(`document.querySelector('#chat .chip.open .why-undo').click()`);
    await H.settle?.();
    assert.ok(await until(`!!document.querySelector('#chat .chip.open .why-undo:not(:disabled)')||document.querySelector('#chat .chip.open .why-undo')===null`, 5000));
    const after = await js(`({chips:document.querySelectorAll('#grants .gchip').length,imgs:document.querySelectorAll('#grants img,#chat img').length,pwn:window.__pwn===undefined})`);
    assert.deepStrictEqual(after, { chips: 1, imgs: 0, pwn: true }, `${w}: revoking a key the broker never held removed nothing and ran nothing`);
    await ev({ type: 'grants', grants: [] });

    // 6) Allow all: the mode is the reason; no rule, no undo button; Allow all itself is unchanged
    const all = await H.openSimAgent(`a=>a.id===${jsLiteral(ids[1])}`, '#msgInput');
    assert.ok(all.ok, `${w}: opened an Allow all agent ${JSON.stringify(all.seen)}`);
    await send('Please edit the file.');
    assert.ok(await until(`!!document.querySelector('#chat .chip .why[data-why="allow-all"]')`, 15000), `${w}: an Allow all edit says why`);
    assert.strictEqual(await js(`document.querySelector('#chat .chip .why[data-why="allow-all"]').textContent`), 'Allowed: Allow all');
    assert.ok(await until(`document.getElementById('sendBtn')&&!document.getElementById('sendBtn').disabled`, 15000), `${w}: turn ended`);
    await js(`(()=>{const c=document.querySelector('#chat .chip .why[data-why="allow-all"]').closest('.chip');if(!c.classList.contains('open'))c.click();})()`);
    assert.ok(await until(`!!document.querySelector('#chat .chip.open .why-t')`, 5000), `${w}: the open card explains`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .chip .why-undo').length`), 0, `${w}: no rule to undo under Allow all`);
    assert.ok(/Change the mode in the chat header/.test(await js(`document.querySelector('#chat .chip.open .why-t').textContent`)), `${w}: says where to change it`);
    await H.shot(path.join(OUT, `003-why-allowed-allowall-${w}x${h}.png`), { prep: 'calm', delay: 150 });

    // 7) Read-only agent: refused, nothing is tagged
    await setMode(ids[1], 'read-only');
    assert.ok(await until(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(ids[1])})||{}).info||{}).permMode==='read-only'||true`, 3000));
    const tagged = await js(`document.querySelectorAll('#chat .why').length`);
    const notes = await js(`document.querySelectorAll('#chat .note.perm').length`);
    await send('Please edit the file.');
    assert.ok(await until(`document.querySelectorAll('#chat .note.perm').length>${jsLiteral(notes)}`, 15000), `${w}: the edit is refused`);
    assert.ok(await until(`document.getElementById('sendBtn')&&!document.getElementById('sendBtn').disabled`, 15000), `${w}: that turn ended`);
    assert.strictEqual(await js(`document.querySelectorAll('#chat .why').length`), tagged, `${w}: a refused call carries no reason`);
  }
};
