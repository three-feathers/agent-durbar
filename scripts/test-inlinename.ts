/** Rename in place, the pure part and the field's logic (spec 059 FR-021, FR-022, FR-027): `npm run test:inlinename`.
 *  The real-browser behaviour (layout, focus, the chat staying open) is `npm run check:ui -- --only check-rename-inline`. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IN = require(path.join(root, 'src', 'renderer', 'inlinename.js')) as any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SN = require(path.join(root, 'src', 'renderer', 'sessionname.js')) as { nameError: (s: string) => string };

// keyAction: Enter, Escape, Tab; composing Enter and keyCode 229 do nothing
assert.strictEqual(IN.keyAction({ key: 'Enter' }), 'save');
assert.strictEqual(IN.keyAction({ key: 'Escape' }), 'cancel');
assert.strictEqual(IN.keyAction({ key: 'Tab' }), 'tab');
assert.strictEqual(IN.keyAction({ key: 'Tab', shiftKey: true }), 'tab');
assert.strictEqual(IN.keyAction({ key: 'F2' }), null);
assert.strictEqual(IN.keyAction({ key: 'a' }), null);
assert.strictEqual(IN.keyAction({ key: 'Enter', isComposing: true }), null, 'Enter during composition only commits the composition');
assert.strictEqual(IN.keyAction({ key: 'Escape', isComposing: true }), null, 'Esc during composition does not cancel the edit');
assert.strictEqual(IN.keyAction({ key: 'Enter', keyCode: 229 }), null);
assert.strictEqual(IN.keyAction(null), null);

// startsEdit: F2 anywhere, Enter only where a title allows it, never with a modifier or while composing
assert.strictEqual(IN.startsEdit({ key: 'F2' }, false), true);
assert.strictEqual(IN.startsEdit({ key: 'Enter' }, false), false);
assert.strictEqual(IN.startsEdit({ key: 'Enter' }, true), true);
assert.strictEqual(IN.startsEdit({ key: 'F2', ctrlKey: true }, false), false);
assert.strictEqual(IN.startsEdit({ key: 'Enter', isComposing: true }, true), false);

// pasteText: LF, CR, CRLF and TAB become one space each; U+2028 stays for the rule to refuse
assert.strictEqual(IN.pasteText('Billing\nrefactor\r\n'), 'Billing refactor ');
assert.strictEqual(IN.pasteText('a\rb'), 'a b');
assert.strictEqual(IN.pasteText('a\tb'), 'a b');
assert.strictEqual(IN.pasteText('a\n\nb'), 'a  b');
assert.strictEqual(IN.pasteText('a b'), 'a b');
assert.ok(SN.nameError(IN.pasteText('a b')), 'the rule still refuses the hidden character');
assert.strictEqual(IN.pasteText(undefined), '');

// outcome: same / reset / save
assert.strictEqual(IN.outcome('Ab', '  Ab '), 'same');
assert.strictEqual(IN.outcome('A  b', 'A b'), 'same');
assert.strictEqual(IN.outcome('Ab', ''), 'reset');
assert.strictEqual(IN.outcome('Ab', '   '), 'reset');
assert.strictEqual(IN.outcome('Ab', 'Abc'), 'save');
assert.strictEqual(IN.outcome('', ''), 'same', 'an unnamed field left alone makes no call');
assert.strictEqual(IN.outcome('', '   '), 'same');
assert.strictEqual(IN.outcome('', 'New'), 'save');

// blurAction: the window losing focus keeps the field; a rule breaker reverts; else save
assert.strictEqual(IN.blurAction(false, ''), 'keep');
assert.strictEqual(IN.blurAction(false, 'Use 1 to 60 characters.'), 'keep');
assert.strictEqual(IN.blurAction(true, 'Use 1 to 60 characters.'), 'revert');
assert.strictEqual(IN.blurAction(true, ''), 'save');

// timing: 200k characters through the pure helpers stay fast (loose limit)
{
  const big = 'ab \n\t'.repeat(40000);
  const t0 = Date.now();
  IN.pasteText(big); IN.outcome(big, big + ' x');
  assert.ok(Date.now() - t0 < 1000, 'pure helpers handle 200k characters in under a second');
}

// ---- the field (jsdom, no layout) ----
const setup = (opts: Record<string, unknown> = {}) => {
  const { window } = new JSDOM('<!doctype html><body><h2 id="t"><button id="b">Old name</button></h2></body>');
  const doc = window.document as Document;
  (doc as any).hasFocus = () => true; // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: string[] = []; const notes: string[] = []; const closed: string[] = [];
  let result: { ok: boolean; reason?: string } = { ok: true };
  let anchor: unknown = doc.getElementById('b');
  const bubbled: string[] = [];
  doc.addEventListener('keydown', (e) => bubbled.push((e as KeyboardEvent).key));
  const start = (extra: Record<string, unknown> = {}) => IN.open({
    doc, anchor: doc.getElementById('b'), value: 'Old name', max: 60, label: 'Name of session Old name', hint: 'Enter saves.', key: 'k1',
    check: (t: string) => SN.nameError(t),
    submit: async (t: string) => { calls.push(t); return result; },
    notify: (m: string) => notes.push(m), onClose: (h: string) => closed.push(h),
    reanchor: () => anchor, focusBack: () => doc.getElementById('b'), ...opts, ...extra,
  });
  const inp = () => doc.querySelector('.inl-input') as HTMLInputElement | null;
  const key = (k: string, extra: object = {}) => { const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }); inp()!.dispatchEvent(e); return e; };
  const type = (v: string) => { inp()!.value = v; inp()!.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, doc, calls, notes, closed, bubbled, start, inp, key, type, tick, setResult: (r: typeof result) => { result = r; }, setAnchor: (a: unknown) => { anchor = a; } };
};

(async () => {
  // Enter saves once; Esc/Enter never bubble to the document (the chat would close)
  {
    const s = setup(); s.start();
    assert.strictEqual(s.doc.activeElement, s.inp(), 'the field has focus');
    assert.strictEqual(s.inp()!.selectionStart, 0); assert.strictEqual(s.inp()!.selectionEnd, 8, 'the prefill is fully selected');
    assert.strictEqual(s.inp()!.getAttribute('aria-label'), 'Name of session Old name');
    s.type('Billing refactor');
    const e = s.key('Enter'); assert.ok(e.defaultPrevented);
    s.key('Enter'); // busy: a second Enter does not send again
    assert.ok(s.inp()!.readOnly && s.inp()!.getAttribute('aria-busy') === 'true');
    await s.tick();
    assert.deepStrictEqual(s.calls, ['Billing refactor']);
    assert.strictEqual(s.inp(), null, 'closed after the save');
    assert.strictEqual(s.doc.activeElement!.id, 'b', 'focus is back on the title button');
    assert.deepStrictEqual(s.bubbled, [], 'no key reached the document');
    assert.deepStrictEqual(s.closed, ['saved']);
  }
  // Esc cancels with no call
  {
    const s = setup(); s.start(); s.type('x'); s.key('Escape');
    await s.tick(); assert.deepStrictEqual(s.calls, []); assert.strictEqual(s.inp(), null); assert.deepStrictEqual(s.closed, ['cancel']);
    assert.deepStrictEqual(s.bubbled, []);
  }
  // unchanged text: no call, even with extra spaces
  {
    const s = setup(); s.start(); s.type('  Old   name '); s.key('Enter');
    await s.tick(); assert.deepStrictEqual(s.calls, []); assert.deepStrictEqual(s.closed, ['same']);
  }
  // empty resets with ''
  {
    const s = setup(); s.start(); s.type('   '); s.key('Enter');
    await s.tick(); assert.deepStrictEqual(s.calls, ['']);
  }
  // rule error: Enter keeps the field open with the reason and sends nothing; typing clears it
  {
    const s = setup(); s.start(); s.type('x'.repeat(61)); s.inp()!.maxLength = 500; s.type('x'.repeat(61)); s.key('Enter');
    await s.tick(); assert.deepStrictEqual(s.calls, []);
    assert.ok(s.inp(), 'still open'); const err = s.doc.querySelector('.inl-err') as HTMLElement;
    assert.ok(!err.hidden && err.getAttribute('role') === 'alert' && /Use 1 to 60/.test(err.textContent || ''));
    assert.ok((s.inp()!.getAttribute('aria-describedby') || '').includes(err.id));
    s.type('ok'); assert.ok(err.hidden);
  }
  // main refuses with a reason on Enter: stay open, reason shown, field usable again
  {
    const s = setup(); s.setResult({ ok: false, reason: 'That looks like a secret.' }); s.start(); s.type('Foo'); s.key('Enter');
    await s.tick(); assert.ok(s.inp() && !s.inp()!.readOnly && s.inp()!.getAttribute('aria-busy') === null);
    assert.ok(/secret/.test((s.doc.querySelector('.inl-err') as HTMLElement).textContent || ''));
  }
  // blur saves; blur with a rule breaker reverts with a toast; window blur keeps the field
  {
    const s = setup(); s.start(); s.type('Blurred'); s.inp()!.dispatchEvent(new s.window.Event('blur'));
    await s.tick(); assert.deepStrictEqual(s.calls, ['Blurred']); assert.strictEqual(s.inp(), null);
    const r = setup(); r.start(); r.inp()!.maxLength = 500; r.type('y'.repeat(61)); r.inp()!.dispatchEvent(new r.window.Event('blur'));
    await r.tick(); assert.deepStrictEqual(r.calls, []); assert.strictEqual(r.inp(), null);
    assert.ok(/^Not renamed: Use 1 to 60/.test(r.notes[0]), r.notes[0]);
    const w = setup(); (w.doc as any).hasFocus = () => false; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.start(); w.type('Away'); w.inp()!.dispatchEvent(new w.window.Event('blur'));
    await w.tick(); assert.ok(w.inp(), 'the window lost focus: still open'); assert.deepStrictEqual(w.calls, []);
  }
  // Tab saves and puts focus back
  {
    const s = setup(); s.start(); s.type('Tabbed'); const e = s.key('Tab', { shiftKey: true });
    assert.ok(e.defaultPrevented); await s.tick();
    assert.deepStrictEqual(s.calls, ['Tabbed']); assert.strictEqual(s.doc.activeElement!.id, 'b');
  }
  // composition: Enter and Esc do nothing but still do not bubble
  {
    const s = setup(); s.start(); s.type('Comp');
    s.key('Enter', { isComposing: true }); s.key('Escape', { isComposing: true });
    await s.tick(); assert.deepStrictEqual(s.calls, []); assert.ok(s.inp());
    assert.deepStrictEqual(s.bubbled, []);
    s.key('Enter'); await s.tick(); assert.deepStrictEqual(s.calls, ['Comp']);
  }
  // paste: line breaks become spaces
  {
    const s = setup(); s.start(); s.type('');
    const ev = new s.window.Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
    (ev as any).clipboardData = { getData: () => 'Billing\nrefactor\r\n' }; // eslint-disable-line @typescript-eslint/no-explicit-any
    s.inp()!.dispatchEvent(ev);
    assert.ok(ev.defaultPrevented); assert.strictEqual(s.inp()!.value, 'Billing refactor ');
    s.key('Enter'); await s.tick(); assert.deepStrictEqual(s.calls, ['Billing refactor']);
  }
  // one at a time: a second open saves the first
  {
    const s = setup(); s.start({ key: 'one' }); s.type('First'); s.start({ key: 'two' });
    await s.tick(); assert.deepStrictEqual(s.calls, ['First']);
    assert.strictEqual(s.doc.querySelectorAll('.inl-input').length, 1);
    assert.strictEqual(IN.current().anchorKey, 'two'); IN.close('gone');
    assert.strictEqual(s.doc.querySelectorAll('.inl-input').length, 0);
  }
  // a save still running (800 ms) when another edit opens: one field only, and the late answer does not take focus back (review of #636)
  {
    const s = setup({ submit: async (t: string) => { await new Promise((r) => setTimeout(r, 800)); s.calls.push(t); return { ok: true }; } });
    s.start({ key: 'one' }); s.type('Slow one'); s.key('Enter');
    assert.ok(s.inp()!.readOnly, 'the first field is busy');
    const b = s.doc.createElement('button'); b.id = 'second'; s.doc.body.appendChild(b);
    IN.open({ doc: s.doc, anchor: b, value: 'B', max: 60, label: 'B', key: 'two', check: () => '', submit: async () => ({ ok: true }), focusBack: () => s.doc.getElementById('b') });
    assert.strictEqual(s.doc.querySelectorAll('.inl-input').length, 1, 'only the second field is on screen');
    assert.strictEqual(s.doc.activeElement, s.inp(), 'the second field has focus');
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepStrictEqual(s.calls, ['Slow one'], 'the first save still went out');
    assert.strictEqual(s.doc.querySelectorAll('.inl-input').length, 1, 'still only the second field');
    assert.strictEqual(s.doc.activeElement, s.inp(), 'the first save finishing did not take focus from the second field');
    assert.strictEqual(IN.current().anchorKey, 'two'); IN.close('gone');
  }
  // the field fills the clip box's free inner width (jsdom has no layout: the boxes are stubbed)
  {
    const s = setup(); const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
    const a = s.doc.getElementById('b') as HTMLElement; (a as any).getBoundingClientRect = () => rect(100, 50, 40, 18); // eslint-disable-line @typescript-eslint/no-explicit-any
    const clip = s.doc.createElement('div'); (clip as any).getBoundingClientRect = () => rect(20, 40, 500, 60); s.doc.body.appendChild(clip); // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.defineProperty(s.doc.documentElement, 'clientWidth', { value: 1000, configurable: true });
    s.start({ clip: () => clip, maxWidth: 480 });
    const w = parseFloat((s.doc.querySelector('.inl-layer') as HTMLElement).style.width);
    assert.strictEqual(w, 520 - 4 - 100, 'the field runs from the name to the clip box right edge minus 4');
    IN.close('gone');
    s.start({ clip: () => clip, maxWidth: 200 });
    assert.strictEqual(parseFloat((s.doc.querySelector('.inl-layer') as HTMLElement).style.width), 200, 'and no wider than maxWidth');
    IN.close('gone');
    s.start({ clip: () => clip, fill: false });
    assert.strictEqual(parseFloat((s.doc.querySelector('.inl-layer') as HTMLElement).style.width), 120, 'fill:false keeps the 120px minimum');
    IN.close('gone');
  }
  // follow: a re-rendered anchor keeps the value; 'gone' closes without a call; null saves like blur
  {
    const s = setup(); s.start(); s.type('Typed');
    const a2 = s.doc.createElement('button'); (a2 as any).getBoundingClientRect = () => ({ left: 10, top: 20, width: 90, height: 18, right: 100, bottom: 38 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    s.doc.body.appendChild(a2); s.setAnchor(a2); IN.follow();
    assert.strictEqual(s.inp()!.value, 'Typed'); assert.strictEqual((s.doc.querySelector('.inl-layer') as HTMLElement).style.left, '10px');
    s.setAnchor('gone'); IN.follow(); await s.tick();
    assert.strictEqual(s.inp(), null); assert.deepStrictEqual(s.calls, []); assert.deepStrictEqual(s.closed, ['gone']);
    const n = setup(); n.start(); n.type('Hidden'); n.setAnchor(null); IN.follow(); await n.tick();
    assert.deepStrictEqual(n.calls, ['Hidden']);
  }
  console.log('inlinename: ok');
})().catch((e) => { console.error(e); process.exit(1); });
