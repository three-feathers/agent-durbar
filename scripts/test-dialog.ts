/** Confirmation dialog keyboard contract (jsdom, no credits): `npm run test:dialog`. See specs/003 FR-033 (issue #25).
 *  The real-browser version (real key events in the simulator) is `npm run check:ui -- --only check-dialog-focus`. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const create = require(path.join(root, 'src', 'renderer', 'dialog.js')) as (doc: Document) => (o: unknown) => Promise<{ value: string; checked: boolean } | null>;

const setup = () => {
  const { window } = new JSDOM('<!doctype html><body><button id="before">before</button><button id="modeChip">chip</button><button id="after">after</button></body>');
  const doc = window.document as Document;
  const ask = create(doc);
  const chip = doc.getElementById('modeChip') as HTMLElement;
  const key = (k: string, shift = false): boolean => {
    const e = new window.KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true });
    (doc.activeElement || doc.body).dispatchEvent(e);
    return e.defaultPrevented;
  };
  const dlg = () => doc.getElementById('modeDlg');
  const btn = (label: string) => Array.from(doc.querySelectorAll('#modeDlg .btn')).find((b) => b.textContent === label) as HTMLElement;
  const inDlg = () => !!dlg() && dlg()!.contains(doc.activeElement);
  const opts = (extra: object = {}) => ({
    title: 'Allow all for Ada?', body: 'Everything runs without asking.', returnFocus: chip, ...extra,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Allow all', value: 'ok', cls: 'primary warn' }],
  });
  return { window, doc, ask, chip, key, dlg, btn, inDlg, opts };
};

(async () => {
  // opens with focus inside (the old bug: the caller focused the chip behind the dialog right after); spec 052 FR-036: a destructive
  // confirmation (primary warn/danger) starts on Cancel, so Enter never confirms it unread
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts());
    assert.ok(t.inDlg(), 'focus is inside the dialog when it opens');
    assert.strictEqual(t.doc.activeElement, t.btn('Cancel'), 'a destructive confirmation starts on Cancel');
    // a stray focus() on the control behind the dialog (what changeMode used to do) is undone
    t.chip.focus();
    assert.ok(t.inDlg(), 'focus cannot be moved to the control behind the dialog');
    t.doc.getElementById('after')!.focus();
    assert.ok(t.inDlg(), 'nor to any other control behind it');
    // Escape closes it from the keyboard: cancels (null), never confirms, and focus goes back to the chip
    t.key('Escape');
    assert.strictEqual(await p, null, 'Escape cancels (null), it does not confirm');
    assert.strictEqual(t.dlg(), null, 'dialog removed');
    assert.strictEqual(t.doc.activeElement, t.chip, 'focus returns to the chip');
  }
  // spec 033 (Rename floor): an input can start filled in and focused; the result carries its text
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts({ input: { label: 'Name', value: 'Client A', max: 40, focus: true } }));
    const inp = t.doc.getElementById('mdIn') as HTMLInputElement;
    assert.strictEqual(inp.value, 'Client A', 'prefilled');
    assert.strictEqual(inp.maxLength, 40);
    assert.strictEqual(t.doc.activeElement, inp, 'focus starts in the field');
    inp.value = 'Client B';
    t.btn('Allow all').click();
    const r = (await p) as unknown as { value: string; text: string };
    assert.strictEqual(r.text, 'Client B');
    // without focus: true the first button is focused: Cancel for a destructive confirmation (FR-036); a plain primary keeps it
    const t2 = setup(); t2.chip.focus();
    const p2 = t2.ask(t2.opts({ input: { label: 'Focus' } }));
    assert.strictEqual(t2.doc.activeElement, t2.btn('Cancel'));
    assert.strictEqual((t2.doc.getElementById('mdIn') as HTMLInputElement).value, '', 'no value: empty');
    t2.key('Escape');
    assert.strictEqual(await p2, null);
    const t3 = setup(); t3.chip.focus();
    const p3 = t3.ask({ ...t3.opts(), buttons: [{ label: 'Cancel', value: null }, { label: 'Allow all', value: 'ok', cls: 'primary' }] });
    assert.strictEqual(t3.doc.activeElement, t3.btn('Allow all'), 'a plain primary keeps the focus');
    t3.key('Escape'); assert.strictEqual(await p3, null);
  }
  // Escape also works when focus slipped to <body> (click on the backdrop's blank area), and when the chip was the opener by default
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts({ returnFocus: undefined }));
    (t.doc.activeElement as HTMLElement).blur(); // focus -> body
    t.key('Escape');
    assert.strictEqual(await p, null);
    assert.strictEqual(t.doc.activeElement, t.chip, 'default return target is the element focused when it opened');
  }
  // Tab and Shift+Tab are trapped (wrap at the ends); in between the browser moves focus inside the dialog
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts({ check: { label: 'Also approve 2 requests', checked: true } }));
    const order = Array.from(t.doc.querySelectorAll('#modeDlg input, #modeDlg .btn')) as HTMLElement[]; // checkbox, Cancel, Allow all
    assert.strictEqual(order.length, 3);
    order[2].focus(); assert.ok(t.key('Tab'), 'Tab on the last control is handled'); assert.strictEqual(t.doc.activeElement, order[0], 'wraps to the first');
    order[0].focus(); assert.ok(t.key('Tab', true), 'Shift+Tab on the first control is handled'); assert.strictEqual(t.doc.activeElement, order[2], 'wraps to the last');
    order[1].focus(); assert.ok(!t.key('Tab'), 'Tab in the middle is left to the browser (stays in the dialog)'); assert.ok(t.inDlg());
    t.key('Escape'); await p;
  }
  // confirming is explicit: only activating Allow all resolves a value; Escape, Cancel, backdrop never do
  {
    const t = setup(); t.chip.focus();
    let p = t.ask(t.opts({ check: { label: 'Also approve 2 requests', checked: true } }));
    t.btn('Cancel').click();
    assert.strictEqual(await p, null, 'Cancel -> null'); assert.strictEqual(t.doc.activeElement, t.chip, 'focus back on the chip after Cancel');
    p = t.ask(t.opts());
    t.dlg()!.click(); // backdrop
    assert.strictEqual(await p, null, 'backdrop click -> null'); assert.strictEqual(t.doc.activeElement, t.chip);
    p = t.ask(t.opts({ check: { label: 'Also approve 2 requests', checked: true } }));
    (t.doc.getElementById('mdChk') as HTMLInputElement).checked = false;
    t.btn('Allow all').click();
    assert.deepStrictEqual(await p, { value: 'ok', checked: false }, 'Allow all needs the explicit click and reports the checkbox');
    assert.strictEqual(t.doc.activeElement, t.chip, 'focus back on the chip after confirming');
    for (const k of ['Enter', ' ', 'Tab']) { // no key handler may confirm by itself
      p = t.ask(t.opts()); let settled = false; void p.then(() => { settled = true; });
      t.key(k); await Promise.resolve();
      assert.ok(!settled, `key ${JSON.stringify(k)} does not close/confirm the dialog`);
      t.key('Escape'); await p;
    }
  }
  // listeners are removed on close (a later Escape / focus change does nothing), and a second dialog replaces the first
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts()); t.key('Escape'); await p;
    t.doc.getElementById('after')!.focus();
    assert.strictEqual(t.doc.activeElement, t.doc.getElementById('after'), 'focus is free again after the dialog closed');
    const p1 = t.ask(t.opts()); const p2 = t.ask(t.opts());
    assert.strictEqual(t.doc.querySelectorAll('#modeDlg').length, 1, 'only one dialog at a time');
    t.key('Escape'); assert.strictEqual(await p2, null); void p1;
  }
  // spec 030: a short list under the body and an optional text input; everything is text, never HTML
  {
    const t = setup(); t.chip.focus();
    const p = t.ask(t.opts({ lines: ['Deep costs 2× more <b>x</b>', 'Second line'], input: { label: 'Focus (optional)', placeholder: 'e.g. keep the API notes', max: 10 } }));
    const items = Array.from(t.doc.querySelectorAll('#modeDlg .dlist li'));
    assert.deepStrictEqual(items.map((li) => li.textContent), ['Deep costs 2× more <b>x</b>', 'Second line']);
    assert.strictEqual(t.doc.querySelectorAll('#modeDlg .dlist b').length, 0, 'lines are text, not HTML');
    const inp = t.doc.getElementById('mdIn') as HTMLInputElement;
    assert.strictEqual(inp.maxLength, 10);
    inp.value = 'keep notes';
    const order = Array.from(t.doc.querySelectorAll('#modeDlg input, #modeDlg .btn')) as HTMLElement[]; // input, Cancel, Allow all
    assert.strictEqual(order.length, 3);
    order[2].focus(); assert.ok(t.key('Tab'), 'Tab wraps over the input too'); assert.strictEqual(t.doc.activeElement, order[0]);
    t.btn('Allow all').click();
    assert.deepStrictEqual(await p, { value: 'ok', checked: false, text: 'keep notes' });
  }
  // spec 059 FR-004: Enter in the field saves (submitOnEnter), a failing check keeps the dialog open with the reason under the field, Escape cancels
  {
    const t = setup(); t.chip.focus();
    const opts = (check?: (v: string) => string) => ({ ...t.opts({ title: 'Rename session', input: { label: 'Name', value: 'Old', max: 60, focus: true, submitOnEnter: true, ...(check ? { check } : {}) } }), buttons: [{ label: 'Cancel', value: null }, { label: 'Rename', value: 'ok', cls: 'primary' }] });
    const p = t.ask(opts((v) => (v.includes('!') ? 'Remove control or hidden characters.' : '')));
    const inp = t.doc.getElementById('mdIn') as HTMLInputElement;
    assert.strictEqual(t.doc.activeElement, inp);
    assert.strictEqual((t.doc.getElementById('mdErr') as HTMLElement).hidden, true, 'no error at first');
    inp.value = 'bad!';
    t.key('Enter');
    assert.ok(t.dlg(), 'a refused name keeps the dialog open');
    const er = t.doc.getElementById('mdErr') as HTMLElement;
    assert.strictEqual(er.hidden, false);
    assert.strictEqual(er.textContent, 'Remove control or hidden characters.');
    assert.strictEqual(er.getAttribute('role'), 'alert');
    assert.strictEqual(inp.getAttribute('aria-describedby'), 'mdErr');
    assert.strictEqual(t.doc.activeElement, inp, 'focus stays in the field');
    inp.value = 'Good';
    t.key('Enter');
    assert.deepStrictEqual(await p, { value: 'ok', checked: false, text: 'Good' }, 'Enter in the field presses the primary button');
    assert.strictEqual(t.doc.activeElement, t.chip, 'focus returns to the opener');
    // without the option, Enter in the field does nothing (as before)
    const q = t.ask(t.opts({ input: { label: 'Name', value: 'x' } }));
    t.key('Enter');
    assert.ok(t.dlg(), 'no submitOnEnter: still open');
    t.key('Escape'); assert.strictEqual(await q, null);
    // Escape cancels without running the check; Cancel never checks
    let ran = 0;
    const r = t.ask(opts(() => (ran++, 'x')));
    t.btn('Cancel').click();
    assert.strictEqual(await r, null); assert.strictEqual(ran, 0);
    // an empty field is allowed through (a reset) when the check says ''
    const u = t.ask(opts(() => ''));
    (t.doc.getElementById('mdIn') as HTMLInputElement).value = '';
    t.key('Enter');
    assert.deepStrictEqual(await u, { value: 'ok', checked: false, text: '' });
  }
  // spec 064 FR-002: a multiline input, a pick list with disabled lines, and `need` (primary disabled until a text and N picks)
  {
    const t = setup();
    const p = t.ask({
      title: 'Send to several sessions', body: 'Choose', returnFocus: t.chip,
      input: { label: 'Message', multiline: true, max: 4000, focus: true },
      picks: [{ label: 'Ada · api', value: 'a1' }, { label: 'Kenji · web', note: 'busy', value: 'a2', disabled: true }, { label: 'Lena · <b>x</b>', value: 'a3' }],
      need: { text: true, picks: 1, label: (n: number) => (n ? `Send to ${n} session${n === 1 ? '' : 's'}` : 'Send') },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Send', value: 'send', cls: 'primary' }],
    });
    const ta = t.doc.getElementById('mdIn') as HTMLTextAreaElement;
    assert.strictEqual(ta.tagName, 'TEXTAREA', 'multiline input is a textarea');
    assert.strictEqual(t.doc.activeElement, ta, 'focus starts in the message');
    const cbs = Array.from(t.doc.querySelectorAll('#mdP input')) as HTMLInputElement[];
    assert.strictEqual(cbs.length, 3);
    assert.ok(cbs[1].disabled && !cbs[1].checked, 'a busy session cannot be picked');
    assert.strictEqual(t.doc.querySelectorAll('#mdP b').length, 0, 'labels are text, not HTML');
    const primary = t.doc.querySelector('#modeDlg .btn.primary') as HTMLButtonElement;
    assert.ok(primary.disabled && primary.textContent === 'Send', 'disabled with no text and no pick');
    ta.value = 'pull main and run the tests'; ta.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    assert.ok(primary.disabled, 'still disabled with no pick');
    cbs[0].checked = true; cbs[0].dispatchEvent(new t.window.Event('change', { bubbles: true }));
    cbs[2].checked = true; cbs[2].dispatchEvent(new t.window.Event('change', { bubbles: true }));
    assert.ok(!primary.disabled && String(primary.textContent as string) === 'Send to 2 sessions', 'enabled, and it names the count');
    ta.value = '   '; ta.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    assert.ok(primary.disabled, 'blank text disables it again');
    primary.click();
    assert.ok(t.dlg(), 'a disabled primary button does nothing');
    ta.value = 'go'; ta.dispatchEvent(new t.window.Event('input', { bubbles: true }));
    primary.click();
    assert.deepStrictEqual(await p, { value: 'send', checked: false, text: 'go', picked: ['a1', 'a3'] });
    // Enter in a multiline textarea never submits (it is a new line)
    const q = t.ask({ title: 'T', body: 'b', returnFocus: t.chip, input: { label: 'Message', multiline: true, focus: true, submitOnEnter: true }, buttons: [{ label: 'Cancel', value: null }, { label: 'Send', value: 'send', cls: 'primary' }] });
    (t.doc.getElementById('mdIn') as HTMLTextAreaElement).value = 'hello';
    t.key('Enter');
    assert.ok(t.dlg(), 'Enter in a textarea does not submit');
    t.key('Escape'); assert.strictEqual(await q, null);
    // submitOnEnter with an unmet `need` does not confirm
    const r = t.ask({ title: 'T', body: 'b', returnFocus: t.chip, input: { label: 'Name', focus: true, submitOnEnter: true }, picks: [{ label: 'Ada', value: 'a1' }], need: { text: true, picks: 1 }, buttons: [{ label: 'Cancel', value: null }, { label: 'Send', value: 'send', cls: 'primary' }] });
    (t.doc.getElementById('mdIn') as HTMLInputElement).value = 'text';
    t.key('Enter');
    assert.ok(t.dlg(), 'Enter does not press a primary button that `need` keeps disabled');
    t.key('Escape'); assert.strictEqual(await r, null);
  }
  console.log('dialog tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
