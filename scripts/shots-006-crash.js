/*
 * Spec 006 FR-038..FR-046 (issue #606): sessions interrupted by a crash are offered back. Simulator only (no AI credits, no login). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-006-crash.js xvfb-run -a npx electron . --no-sandbox
 *
 * At 1440x900 and 1280x800, with waits (until) and no fixed sleeps; exits non-zero on a miss:
 *   no simcrash   there is no card (a clean start, or a crash while everything was idle)
 *   simcrash=3    one card: "3 sessions were interrupted", Resume all / Pick… / Dismiss, the text says the reply is lost and nothing is sent again;
 *                 text >= 10.5px, inside the window, no page overflow, the office keeps its 15 desks
 *   Pick…         a list with one Resume per session (aria-expanded, focus moves into it); Resume on one row resumes only that session
 *   Resume all    resumes the rest one after another, the card goes, each chat says its last reply is lost and that nothing was sent again
 *   Dismiss       the card goes and nothing is resumed (the sessions stay "not started"); no note in their chats
 * Screenshots: 006-crash-{card,pick}-<w>x<h>.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';
const NOTE = 'reply it was writing is lost';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until, click } = H;
  const shot = (name, w, h) => H.shot(path.join(OUT, `006-crash-${name}-${w}x${h}.png`), { prep: 'calm', tag: '006', what: `${name} ${w}x${h}` });
  const strip = () => js(`(()=>{const s=document.getElementById('crashStrip');if(!s)return null;const r=s.getBoundingClientRect();
    return {hidden:s.hidden,text:((s.querySelector('.ns-t')||s).innerText).replace(/\\s+/g,' ').trim(),buttons:[...s.querySelectorAll('.ns-act button')].map(b=>b.textContent.trim()),
      rows:[...s.querySelectorAll('[data-crrow]')].map(b=>b.dataset.crrow),expanded:(s.querySelector('[data-cr="pick"]')||{getAttribute(){return null}}).getAttribute('aria-expanded'),
      font:Math.min(...[...s.querySelectorAll('.ns-t,button,small')].map(e=>parseFloat(getComputedStyle(e).fontSize))),
      inside:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,h:Math.round(r.height),
      focusRow:!!(document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.crrow),
      overflow:document.documentElement.scrollWidth>innerWidth,desks:document.querySelectorAll('#stage .desk[data-id]').length}})()`);
  const noteIn = async (id) => {
    await click(`#stage .desk[data-id=${jsLiteral(id)}]`);
    await until(`document.body.classList.contains('panel-open')`, 8000);
    return until(`(()=>{const c=document.getElementById('chat');return !!c&&[...c.querySelectorAll('.note')].some(n=>n.textContent.includes(${jsLiteral(NOTE)}))})()`, 6000);
  };
  const noNoteIn = async (id) => {
    await click(`#stage .desk[data-id=${jsLiteral(id)}]`);
    await until(`document.body.classList.contains('panel-open')`, 8000);
    // the chat of a restored session wakes by itself when it is opened (spec 006 FR-021); wait for that, then there must be no crash note
    await until(`(()=>{const c=document.getElementById('chat');return !!c&&c.querySelector('.note')})()`, 6000);
    return js(`[...document.querySelectorAll('#chat .note')].every(n=>!n.textContent.includes(${jsLiteral(NOTE)}))`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // ---- a clean start: no card
    await H.load({ w, h, focus: true });
    await H.calm();
    let s = await strip();
    assert.ok(s && s.hidden, `${w}: no card without a crash`);
    assert.strictEqual(s.text, '', `${w}: and nothing in it`);

    // ---- a crash with three sessions mid-turn
    await H.load({ w, h, query: { simcrash: '3' }, focus: true });
    await H.calm();
    assert.ok(await until(`(()=>{const s=document.getElementById('crashStrip');return !!s&&!s.hidden&&s.querySelector('[data-cr="all"]')})()`, 10000), `${w}: the card shows`);
    s = await strip();
    assert.ok(/^3 sessions were interrupted when Durbar stopped unexpectedly\./.test(s.text), `${w}: headline: ${s.text}`);
    assert.ok(/nothing is sent again/.test(s.text) && /is lost/.test(s.text), `${w}: says the reply is lost and nothing is re-sent`);
    assert.deepStrictEqual(s.buttons, ['Resume all', 'Pick…', 'Dismiss'], `${w}: the three choices`);
    assert.ok(s.font >= 10.5, `${w}: text ${s.font}px`);
    assert.ok(s.inside && !s.overflow, `${w}: the card is inside the window, no page overflow`);
    assert.ok(s.desks >= 15, `${w}: the office keeps its desks (${s.desks})`);
    assert.strictEqual(s.expanded, 'false', `${w}: the list is closed at first`);
    await shot('card', w, h);

    // ---- Pick…: a list with one Resume per session
    await click('#crashStrip [data-cr="pick"]');
    assert.ok(await until(`document.querySelectorAll('#crashStrip [data-crrow]').length===3`, 6000), `${w}: three rows`);
    s = await strip();
    assert.strictEqual(s.expanded, 'true', `${w}: aria-expanded`);
    assert.ok(s.focusRow, `${w}: focus moves into the list`);
    assert.deepStrictEqual(s.rows, ['sim-1', 'sim-2', 'sim-3'], `${w}: the interrupted sessions, in order`);
    assert.ok(s.inside && !s.overflow && s.font >= 10.5, `${w}: the open list fits (${s.h}px tall)`);
    await shot('pick', w, h);

    // ---- one row: only that session resumes
    await click('#crashStrip [data-crrow="sim-2"]');
    assert.ok(await until(`document.querySelectorAll('#crashStrip [data-crrow]').length===2`, 8000), `${w}: the resumed row leaves the list`);
    s = await strip();
    assert.deepStrictEqual(s.rows, ['sim-1', 'sim-3'], `${w}: the other two are still waiting`);
    assert.ok(/^2 sessions were interrupted/.test(s.text), `${w}: the count follows: ${s.text}`);

    // ---- Resume all: the rest, the card goes, each chat tells the truth
    await click('#crashStrip [data-cr="all"]');
    assert.ok(await until(`document.getElementById('crashStrip').hidden`, 10000), `${w}: the card goes when nothing is left`);
    assert.ok(await noteIn('sim-1'), `${w}: sim-1's chat says its last reply is lost`);
    const sent = await js(`[...document.querySelectorAll('#chat .msg.user')].map(m=>m.textContent).filter(t=>/^\\s*continue/i.test(t)).length`);
    assert.strictEqual(sent, 0, `${w}: nothing was sent on the user's behalf`);
    assert.ok(await js(`/Nothing was sent again/.test(document.getElementById('chat').innerText)`), `${w}: the note says nothing was sent again`);
    assert.ok(await noteIn('sim-2'), `${w}: sim-2 (resumed from the list)`);
    assert.ok(await noteIn('sim-3'), `${w}: sim-3`);

    // ---- Dismiss: nothing is resumed
    await H.load({ w, h, query: { simcrash: '2' }, focus: true });
    await H.calm();
    assert.ok(await until(`(()=>{const s=document.getElementById('crashStrip');return !!s&&!s.hidden})()`, 10000), `${w}: the card shows again for two`);
    s = await strip();
    assert.ok(/^2 sessions were interrupted/.test(s.text), `${w}: two: ${s.text}`);
    await click('#crashStrip [data-cr="close"]');
    assert.ok(await until(`document.getElementById('crashStrip').hidden`, 6000), `${w}: Dismiss closes the card`);
    assert.ok(await noNoteIn('sim-1'), `${w}: a dismissed session was not resumed by the card (no crash note)`);
  }
  console.log('shots-006-crash: PASS');
};
