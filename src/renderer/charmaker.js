/* The AI character maker and My characters' rows (spec 096 FR-034, FR-035, FR-040..FR-042; T041, T041a, T041b, T045). A plain script: window.DurbarCharMaker in the page, module.exports in Node
   (`test:charipc` drives the login gate there). It reuses the neutral helpers of screens.js (T040), `dialog` and DurbarDialog (spec 021 FR-031); it does not depend on the theme maker.
   Everything from main or the model is data: a name goes through `esc` in markup and `textContent` in askDialog, and a description is held only while its dialog is open (D3).
   `gatedGenerate` is the renderer's only call of `bridge.characterGenerate` (`test:charipc` counts them). */
(function (root, api) {
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DurbarCharMaker = api;
})(typeof self !== 'undefined' ? self : this, (function () {
  'use strict';

  /* ---------- FR-034: the login gate. It fails closed: only the exact word `chatgpt` skips the question; only `apikey` is refused; anything else asks. ---------- */
  const API_KEY_REFUSED = 'Codex is signed in with an API key, so each picture would be charged by OpenAI. Sign in to Codex with ChatGPT to make characters.';
  const API_KEY_ASK = 'If Codex is signed in with an API key, OpenAI charges this picture. Make it?';
  const NEEDS_CODEX = 'This needs OpenAI Codex, installed and signed in with ChatGPT on this computer.';
  /* no adapter reports `imageGen` at all: installing or signing in to anything would not help, so the words must not suggest it (choice awaiting owner review, spec `## Changes`) */
  const NOT_YET = 'This version of Agent Durbar cannot make characters yet. Making pictures with Codex stays switched off until it has been tested with a real Codex. Nothing was sent and nothing was charged.';
  /* the owner's principle of 2026-10-31: warn and let the person go on; the same number as CHARACTERS_WARN_AT in src/shared/charrules.ts (test:charipc) */
  const MANY_AT = 24;
  const NOT_YET_NOTE = 'Not available in this version yet: nothing can make a character here.';
  const loginGate = (kind) => kind === 'chatgpt' ? 'go' : kind === 'apikey' ? 'refuse' : 'ask';
  /* no answer, an error or an unknown word is `unknown`. No real channel exists until probe P6 (T014) and T030a, so outside the simulator this is always `unknown`. */
  async function readLoginKind(bridge, adapterId) {
    if (!bridge || typeof bridge.characterLoginKind !== 'function') return 'unknown';
    try { const k = await bridge.characterLoginKind(adapterId); return k === 'chatgpt' || k === 'apikey' ? k : 'unknown'; } catch (e) { return 'unknown'; }
  }
  /* One try, Try again included: the kind is read now, not when the dialog opened. `confirm()` is asked when the gate says so; only its exact `true` goes on, and a throw counts as Cancel. */
  async function gatedGenerate({ bridge, description, adapterId, confirm }) {
    const gate = loginGate(await readLoginKind(bridge, adapterId));
    if (gate === 'refuse') return { state: 'refused', error: API_KEY_REFUSED };
    let confirmed = false;
    if (gate !== 'go') {
      try { confirmed = (await confirm()) === true; } catch (e) { confirmed = false; }
      if (!confirmed) return { state: 'declined' };
    }
    return { state: 'started', reply: Promise.resolve().then(() => bridge.characterGenerate(description, adapterId, { confirmed })) };
  }
  /* which of the three things the maker can say (FR-003, US1 scenario 5) */
  function availability(kinds) {
    const can = (Array.isArray(kinds) ? kinds : []).filter((k) => k && k.capabilities && k.capabilities.imageGen === true);
    const ready = can.filter((k) => k.state === 'ready');
    return ready.length ? { state: 'ready', kinds: ready } : can.length ? { state: 'needs', kinds: [] } : { state: 'off', kinds: [] };
  }
  const DEFAULT_FACE = [176, 150];
  const facePoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0 && n <= 352) ? p : DEFAULT_FACE;
  const shortFolder = (key) => String(key || '').split(/[\\/]/).filter(Boolean).pop() || String(key || '');
  const pinsOf = (pins, id) => Object.keys(pins || {}).filter((k) => pins[k] === id);

  /* ---------- the window ---------- */
  let S = null; /* {X, dialog, maker, focusIn, scrollTo} from screens.js */
  const esc = (t) => S.X.esc(t);
  const ask = () => window.DurbarDialog(document);
  const FRAMES = [['working', 'Working'], ['waiting', 'Waiting'], ['resting', 'Resting'], ['blink', 'Blink']];
  const NOTHING_ELSE = [{ label: 'Close', value: 'ok', cls: 'primary' }];

  /* FR-034's question: Cancel focused (`dialog` starts on Cancel for an amber button), Make it second */
  const askCost = async () => { const r = await S.dialog({ title: 'Make this picture?', html: `<p class="dsub" id="cmAskCost">${esc(API_KEY_ASK)}</p>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Make it', value: 'go', cls: 'primary warn' }] }); return !!(r && r.value === 'go'); };
  const say = (title, text, buttons) => S.dialog({ title, html: `<p class="dsub" id="cmSay">${esc(text)}</p>`, buttons: buttons || NOTHING_ELSE });
  const elapsed = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* one try: the gate, then the busy line with its Cancel. Resolves {cancelled|refused|declined|reply}. */
  async function runTry(description, adapterId) {
    const g = await gatedGenerate({ bridge: S.X.bridge, description, adapterId, confirm: askCost });
    if (g.state !== 'started') return g;
    let finished = false, reply = null, box = null, timer = 0;
    const started = Date.now();
    const shown = S.dialog({ title: 'Making the character', html: `<p class="dsub" id="cmBusy">Making the character… this takes about a minute per try. <span id="cmElapsed" aria-hidden="true">0:00</span></p>`, buttons: [{ label: 'Cancel', value: null }],
      onOpen: (d) => { box = d; timer = setInterval(() => { const e = d.querySelector('#cmElapsed'); if (e) e.textContent = elapsed(Date.now() - started); }, 1000); } });
    const over = g.reply.then((r) => r, (e) => ({ ok: false, error: String((e && e.message) || e) })).then((r) => { finished = true; reply = r; if (box && box._close) box._close(); });
    await shown;
    clearInterval(timer);
    if (!finished) {
      /* the person left the busy line (Cancel, Escape or a click outside): a picture that still arrives is dropped, never shown */
      try { await S.X.bridge.characterCancel(); } catch (e) { /* the reply below says what happened */ }
      await over;
      if (reply && reply.ok && reply.tryId) { try { await S.X.bridge.characterCancel(reply.tryId); } catch (e) { /* main's 10-minute limit drops it */ } }
      return { state: 'cancelled' };
    }
    return { state: 'done', reply };
  }

  /* the frames as URLs for this dialog only */
  function previewUrls(frames) {
    const urls = {};
    for (const [p] of FRAMES) if (frames && frames[p]) urls[p] = URL.createObjectURL(new Blob([frames[p]], { type: 'image/webp' }));
    return urls;
  }
  const dropUrls = (urls) => { for (const k of Object.keys(urls)) URL.revokeObjectURL(urls[k]); };

  /* FR-041: four frames at the desk's portrait size and the round crop; Discard, Try again, Save. Resolves 'again', 'discard' or {saved}. */
  async function preview(g, tries, kind, prevName, prevError) {
    const urls = previewUrls(g.frames), who = kind && kind.id === 'codex' ? 'Codex' : ((kind && kind.displayName) || 'the agent app');
    const mins = Math.max(1, Math.round((Number(g.tookMs) || 0) / 60000));
    const face = facePoint(g.face && g.face.working), vb = window.DurbarCrew && window.DurbarCrew.viewBoxAt ? window.DurbarCrew.viewBoxAt(face) : '50 20 48 48';
    const pic = (p, label) => urls[p] ? `<figure class="cm-frame"><span class="cm-pic"><img alt="${esc(label)}" width="88" height="88" src="${esc(urls[p])}"></span><figcaption>${esc(label)}</figcaption></figure>` : '';
    let name = prevName || '';
    const r = await S.dialog({ title: 'Your character', size: 'l', cls: 'cm-preview', html: `<div class="cm-frames">${FRAMES.map(([p, l]) => pic(p, l)).join('')}<figure class="cm-frame"><span class="cm-round"><svg viewBox="${esc(vb)}" width="64" height="64" aria-hidden="true" focusable="false"><image href="${esc(urls.working || '')}" x="24" y="22" width="88" height="88"/></svg></span><figcaption>Round crop</figcaption></figure></div>
        <p class="scr-note small" id="cmMade">Made in ${tries} ${tries === 1 ? 'try' : 'tries'}, about ${mins} minute${mins === 1 ? '' : 's'}, with ${esc(who)}. Nothing is saved until you press Save.</p>
        <label>Name<input id="cmName" type="text" maxlength="40" placeholder="My character" value="${esc(name)}"></label>${prevError ? `<p class="derr" id="cmSaveErr" role="alert">${esc(prevError)}</p>` : ''}`,
      buttons: [{ label: 'Discard', value: null }, { label: 'Try again', value: 'again' }, { label: 'Save to My characters', value: 'save', cls: 'primary' }],
      onOpen: (d) => { const n = d.querySelector('#cmName'); n.addEventListener('input', () => { name = n.value; });
        d.addEventListener('click', (e) => { if (e.target === d) e.stopImmediatePropagation(); }, true); } /* a stray click outside must not throw away a picture the plan already paid for */
    });
    dropUrls(urls);
    if (r && r.value === 'again') return { next: 'again', name };
    if (r && r.value === 'save') return { next: 'save', name };
    return { next: 'discard', name };
  }

  /* one flow at a time: a second press while one runs (a try may be running) does nothing, and when the flow ends the focus is back on the button */
  let flowOpen = false;
  async function openMaker() {
    if (flowOpen) return;
    flowOpen = true;
    const release = S.holdDialogs(); /* a background prompt waits for the end of the flow, so it can never cancel a try or drop a picture */
    try { await makerFlow(); } finally {
      flowOpen = false;
      const b = document.getElementById('chMake');
      if (b && !document.querySelector('.dlg-ov') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#chManage'))) S.focusIn(b); /* Manage has put it on a row */
      release();
    }
  }
  /* FR-040, FR-041: the whole flow; the description lives in this function's variable and the dialog's box */
  async function makerFlow() {
    const X = S.X;
    if (!X.bridge.characterGenerate || !X.bridge.listAdapters) { await say('Make a character with AI', NOT_YET); return; }
    let all = [];
    try { all = (await X.bridge.listAdapters()) || []; } catch (e) { all = []; }
    const can = availability(all);
    if (can.state === 'off') { await say('Make a character with AI', NOT_YET); return; }
    if (can.state === 'needs') { await say('Make a character with AI', NEEDS_CODEX); return; }
    if (await warnWhenMany()) return;
    let ideas = [];
    if (X.bridge.characterIdeas) { try { ideas = (await X.bridge.characterIdeas()) || []; } catch (e) { ideas = []; } }
    const M = S.maker, IDEA_IDS = { box: 'cmIdeas', more: 'cmMore' };
    let desc = '', kindId = can.kinds[0].id, login = {};
    for (const k of can.kinds) login[k.id] = await readLoginKind(X.bridge, k.id);
    const kindOf = (id) => can.kinds.find((k) => k.id === id) || can.kinds[0];
    const cost = (id) => M.imageCostLine(kindOf(id), login[id]);
    let tries = 0;
    form: for (;;) {
      const r = await S.dialog({ title: 'Make a character with AI', size: 'm', html: `<p class="dsub">Describe one person in a few words: how they look and what they wear. Durbar adds the office style and the poses.</p>
        <ul class="dlist ai-pts" id="cmPoints"><li>One picture, about a minute</li><li>Durbar keeps nothing from your description (Codex keeps its own copy of the picture)</li><li>Preview before saving</li></ul>
        <label>Description<textarea id="cmDesc" rows="3" maxlength="300" placeholder="A tall woman in her fifties with short grey hair, round glasses and a green cardigan">${esc(desc)}</textarea></label>
        ${M.ideaChipsHtml(ideas, IDEA_IDS)}
        ${M.harnessPickerHtml(can.kinds, kindId, 'cmKind')}
        <p class="scr-note small" id="cmCost">${esc(cost(kindId))}</p>
        <p class="scr-note small" id="cmCopies">Codex keeps its own copy of each picture it makes under <code>~/.codex/generated_images/</code>. Durbar neither reads nor deletes that folder; you can delete those copies yourself.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Make the character', value: 'go', cls: 'primary' }],
      validate: (d) => Array.from(d.querySelector('#cmDesc').value.trim()).length < 3 ? 'Describe the person in at least 3 characters.' : false,
      onOpen: (d) => { const t = d.querySelector('#cmDesc'); t.addEventListener('input', () => { desc = t.value; });
        M.wireIdeaChips(d, ideas, IDEA_IDS, t, (v) => { desc = v; }); M.wireHarnessPicker(d, 'cmKind', 'cmCost', (v) => { kindId = v; }, cost); } });
      if (!r || r.value !== 'go') return;
      let name = '', saveError = '', last = null;
      again: for (;;) {
        const t = await runTry(desc.trim(), kindId);
        if (t.state === 'cancelled') continue form; /* nothing is held: the try before it was dropped when this one started */
        if (t.state === 'declined' && !last) continue form;
        if (t.state === 'refused') { await say('Make a character with AI', t.error); return; }
        /* Cancel at the question of a Try again: nothing started, so the picture already made is still there */
        const g = t.state === 'declined' ? last : t.reply;
        if (!g || !g.ok) {
          if (g && g.cancelled) continue form;
          const e = await say('No character this time', (g && g.error) || 'Unknown error.', [{ label: 'Close', value: null }, { label: 'Try again', value: 'again', cls: 'primary' }]);
          if (e && e.value === 'again') continue again;
          return;
        }
        if (g !== last) tries++;
        last = g;
        for (;;) {
          const p = await preview(g, tries, kindOf(kindId), name, saveError);
          name = p.name; saveError = '';
          if (p.next === 'again') continue again; /* main drops the held try when the next one starts */
          if (p.next === 'discard') { try { await X.bridge.characterCancel(g.tryId); } catch (e) { /* main's limit drops it */ } return; }
          const res = await Promise.resolve(X.bridge.characterSave(g.tryId, name.trim())).catch(() => null);
          if (res && res.ok) {
            desc = '';
            await X.own.changed();
            X.toast('<b>' + esc(res.name) + '</b> is saved in My characters.' + (X.charactersChosen() === 'mine' ? '' : ' Choose My characters to see it at the desks.'), 4200);
            await paintLists();
            return;
          }
          saveError = (res && res.error) || 'The character could not be saved.';
        }
      }
    }
  }

  /* many characters: a warning, never a stop (the rows are under the list). True when the person chose not to go on. */
  async function warnWhenMany() {
    const X = S.X;
    let n = 0;
    try { n = ((await X.bridge.characterList()) || []).length; } catch (e) { n = 0; }
    if (n < MANY_AT) return false;
    const r = await say('You have many characters', 'You have ' + n + ' characters. You can make more; the list gets long, and all of them are kept in memory while they are shown. You could tidy up first.', [{ label: 'Cancel', value: null }, { label: 'Manage', value: 'manage' }, { label: 'Make another', value: 'go', cls: 'primary' }]);
    if (r && r.value === 'go') return false;
    if (r && r.value === 'manage') { const h = document.getElementById('chmH'); if (h) { S.scrollTo(h); S.focusIn(document.querySelector('#chmList button') || h); } }
    return true;
  }

  /* ---------- FR-042: the rows ---------- */
  function rowHtml(c) {
    const X = S.X, urls = X.own.urlsOf(c.id), pinned = pinsOf(X.own.pins(), c.id).map(shortFolder);
    const cur = window.exports && window.exports.DEFAULT_STYLE_ID, old = cur && c.style !== cur;
    const sub = [urls ? '' : 'Its pictures cannot be read', pinned.length ? 'Pinned to ' + pinned.join(', ') : '', old ? 'older style' : ''].filter(Boolean).join(' · ');
    const n = esc(c.name);
    return `<li class="chm-row" data-chid="${esc(c.id)}"><span class="chm-pic">${urls && urls.working ? `<img alt="" width="44" height="44" src="${esc(urls.working)}">` : ''}</span>
      <span class="chm-tx"><b class="chm-name" title="${n}">${n}</b>${sub ? `<small class="chm-sub" title="${esc(sub)}">${esc(sub)}</small>` : ''}</span>
      <span class="chm-act"><button class="btn sm" type="button" data-chact="rename" aria-label="Rename ${n}">Rename…</button><button class="btn sm" type="button" data-chact="pin" aria-label="Pin ${n} to a folder">Pin to a folder…</button><button class="btn sm" type="button" data-chact="export" aria-label="Export ${n}">Export…</button><button class="btn sm" type="button" data-chact="delete" aria-label="Delete ${n}">Delete…</button></span></li>`;
  }
  /* the list's items and the rows, from what main lists now */
  async function paintLists(keep) {
    const X = S.X, box = document.getElementById('chManage'), list = await X.own.load();
    if (S.repaintChoices) S.repaintChoices();
    if (!box) return;
    box.innerHTML = list.length ? `<h4 class="scr-sub" id="chmH">My characters <small>${list.length}</small></h4><ul class="chm-list" id="chmList">${list.map(rowHtml).join('')}</ul>` : '';
    if (keep) { const b = box.querySelector(`[data-chid="${keep.id}"] [data-chact="${keep.act}"]`); if (b) S.focusIn(b); }
    const note = document.getElementById('chMakeNote');
    if (note) {
      let all = [];
      try { all = (await X.bridge.listAdapters()) || []; } catch (e) { all = []; }
      const off = availability(all).state === 'off';
      note.hidden = !off; note.textContent = off ? NOT_YET_NOTE : '';
    }
  }

  async function renameRow(c, el) {
    const X = S.X;
    let error = '', text = c.name;
    for (;;) {
      const res = await ask()({ title: 'Rename character', body: '1 to 40 characters. The pictures and the id stay the same.', input: { label: 'Name', value: text, max: 40, focus: true, select: true, submitOnEnter: true, error }, need: { text: true }, returnFocus: el, buttons: [{ label: 'Cancel', value: null }, { label: 'Rename', value: 'ok', cls: 'primary' }] });
      if (!res || res.value !== 'ok') return;
      const r = await Promise.resolve(X.bridge.characterRename(c.id, res.text)).catch(() => null);
      if (r && r.ok) { await X.own.changed(); await paintLists({ id: c.id, act: 'rename' }); X.toast('Renamed to <b>' + esc(r.name) + '</b>.', 2600); return; }
      text = res.text; error = (r && r.error) || 'The name could not be saved.';
    }
  }
  /* a checkbox per open folder (and per pinned folder that is not open: its pin stays until it is cleared, *Edge cases*) */
  async function pinRow(c, el) {
    const X = S.X, pins = X.own.pins(), open = X.openFolders ? X.openFolders() : [], seen = new Set(open.map((f) => X.own.keyOf(f.key)));
    const others = X.own.list();
    const label = (key, nm) => { const on = pins[key]; const o = on && on !== c.id ? others.find((x) => x.id === on) : null; return { label: nm, note: o ? 'now ' + o.name : '', value: key, checked: on === c.id }; };
    const picks = open.map((f) => label(X.own.keyOf(f.key), f.name)).concat(Object.keys(pins).filter((k) => pins[k] === c.id && !seen.has(k)).map((k) => ({ label: shortFolder(k), note: 'not open now', value: k, checked: true })));
    if (!picks.length) { await ask()({ title: 'Pin to a folder', body: 'No folder is open. Add a folder first, then pin this character to it.', returnFocus: el, buttons: [{ label: 'Close', value: 'ok', cls: 'primary' }] }); return; }
    const res = await ask()({ title: 'Pin to a folder', body: 'Every session in a checked folder wears this character, whichever crew is chosen. The themes’ own figures and Minimalist draw no portraits, so pins wait there.', picks, size: 'm', returnFocus: el, buttons: [{ label: 'Cancel', value: null }, { label: 'Save pins', value: 'ok', cls: 'primary' }] });
    if (!res || res.value !== 'ok') return;
    const want = new Set(res.picked || []);
    let failed = '';
    for (const p of picks) {
      const had = pins[p.value] === c.id, on = want.has(p.value);
      if (had === on) continue;
      const r = await Promise.resolve(X.bridge.characterPin(p.value, on ? c.id : null)).catch(() => null);
      if (r && r.ok && r.pins) X.own.setPins(r.pins); else failed = (r && r.error) || 'The pin could not be saved.';
    }
    await X.own.changed();
    await paintLists({ id: c.id, act: 'pin' });
    if (failed) X.toast(esc(failed), 4200);
  }
  async function deleteRow(c, el) {
    const X = S.X, nPins = pinsOf(X.own.pins(), c.id).length;
    const res = await ask()({ title: 'Delete this character?', body: 'This removes its pictures from this computer. Desks wearing it get another character.', lines: [c.name].concat(nPins ? [nPins + ' folder pin' + (nPins === 1 ? '' : 's') + ' removed'] : []), returnFocus: el, buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'ok', cls: 'primary danger' }] });
    if (!res || res.value !== 'ok') return;
    const r = await Promise.resolve(X.bridge.characterDelete(c.id)).catch(() => null);
    if (!r || !r.ok) { X.toast(esc((r && r.error) || 'The character could not be deleted.'), 4200); return; }
    const gone = Number(r.pinsRemoved) || 0;
    const pins = Object.assign({}, X.own.pins()); for (const k of Object.keys(pins)) if (pins[k] === c.id) delete pins[k]; X.own.setPins(pins);
    await X.own.changed();
    await paintLists();
    const b = document.getElementById('chMake'); if (b) S.focusIn(b);
    const pinWords = gone ? ' ' + gone + ' folder pin' + (gone === 1 ? '' : 's') + ' removed.' : '';
    /* US2 scenario 4: the stored value stays `mine`, so a new character is used once made */
    if (X.charactersChosen() === 'mine' && !X.own.list().length) X.toast('<b>' + esc(c.name) + '</b> deleted.' + pinWords + ' You have no characters left, so the desks show the theme’s own figures until you make one.', 6000);
    else X.toast('<b>' + esc(c.name) + '</b> deleted.' + pinWords, 3600);
  }
  async function exportRow(c) {
    const X = S.X;
    const r = await Promise.resolve(X.bridge.characterExport(c.id)).catch(() => null);
    if (r && r.ok) X.toast('Exported to <b>' + esc(r.to) + '</b>.', 4200);
    else if (!(r && r.cancelled)) X.toast(esc((r && r.error) || 'The character could not be exported.'), 4200);
  }

  /* Settings painted its section: wire it. `deps`: {X, dialog, maker, focusIn, scrollTo, repaintChoices} */
  function paint(deps) {
    S = deps;
    const make = document.getElementById('chMake'), box = document.getElementById('chManage');
    if (!make || !box) return;
    make.onclick = () => openMaker();
    box.onclick = (e) => {
      const b = e.target.closest && e.target.closest('[data-chact]'), row = b && b.closest('[data-chid]');
      if (!row) return;
      const c = S.X.own.list().find((x) => x.id === row.dataset.chid);
      if (!c) return;
      if (b.dataset.chact === 'rename') renameRow(c, b);
      else if (b.dataset.chact === 'pin') pinRow(c, b);
      else if (b.dataset.chact === 'delete') deleteRow(c, b);
      else if (b.dataset.chact === 'export') exportRow(c);
    };
    return paintLists();
  }

  return { MANY_AT, loginGate, readLoginKind, gatedGenerate, availability, shortFolder, pinsOf, paint, API_KEY_REFUSED, API_KEY_ASK, NEEDS_CODEX, NOT_YET, NOT_YET_NOTE };
})());
