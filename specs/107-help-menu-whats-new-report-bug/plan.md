# Implementation Plan: Help menu: What's new and Report a bug (spec 107)

**Branch**: `107-help-whats-new-report-bug` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

## Summary

Two small Help items, built in three small PRs. The notes are made into `dist/whatsnew.json` at build time from the same output that writes the GitHub release body, so the app never fetches them. The bug report is a dialog of short, masked, editable text; main re-masks it and opens one fixed-base https link in the system browser. Q1..Q5 (spec, Clarifications) were answered by the owner on 2026-11-09 with the proposed defaults; this plan follows them.

## Technical context

- **Language**: TypeScript in `src/main` and `src/shared`; plain JS in the renderer (`src/renderer/*.js`); Node scripts in `scripts/`.
- **Dependencies**: none new. `marked` and DOMPurify (already bundled for the chat) render the notes.
- **Storage**: one field in `daily.ts`'s app state file (`lastRunVersion`). No setting, no new file in userData.
- **Testing**: `npm test` units (pure functions with injected environment), simulator drivers at 1440x900 and 1280x800, mutants for the masking and the version decision. Zero AI credits.
- **Platforms**: Windows, macOS, Linux; the Mac menu is the only native part.

## Design

### D1 Notes at build time (T001)

`scripts/whatsnew-build.js` (new, called from `npm run build` after `copy-assets.js`) writes `dist/whatsnew.json`:

- running version from `package.json`;
- `released`: true when `CHANGELOG.md` already has `## v<version>` or the build runs for a tag (`GITHUB_REF_TYPE=tag`, a default Actions variable; `release.yml`'s package jobs check out the tag, `read:` line 86);
- the running version's section: at a tag, `changelog.js`'s `build({ release, dryRun: true })` (the same function `--stdout` uses, so the text equals the release body section); otherwise the released section from `CHANGELOG.md`, or for a development build the unreleased preview labelled "Not released yet";
- `highlights`: the `highlights(frs)` of that section's fragments (spec 008 FR-173, already plain text from an allow-list, at most five);
- up to four earlier released sections from `CHANGELOG.md` (Q1).

The file is capped (64 KB) and the script fails the build if the cap is passed or the JSON does not parse back. No network. It reuses `changelog.js`'s exported functions rather than parsing Markdown twice; if they are not exported, T001 exports them (no behaviour change in `changelog.js`). **Check in T001**: that `release.yml`'s package jobs build from the tagged commit with its fragments still present (`read:` today; fold happens after the tag, FR-117..FR-120).

### D2 The note and the dialog (T002)

- **Main**: `src/main/whatsnew.ts` (pure): `shouldShowNote({ state, running, notes })` returns `{ show, skipped }` per FR-002..FR-006 using `compareVersions`. `main.ts` reads the app state, decides, then writes `lastRunVersion` (read before write, as `quitAt`). IPC: `app:whatsNew` returns `{ note?: {...}, notes }` from the shipped file read once with `readCapped`-style size check; the page never reads files.
- **Renderer**: `src/renderer/whatsnew.js` (new, plain script): the strip (built like `#awayStrip`, its own `#newStrip`), the dialog through `DurbarDialog`, notes through `DurbarMD`, links through `app:openExternal`.
- **Entries**: Mac Help menu (`appmenu.ts`: `MenuActions.help(kind: 'whatsnew' | 'bug')` forwarded to the page as `add()` is); More menu items in `index.html` `#topMoreMenu`; two buttons in Settings > About (`screens.js`, `aboutSec`).
- Dev hook `DURBAR_WHATSNEW_FROM=<version>` (through `devhooks.ts`) to show the strip in the simulator for screenshots.

### D3 Report a bug (T003)

- **Shared, pure**: `src/shared/bugreport.ts`: `bugFacts({ version, packaged, platform, release, arch })` → `{ release, env, deployment }` (the three values main fills, FR-028; the `deployment` strings are the `bug.yml` option texts); `osLine(env)` per platform (injected); `appInfoText({ apps, error? })` → the editable box's starting text; `maskBugText(text, env)` (FR-029: `unhide`, `redact`, `maskSecretUrl`, `maskHomePaths`, `maskOutgoing`; idempotent); `bugFormUrl(facts, appInfo)` → `{ ok: true, url } | { ok: false, reason: 'too-long', over }` from `REPO_URL` + `/issues/new`, `template=bug.yml` and exactly the four ids of FR-028 through `URLSearchParams`, measuring `url.href.length` (encoded) against `BUG_URL_MAX = 8000` (FR-025); it never cuts. Masking only through `redact.ts`; no local patterns.
- **Main**: `app:reportBug` (`ipcHandle`, in `src/main/ipc/app.ts` next to `app:openExternal`) takes **one string, the edited `app-info` text**, nothing else. It refuses a non-string or one longer than `MASK_INPUT_MAX` (`{ ok: false, reason: 'too-big' }`, FR-035) before masking; runs `maskBugText`; if that changed the text, returns `{ ok: false, reason: 'remasked', text }` and opens nothing (FR-024); otherwise computes `bugFacts(...)` itself (it never takes them from the page), calls `bugFormUrl`, returns `too-long` without opening when over `BUG_URL_MAX`, else calls `shell.openExternal` once. Not in `SIM_OPEN_CHANNELS`. `app:bugFacts` returns the same `bugFacts(...)` and the agent app list, read-only, only for display.
- **Renderer**: `src/renderer/bugreport.js`: the dialog (three read-only lines for `release`, `env`, `deployment`; the editable *Agent Durbar details* box; the error box per Q2; a live encoded-length line from `bugFormUrl`, disabling *Open the bug form* over `BUG_URL_MAX` and both buttons over `MASK_INPUT_MAX`; *Open the bug form*; *Copy text* per Q3 with `copyText`; Cancel). It shows main's `remasked` text and `too-long`/`too-big` answers in place. The shared functions reach the page the way `redact.ts` does (`window.DurbarRedact`, `liveact.js`). The last error: a small in-memory ring of one entry, set where error toasts and agent error lines are shown (`X.toast(...).classList.add('err')` call sites and the agent error status), never persisted.
- **Form (T005, its own PR)**: `.github/ISSUE_TEMPLATE/bug.yml` gains the optional `app-info` textarea (Q4), with no `validations` block (not required) and no other change. `/.github/` is in `CODEOWNERS` (`@vikramgorla @fjcabello @rubenlupi`) and the `main` ruleset requires a Code Owner approval, so this PR needs an owner's review (AGENTS.md, Reviews and merge) and an agent does not merge it on its own or another agent's approval. It lands before T003 so the prefilled `app-info` has a field to fill.

### D4 Tests for the masking path (T003)

`scripts/test-bugreport.ts` (in `npm test`), test first:

- **Stability (FR-029)**: for every fixture (token shapes, secret URL, home paths on all three OS, hidden characters, `[redacted]`, `[redacted:GITHUB_TOKEN]`, `~/x`, mixed), `maskBugText(maskBugText(x)) === maskBugText(x)` (assert text "re-masking changed already-masked text"), and the masked text never holds the original secret ("re-masking revealed a hidden value").
- **Re-introduced secret (FR-024, FR-029)**: page text masked once, then a token and a home path appended: `app:reportBug` with a fake `shell` returns `remasked`, the returned text holds neither, `shell.openExternal` is not called ("edited secret reached the link").
- **Fields (FR-028)**: the built URL's query has exactly `template`, `release`, `env`, `deployment`, `app-info`; values for the first three equal `bugFacts(...)` whatever string the page sends, including one shaped like `release=v9&env=x` ("page changed a main-filled field"); every id exists in `bug.yml` and `app-info` has no `required` ("bug.yml app-info must stay optional").
- **Length (FR-025, FR-035)**: a text whose raw length is under `BUG_URL_MAX` but whose encoded link is over (non-ASCII) is `too-long` ("length counted before encoding"); over the limit nothing is opened and the text is unchanged ("person's text was cut"); over `MASK_INPUT_MAX` is `too-big` with no masking call.
- **Mutants** (each must fail on its named assert, not on a compile error or a missing script): main skips `maskBugText` (re-introduced secret); a masking step that re-wraps `[redacted]` or re-masks `~` (stability); `bugFormUrl` measures the raw text instead of `href` (encoded length); `bugFormUrl` cuts instead of refusing (person's text cut); main takes `release` from the page (main-filled field).

## Existing capability check (spec 021 FR-031)

Reused: `appMenuTemplate` and `MenuActions`, `#topMoreMenu`, Settings > About (`aboutSec`), `REPO_URL`, `app:version`, `compareVersions`, `daily.ts` app state, the `#awayStrip` pattern, `changelog.js` (`build`, `highlights`), `DurbarMD`, `DurbarDialog`, `app:openExternal`/`isHttpUrl`, `copyText`, `redact.ts` masks, `listAdapters()` versions, `devhooks.ts`, `simguard.ts`. New: three IPC channels (`app:whatsNew` and `app:bugFacts`, both read-only, and `app:reportBug`), two renderer scripts, one shared module, one build script. No existing channel opens a fixed-base link with masked text, so `app:reportBug` is new rather than a widening of `app:openExternal`.

## Constitution check

- **I** Spec, plan and tasks first (this PR); no `src/` change here.
- **II** No adapter types: agent apps appear only through `AdapterInfo` (id, version).
- **III** Nothing sent by Durbar; the link is opened only on the person's click, after they saw the text; main re-masks; no secrets, paths or names; the error excerpt off by default and memory only; IPC validated in main; no shell spawn.
- **IV** Simulator and unit tests only; the one real check (GitHub's prefill on the live site, FR-042) opens a browser page and spends no AI credits.
- **V** Strip and dialogs at 10.5 px or more, both sizes, three worlds, no motion added; status not by colour alone.
- **VI** Pure OS line with injected environment; `shell.openExternal` on all three; the Mac menu is the one native part, with the More menu doing the same job elsewhere.
- **VII** Typecheck, build, test; screenshots at both sizes; mutants on masking and the version rule.
- **VIII** `[KNOWN GAP]`s: FR-031 (OS About panel), FR-041 (masking limits), FR-042 (GitHub prefill and length unverified until T003's real check); no Windows or macOS run claimed.

## Phases

| Phase | PR | Tasks | Size (estimate) | Gate |
|---|---|---|---|---|
| P1 | Notes at build time | T001 | About 120 lines | Q1 default; fold timing checked |
| P2 | Strip, dialog, entries | T002 | About 250 lines | P1 |
| P3a | `bug.yml` `app-info` field | T005 | About 5 lines | Owner (Code Owner) review; not merged by an agent alone |
| P3 | Report a bug | T003 | About 300 lines | T005 merged; three-agent security review |
| P4 | Docs, pictures, converge | T004 | Small | P2, P3 |

## Risks

- **Fold timing**: if a tag build does not have its fragments, the shipped notes would be empty. T001 checks `release.yml` first and fails the build loudly rather than shipping empty notes for a tag.
- **Masking gaps**: names are not secrets to the masker; the defaults (error off, text shown first) carry this.
- **Form drift**: if someone renames a `bug.yml` field id or a `deployment` option, the prefill silently drops it. T003 adds a test that reads `bug.yml` and checks every id `bugFormUrl` uses exists, every `deployment` string `bugFacts` returns is an option, and `app-info` is not required (D4).

## Complexity tracking

None.
