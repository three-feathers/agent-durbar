/*
 * Spec 005 FR-438 (issue #2060 item 3, part A; T540): a tool chip says how many characters of its masked argument its line leaves out, and an
 * argument over the masks' limit (12,288 characters: main sends it empty) is named by its length instead of a blank chip. Simulator only (no
 * AI credits, no agent app; the simulator applies main's rule to the events it emits). Needs the window's focus (the keyboard steps).
 *
 *   npm run check:ui -- --only check-005-long-args
 *
 * At 1440x900 and 1280x800, 15 agents (frozen clock), the first live agent's chat open, tool calls sent through `__durbarSimEmit`:
 *   - a signed-token-shaped value (invented, built from pieces; the masks hide it only whole) that straddles the line's 400th character: the line and the tooltip hold no piece
 *     of it (the cut is taken after the mask, CUT-AFTER-MASK); the line says "N more characters" (NOTE) with N the characters of the masked
 *     one-line text past 400 (N-COUNT); Enter on the focused chip opens it in place, aria-expanded true, the focus stays on the chip and the
 *     open command box shows the rest (CLICK-REVEALS), masked whole (REST-MASKED); Space closes it again;
 *   - harmless commands of 300, 399, 400, 401, 402, 1,000, 12,287, 12,288, 12,289, 13,000, 20,000 and 30,000 characters (words, and one long
 *     word): no note up to 400; "N more characters" from 401 to 12,288 (N = length - 400, "1 more character" at 401) and the open box holds
 *     the whole argument; over 12,288 the line shows none of it, says "Arguments too long to show (N characters)", the tooltip says the same,
 *     there is no open command, and the chip's HTML holds no piece of it (LONG); an update that brings an over-limit argument replaces the
 *     start's label by the note (LONG-UPDATE);
 *   - layout: the note's text is at least 10.5px, inside its chip, clear of the status word, kept whole, and the status word whole too; a chip with a note is as high as one
 *     without; the chat does not scroll sideways.
 *   - review of PR 2119: bad argsLong values (NaN, infinities, fractions, strings, objects, at or under 12,288, past MAX_SAFE_INTEGER) sent to
 *     the chip's own chipArgs and makeChip give no note (LONG-VALID); an argument main's mask makes longer than the window's cap gives a note
 *     whose counts add up to the masked length and a plain count at the end of the open box (CUT-COUNT).
 * Screenshots (OUT or the temp folder): 005-long-args-<w>x<h>.png (closed chips) and 005-long-args-open-<w>x<h>.png (the straddling chip open).
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

process.exitCode = 1;
const SIZES = [[1440, 900], [1280, 800]];
const j = (...p) => p.join('');
/* invented, a signed-token shape the masks hide only whole: a head of it alone is not hidden, so a cut before the mask would show it */
const TOK = j('eyJhbGci', 'OiJIUzI1NiJ9', '.', 'eyJzdWIiOiIx', 'MjM0NTY3ODkwIn0', '.', 'Qx7Mw2Rt9Lp4', 'Vz8Nc3HkZr4Kq8Wm2');
const PIECES = [TOK, TOK.slice(0, 8), TOK.slice(21, 35), TOK.slice(-12)].map((x) => x.toLowerCase());
const words = (n) => { let s = 'echo'; while (s.length < n) s += ' word' + (s.length % 97); return s.slice(0, n); };
const blob = (n) => 'echo ' + 'a'.repeat(n - 5);
const fmt = (n) => n.toLocaleString('en-US');
const moreText = (n) => `${fmt(n)} more character${n === 1 ? '' : 's'}`;
const longText = (n) => `Arguments too long to show (${fmt(n)} characters)`;

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign(${jsLiteral(e)},{timestamp:Date.now()}))`);
  let ID = '';
  /* one chip as the page shows it: the line, the note, the tooltip, the open command, its state, the HTML */
  const read = (callId) => js(`(()=>{const c=window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(callId)});if(!c)return null;
    const q=s=>c.querySelector(s),pre=q('pre.cmd'),note=q('.argmore');
    return {code:(q('code')||{}).textContent||'',note:note?note.textContent:'',noteShown:!!note&&note.getBoundingClientRect().width>0,title:c.title,
      pre:pre?pre.textContent:null,preShown:!!pre&&pre.getBoundingClientRect().height>0,exp:c.getAttribute('aria-expanded'),focused:document.activeElement===c,html:c.outerHTML.toLowerCase()};})()`);
  const leak = (t) => PIECES.find((p) => String(t).toLowerCase().includes(p));
  const start = async (callId, args) => {
    await emit({ type: 'toolCall', sessionId: ID, callId, tool: 'bash', phase: 'start', args });
    assert.ok(await until(`!!window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(callId)})`, 5000), `chip ${callId} is in the chat`);
    return read(callId);
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, ready: 'fit', focus: true });
    await H.needFocus(tag);
    ID = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.live);return a?a.id:''})()`);
    assert.ok(ID, `${tag}: a live agent`);
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(ID)})`);
    assert.ok(await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('chat')`, 10000), `${tag}: the chat is open`);

    // ---- a token across the line's 400th character
    {
      const raw = j('echo ', 'ab '.repeat(129), TOK, ' done ', 'cd '.repeat(100)); // TOK starts at 392
      assert.strictEqual(raw.indexOf(TOK), 392, 'the token straddles the 400 cut');
      const cid = `${tag}-straddle`;
      const v = await start(cid, { command: raw });
      let x = leak(v.code) || leak(v.title);
      assert.ok(!x, `CUT-AFTER-MASK ${tag}: the line or its tooltip shows a piece of the token ("${x}"): ${v.code.slice(380)}`);
      assert.ok(/more characters?$/.test(v.note) && v.noteShown, `NOTE ${tag}: the line says how many more characters there are: ${JSON.stringify(v.note)}`);
      assert.ok(v.title.includes(` \u2026 (${v.note})`), `NOTE ${tag}: the tooltip says the note after the line: ${v.title.slice(-60)}`);
      await js(`window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cid)}).focus()`);
      await H.key('Return');
      await until(`window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cid)}).getAttribute('aria-expanded')==='true'`, 2000);
      const o = await read(cid);
      assert.ok(o.exp === 'true' && o.focused && o.preShown && o.pre.length > o.code.length, `CLICK-REVEALS ${tag}: Enter opens the chip in place, the focus stays on it and the rest is shown: ${JSON.stringify({ exp: o.exp, focused: o.focused, shown: o.preShown })}`);
      x = leak(o.pre) || leak(o.html);
      assert.ok(!x && /\[redacted\]/.test(o.pre), `REST-MASKED ${tag}: the rest the click shows is masked whole ("${x}")`);
      assert.strictEqual(v.note, moreText(o.pre.length - 400), `N-COUNT ${tag}: N is the masked one-line text past the line's 400`);
      assert.ok(!o.noteShown, `${tag}: the note is hidden while the rest is on screen`);
      await js(`window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cid)}).scrollIntoView({block:'nearest'})`);
      await H.shot(path.join(OUT, `005-long-args-open-${tag}.png`), { prep: 'mouse', tag: 'long-args' });
      await H.key('Space');
      await until(`window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cid)}).getAttribute('aria-expanded')==='false'`, 2000);
      const c = await read(cid);
      assert.ok(c.exp === 'false' && c.focused && !c.preShown && c.noteShown, `${tag}: Space closes it, the focus stays, the note is back`);
    }

    // ---- the lengths around 400 and 12,288
    for (const n of [300, 399, 400, 401, 402, 1000, 12287, 12288, 12289, 13000, 20000, 30000]) {
      for (const [kind, make] of [['words', words], ['blob', blob]]) {
        const raw = make(n);
        const v = await start(`${tag}-${kind}-${n}`, { command: raw });
        const what = `${tag} ${kind} ${n}`;
        if (n <= 400) {
          assert.ok(v.note === '' && v.code === raw && v.pre === raw, `NOTE ${what}: no note, the line shows it all: ${JSON.stringify(v.note)}`);
        } else if (n <= 12288) {
          assert.strictEqual(v.code, raw.slice(0, 400), `${what}: the line holds the first 400 characters`);
          assert.strictEqual(v.note, moreText(n - 400), `N-COUNT ${what}: the line says how many more characters there are`);
          assert.strictEqual(v.pre, raw, `${what}: the open command holds the whole argument`);
        } else {
          assert.ok(v.code === '' && v.pre === null && !v.html.includes(raw.slice(0, 40).toLowerCase()) && !v.html.includes('aaaaaaaaaaaaaaaaaaaa') && !v.html.includes('word10 word17'), `LONG ${what}: none of an over-limit argument is shown`);
          assert.strictEqual(v.note, longText(n), `LONG ${what}: the line names its length`);
          assert.ok(v.title.includes(`: ${longText(n)}`), `LONG ${what}: the tooltip names its length: ${v.title}`);
        }
      }
    }
    {
      const cid = `${tag}-upd`;
      const v0 = await start(cid, { command: 'echo start' });
      assert.strictEqual(v0.code, 'echo start');
      await emit({ type: 'toolCall', sessionId: ID, callId: cid, tool: 'bash', phase: 'update', args: { command: words(20000) } });
      assert.ok(await until(`(window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cid)}).querySelector('.argmore')||{}).textContent===${jsLiteral(longText(20000))}`, 3000), `LONG-UPDATE ${tag}: an update with an over-limit argument names its length`);
      const v = await read(cid);
      assert.ok(v.code === '' && v.pre === null, `LONG-UPDATE ${tag}: the start's label is gone`);
    }

    // ---- review of PR 2119, finding 1: the window trusts argsLong only as a finite integer over MASK_INPUT_MAX (LONG-VALID); the simulator's own
    // event path strips the field, so the values go straight to the chip's own chipArgs and makeChip through the simulator-only hook
    {
      const r = await js(`(()=>{const f=window.__durbarSimUi.chipNoteOf;const bad=[NaN,Infinity,-Infinity,-1,0,1.5,12288.5,'20000',null,undefined,1e21,1e300,300,12288,Number.MAX_SAFE_INTEGER+1,2**53,{valueOf(){return 20000;}},[20000],true];
        return {bad:bad.map((v,i)=>{const o=f({tool:'bash',args:{command:''},argsLong:v});return {i,long:String(o.long),note:String(o.note),title:String(o.title)};}),good:f({tool:'bash',args:{command:''},argsLong:12289})};})()`);
      for (const b of r.bad) assert.ok(b.long === '0' && b.note === '' && !/characters\)/.test(b.title), `LONG-VALID ${tag}: bad argsLong value #${b.i} is ignored (no note): ${JSON.stringify(b)}`);
      assert.strictEqual(r.good.note, longText(12289), `${tag}: a valid argsLong (12,289) still names its length`);
    }
    // ---- review of PR 2119, finding 2: main's mask can make an argument longer than the window's cap; what the cap leaves out is counted (CUT-COUNT)
    {
      const M = require(path.join(__dirname, '..', 'dist', 'main', 'mcpmask.js'));
      const unit = j(' --pass', 'word zq');
      let raw = 'env'; while (raw.length + unit.length <= 12283) raw += unit;
      const masked = M.maskToolArgs({ command: raw }).command; // what main sends the window for this call
      assert.ok(raw.length <= 12288 && masked.length > 12288, `${tag}: the invented run masks longer than the window's cap (${raw.length} -> ${masked.length})`);
      const o = await js(`window.__durbarSimUi.chipNoteOf(${jsLiteral({ tool: 'bash', args: { command: masked } })})`);
      const m = /^([\d,]+) more characters \(([\d,]+) not shown\)$/.exec(o.note);
      assert.ok(m, `CUT-COUNT ${tag}: the note says what the cap leaves out: ${JSON.stringify(o.note)}`);
      const more = Number(m[1].replace(/,/g, '')), cut = Number(m[2].replace(/,/g, ''));
      assert.strictEqual(400 + more + cut, masked.length, `CUT-COUNT ${tag}: 400 on the line + ${more} in the box + ${cut} not shown = the masked length`);
      assert.strictEqual(400 + more, o.full, `${tag}: the box holds the line and the ${more} more`);
      assert.strictEqual(o.cutLine, `${fmt(cut)} more characters not shown.`, `CUT-COUNT ${tag}: the open box ends with the plain count`);
      assert.ok(o.title.includes(`(${o.note})`), `${tag}: the tooltip says it too`);
    }

    // ---- layout: three fresh chips (short, more, too long) are the newest, so they are shown
    await start(`${tag}-L-short`, { command: 'npm test' });
    await start(`${tag}-L-more`, { command: words(2400) });
    await start(`${tag}-L-long`, { command: words(20000) });
    const lay = await js(`(()=>{const ids=${jsLiteral([`${tag}-L-short`, `${tag}-L-more`, `${tag}-L-long`])}.map(i=>window.__durbarSimUi.chipEl(${jsLiteral(ID)},i));
      const r=e=>e.getBoundingClientRect();const out=ids.map(c=>{const n=c.querySelector('.argmore'),res=c.querySelector('.res'),cr=r(c);
        const nr=n&&r(n),rr=res&&r(res);return {h:Math.round(cr.height),note:!!n,fs:n?parseFloat(getComputedStyle(n).fontSize):0,
        inside:!n||(nr.left>=cr.left-0.5&&nr.right<=cr.right+0.5&&nr.top>=cr.top-0.5&&nr.bottom<=cr.bottom+0.5),
        clear:!n||!rr||nr.right<=rr.left+0.5,whole:!n||n.scrollWidth<=n.clientWidth+1,resWhole:!rr||rr.width<=0||res.scrollWidth<=res.clientWidth+1,shown:!c.hidden&&cr.height>0};});
      const ch=document.getElementById('chat');return {chips:out,sideways:ch.scrollWidth>ch.clientWidth+1};})()`);
    lay.chips.forEach((c, i) => {
      assert.ok(c.shown, `${tag}: layout chip ${i} is shown`);
      if (c.note) assert.ok(c.fs >= 10.5 && c.inside && c.clear && c.whole && c.resWhole, `${tag}: chip ${i}'s note is at least 10.5px, inside its chip, clear of the status word, both whole: ${JSON.stringify(c)}`);
      assert.strictEqual(c.h, lay.chips[0].h, `${tag}: chip ${i} is as high as a chip without a note`);
    });
    assert.ok(lay.chips[1].note && lay.chips[2].note, `${tag}: the two long chips have notes`);
    assert.ok(!lay.sideways, `${tag}: the chat does not scroll sideways`);
    await js(`document.activeElement&&document.activeElement.blur()`);
    await H.shot(path.join(OUT, `005-long-args-${tag}.png`), { prep: 'mouse', tag: 'long-args' });
  }
  console.log('check-005-long-args: all checks passed');
  process.exitCode = 0;
};
