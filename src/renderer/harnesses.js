/* Settings > Agent apps (spec 051; called harnesses in the code): one card per agent app with its state and one next step (Install / Update / Sign in / Check again).
   Durbar runs only fixed commands from main (shown before they run); the window never names a command. Plain script, no secrets:
   a sign-in shows the vendor's own link and one-time code, and a code pasted for Claude goes straight to Claude's process. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATE = {
    ready: ['ok', 'Ready'],
    'not-installed': ['off', 'Not installed'],
    'too-old': ['warn', 'Update needed'],
    'not-signed-in': ['warn', 'Not signed in'],
    unknown: ['off', 'Unknown'],
  };
  const SETUP_KINDS = ['copilot', 'claude', 'codex'];
  /* spec 052 FR-045: which subscription each harness uses, and the account its sign-in asks for */
  const PLAN = {
    codex: 'Uses your ChatGPT plan (Plus, Pro or Team)',
    claude: 'Uses your Claude plan (Pro or Max) or an Anthropic API key',
    copilot: 'Uses your GitHub account; a free plan works',
  };
  /* spec 052 FR-056: the AI account each agent app connects, as a muted subtitle next to the card's title */
  const FOR = { codex: 'for ChatGPT', claude: 'for Claude', copilot: 'for GitHub' };
  const ACCOUNT = { codex: 'your ChatGPT account', claude: 'your Claude account', copilot: 'your GitHub account' };
  /* FR-045: a plain label for each package manager in the install dialog; the command stays visible below it */
  const MANAGER = { brew: 'Homebrew', npm: 'npm', winget: 'winget (Windows Package Manager)' };
  /* spec 052 FR-073: two plain hints for Copilot (the second only on Windows when PowerShell 7 is missing; text only, nothing is installed) */
  const COPILOT_VSCODE_NOTE = 'Signed in to Copilot in VS Code? That sign-in is separate: this signs in the Copilot CLI once, with the same GitHub account.';
  const PWSH_HINT = 'Copilot runs shell commands with PowerShell 7. Install it with winget: winget install --id Microsoft.PowerShell -e';
  /* spec 052 FR-072: a CLI installed just now may need Durbar to restart before it shows up (the new PATH is not re-read) */
  const RESTART_HINT = 'Installed? If Durbar still says Not installed, close and reopen Durbar, then choose Check again.';
  let B = null; /* the bridge */
  let onChange = () => {};

  /* the cards; `kinds` from listAdapters, `copilot` from copilotAuth (Copilot's detection itself is free of I/O, FR-007) */
  function sectionHTML(kinds, copilot) {
    const list = (kinds || []).filter((k) => SETUP_KINDS.includes(k.id));
    if (!list.length) return '';
    const cards = list.map((k) => {
      let st = k.state;
      if (k.id === 'copilot' && st === 'ready' && copilot && copilot.known && copilot.signedIn === false) st = 'not-signed-in';
      const [cls, word] = STATE[st] || STATE.unknown;
      const act = st === 'not-installed' ? 'install' : st === 'too-old' ? 'update' : st === 'not-signed-in' ? 'signin' : '';
      const label = { install: 'Install…', update: 'Update…', signin: 'Sign in…' }[act];
      const hint = st === 'ready' ? (k.version === 'sim' ? 'Simulated version.' : k.version ? 'Version ' + k.version + '.' : 'Ready to use.') : st === 'not-signed-in' ? 'Installed; sign in once to use it.' : st === 'too-old' ? (k.hint || 'This version is too old for Durbar.') : st === 'not-installed' ? 'Not on this computer yet.' : 'Durbar could not tell; try Check again.';
      return `<li class="hs-card" data-kind="${esc(k.id)}"><div class="hs-top"><span class="hs-name"><b>${esc(k.displayName || k.id)}</b>${FOR[k.id] ? `<span class="hs-for"> · ${esc(FOR[k.id])}</span>` : ''}</span><span class="hs-st hs-${cls}">${esc(word)}</span></div>
        ${PLAN[k.id] ? `<p class="scr-note small hs-plan-uses">${esc(PLAN[k.id])}</p>` : ''}<p class="scr-note small">${esc(hint)}</p>${k.id === 'copilot' && copilot && copilot.pwshMissing ? `<p class="scr-note small hs-pwsh">${esc(PWSH_HINT)}</p>` : ''}
        <div class="hs-act">${act ? `<button class="btn primary" type="button" data-hs="${act}" data-kind="${esc(k.id)}">${esc(label)}</button>` : ''}<button class="btn" type="button" data-hs="check" data-kind="${esc(k.id)}">Check again</button></div></li>`;
    }).join('');
    return `<section class="scr-sec" aria-labelledby="hsH"><h3 id="hsH" tabindex="-1">Agent apps</h3>
      <p class="scr-note">The agent apps Durbar can run. Install, update or sign in here; Durbar shows every command before it runs and never sees your password.</p>
      <ul class="hs-list">${cards}</ul></section>`;
  }

  /* a small modal in the app's dialog style; returns {root, close} */
  function modal(title, html, buttons) {
    const old = document.getElementById('hsDlg'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'hsDlg'; d.className = 'dlg-ov';
    d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="hsDlgT"><h3 id="hsDlgT"></h3><div class="dbody">${html}</div><div class="dbtn"></div></div>`;
    d.querySelector('#hsDlgT').textContent = title;
    const row = d.querySelector('.dbtn');
    let closed = false;
    const close = () => { if (closed) return; closed = true; d.remove(); };
    for (const b of buttons) { const el = document.createElement('button'); el.type = 'button'; el.className = 'btn' + (b.cls ? ' ' + b.cls : ''); el.textContent = b.label; if (b.id) el.id = b.id; el.onclick = () => b.onClick(close); row.appendChild(el); }
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); const c = buttons.find((x) => x.cancel); if (c) c.onClick(close); else close(); } });
    document.body.appendChild(d);
    const f = d.querySelector('input,select,.btn.primary') || row.lastElementChild; if (f) f.focus();
    return { root: d, close, isClosed: () => closed };
  }

  /* running an operation: progress lines, link and code; resolves when main says it is done */
  function runDialog(kind, op, name, planIndex) {
    return new Promise((resolve) => {
      const isSign = op === 'signin';
      const html = `${isSign ? `<p class="scr-note" id="hsLead">Starting the sign-in…</p>${kind === 'copilot' ? `<p class="scr-note small hs-vscode">${esc(COPILOT_VSCODE_NOTE)}</p>` : ''}<div class="hs-sign" id="hsSign" hidden><p class="scr-note">1. Open the sign-in page and sign in with ${esc(ACCOUNT[kind] || 'your account')}.</p><div class="hs-row"><button class="btn primary" type="button" id="hsOpen">Open the sign-in page</button></div><div id="hsCodeBox" hidden><p class="scr-note">2. Enter this code on that page:</p><div class="hs-row"><code class="hs-code" id="hsCode"></code><button class="btn sm" type="button" id="hsCopy">Copy</button></div></div><div id="hsPasteBox" hidden><p class="scr-note">2. After signing in, the page shows a code. Paste it here:</p><div class="hs-row"><input id="hsPaste" type="text" maxlength="512" autocomplete="off" spellcheck="false" aria-label="Code from the sign-in page"><button class="btn primary" type="button" id="hsPasteGo">Continue</button></div></div><p class="scr-note">3. Come back here. This window closes by itself when you are signed in.</p></div>` : '<p class="scr-note" id="hsLead">Installing… this can take a few minutes. A system prompt may ask for permission.</p>'}
        <pre class="hs-log" id="hsLog" aria-live="polite"></pre>${isSign ? '' : '<p class="scr-note small" id="hsTime"></p>'}`;
      const m = modal(isSign ? 'Sign in to ' + name : (op === 'update' ? 'Updating ' : 'Installing ') + name, html, [{ label: 'Cancel', cancel: true, onClick: (close) => { B.harnessCancel(); close(); } }]);
      let url = '';
      const offP = B.onHarnessProgress((p) => {
        if (p.kind !== kind || m.isClosed()) return;
        const log = m.root.querySelector('#hsLog'); if (log) log.textContent = (p.lines || []).join('\n');
        const t = m.root.querySelector('#hsTime'); if (t) t.textContent = Math.round((p.elapsedMs || 0) / 1000) + ' s';
        if (isSign) {
          if (p.url && !url) { url = p.url; m.root.querySelector('#hsSign').hidden = false; m.root.querySelector('#hsLead').textContent = 'You sign in on ' + name + '\'s own page. Durbar never sees or stores your password.'; }
          if (p.code) { const c = m.root.querySelector('#hsCode'); if (c.textContent !== p.code) { c.textContent = p.code; m.root.querySelector('#hsCodeBox').hidden = false; } }
          if (p.needsPaste) m.root.querySelector('#hsPasteBox').hidden = false;
        }
      });
      const offD = B.onHarnessDone((p) => {
        if (p.kind !== kind) return;
        offP(); offD();
        if (!m.isClosed()) m.close();
        resolve(p);
      });
      if (isSign) {
        m.root.querySelector('#hsOpen').onclick = () => { if (url) B.harnessOpenSignIn(kind, url); };
        m.root.querySelector('#hsCopy').onclick = () => { const c = m.root.querySelector('#hsCode').textContent; if (navigator.clipboard) navigator.clipboard.writeText(c).catch(() => {}); };
        m.root.querySelector('#hsPasteGo').onclick = async () => { const i = m.root.querySelector('#hsPaste'); const r = await B.harnessPaste(i.value); if (r && r.ok) { i.value = ''; m.root.querySelector('#hsLead').textContent = 'Code sent. Waiting for the sign-in to finish…'; } else m.root.querySelector('#hsLead').textContent = (r && r.error) || 'That did not work.'; };
      }
      B.harnessRun(kind, op, planIndex).then((r) => {
        if (r && r.ok) return;
        offP(); offD(); if (!m.isClosed()) m.close();
        resolve({ kind, op, ok: false, lines: [], reason: r && r.cancelled ? 'cancelled' : 'error', error: (r && r.error) || 'Could not start.' }); // spec 051 FR-004b: Cancel in the native confirmation is not an error
      });
    });
  }

  async function install(kind, op, name) {
    const p = await B.harnessPlans(kind, op);
    if (!p || !p.plans || !p.plans.length) {
      modal((op === 'update' ? 'Update ' : 'Install ') + (p && p.name || name), `<p class="scr-note">No package manager that Durbar can use was found on this computer (winget, Homebrew or npm). Install ${esc(p && p.name || name)} from its official page, then come back and choose <b>Check again</b>.</p>`,
        [{ label: 'Close', cancel: true, onClick: (c) => c() }, { label: 'Open the official page', cls: 'primary', onClick: (c) => { B.harnessOpenPage(kind); c(); } }]);
      return;
    }
    /* spec 052 FR-056: one plain sentence per way; the exact commands sit in a <details>, closed in Simple and open in Expert.
       Main still shows the exact command in its native confirmation before anything runs (spec 051 FR-004b). */
    const simple = document.body.classList.contains('simple');
    const mgr = (pl) => MANAGER[pl.manager] || pl.manager;
    /* spec 052 FR-077: each option leads with what differs (the manager); the shared words are in the lead sentence */
    const many = p.plans.length > 1;
    const tag = (pl, i) => (many && i === 0 ? ' (recommended)' : many && i === p.plans.length - 1 && pl.manager === 'npm' ? ' (last resort)' : '');
    const opts = p.plans.map((pl, i) => `<label class="hs-plan"><input type="radio" name="hsPlan" value="${i}"${i === 0 ? ' checked' : ''}> <span><b>${esc(mgr(pl))}${tag(pl, i)}</b>${pl.note ? `<small>${esc(pl.note)}</small>` : ''}</span></label>`).join('');
    const cmds = `<details class="hs-cmds"${simple ? '' : ' open'}><summary>Show the exact command</summary>${p.plans.map((pl) => `<p class="scr-note small">${esc(mgr(pl))}: <code>${esc(pl.display)}</code></p>`).join('')}</details>`;
    const choice = await new Promise((res) => {
      modal((op === 'update' ? 'Update ' : 'Install ') + p.name, `<p class="scr-note">Durbar ${op === 'update' ? 'updates' : 'installs'} ${esc(p.name)} for you. Choose how:</p>${opts}${cmds}<p class="scr-note small">It runs on your computer, as you, and asks once more before it starts. Prefer to do it yourself? <button type="button" class="linkbtn" id="hsPage">Open the official page</button></p>`,
        [{ label: 'Cancel', cancel: true, onClick: (c) => { c(); res(null); } }, { label: op === 'update' ? 'Update' : 'Install', cls: 'primary', onClick: (c) => { const v = document.querySelector('#hsDlg input[name="hsPlan"]:checked'); const i = v ? Number(v.value) : 0; c(); res(i); } }]);
      const a = document.getElementById('hsPage'); if (a) a.onclick = (e) => { e.preventDefault(); B.harnessOpenPage(kind); };
    });
    if (choice === null) return;
    const done = await runDialog(kind, op, p.name, choice);
    result(done, p.name, kind);
    if (done.ok) await signInNext(kind);
  }

  /* FR-045: after an install or update that worked, go straight to the sign-in when the harness still needs one */
  async function signInNext(kind) {
    let k = null;
    try { const list = await B.listAdapters(true); k = (list || []).find((x) => x.id === kind) || null; } catch (e) { k = null; }
    if (!k) return;
    if (k.state === 'not-installed') {
      modal((k.displayName || kind) + ' not found yet', `<p class="scr-note">${esc(RESTART_HINT)}</p>`, [{ label: 'Close', cancel: true, onClick: (c) => c() }]);
      return;
    }
    let need = k.state === 'not-signed-in';
    if (!need && kind === 'copilot' && k.state === 'ready' && B.copilotAuth) {
      try { const a = await B.copilotAuth(); need = !!(a && a.known && a.signedIn === false); } catch (e) { need = false; }
    }
    if (need) await signin(kind, k.displayName || kind);
  }

  async function signin(kind, name) {
    const done = await runDialog(kind, 'signin', name, 0);
    if (!done.ok && done.error && /not installed/i.test(done.error) && kind === 'copilot') {
      /* FR-006: Copilot signs in through its CLI; offer to install it first */
      modal('Sign in to GitHub Copilot', '<p class="scr-note">Copilot signs in through the official GitHub Copilot CLI, which is not on this computer yet. Install it first; Durbar uses it only to sign in.</p>',
        [{ label: 'Cancel', cancel: true, onClick: (c) => c() }, { label: 'Install the Copilot CLI…', cls: 'primary', onClick: (c) => { c(); install('copilot', 'install', 'the GitHub Copilot CLI').then(() => onChange()); } }]);
      return;
    }
    result(done, name, kind);
  }

  function result(p, name, kind) {
    onChange();
    if (p.ok) { toastLike((name || kind) + (p.op === 'install' ? ' is installed.' : p.op === 'update' ? ' is updated.' : ' is ready.')); return; }
    if (p.reason === 'cancelled') return;
    modal('That did not finish', `<p class="scr-note">${esc(p.error || (p.reason === 'timeout' ? 'It took too long and was stopped.' : 'It ended with an error' + (p.exitCode != null ? ' (code ' + p.exitCode + ')' : '') + '.'))}</p>${p.lines && p.lines.length ? `<pre class="hs-log">${esc(p.lines.join('\n'))}</pre>` : ''}<p class="scr-note small">You can also follow the official instructions.</p>`,
      [{ label: 'Close', cancel: true, onClick: (c) => c() }, { label: 'Open the official page', onClick: (c) => { B.harnessOpenPage(kind); c(); } }]);
  }
  let toastLike = () => {};

  /* clicks inside the Settings screen */
  function onClick(e) {
    const b = e.target.closest && e.target.closest('[data-hs]'); if (!b) return false;
    const kind = b.dataset.kind, card = b.closest('.hs-card'), name = card ? card.querySelector('b').textContent : kind;
    if (b.dataset.hs === 'check') onChange(true);
    else if (b.dataset.hs === 'install' || b.dataset.hs === 'update') install(kind, b.dataset.hs, name);
    else if (b.dataset.hs === 'signin') signin(kind, name);
    return true;
  }

  window.DurbarHarnesses = {
    init(o) { B = o.bridge; onChange = o.onChange || onChange; toastLike = o.toast || toastLike; },
    available: () => !!(B && B.harnessRun),
    sectionHTML,
    onClick,
  };
})();
