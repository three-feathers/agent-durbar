/**
 * Spec 111 T009: the team member editor, no Electron, no credits: `npm run test:teams-editor`.
 *  1. the pure rules (`src/renderer/teameditor.js`): the 8-member limit, remove/move, changing the app clears the limit, the limit in the app's unit,
 *     the fields' fixed words, the payload for `teams:put` (no `briefFrom`, `memberId` kept, no empty optional), which fields main refused (and no text of its);
 *  2. the shared rows (`src/renderer/memberrows.js`): the limit parse that New session uses, and the builders;
 *  3. the dialog in jsdom with the real `askDialog` and `modelswitch.js`: errors on the field with `aria-describedby`, the tope of 8, a limit cleared with
 *     the app, Mark as mine asks first (and `teams:markMine` is not called without the yes), a `changed` or `failed` answer keeps what was typed, the
 *     value of a hostile name is text;
 *  4. static: no way to turn a string into markup in the three renderer files of this feature; New session's pair of rows are the shared builders;
 *  5. `custom.confirm` of dialog.js (a save that is refused keeps the dialog open).
 * 6. mutants (end of the file): each one is applied to a COPY of the renderer files in a temporary folder (`TEAMS_EDITOR_SRC`), this same test runs on the copy
 *    in a child process and must fail: a limit kept across an app change; Mark as mine without the question, and without the yes; no limit of 8 (the
 *    button's and the function's); Esc with changes closing without a question (and the dialog's own dismiss and confirm paths, Mark as mine without a memberId or a template id, no state words); the section shown outside the simulator; `innerHTML` for a legend; `aria-describedby` dropped; `briefFrom` sent to main.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import { spawnSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, o?: unknown) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROOT = path.join(__dirname, '..', '..');
const SRC = process.env.TEAMS_EDITOR_SRC || path.join(ROOT, 'src', 'renderer'); // the mutant runner points it at a copy
let checks = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); checks++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); checks++; };
/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (f: string): any => { const p = path.join(SRC, f); delete require.cache[p]; return require(p); };

const E = load('teameditor.js');
const MR = load('memberrows.js');
const DMK = load('modelswitch.js');
const createDialog = load('dialog.js'); // from SRC too: a mutant of dialog.js is a copy

// ---------------------------------------------------------------- 1. pure rules
const draft = E.newDraft('claude');
eq(draft.members.length, 1, 'a new draft has one member');
for (let i = 0; i < 7; i++) ok(E.addMember(draft, 'claude'), 'member ' + (i + 2) + ' is added');
eq(draft.members.length, 8, 'eight members');
eq(E.canAdd(draft), false, 'the 9th cannot be added');
eq(E.addMember(draft, 'claude'), null, 'addMember refuses a 9th (the button is not the only guard)');
eq(draft.members.length, 8, 'still eight');
eq(E.removeMember(E.newDraft('claude'), 0), false, 'the last member cannot be removed');
const d3 = E.newDraft('claude'); E.addMember(d3, 'codex'); E.addMember(d3, 'copilot');
d3.members.forEach((m: any, i: number) => { m.name = 'M' + i; });
eq(E.moveMember(d3, 0, -1), false, 'the first cannot move up');
eq(E.moveMember(d3, 2, 1), false, 'the last cannot move down');
ok(E.moveMember(d3, 0, 1), 'down');
eq(d3.members.map((m: any) => m.name), ['M1', 'M0', 'M2'], 'the order changed');
ok(E.removeMember(d3, 1), 'remove'); eq(d3.members.map((m: any) => m.name), ['M1', 'M2'], 'the removed one is gone');

// the app changes: limit, model and effort are cleared
const m1 = E.blankMember('claude'); m1.capText = '12'; m1.capUnit = 'usd'; m1.model = 'x1'; m1.effort = 'high'; m1.role = 'Dev';
E.changeApp(m1, 'codex');
eq([m1.app, m1.capText, m1.capUnit, m1.model, m1.effort, m1.role], ['codex', '', '', '', '', 'Dev'], 'changing the app clears the limit, model and effort, nothing else');
const m2 = E.blankMember('claude'); m2.capText = '40'; m2.capUnit = 'aiu';
E.syncCapUnit(m2, 'usd'); eq([m2.capText, m2.capUnit, m2.capCleared], ['', 'usd', true], 'a limit typed in another unit is not kept');
const m3 = E.blankMember('claude'); m3.capText = '40'; m3.capUnit = 'aiu'; E.syncCapUnit(m3, 'aiu'); eq(m3.capText, '40', 'the same unit keeps it');
const m4 = E.blankMember('claude'); m4.effort = 'high'; E.changeModel(m4, 'a', ['low', 'high']); eq(m4.effort, 'high', 'an effort the model offers stays');
E.changeModel(m4, 'b', ['low']); eq(m4.effort, '', 'an effort the model does not offer goes');
E.changeModel(m4, '', null); eq(m4.model, '', 'App default');

// the rules of the form, in fixed words
const parse = (usd: boolean, t: string) => MR.capParse(usd, t, { minAiu: 30, minUsd: 0.01 });
const bad = E.newDraft('claude'); const bm = bad.members[0];
let c = E.checkDraft(bad, { parse, limits: { minAiu: 30, minUsd: 0.01 } });
eq([c.template.name, c.members[0].name, c.members[0].role], ['Give the template a name (1 to 40 characters).', 'Give the member a name (1 to 60 characters).', 'Give the member a role (1 to 40 characters).'], 'empty names say so');
eq(c.count, 3, 'three fields');
bad.name = 'T'; bm.name = 'N'; bm.role = 'R';
eq(E.checkDraft(bad, { parse }).count, 0, 'a valid draft has no error');
bm.name = 'x'.repeat(61); eq(E.checkDraft(bad, { parse }).members[0].name, 'Give the member a name (1 to 60 characters).', 'a name over 60');
bm.name = 'N'; bm.role = 'r'.repeat(41); eq(E.checkDraft(bad, { parse }).members[0].role, 'Give the member a role (1 to 40 characters).', 'a role over 40');
bm.role = 'R'; bad.name = 'n'.repeat(41); ok(E.checkDraft(bad, { parse }).template.name, 'a template name over 40'); bad.name = 'T';
bad.description = 'a\nb'; ok(E.checkDraft(bad, { parse }).template.description, 'a description is one line'); bad.description = '';
bm.brief = 'l\n'.repeat(80); ok(E.checkDraft(bad, { parse }).members[0].brief, 'a brief of 81 lines');
bm.brief = 'b'.repeat(4001); ok(E.checkDraft(bad, { parse }).members[0].brief, 'a brief over 4,000');
bm.brief = 'b'.repeat(4000); eq(E.checkDraft(bad, { parse }).count, 0, '4,000 is fine');
bm.briefFrom = 'file'; bm.brief = 'b'.repeat(2001); eq(E.checkDraft(bad, { parse }).members[0].brief, 'The brief is too long: at most 2,000 characters and 40 lines.', 'a brief from a file keeps its limit of 2,000');
bm.brief = ''; bm.briefFrom = '';
bm.profile = 'bad id'; ok(E.checkDraft(bad, { parse }).members[0].profile, 'a custom agent id with a space'); bm.profile = 'team/agent_1';
eq(E.checkDraft(bad, { parse }).count, 0, 'a valid id');
bm.capUnit = 'aiu'; bm.capText = '5'; eq(E.checkDraft(bad, { parse, limits: { minAiu: 30 } }).members[0].cap, 'Use an amount from 30 to 1,000,000 AI credits.', 'a limit under the least');
bm.capUnit = 'usd'; bm.capText = '20000'; eq(E.checkDraft(bad, { parse, limits: { minUsd: 0.01 } }).members[0].cap, 'Use an amount from 0.01 to 10,000 dollars.', 'dollars over the most');
bm.capText = '2.5'; eq(E.checkDraft(bad, { parse }).count, 0, 'a dollar amount');
// two names that read the same
E.addMember(bad, 'claude'); bad.members[1].name = '  n  '; bad.members[1].role = 'R';
eq(E.sameNames(bad, 0), [1], 'the same name, trimmed and case-folded'); eq(E.checkDraft(bad, { parse }).members[0].name, 'Two members cannot have names that look the same.', 'refused at save');
bad.members[1].name = 'Ｎ'; eq(E.sameNames(bad, 0), [1], 'a full-width letter reads the same (NFKC)');

// dirty: Esc asks only when something changed
const dd = E.newDraft('claude'); const base0 = E.snapshot(dd);
eq(E.isDirty(dd, base0), false, 'a draft as it started is not dirty');
dd.members[0].name = 'x'; eq(E.isDirty(dd, base0), true, 'a typed name is');
dd.members[0].name = ''; eq(E.isDirty(dd, base0), false, 'typed and erased is not');
E.addMember(dd, 'claude'); eq(E.isDirty(dd, base0), true, 'a new member is');

// the section is shown only under the simulator until T010 (the create preview)
{
  const T = load('teams.js');
  T.init({ bridge: { teamsList: async () => ({ ok: true, templates: [] }) }, editorEnv: () => ({}) });
  eq(T.shown(), false, 'teams.js: the editor alone does not show the section in the app');
  T.init({ bridge: {}, sim: true });
  eq(T.shown(), true, 'teams.js: the simulator shows it');
}

// the payload
const pd = E.draftOf({ id: 'tid', name: 'Crew', description: 'D', members: [{ name: 'A', role: 'Dev', app: 'claude', permMode: 'ask', sendBrief: false, memberId: 'a'.repeat(32), briefFrom: 'file', brief: 'Do it', cap: { unit: 'usd', amount: 3 }, model: 'm1', effort: 'high' }, { name: 'B', role: 'QA', app: 'codex', permMode: 'read-only', sendBrief: true }] });
const pl = E.payload(pd);
eq(pl.members[0], { name: 'A', role: 'Dev', app: 'claude', permMode: 'ask', sendBrief: false, brief: 'Do it', model: 'm1', effort: 'high', cap: { unit: 'usd', amount: 3 }, memberId: 'a'.repeat(32) }, 'an existing member keeps its memberId; briefFrom is never sent');
eq(pl.members[1], { name: 'B', role: 'QA', app: 'codex', permMode: 'read-only', sendBrief: true }, 'no empty optional is sent');
eq([pl.id, pl.name, pl.description], ['tid', 'Crew', 'D'], 'template fields');
eq(E.payload(E.newDraft('claude')).id, undefined, 'a new template has no id');
ok(!('briefFrom' in pl.members[0]) && !JSON.stringify(pl).includes('briefFrom'), 'no briefFrom anywhere');
eq(E.draftOf({ members: [{ name: 5, role: {}, app: ['x'], permMode: '__proto__', cap: 'no' }] }).members[0].permMode, 'read-only', 'a field of another type is read as empty');

// which fields main refused: only the member number and a field word, never the text
const secret = 'tok' + 'en-' + 'abcdef123456';
const rf = E.refusedFields({ ok: false, code: 'invalid', errors: ['Member 2, brief, line 5: ' + secret, 'Member 1, role and brief: x', 'Member 3, memberId: y', 'Template: too many fields.', 'Member 99, name: z', 7, 'Member 2: send an object.'] });
eq([...rf.entries()].map(([i, s]: [number, Set<string>]) => [i, [...s]]), [[1, ['brief']], [0, ['brief']]], 'only known fields of members that exist');
for (const w of Object.values(E.FIELD_WORDS) as string[]) ok(!w.includes(secret), 'the fixed words hold no value');
eq(E.legendText(1, 4, 'Developer 1'), 'Member 2 of 4: Developer 1', 'the legend of FR-132');
eq(E.legendText(0, 1, ' '), 'Member 1 of 1', 'no name, no colon');
ok(E.legendText(0, 1, 'x'.repeat(100)).length < 70, 'a long name is cut in the legend');
eq(E.stateWords({ briefFrom: 'file' }, 'not-installed'), ['Brief from a file', 'App not installed'], 'state words');

// ---------------------------------------------------------------- 2. the shared rows
eq(MR.capParse(false, '', { minAiu: 30 }), { empty: true }, 'empty is no limit');
eq(MR.capParse(false, '29.99', { minAiu: 30 }), { error: 'range' }, 'under the least');
eq(MR.capParse(false, '30', { minAiu: 30 }), { amount: 30 }, 'the least');
eq(MR.capParse(false, '1000000.4', { minAiu: 30 }), { error: 'range' }, 'over the most');
eq(MR.capParse(true, '0.019', { minUsd: 0.01 }), { amount: 0.02 }, 'dollars to two decimals');
eq(MR.capParse(true, '10001', { minUsd: 0.01 }), { error: 'range' }, 'dollars over the most');
eq(MR.capParse(false, 'abc', {}), { error: 'range' }, 'not a number');
eq(MR.capSpec(true, { minUsd: 0.01 }).hint, 'Claude\'s estimate, in dollars. Empty means no limit.', 'New session\'s dollar words');
eq(MR.capSpec(false).hint, 'In AI credits. Empty means no limit.', 'New session\'s credit words');
eq(MR.capSpec(false, { template: true }).hint, 'In AI credits. Empty means your default limit.', 'a template\'s credit words (FR-002)');

const page = (): any => new JSDOM('<!doctype html><body><button id="opener">Edit</button><div id="srAnnounce"></div></body>', { pretendToBeVisual: true }).window;
{
  const w = page(); const doc = w.document;
  const p = MR.permRow(doc, { id: 'sdPerm' }); const k = MR.capRow(doc, { ids: { row: 'sdCapL', title: 'sdCapT', input: 'sdCap', hint: 'sdCapH' } });
  eq([...p.select.options].map((o: any) => o.value), ['read-only', 'ask', 'allow'], 'the permission row has the three modes');
  eq([p.select.id, k.label.id, k.title.id, k.input.id, k.hint.id], ['sdPerm', 'sdCapL', 'sdCapT', 'sdCap', 'sdCapH'], 'New session\'s ids');
  eq([k.input.type, k.input.min, k.input.step, k.input.placeholder, k.input.getAttribute('aria-describedby'), k.hint.className, k.hint.textContent], ['number', '0.001', '0.01', 'No limit', 'sdCapH', 'dhint', 'In AI credits. Empty means no limit.'], 'the limit row is the one New session had');
  eq(k.nodes.length, 2, 'label and hint');
}

// ---------------------------------------------------------------- 3. the dialog
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const CAPS: Record<string, any> = {
  claude: { models: true, effort: true, caps: true, capUnit: 'usd', permissionModes: ['read-only', 'ask', 'allow'] },
  codex: { models: true, effort: true, caps: false, permissionModes: ['read-only', 'ask'] },
  copilot: { models: true, effort: true, caps: true, permissionModes: ['read-only', 'ask', 'allow'] },
};
const KINDS = [{ id: 'claude', name: 'Claude Code', state: 'ready' }, { id: 'codex', name: 'Codex CLI', state: 'not-installed' }, { id: 'copilot', name: 'GitHub Copilot', state: 'ready' }];
const MODELS: Record<string, any[]> = { claude: [{ id: 'c-big', name: 'Big', efforts: ['low', 'high'], defaultEffort: 'low' }, { id: 'c-small', name: 'Small' }], codex: [{ id: 'x1', name: 'X one', efforts: ['low'] }], copilot: [] };

async function session(open: (env: any) => Promise<any>, o: { put?: (v: any) => any; mark?: (a: string, b: string) => any } = {}): Promise<{ w: any; doc: any; result: Promise<any>; calls: any; ask: (o: any) => any }> {
  const w = page(); const doc = w.document;
  (globalThis as any).self = globalThis; (globalThis as any).document = doc; (globalThis as any).window = w;
  (globalThis as any).DurbarMemberRows = MR;
  const ask = createDialog(doc);
  const calls: any = { put: [], mark: [], ask: [] };
  const asked = (x: any) => { calls.ask.push(x.title); return ask(x); };
  const env = {
    bridge: { teamsPut: async (v: any) => { calls.put.push(v); return o.put ? o.put(v) : { ok: true, template: v }; }, teamsMarkMine: async (a: string, b: string) => { calls.mark.push([a, b]); return o.mark ? o.mark(a, b) : { ok: true, template: {} }; } },
    askDialog: asked, announce: (t: string) => { doc.getElementById('srAnnounce').textContent = t; }, toast: () => undefined,
    refusalText: (res: any, what: string) => (res && res.code === 'changed' ? what + ' changed elsewhere.' : what + ' failed.'),
    opener: doc.getElementById('opener'),
    rows: () => ({
      kinds: () => KINDS.map((k) => Object.assign({}, k, { stateText: k.state === 'ready' ? '' : 'not installed', disabled: k.state !== 'ready', shortName: k.name })),
      kindCaps: (id: string) => CAPS[id] || null, shows: (cc: any, f: string) => DMK.shows(cc, f), ensureModels: async () => undefined, modelsFor: (id: string) => MODELS[id] || [],
      fillModelSelect: (sel: any, _cur: unknown, id: string) => { sel.textContent = ''; for (const m of MODELS[id] || []) { const op = doc.createElement('option'); op.value = m.id; op.textContent = m.name; sel.appendChild(op); } },
      fillEffortSelect: (sel: any, mid: string, _cur: unknown, off: boolean, id: string) => { const m = (MODELS[id] || []).find((x) => x.id === mid); const ef = off ? [] : (m && m.efforts) || []; sel.hidden = !ef.length; sel.textContent = ''; for (const e of ['', ...ef]) { const op = doc.createElement('option'); op.value = e; op.textContent = e || 'Effort: default'; sel.appendChild(op); } },
      fillPerm: (sel: any, cc: any) => { const modes = DMK.modesFor(cc), cur = sel.value; sel.textContent = ''; for (const m of modes) { const op = doc.createElement('option'); op.value = m; op.textContent = m; sel.appendChild(op); } sel.value = DMK.fallbackMode(cc, cur); },
      limits: { minAiu: 30, minUsd: 0.01 }, characters: () => ['punk', 'gamer', 'bob-glasses'],
    }),
  };
  const E2 = load('teameditor.js');
  const result = open(Object.assign(env, { E2 }));
  await tick(5);
  return { w, doc, result, calls, ask };
}
const q = (doc: any, s: string): any => doc.querySelector(s);
const qa = (doc: any, s: string): any[] => [...doc.querySelectorAll(s)];
const typeIn = (w: any, el: any, v: string): void => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const choose = (w: any, el: any, v: string): void => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const click = (el: any): void => el.click();
const saveBtn = (doc: any): any => qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Save template');
const cancelBtn = (doc: any): any => qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Cancel');
const closedClean = async (doc: any, s: { result: Promise<any> }): Promise<void> => { click(cancelBtn(doc)); eq(await Promise.race([s.result, tick(150).then(() => 'still waiting')]), false, 'Cancel with nothing changed closes at once'); }; // a clean editor never asks
const title = (doc: any): string => { const h = q(doc, '#modeDlg h3'); return h ? h.textContent : '(no dialog open)'; }; // a missing dialog is a failed check with words, not a TypeError
const discard = async (doc: any): Promise<void> => { await tick(10); eq(title(doc), 'Discard changes?', 'Cancel with unsaved changes asks "Discard changes?"'); const dbtn = qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Discard'); ok(dbtn, 'the question has a Discard button'); click(dbtn); await tick(10); };
const fill = (w: any, doc: any, fs: any, name: string, role: string): void => { typeIn(w, q(fs, 'input[id$="-name"]'), name); typeIn(w, q(fs, 'input[id$="-role"]'), role); void doc; };

let finished = false; // a dialog that never closes drains the event loop and would end the process with 0: say so
process.on('exit', (c) => { if (!finished && c === 0) { console.error('teams-editor: ended before the last check'); process.exitCode = 1; } });
(async () => {
  // a new template: Save on an empty form shows the fields' errors, linked with aria-describedby, and calls nothing
  {
    const s = await session((env) => env.E2.open({ mode: 'new' }, env));
    const { doc, w } = s;
    ok(q(doc, '#modeDlg .dlg.l'), 'a dialog of size l');
    eq(qa(doc, '#modeDlg fieldset.tm-mem').length, 1, 'one fieldset per member');
    eq(q(doc, '#modeDlg fieldset legend').textContent, 'Member 1 of 1', 'its legend');
    eq(doc.activeElement.id.endsWith('tname'), true, 'the focus starts on the template name');
    click(saveBtn(doc)); await tick(5);
    eq(s.calls.put.length, 0, 'nothing was sent');
    ok(q(doc, '#modeDlg .tm-ed'), 'Save with errors keeps the editor open (confirm() false)');
    const nameInput = q(doc, 'fieldset input[id$="-name"]');
    const desc = (nameInput.getAttribute('aria-describedby') || '').split(' ').map((i: string) => doc.getElementById(i)).filter(Boolean);
    ok(desc.some((e: any) => e.textContent === 'Give the member a name (1 to 60 characters).' && !e.hidden), 'the member name is linked (aria-describedby) to its error');
    eq(nameInput.getAttribute('aria-invalid'), 'true', 'and marked invalid');
    const tn = q(doc, '#tmEd-tname');
    ok((tn.getAttribute('aria-describedby') || '').split(' ').some((i: string) => (doc.getElementById(i) || {}).textContent === 'Give the template a name (1 to 40 characters).'), 'the template name is linked to its error');
    ok(/Some fields need attention: 3 fields are marked/.test(q(doc, '#tmEdErr').textContent), 'a summary in words');
    ok(doc.getElementById('modeDlg').contains(doc.activeElement) && doc.activeElement.getAttribute('aria-invalid') === 'true', 'the focus is on the first invalid field');
    typeIn(w, tn, 'Crew'); eq(tn.getAttribute('aria-invalid'), null, 'typing clears the field\'s error');
    // the tope of 8 in the window
    for (let i = 0; i < 7; i++) click(q(doc, 'button[data-act="add"]'));
    eq(qa(doc, 'fieldset.tm-mem').length, 8, 'eight members');
    eq(q(doc, 'button[data-act="add"]').disabled, true, 'Add member is disabled at 8');
    eq(q(doc, '#tmEdAddNote').textContent, 'A team has at most 8 members.', 'and says why');
    eq(q(doc, 'fieldset.tm-mem:last-of-type legend').textContent, 'Member 8 of 8', 'the last legend');
    // fill every member, remove one, move one, save
    qa(doc, 'fieldset.tm-mem').forEach((fs, i) => fill(w, doc, fs, 'Dev ' + i, 'Role ' + i));
    click(qa(doc, 'fieldset.tm-mem')[7].querySelector('button[data-act="remove"]'));
    eq(qa(doc, 'fieldset.tm-mem').length, 7, 'Remove took one out');
    ok(!q(doc, 'button[data-act="add"]').disabled, 'Add member is back');
    click(qa(doc, 'fieldset.tm-mem')[0].querySelector('button[data-act="down"]'));
    eq(qa(doc, 'fieldset legend').map((l: any) => l.textContent).slice(0, 2), ['Member 1 of 7: Dev 1', 'Member 2 of 7: Dev 0'], 'Move down reorders and renumbers');
    ok(/moved to position 2 of 7/.test(doc.getElementById('srAnnounce').textContent), 'the move is announced');
    eq(doc.activeElement.dataset.act, 'down', 'the focus stays on the button');
    click(saveBtn(doc)); await tick(5);
    eq(s.calls.put.length, 1, 'one put');
    eq(s.calls.put[0].members.map((m: any) => m.name).slice(0, 2), ['Dev 1', 'Dev 0'], 'in the order on screen');
    eq(await s.result, true, 'the editor says something was saved');
    ok(!q(doc, '#modeDlg'), 'the dialog closed');
  }

  // the limit is in the app's unit and is cleared when the app changes
  {
    const s = await session((env) => env.E2.open({ mode: 'new' }, env));
    const { doc, w } = s; const fs = q(doc, 'fieldset.tm-mem');
    eq(q(fs, 'select[id$="-app"]').value, 'claude', 'the first ready app');
    eq([...q(fs, 'select[id$="-app"]').options].map((o: any) => o.textContent), ['Claude Code (ready)', 'Codex CLI (not installed)', 'GitHub Copilot (ready)'], 'the app select says each app\'s state in words');
    const cap = q(fs, 'input[type="number"]');
    ok(/dollars/.test(q(fs, '.tm-f label[for], label').parentNode.textContent) || /dollars/.test(fs.textContent), 'claude: the unit is dollars');
    eq(cap.placeholder, 'No limit', 'dollars: empty means no limit');
    typeIn(w, cap, '5');
    choose(w, q(fs, 'select[id$="-app"]'), 'copilot');
    eq(q(fs, 'input[type="number"]').value, '', 'a limit typed for one app is gone when the app changes');
    eq(q(fs, 'input[type="number"]').placeholder, 'Default', 'AI credits: empty means your default');
    ok(/your default limit/.test(fs.textContent), 'the hint says so');
    typeIn(w, q(fs, 'input[type="number"]'), '60'); choose(w, q(fs, 'select[id$="-app"]'), 'codex');
    ok(q(fs, 'input[type="number"]').closest('.tm-f').hidden, 'an app without limits has no limit row');
    eq(q(fs, '[id$="-st"]').textContent, 'App not installed', 'an app that is not installed says so in the member\'s description');
    ok(q(fs, 'select[id$="-app"]').options[1].textContent === 'Codex CLI (not installed)', 'and in the select');
    eq(qa(fs, 'select[id$="-perm"] option').map((o: any) => o.value), ['read-only', 'ask'], 'permissions follow the app');
    choose(w, q(fs, 'select[id$="-app"]'), 'claude'); await tick(5);
    eq(q(fs, 'input[type="number"]').value, '', 'back to the first app: still empty');
    // model: App default, the list, effort follows the model, a saved model that is not offered
    const model = q(fs, 'select[id$="-model"]');
    eq([...model.options].map((o: any) => o.textContent), ['App default', 'Big', 'Small'], 'App default, then the app\'s models');
    ok(q(fs, 'select[id$="-eff"]').closest('.tm-f').hidden, 'no effort for App default');
    choose(w, model, 'c-big');
    ok(!q(fs, 'select[id$="-eff"]').closest('.tm-f').hidden, 'effort appears for a model that has efforts');
    choose(w, model, 'c-small');
    ok(q(fs, 'select[id$="-eff"]').closest('.tm-f').hidden, 'and goes for one that has none');
    ok(/Checked when the member first starts/.test(fs.textContent), 'the custom agent id has its hint');
    eq(qa(fs, 'select[id$="-char"] option').map((o: any) => o.textContent), ['Any', 'Punk', 'Gamer', 'Bob glasses'], 'the character select: Any and the kit');
    click(cancelBtn(doc)); await discard(doc); eq(await s.result, false, 'Cancel saves nothing');
  }

  // an imported template: a saved model that is not offered, the file mark, Mark as mine asks first
  {
    const t = { id: 'tid1', name: 'Imported crew', origin: 'imported', members: [{ name: 'Rev', role: 'Reviewer', app: 'claude', model: 'gone-model', effort: 'high', permMode: 'read-only', sendBrief: true, brief: 'Read it.', briefFrom: 'file', memberId: 'b'.repeat(32), cap: { unit: 'usd', amount: 4 } }] };
    const s = await session((env) => env.E2.open({ mode: 'edit', template: t }, env));
    const { doc, w } = s; let fs = q(doc, 'fieldset.tm-mem');
    eq(q(fs, 'select[id$="-model"]').value, 'gone-model', 'the saved model is selected');
    ok(qa(fs, 'select[id$="-model"] option').some((o: any) => o.textContent === 'gone-model (not offered here)'), 'marked "not offered here"');
    eq(q(fs, 'input[type="number"]').value, '4', 'the saved limit');
    ok(/Brief from a file/.test(q(doc, '[id$="-st"]').textContent), 'the file mark is in the member\'s description');
    ok(/From a file: up to 2,000 characters and 40 lines/.test(fs.textContent), 'the lower limit is shown');
    typeIn(w, q(fs, 'textarea'), 'Changed text'); // typed text must survive the question
    const mk = q(fs, 'button[data-act="mark"]'); ok(mk, 'Mark as mine is there'); eq(mk.getAttribute('aria-label'), 'Mark the brief of Rev as mine', 'and named');
    click(mk); await tick(10);
    eq(s.calls.ask, ['Edit team template', 'Mark this brief as yours?'], 'the question is asked first');
    eq(s.calls.mark.length, 0, 'nothing was marked yet');
    eq(q(doc, '#modeDlg .dsub').textContent, 'This brief came from a file. Mark it as written by you? It will be sent as your own text and may grow to 4,000 characters.', 'FR-023\'s words');
    eq(doc.activeElement.textContent, 'Keep as from the file', 'the focus starts on the safe button');
    click(cancelBtn(doc) || qa(doc, '#modeDlg .dbtn button')[0]); await tick(10);
    eq(s.calls.mark.length, 0, 'Keep: still nothing marked');
    fs = q(doc, 'fieldset.tm-mem'); ok(q(fs, 'button[data-act="mark"]'), 'the editor is back, still from the file');
    eq(q(fs, 'textarea').value, 'Changed text', 'what was typed is kept');
    click(q(fs, 'button[data-act="mark"]')); await tick(10);
    click(qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Mark as mine')); await tick(10);
    eq(s.calls.mark, [['tid1', 'b'.repeat(32)]], 'the channel is called once, with the template and the member');
    fs = q(doc, 'fieldset.tm-mem'); ok(!q(fs, 'button[data-act="mark"]'), 'the mark is gone');
    ok(/Up to 4,000 characters and 80 lines/.test(fs.textContent), 'the own limit shows');
    eq(q(fs, 'textarea').value, 'Changed text', 'the text is still there');
    click(cancelBtn(doc)); await discard(doc); eq(await s.result, true, 'a marked brief repaints the list');
  }

  // Mark as mine only on a saved member (a memberId) of a saved template (an id): never on one that lacks either
  for (const [label, t, shown] of [
    ['a saved member of a saved template', { id: 'tm1', name: 'T', members: [{ name: 'A', role: 'R', app: 'claude', briefFrom: 'file', memberId: 'd'.repeat(32), brief: 'x' }] }, true],
    ['a file brief without a memberId', { id: 'tm1', name: 'T', members: [{ name: 'A', role: 'R', app: 'claude', briefFrom: 'file', brief: 'x' }] }, false],
    ['a file brief of a template without an id', { name: 'T', members: [{ name: 'A', role: 'R', app: 'claude', briefFrom: 'file', memberId: 'd'.repeat(32), brief: 'x' }] }, false],
    ['an own brief', { id: 'tm1', name: 'T', members: [{ name: 'A', role: 'R', app: 'claude', memberId: 'd'.repeat(32), brief: 'x' }] }, false],
  ] as [string, any, boolean][]) {
    const s = await session((env) => env.E2.open({ mode: 'edit', template: t }, env));
    eq(!!q(s.doc, 'button[data-act="mark"]'), shown, 'Mark as mine for ' + label + ': ' + (shown ? 'offered' : 'not offered'));
    await closedClean(s.doc, s);
  }

  // a save that throws (the bridge rejects) is told in words, the dialog stays and what was typed is kept
  {
    const s = await session((env) => env.E2.open({ mode: 'new' }, env), { put: () => { throw new Error(secret); } });
    const { doc, w } = s; const fs0 = q(doc, 'fieldset.tm-mem');
    typeIn(w, q(doc, '#tmEd-tname'), 'Keep me'); fill(w, doc, fs0, 'Ana', 'Lead');
    click(saveBtn(doc)); await tick(10);
    ok(q(doc, '#modeDlg') && /What you typed is kept/.test(q(doc, '#tmEdErr').textContent), 'a rejected save: words, the dialog stays');
    ok(!doc.body.textContent.includes(secret), 'a rejected save: the error text is not shown');
    eq(q(doc, 'fieldset.tm-mem input[id$="-name"]').value, 'Ana', 'a rejected save: what was typed is kept');
    click(cancelBtn(doc)); await discard(doc); await s.result;
  }

  // main says changed / failed / invalid: the dialog stays, what was typed is kept, in words only
  for (const [code, extra] of [['changed', { templates: [] }], ['failed', {}], ['invalid', { errors: ['Member 1, brief: ' + secret] }]] as [string, any][]) {
    const s = await session((env) => env.E2.open({ mode: 'new' }, env), { put: () => Object.assign({ ok: false, code, errors: [], blocked: false }, extra) });
    const { doc, w } = s; const fs = q(doc, 'fieldset.tm-mem');
    typeIn(w, q(doc, '#tmEd-tname'), 'Keep me'); fill(w, doc, fs, 'Ana', 'Lead'); typeIn(w, q(fs, 'textarea'), 'My brief');
    click(saveBtn(doc)); await tick(10);
    ok(q(doc, '#modeDlg'), code + ': the dialog stays open');
    eq([q(doc, '#tmEd-tname').value, q(fs, 'input[id$="-name"]').value, q(fs, 'textarea').value], ['Keep me', 'Ana', 'My brief'], code + ': what was typed is kept');
    const note = q(doc, '#tmEdErr'); ok(!note.hidden && /What you typed is kept/.test(note.textContent), code + ': words: ' + note.textContent);
    ok(!doc.body.textContent.includes(secret), code + ': no text of main\'s errors on the page');
    if (code === 'invalid') eq(q(fs, 'textarea').getAttribute('aria-invalid'), 'true', 'invalid: the refused field is marked');
    click(saveBtn(doc)); await tick(10); eq(s.calls.put.length, 2, code + ': Save tries again');
    click(cancelBtn(doc)); await discard(doc); eq(await s.result, code === 'changed', code + ': the list is repainted only after `changed`');
  }

  // Esc: with nothing changed it closes at once; with unsaved changes it asks first (Cancel focused), Cancel keeps everything, Discard closes
  {
    const s = await session((env) => env.E2.open({ mode: 'new' }, env));
    const { doc, w } = s;
    const esc = (): void => { doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    esc(); await tick(10);
    ok(!q(doc, '#modeDlg'), 'Esc with no change closes at once');
    eq(await Promise.race([s.result, tick(100).then(() => 'still waiting')]), false, 'Esc with no change saves nothing and the editor is done');
    eq(s.calls.ask, ['New team template'], 'without a question');
    const s2 = await session((env) => env.E2.open({ mode: 'new' }, env));
    const d2 = s2.doc; const e2 = (): void => { d2.activeElement.dispatchEvent(new s2.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    typeIn(s2.w, q(d2, '#tmEd-tname'), 'Keep me'); typeIn(s2.w, q(d2, 'fieldset input[id$="-name"]'), 'Ana');
    e2(); await tick(10);
    eq(title(d2), 'Discard changes?', 'Esc with unsaved changes asks "Discard changes?"');
    eq(d2.activeElement.textContent, 'Cancel', 'the question starts with Cancel focused');
    eq(q(d2, '#modeDlg .tm-ed'), null, 'the question is the only dialog');
    e2(); await tick(10);  // Esc on the question: Cancel, the editor comes back as it was
    eq(q(d2, '#tmEd-tname').value, 'Keep me', 'Cancel: the template name is kept');
    eq(q(d2, 'fieldset input[id$="-name"]').value, 'Ana', 'and the member');
    click(cancelBtn(d2)); await tick(10);
    eq(title(d2), 'Discard changes?', 'the Cancel button of the editor with unsaved changes asks "Discard changes?"');
    click(qa(d2, '#modeDlg .dbtn button').find((b) => b.textContent === 'Discard')); await tick(10);
    ok(!q(d2, '#modeDlg'), 'Discard closes');
    eq(await s2.result, false, 'nothing saved');
    eq(s2.calls.put.length, 0, 'and nothing sent');
  }

  // a hostile name is text
  {
    const hostile = '<img src=x onerror=window.__x=1>';
    const t = { id: 't2', name: hostile, members: [{ name: hostile, role: hostile, app: 'claude', permMode: 'read-only', sendBrief: true, brief: hostile, profile: hostile, model: hostile, character: hostile, memberId: 'c'.repeat(32) }] };
    const s = await session((env) => env.E2.open({ mode: 'edit', template: t }, env));
    const { doc } = s;
    eq(qa(doc, '#modeDlg img').length, 0, 'no element came from a value');
    eq(q(doc, 'fieldset legend').textContent, 'Member 1 of 1: ' + hostile, 'the legend shows it literally');
    eq(typeof (globalThis as any).__x, 'undefined', 'nothing ran');
    await closedClean(doc, s);
  }

  // the dialog's own `custom.confirm`
  {
    const w = page(); const doc = w.document; const ask = createDialog(doc);
    let n = 0; let gate: (v: boolean) => void = () => undefined;
    const p = ask({ title: 'T', body: 'B', custom: { node: doc.createElement('div'), value: () => 'v', valid: () => true, confirm: () => (++n === 1 ? false : new Promise<boolean>((r) => { gate = r; })) }, buttons: [{ label: 'Cancel', value: null }, { label: 'Go', value: 'go', cls: 'primary' }] });
    const go = () => qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Go');
    go().click(); await tick(); ok(q(doc, '#modeDlg'), 'confirm() false keeps the dialog open');
    go().click(); await tick(); ok(q(doc, '#modeDlg') && go().disabled, 'a pending promise keeps it open, button disabled');
    gate(false); await tick(5); const back = go(); ok(!!q(doc, '#modeDlg') && !!back && !back.disabled, 'a promise of false keeps it open, button back');
    n = 1; go().click(); await tick(); gate(true); await tick(5);
    eq(((await p) as any).value, 'go', 'a promise of true closes with the value'); ok(!q(doc, '#modeDlg'), 'closed');
  }
  // a confirm() that rejects keeps the dialog open, the button usable and the form as it was (no unhandled rejection)
  {
    const w = page(); const doc = w.document; const ask = createDialog(doc);
    const field = doc.createElement('input'); field.value = 'typed';
    const node = doc.createElement('div'); node.appendChild(field);
    let mode = 'reject';
    const p = ask({ title: 'T', body: 'B', custom: { node, value: () => field.value, valid: () => true, confirm: () => (mode === 'reject' ? Promise.reject(new Error('boom')) : true) }, buttons: [{ label: 'Cancel', value: null }, { label: 'Go', value: 'go', cls: 'primary' }] });
    const go = () => qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Go');
    go().click(); await tick(10);
    ok(q(doc, '#modeDlg') && !go().disabled && field.value === 'typed', 'a rejected confirm(): open, button back, text kept');
    mode = 'ok'; go().click(); await tick(5);
    eq(((await p) as any).custom, 'typed', 'and the next try closes with the form\'s value');
  }
  // dismiss(): a promise that rejects or says false keeps it open; true or nothing closes
  {
    const w = page(); const doc = w.document; const ask = createDialog(doc);
    let answer: () => unknown = () => Promise.reject(new Error('boom'));
    const p = ask({ title: 'T', body: 'B', custom: { node: doc.createElement('div'), value: () => null, valid: () => true, dismiss: () => answer() }, buttons: [{ label: 'Cancel', value: null }, { label: 'Go', value: 'go', cls: 'primary' }] });
    const esc = (): void => { doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    esc(); await tick(10); ok(q(doc, '#modeDlg'), 'a rejected dismiss() keeps it open');
    answer = () => Promise.resolve(false); esc(); await tick(10); ok(q(doc, '#modeDlg'), 'a promise of false keeps it open');
    answer = () => false; click(cancelBtn(doc)); await tick(5); ok(q(doc, '#modeDlg'), 'false keeps it open for the Cancel button too');
    answer = () => false; doc.getElementById('modeDlg').click(); await tick(5); ok(q(doc, '#modeDlg'), 'a click on the backdrop asks dismiss(): false keeps it open');
    answer = () => Promise.resolve(false); doc.getElementById('modeDlg').click(); await tick(10); ok(q(doc, '#modeDlg'), 'a click on the backdrop: a promise of false keeps it open');
    answer = () => true; doc.getElementById('modeDlg').click(); await tick(5); eq(await p, null, 'a click on the backdrop closes when dismiss() says true'); ok(!q(doc, '#modeDlg'), 'backdrop: closed');
  }
  {
    const w = page(); const doc = w.document; const ask = createDialog(doc);
    const p = ask({ title: 'T', body: 'B', custom: { node: doc.createElement('div'), value: () => null, valid: () => true, dismiss: () => true }, buttons: [{ label: 'Cancel', value: null }, { label: 'Go', value: 'go', cls: 'primary' }] });
    const esc = (): void => { doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
    esc(); await tick(5); eq(await p, null, 'true closes with null (Escape)'); ok(!q(doc, '#modeDlg'), 'closed');
  }
  // a dialog with no custom.dismiss and no custom.confirm behaves as before (Esc and Cancel close with null, the primary button with its value), with or without `custom`
  for (const withCustom of [false, true]) {
    for (const how of ['esc', 'cancel', 'primary']) {
      const w = page(); const doc = w.document; const ask = createDialog(doc);
      const p = ask({ title: 'T', body: 'B', ...(withCustom ? { custom: { node: doc.createElement('div'), value: () => 'v', valid: () => true } } : {}), buttons: [{ label: 'Cancel', value: null }, { label: 'Go', value: 'go', cls: 'primary' }] });
      if (how === 'esc') doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      else if (how === 'cancel') click(cancelBtn(doc));
      else click(qa(doc, '#modeDlg .dbtn button').find((b) => b.textContent === 'Go'));
      const r = (await p) as any;
      eq(how === 'primary' ? r.value : r, how === 'primary' ? 'go' : null, `no hooks (custom ${withCustom}): ${how}`);
      ok(!q(doc, '#modeDlg'), `no hooks (custom ${withCustom}): ${how} closed`);
    }
  }

  // ---------------------------------------------------------------- 4. static
  const strip = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['teameditor.js', 'memberrows.js', 'teams.js']) {
    const code = strip(f);
    for (const badRe of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\b/, /\bFunction\s*\(/, /document\.write/, /createContextualFragment/, /DOMParser/]) ok(!badRe.test(code), f + ' has no ' + badRe.source);
  }
  const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  ok(/MR\.permRow\(document,\{id:'sdPerm'\}\)/.test(app) && /MR\.capRow\(document,/.test(app) && /MR\.capParse\(/.test(app) && /MR\.capSpec\(/.test(app), 'New session builds its permission and limit rows with the shared builders');
  ok(!/<select id="sdPerm">/.test(app) && !/<input id="sdCap"/.test(app), 'and no longer has its own copy of them');
  ok(/'memberrows\.js', 'teameditor\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets copies the new files');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  ok(html.indexOf('memberrows.js') > 0 && html.indexOf('teameditor.js') < html.indexOf('teams.js'), 'index.html loads them before teams.js');

  // ---------------------------------------------------------------- 6. mutants, on copies
  if (!process.env.TEAMS_EDITOR_SRC) {
    /* the source with LF line ends, then the mutation; a missing anchor is a failed check with the mutant's name, not a silent no-op */
    const mutate = (text: string, m: { name: string; from: string; to: string }): string => {
      const lf = text.replace(/\r\n/g, '\n');
      assert.ok(lf.includes(m.from), 'mutant anchor not found: ' + m.name);
      return lf.split(m.from).join(m.to);
    };
    const files = ['teameditor.js', 'memberrows.js', 'modelswitch.js', 'teams.js', 'dialog.js'];
    const mutants: { name: string; file: string; from: string; to: string; label?: string }[] = [
      { name: 'the limit is kept when the app changes', file: 'teameditor.js', from: "m.app=String(app||'');m.capText='';m.capUnit='';", to: "m.app=String(app||'');m.capUnit='';", label: 'changing the app clears the limit' },
      { name: 'Mark as mine without the question', file: 'teameditor.js', from: "const ans=await env.askDialog({title:'Mark this brief as yours?'", to: "const ans={value:'mark'};const unused=({title:'Mark this brief as yours?'", label: 'the question is asked first' },
      { name: 'Mark as mine on any answer', file: 'teameditor.js', from: "if(!ans||ans.value!=='mark')return false;", to: '', label: 'Keep: still nothing marked' },
      { name: 'no limit of 8 (canAdd)', file: 'teameditor.js', from: 'const canAdd=d=>d.members.length<MAX_MEMBERS;', to: 'const canAdd=d=>true;', label: 'the 9th cannot be added' },
      { name: 'no limit of 8 (addMember)', file: 'teameditor.js', from: 'if(!canAdd(d))return null;', to: '', label: 'addMember refuses a 9th' },
      { name: 'the Add member button stays enabled', file: 'teameditor.js', from: 'addBtn.disabled=!can;', to: 'addBtn.disabled=false;', label: 'Add member is disabled at 8' },
      { name: 'innerHTML with the name', file: 'teameditor.js', from: 'v.legend.textContent=legendText(', to: 'v.legend.innerHTML=legendText(', label: 'no element came from a value' },
      { name: 'aria-describedby dropped', file: 'teameditor.js', from: "if(ids2.length)f.control.setAttribute('aria-describedby',ids2.join(' '));else f.control.removeAttribute('aria-describedby');", to: "f.control.removeAttribute('aria-describedby');", label: 'is linked (aria-describedby) to its error' },
      { name: 'briefFrom sent to main', file: 'teameditor.js', from: "if(m.memberId!=='')o.memberId=m.memberId;", to: "if(m.memberId!=='')o.memberId=m.memberId;if(m.briefFrom)o.briefFrom=m.briefFrom;", label: 'briefFrom is never sent' },
      { name: 'Esc with changes closes without asking', file: 'teameditor.js', from: 'dismiss:()=>{if(busyNow()||!isDirty(draft,baseline))return true;', to: 'dismiss:()=>{if(true)return true;', label: 'Cancel with unsaved changes asks' },
      { name: 'the section shown in the real app', file: 'teams.js', from: 'function shown(){return !!(X&&X.sim);}', to: 'function shown(){return !!X;}', label: 'does not show the section in the app' },
      { name: 'the editor asks even when nothing changed', file: 'teameditor.js', from: 'dismiss:()=>{if(busyNow()||!isDirty(draft,baseline))return true;', to: 'dismiss:()=>{if(busyNow())return true;', label: 'Cancel with nothing changed closes at once' },
      { name: 'Mark as mine without a memberId', file: 'teameditor.js', from: "if(m.briefFrom==='file'&&m.memberId&&d.id){", to: "if(m.briefFrom==='file'&&d.id){", label: 'a file brief without a memberId: not offered' },
      { name: 'Mark as mine without a template id', file: 'teameditor.js', from: "if(m.briefFrom==='file'&&m.memberId&&d.id){", to: "if(m.briefFrom==='file'&&m.memberId){", label: 'template without an id: not offered' },
      { name: 'the status words are not painted', file: 'teameditor.js', from: "v.status.textContent=stateWords(m,st).join(' · ');", to: "v.status.textContent='';", label: 'says so in the member\'s description' },
      { name: 'the app select has no state words', file: 'teameditor.js', from: "(k.shortName||k.name||k.id)+' ('+(k.stateText||'ready')+')'", to: '(k.shortName||k.name||k.id)', label: 'says each app\'s state in words' },
      { name: 'dialog: dismiss() is never asked (Esc, Cancel, backdrop)', file: 'dialog.js', from: 'const r=custom.dismiss();', to: 'const r=true;', label: 'Cancel with unsaved changes asks' },
      { name: 'dialog: Escape bypasses dismiss()', file: 'dialog.js', from: 'e.stopPropagation();dismiss();return;}', to: 'e.stopPropagation();done(null);return;}', label: 'Esc with unsaved changes asks' },
      { name: 'dialog: the Cancel button bypasses dismiss()', file: 'dialog.js', from: "if(b.value===null&&custom&&typeof custom.dismiss==='function'){dismiss();return;}", to: '', label: 'Cancel with unsaved changes asks' },
      { name: 'dialog: confirm() false does not keep it open', file: 'dialog.js', from: "          if(r===false)return;\n        }\n        fin();", to: '        }\n        fin();', label: 'confirm() false keeps the dialog open' },
      { name: 'dialog: a promise of false from confirm() closes', file: 'dialog.js', from: 'el.disabled=false;if(ok!==false)fin();', to: 'el.disabled=false;fin();', label: 'Save with errors keeps the editor open' },
      { name: 'dialog: a rejected confirm() closes', file: 'dialog.js', from: '()=>{el.disabled=false;});return;}', to: '()=>{el.disabled=false;fin();});return;}', label: 'a rejected confirm(): open' },
      { name: 'dialog: a rejected dismiss() closes', file: 'dialog.js', from: 'r.then(ok=>{if(ok!==false)done(null);},()=>undefined);', to: 'r.then(ok=>{if(ok!==false)done(null);},()=>done(null));', label: 'a rejected dismiss() keeps it open' },
      { name: 'dialog: a click on the backdrop bypasses dismiss()', file: 'dialog.js', from: 'DURBAR_PRESS.onBackdrop(d,dismiss);', to: 'DURBAR_PRESS.onBackdrop(d,()=>done(null));', label: 'a click on the backdrop asks dismiss()' },
      { name: 'the own brief limit for a brief from a file', file: 'teameditor.js', from: 'const briefLimits=fromFile=>fromFile?BRIEF_FILE:BRIEF_OWN;', to: 'const briefLimits=fromFile=>BRIEF_OWN;', label: 'keeps its limit of 2,000' },
    ];
    // Windows checks sources out with CRLF: the anchors (some span lines) are written with LF, so the text is read with LF first (`mutate`). Shown without Windows:
    // every anchor is found in the CRLF form of its file too, and the raw CRLF text would NOT hold a multi-line anchor (the failure this guards against).
    for (const m of mutants) {
      const lf = fs.readFileSync(path.join(ROOT, 'src', 'renderer', m.file), 'utf8').replace(/\r\n/g, '\n');
      const crlf = lf.replace(/\n/g, '\r\n');
      ok(mutate(crlf, m).includes(m.to === '' ? '' : m.to), 'the anchor of "' + m.name + '" is found in a CRLF source');
      if (m.from.includes('\n')) ok(!crlf.includes(m.from), 'a multi-line anchor ("' + m.name + '") would not match the raw CRLF text: it must be read with LF');
    }
    assert.throws(() => mutate('no such text', mutants[0]), /mutant anchor not found: /, 'a missing anchor says so, with the mutant\'s name');
    let killed = 0;
    for (const m of mutants) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-editor-mutant-'));
      try {
        for (const f of files) fs.copyFileSync(path.join(ROOT, 'src', 'renderer', f), path.join(dir, f));
        const mutated = mutate(fs.readFileSync(path.join(dir, m.file), 'utf8'), m);
        // a mutant that does not compile would "die" of the syntax error, whatever it was meant to break: refuse it
        try { new vm.Script(mutated, { filename: m.file }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
        fs.writeFileSync(path.join(dir, m.file), mutated);
        const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TEAMS_EDITOR_SRC: dir }), encoding: 'utf8', timeout: 60000 });
        assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
        const first = (/AssertionError[^\n]*?: ([^\n]*)/.exec(r.stderr) || [])[1] || '(no assertion message: ' + (r.stderr.split('\n').find((l) => /Error/.test(l)) || 'silent exit') + ')';
        if (process.env.TEAMS_EDITOR_LABELS) console.log(m.name + ' => ' + first);
        assert.ok(!!process.env.TEAMS_EDITOR_LABELS || (m.label !== undefined && first.includes(m.label)), `mutant "${m.name}" must die at its own check "${m.label}", it died at: ${first}`);
        killed++;
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    assert.strictEqual(killed, mutants.length);
    console.log(`teams-editor: ${checks} checks passed, ${killed} mutants killed`);
  } else console.log(`teams-editor (copy): ${checks} checks passed`);
  finished = true;
})().catch((e) => { console.error(e); process.exit(1); });
