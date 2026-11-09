# Feature Specification: Help menu: What's new and Report a bug

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Help menu (issues #433, #521): What's new after an update from notes shipped with the app, and Report a bug as a prefilled, masked bug form the person opens; nothing sent by Durbar
status: draft
note: spec, plan, tasks; Q1..Q5 open for the owner (proposed defaults); nothing built
-->

**Feature Branch**: `107-help-whats-new-report-bug` (spec, plan and tasks only). The build is one small PR per plan phase.
**Created**: 2026-11-09
**Status**: Draft: spec, plan and tasks; not built. Nothing in `src/` changes in this PR and no dependency is added. Five questions for the owner are open (Clarifications); each has a proposed default that the plan follows until he answers.
**Input**: Two issues, decided together by the owner (Vikram, triage 2026-11-09, Telegram 06:59 UTC, recorded on both issues: "spec now, one spec together"):

- **#433 What's new** (usability pass, spec 052 round 10; +1 by Paco 2026-10-22): after an update nothing in the app says what changed. Asked: a short, dismissible note after the first launch of a new version with 3-5 lines and a link to the full notes, never on a fresh install, no network call (the notes ship with the app); and a permanent **Help > What's new** entry showing the current version's notes. Owner decision 2026-11-02: keep, spec soon.
- **#521 Report a bug** (Paco, 2026-10-22): **Help > Report a bug…** opens the repo's bug form in the browser, prefilled only with what the form asks for, shown to the person first so they can read and edit it before anything leaves the machine. No secrets, nothing automatic, no network call from the app. Owner decision 2026-11-02: "Nothing is sent automatically; the person sees it first."

Facts below are `read:` from `main` at `afb3803c9` unless they say otherwise.

## Summary

Two small items for the Help menu. **What's new**: the first start of a new version shows one calm strip with up to five lines of what changed and a *What's new* button; the same notes are always one click away in Help, the top bar's More menu and Settings > About. The text is built into the app at build time from the same source as the GitHub release notes, so it works offline. **Report a bug**: a dialog shows the short, masked text the bug form will receive (version, OS, agent app versions, optionally a masked excerpt of the last error), lets the person edit it, and only on *Open the bug form* hands one https link to the system browser. Durbar itself sends nothing.

## Existing capability check (spec 021 FR-031)

What exists and is reused, by name (`read:`):

| Need | Existing capability | Use |
|---|---|---|
| Mac Help menu | `src/main/appmenu.ts` `appMenuTemplate`, Help submenu with `HELP_LINK_LABEL` (spec 052 FR-083); `MenuActions.add()` forwards a menu click to the page | Two items added; a forwarding action like `add()` |
| Menu on Windows and Linux | None: `appMenuTemplate` returns `null` there (FR-083, on purpose). The page's top bar **More** menu (`#topMoreMenu`, `role="menu"`, holds *Keyboard shortcuts*) is the in-page home, in every OS and world | Two menu items added |
| About | `src/shared/about.ts` (`REPO_URL`, `aboutView`), Settings > About (`screens.js`, `aboutSec`), the OS About panel (`aboutPanelOptions`) | Two buttons in Settings > About; the OS panel cannot hold buttons (`[KNOWN GAP]`, FR-031) |
| Version | `app:version` IPC, `app.getVersion()`; `compareVersions` in `src/adapters/detect.ts` | Version compare for the note |
| Remembered state that is not a setting | `src/main/daily.ts` `AppState` (window, `quitAt`; one JSON file in userData; no paths or prompts) | One new field, `lastRunVersion` |
| A one-time start notice | The "Since you were away" strip (`#awayStrip`, `.notice-strip info`, `role="status"`, spec 052 FR-089) | Same strip pattern, its own element |
| Release notes | `CHANGELOG.md` (released sections) and `changelog.d/` fragments, folded **at tag time** (spec 008 FR-117..FR-120): the tagged commit does not hold its own section; `scripts/changelog.js build --release <heading> --stdout` prints it from the fragments, and fragments may carry one `Highlight:` line each (FR-173: at most five, at most 100 characters, plain-text allow-list) that becomes the release's *Highlights* block | The build writes the notes from that same output; the Highlights are the note's lines |
| Safe Markdown | `src/renderer/markdown.js` (`DurbarMD`: marked + DOMPurify, bundled, spec 016) | Renders the notes; links go through `app:openExternal` |
| External links | `app:openExternal` (http/https only, `isHttpUrl`), `shell.openExternal(REPO_URL)` for the Help link | The bug form link is opened by main with a fixed base (FR-024) |
| Masking | `src/shared/redact.ts`: `redact`, `maskSecretUrl`, `maskHomePaths`, `maskOutgoing`, `cut`, `unhide`/`HIDDEN_CHARS`; the renderer gets them as `window.DurbarRedact` (set up in `liveact.js`) | Every prefilled value (FR-020, FR-021) |
| Diagnostics text | Spec 058 FR-093 *Copy diagnostics* (`copyDiagnostics` in `screens.js`, `DurbarMcpWords.diagnostics`): masked plain text, time in UTC only, no folder or agent names, `copyText` with a toast | Same rules and the same copy helper |
| Agent app versions | `listAdapters()` → `AdapterInfo.version` (`src/shared/adapters.ts`), already in the window for Settings > Agent apps | The app versions line |
| Dialogs | `src/renderer/dialog.js` (`DurbarDialog`: focus trap, Esc, labelled) | Both dialogs |
| Public bug form | `.github/ISSUE_TEMPLATE/bug.yml`: fields `env` (OS, single line), `release` (version), `deployment` (dropdown) and others | Prefilled by field id (Q4 for agent app versions) |

Nothing found that already shows release notes in the app or builds a bug-form link (`git grep -i "whats new\|what's new\|issues/new" src` finds nothing).

## Clarifications

### Open questions for the owner (Vikram); not guessed

Each has a proposed default; the plan and tasks follow the default until he answers, and the answer is recorded here with its date.

- **Q1 Skipped versions.** A person who skips releases (v0.1.11 to v0.1.14) gets which notes? **Proposed:** the strip shows the Highlights of the version now running and says "and 2 earlier releases"; the *What's new* dialog shows the running version first, then the sections of up to four earlier releases, all shipped in the app (about 30 KB; the whole `CHANGELOG.md` is 330 KB and is not shipped). Older than that: the *All release notes* link.
- **Q2 The recent-error excerpt.** There is no app-wide error log today. What counts as "recent error", and is it on by default? **Proposed:** the last error the window showed in this run (an error toast or an agent's error line), kept in memory only, never written to disk, at most 600 characters after masking, and **off by default**: an unticked box *Include the last error (masked)* in the dialog, with the text shown under it before it is included.
- **Q3 People without a GitHub account.** **Proposed:** the dialog also has *Copy text*, which copies the same shown text (for chat or e-mail); no other channel is offered and Durbar sends nothing.
- **Q4 The public bug form.** `bug.yml` has no field for agent app versions or an error excerpt, and its `env` field is one line labelled "OS". **Proposed:** add one optional textarea `app-info` ("Agent Durbar details", description: filled in by Help > Report a bug; edit freely) to `bug.yml`; Durbar prefills `release`, `env`, `deployment` and `app-info`, nothing else. The alternative is to squeeze everything into `env` (no form change, a cramped field).
- **Q5 Where the items live on Windows and Linux.** There is no native menu there (spec 052 FR-083, on purpose). **Proposed:** the top bar's More menu (⋯) gets *What's new* and *Report a bug…*, and Settings > About gets the same two buttons; no native menu is added.

### Decided (recorded on the issues)

- 2026-11-09 (Vikram): one spec for #433 and #521.
- 2026-11-02 (Vikram, #521): nothing is sent automatically; the person sees it first.
- From the issue texts (both by owners): the note is never shown on a fresh install; no network call for the notes; the bug report is only a link the person opens; no logs, prompts, chat text, paths, folder names, tokens or session ids.

## User scenarios and testing

### User story 1: What changed after an update (P1)

Ana updates Durbar from v0.1.13 to v0.1.14. On the first start of v0.1.14, a strip above the office says "Updated to v0.1.14" with up to five short lines (the release's Highlights), a *What's new* button and a close button. She reads it, closes it, and it does not come back. A week later she opens Help > What's new and reads the full notes for v0.1.14.

**Why this priority**: the asked-for half of #433 and the problem the usability pass found.

**Independent test**: a profile whose app state says `lastRunVersion: 0.1.13`, a build that ships v0.1.14 notes: the strip appears once; after close and restart it does not.

**Acceptance scenarios**:

1. **Given** the app state says the last run was an older version, **When** the new version starts, **Then** the strip appears once with at most five lines and the buttons *What's new* and *Close* (FR-001..FR-004).
2. **Given** a fresh install (no app state file), **When** Durbar starts, **Then** no strip appears and the running version is recorded (FR-002).
3. **Given** the strip is open, **When** the person closes it, presses Esc while it has focus, or opens *What's new*, **Then** it is gone for good for this version (FR-005).
4. **Given** any version, **When** the person chooses Help > What's new (Mac menu, More menu or Settings > About), **Then** a dialog shows that version's notes with *All release notes* (FR-010..FR-013).
5. **Given** no network, **When** the dialog opens, **Then** the notes show in full; only the *All release notes* link needs the network, and only when clicked (FR-012).

### User story 2: Report a bug without leaking anything (P1)

Ben hits a bug. He chooses Help > Report a bug…. A dialog shows the text that will go to the bug form: Durbar version, OS and version, CPU, packaged or development build, the agent apps found and their versions. He can edit it. He ticks *Include the last error (masked)* after reading the masked excerpt shown under it. He presses *Open the bug form*; his browser opens GitHub's bug form with these fields filled in. He writes what happened and submits it himself.

**Why this priority**: the other half of the request; the safety rules are the point.

**Independent test**: a fake environment with a token-shaped value and a home path in the last error: the dialog text and the built link hold neither; the link starts with the fixed form address; nothing is opened before the button.

**Acceptance scenarios**:

1. **Given** the dialog opens, **Then** it shows exactly the text the link will carry, and nothing has been opened or sent (FR-020, FR-023).
2. **Given** the person edits the text, **When** they press *Open the bug form*, **Then** main masks the edited text again, builds the link to the fixed form address and opens it in the system browser (FR-024).
3. **Given** a last error that holds a token or a home folder, **Then** the excerpt shown is masked (token hidden, home as `~`), and it is left out unless the box is ticked (FR-021, FR-022).
4. **Given** the text would make the link too long, **Then** the dialog says so and shortens the error excerpt first, never cutting silently (FR-025).
5. **Given** the person presses Cancel or Esc, **Then** nothing is opened or copied.
6. **Given** *Copy text* (Q3), **Then** the same shown text is copied with a toast "Copied (masked)" (FR-026).

### User story 3: The same in every world, by keyboard and screen reader (P2)

Both items work the same in the Open office, Real office and Retro arcade, at 1440x900 and 1280x800, by keyboard and with a screen reader, on Windows, macOS and Linux.

**Acceptance scenarios**:

1. **Given** any world, **Then** the strip, both dialogs and both menu items show with that world's top bar and dialog colours, and no text below 10.5 px (FR-030).
2. **Given** a keyboard only, **Then** the More menu items are reached with the arrow keys, the dialogs trap focus and close with Esc, focus returns to where it was (FR-032).
3. **Given** a screen reader, **Then** the strip is announced once as a status, the dialogs have names, the error checkbox says what it adds (FR-033).

### Edge cases

- A downgrade (v0.1.14 → v0.1.13) or the same version: no strip; the running version is recorded.
- An existing user who updates from a version before this feature (no `lastRunVersion`, but an app state with `window` or `quitAt`): treated as an update; the strip shows. No app state at all: fresh install, no strip (FR-002).
- A pre-release (`0.1.14-test.1`): compared with `compareVersions`; a `-test` build never shows the strip (FR-003).
- A build with no notes for its version (a development build, or a release whose fragments have no Highlights): no strip; the dialog says "No notes ship with this build" and offers *All release notes* (FR-006, FR-013).
- The app state cannot be written: the strip shows, and may show again next start; no error to the person (logged in the debug sink only).
- Two Durbar windows or processes on one profile: the first start records the version; the second does not show the strip again (read the state before writing it, as `daily.ts` already does for `quitAt`).
- The demo (sample agents) and the simulator: the strip is not shown unless a dev-only flag asks for it for screenshots (FR-007).
- No agent app found: the line says "Agent apps: none found"; an unknown version reads "version not known" (as spec 058 FR-093).
- The last error holds a folder or agent name: masking does not remove names that are not secrets, so the excerpt is off by default and shown before it is included (FR-022, `[KNOWN GAP]` FR-041).
- The system has no default browser, or `shell.openExternal` fails: a toast says so and offers *Copy text*.
- An organization policy: nothing in spec 076's policy covers these items; both stay available (FR-040).

## Requirements

### Functional requirements: What's new (#433)

- **FR-001** **The note after an update.** On the first start of a version newer than the recorded `lastRunVersion`, the window shows a strip "Updated to v<version>" with the release's Highlights (at most five lines, each at most 100 characters, plain text) and the buttons *What's new* and *Close*. Built like the "Since you were away" strip (`.notice-strip info`), its own element, `role="status"`, placed with it, never covering the office. If both strips show, they stack and the office is not pushed below the fold at 1280x800 (SC-003).
- **FR-002** **Never on a fresh install.** No app state file → no strip; the running version is recorded. An app state without `lastRunVersion` but with `window` or `quitAt` counts as an update from an older version.
- **FR-003** **Only newer, only releases.** The strip shows only when `compareVersions(running, lastRunVersion) > 0` and the running version is not a `-test` build. The running version is recorded at every start (after the comparison), so a downgrade never shows it.
- **FR-004** **Skipped versions.** (Q1, proposed) the strip shows the running version's Highlights and, when releases were skipped and their notes ship, "and N earlier releases".
- **FR-005** **Shown once.** Closing the strip, Esc while it has focus, or *What's new* dismisses it for this version. It is never shown again for a version that was recorded, whatever the person did.
- **FR-006** **Nothing to say, nothing shown.** A version whose shipped notes have no Highlights shows no strip (the version is still recorded); the full notes stay in the dialog.
- **FR-007** **Simulator and demo.** The strip is never shown in the demo or the simulator, except with a `DURBAR_*` dev hook for screenshots, read through `src/main/devhooks.ts`, so a packaged build ignores it (spec 010 FR-017..FR-020). In the simulator `app:reportBug` is refused like every channel not in `SIM_OPEN_CHANNELS` (`simguard.ts`), so a driver checks the dialog, not the browser.
- **FR-010** **Help > What's new.** One action, *What's new*, opens a dialog titled "What's new in v<version>" with that version's notes. It is reached from: the Mac Help menu (above *Agent Durbar on GitHub*), the top bar's More menu on every OS (Q5), Settings > About (a button), and the strip.
- **FR-011** **The notes' text.** The dialog shows the shipped notes rendered by `DurbarMD` (safe Markdown); links open through `app:openExternal` on click only. Issue references stay as written; nothing is fetched.
- **FR-012** **Offline, shipped with the app.** The notes are a file built into the app (`dist/`) at build time; showing them makes no network call. The text is the same as the GitHub release body's section for that version: it comes from `scripts/changelog.js build --release <heading> --stdout` at the tagged commit (fragments folded at tag time), plus the released sections of up to four earlier versions from `CHANGELOG.md` (Q1). A development build ships the preview of its unreleased fragments, labelled "Not released yet".
- **FR-013** **All release notes.** The dialog ends with *All release notes* (`<REPO_URL>/releases`) and, for a released version, *This release on GitHub* (`<REPO_URL>/releases/tag/v<version>`): opened only on click, through `app:openExternal`.

### Functional requirements: Report a bug (#521)

- **FR-020** **The text, short and masked.** *Report a bug…* opens a dialog with an editable text box holding, one line each: Durbar version; packaged or development build; OS name and version and CPU architecture (`process.platform`, `os.release()`, `process.arch`); the agent apps found and their versions (`AdapterInfo.version`, "version not known" when missing). Nothing else by default: no logs, prompts, chat text, file or folder paths, folder, agent or session names, session ids, account names, environment values or tokens. Every value goes through `redact()`, `maskSecretUrl()` and `maskHomePaths()` (`src/shared/redact.ts`) and has hidden characters removed (`unhide`) before it is shown.
- **FR-021** **The last error, masked, only with an OK.** (Q2, proposed) The dialog has an unticked box *Include the last error (masked)*; under it, the masked excerpt is shown in full (at most 600 characters after masking, cut with `cut()` and saying so). Ticking it adds the excerpt to the text box; unticking removes it. No error in this run: the box is not shown.
- **FR-022** **Where the error comes from.** (Q2, proposed) The last error the window showed in this run (an error toast or an agent's error line), kept in renderer memory only, never written to disk, never sent to main except as part of the text the person chose to open or copy.
- **FR-023** **Nothing leaves before the click.** Opening the dialog opens nothing, copies nothing and makes no network call. Only *Open the bug form* (and *Copy text*, Q3) acts, once per press.
- **FR-024** **Main builds and opens the link.** The facts the page cannot know (OS release, packaged) come from main through a read-only channel, `app:bugFacts`, which returns only the FR-020 fields. The page sends the edited text through one new channel, `app:reportBug`. Main checks it is a string within the cap, masks it again with `maskOutgoing()` and `maskHomePaths()` (the person may have pasted something), builds `https://github.com/three-feathers/agent-durbar/issues/new` from `REPO_URL` with `template=bug.yml` and the form's field ids as query values (`URLSearchParams`; field ids per Q4), and opens it with `shell.openExternal`. The base address is fixed in main; the page cannot choose it. The simulator never opens the real browser (FR-007).
- **FR-025** **Length.** The link is kept under 8,000 characters. When the text would pass it, the dialog says so before the button is pressed and the error excerpt is shortened first, then the agent app lines; the person sees the final text. (GitHub's real limit is not documented: `[KNOWN GAP]`, FR-042.)
- **FR-026** **Copy text.** (Q3, proposed) *Copy text* copies the shown text (after the same masking as FR-024) with the existing `copyText` helper and a toast "Copied (masked)".
- **FR-027** **Where it is.** *Report a bug…* is reached from the Mac Help menu, the top bar's More menu on every OS (Q5), and Settings > About.
- **FR-028** **The form.** (Q4, proposed) `.github/ISSUE_TEMPLATE/bug.yml` gains one optional textarea, id `app-info`, label "Agent Durbar details", description "Filled in by Help > Report a bug in the app; edit or delete freely. Do not paste tokens, .env or session data." `release` gets the version, `env` gets the OS line, `deployment` gets "Published user-facing release" for a packaged release build and "Development or main build" otherwise, `app-info` gets the rest.

### Functional requirements: all worlds, access, platforms, limits

- **FR-030** **Every world.** The strip, both dialogs and the menu items work and read the same in the Open office, Real office and Retro arcade (the More menu and dialogs already follow `html[data-world]`), with text at least 10.5 px, forced colours readable, and no layout change in the office at 1440x900 and 1280x800 with 15 agents.
- **FR-031** **Mac.** The Help menu gets *What's New* and *Report a Bug…* above *Agent Durbar on GitHub*; their clicks are forwarded to the page as `add()` is. The OS About panel cannot hold buttons (`[KNOWN GAP]`, Electron's `setAboutPanelOptions` has no action field: `read:` its documented options).
- **FR-032** **Keyboard.** The More menu items follow its existing arrow-key and Esc handling. Dialogs use `DurbarDialog` (focus trap, Esc closes, focus returns). The strip's buttons are in tab order. No new shortcut key.
- **FR-033** **Screen reader.** The strip is `role="status"` and announced once; dialogs are labelled by their titles; the text box is labelled "Text for the bug form (you can edit it)"; the error box's label says what it adds; the link buttons say they open the browser.
- **FR-034** **Windows, macOS, Linux.** OS name and version come from a pure function with an injected environment (tested for all three from any OS). No paths in any text. `shell.openExternal` is the only way out, on all three.
- **FR-040** **Policy.** No organization policy switch hides these items in this spec (spec 076 has none); an org that needs one asks for it.
- **FR-041** `[KNOWN GAP]` **Masking is not perfect.** It hides token shapes, secret URL parts and home folders; it does not know a private project or person name. That is why the error excerpt is off by default and the person reads the text before it leaves.
- **FR-042** `[KNOWN GAP]` **GitHub's form prefill.** Prefilling issue-form fields by id through the query string, and the URL length GitHub accepts, are `read:` from GitHub's documentation only; checked on the real site in the build task, not in CI.

### Key entities

- **AppState.lastRunVersion**: the version string of the last start (no path, no name). In `daily.ts`'s app state file.
- **Shipped notes** (`dist/whatsnew.json`): `{ version, released: boolean, highlights: string[] (≤5), sections: [{ version, date?, markdown }] (≤5) }`, built at build time.
- **Bug text**: plain text, shown and editable; never stored.

## Success criteria

- **SC-001** Zero network calls from Durbar when the strip, the What's new dialog or the Report a bug dialog opens (checked by a driver that fails on any request from the window and by main's test of `app:reportBug` with a fake `shell`).
- **SC-002** A fake environment with a token shape, a secret URL, a home path and hidden characters in the last error and in the edited text: none of them appear in the built link or the copied text (unit test with mutants).
- **SC-003** The strip (with the "Since you were away" strip too) leaves the office readable with 15 agents at 1440x900 and 1280x800, in all three worlds (simulator screenshots).
- **SC-004** Fresh install, downgrade, same version, `-test` build: no strip; update: one strip, once (unit test of the pure decision).
- **SC-005** Keyboard only: both items reached and both dialogs used and closed without a mouse (driver).

## Assumptions

- The release notes and their Highlights stay as spec 008 FR-117..FR-120 and FR-173 make them; this spec reads them, it does not change how they are written.
- The daily release builds from the tagged commit, where `changelog.js build --stdout` gives the same section as the release body (`read:` `release.yml`, `scripts/release-notes.js`; to confirm in T001).
- The bug form stays in this public repository; opening it needs the person's own browser and, to submit, their own GitHub account.

## Changes

- 2026-11-09: spec, plan and tasks written (issues #433, #521). Nothing built.
