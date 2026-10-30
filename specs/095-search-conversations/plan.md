# Implementation Plan: Search every session's conversation

**Branch**: spec on `095-search-conversations`; code on `095-pN-slug` branches, one per phase | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

## Summary

A top-bar box starts a **streamed, cancellable scan in main** over the open sessions and the previous sessions of every shown folder. Main reads each session through the existing history readers (text only), masks, matches with the same fold as `DurbarSessionSearch`, and sends small batches of hits (masked excerpt, mark offsets, anchor) to the window. The window shows them in the List view area as rows plus excerpt lines; opening one uses the List row click or the existing Resume, then scrolls to the anchor. No index, nothing stored.

## Technical Context

**Language**: TypeScript (main, shared, adapters), plain-script JavaScript (renderer). No new dependency.
**Storage**: none (A1). No setting except a shortcut entry (Ctrl+Shift+F, Q2 (a)) in the existing keyboard settings.
**Processes**: none new. The Codex probe (`CodexAdapter.probe`) is the only process a scan can start, through `history()`, and only for an open Codex session (earlier Codex sessions are title only in v1, review question B); one read at a time across scans.
**Testing**: node tests (matcher and fold parity, bounded masking, scan with fake readers and a fake clock, IPC wiring on a stand-in `electron`), a simulator driver with screenshots at 1440x900 and 1280x800. 0 credits, no network.
**Constraints**: constitution III (nothing stored, masked, window sends only the query), V (10.5px, 15 agents unaffected), VI (readers' own paths), VIII (gaps).

## Code paths reused (do not add parallel versions)

| Need | Reuse | Where |
| --- | --- | --- |
| Fold, words, "every word any order" | `fold`, `terms`, `filterSessions` of `DurbarSessionSearch`; extended with `locate(text, query)` returning folded-to-original ranges, same file | `src/renderer/sessionsearch.js` |
| Fold in main | the same functions, loaded by main as a CommonJS module (T010 decides how: a tiny `src/shared/` copy with a parity test is the fallback; see Risks) | `src/main/convsearch.ts` |
| List view, rows, sort, J/K, click | `renderList()` cell helpers (`row0`), `setView`, `#list`, the row click handler | `src/renderer/app.js:1826, 3827` |
| Previous sessions of a folder, names, hides | `listPreviousOp` pieces: `previousSessionsOf`, `openIdsOf`, `marksFor`, the user's names | `src/main/prevsessions.ts:46-80`, `src/adapters/router.ts:108` |
| Content readers | `historyOf` / `AgentAdapter.history` (open sessions), `claudeHistoryFromText` fed by a new async streamed line reader for earlier Claude sessions (not `readClaudeHistory`'s `readFileSync`), `codexHistory` (open Codex), `readChat` + `toTranscript` | `src/adapters/router.ts:115`, `claudeHistory.ts:187`, `codexHistory.ts:55`, `vscodeChat.ts:538,426` |
| Text-only, uncapped read | a `HistoryLimits` option `textOnly` and a larger `maxItems` for search only (default and replay unchanged) | `src/adapters/history.ts:123-131`, `claudeHistory.ts:86`, `codexHistory.ts:55` |
| Open a result | `sessions:resume`, `vschat:read`, the List row click | `src/main/ipc/previous.ts:65,121`, `app.js` |
| Masking | the replayed-history masking: `maskHistory` = `maskMcpHistory(h, mcp.secretValuesFor(id))` (`main.ts`, spec 058 FR-067) with `maskMcpText` for message text, then `redactMarkdown`, then `maskHomePaths` (main); `DurbarSafeText` order rule (mask before cut) | `src/shared/redact.ts:150,172,1210`, `src/renderer/safetext.js` |
| Progress throttle | the setup runner's 250 ms gap and `lastLines` pattern | `src/main/harnesssetup.ts` (`harness:progress`) |
| IPC guard, simulator | `ipcHandle`, `SIM_OPEN_CHANNELS`, `sim.ts` bridge fake | `src/main/ipcguard.ts`, `simguard.ts:28`, `src/renderer/sim.ts` |
| Palette / shortcuts / keyboard sheet | palette actions, `KEYS`, Settings > Keyboard, and `TAKEN` / `SAVED_BEFORE` in the navigator's key recorder | `app.js:3128, 3462`, `src/renderer/navigator.js:160,215` |
| Scroll and focus | `innerscroll.js` helpers (no bare `scrollIntoView`, spec 052 FR-176) | `src/renderer/innerscroll.js` |

## Data flow

1. Window: box input, 250 ms pause, the minimum of FR-033 met, `setView('list')` (remember the previous view), `bridge.convSearchStart(query)`. A stale `searchId` is ignored.
2. Main `search:start` (`fromApp`): validate the query (FR-033), cancel any scan, build the **plan** from its own state: open agents (`agents`, floors on, helpers left out), their folders, `previousSessionsOf` per folder (cached for the scan, deduplicated by (adapter, folder, session id), hidden sessions left out), VS Code `listChats` per folder. The top-bar folder filter is not used. Count the sessions = `total`.
3. Scan loop (`src/main/convsearch.ts`, deps injected: clock, `yield`, readers, masker): for each session, mask the title and check it, then (Claude/VS Code/open sessions only; Copilot and Codex earlier sessions stop at the title) read text-only (Claude earlier: streamed line by line), window each raw hit, mask, re-match, build excerpt and `head`, push to the batch. Yield every 15 ms; flush a batch every 250 ms or 20 hits; check the cancel flag between sessions and between messages.
4. Main sends `search:batch` and `search:done` with the notes (FR-014) to the window that started the scan.
5. Window renders groups and rows (`src/renderer/convsearch.js`, pure builders + a small DOM part); a click or Enter opens the session (existing paths) and then calls `jumpToAnchor({n, head})`; at `search:done` the group is re-sorted newest first, keeping the focused or hovered row in place.

## Performance approach (A1)

Streamed scan, no index. Per FR-022: one session read at a time, a 15 ms slice, 250 ms batches, caps (400 sessions, 200 per folder, 20 000 characters per message, Claude 50 MB per file, 60 s). Cheap first: titles, then open sessions (memory), then Claude/VS Code files (local reads, Claude streamed so a large file is never held whole); an open Codex session is the only read that can start a process, one at a time across scans. Messages are matched on folded text first; masking runs only on the window around a raw hit, so the cost is proportional to the hits, not to the corpus. Typing cancels the previous scan; there is no caching between queries (an in-memory cache of folded text would hold conversation text; refused in v1). If real timings are poor, the answer is a separate spec for an index (Q6), with its own location, content and a Clear button.

## Risks and how the plan answers them

- **Fold lives in a renderer script.** Main cannot import `src/renderer/sessionsearch.js` through `tsc`. T010 tries a `require` of the file from `dist` (the build copies renderer files; `scripts/test-sessionsearch.ts` already requires it from the source tree) and, if the packaged app does not carry it in a path main can reach, falls back to a `src/shared/foldtext.ts` copy plus a parity test over a corpus (accents, `ß`, `İ`, combining marks, emoji, Turkish dotless i, Hangul). Same model as `DurbarSafeText` / `redactMarkdown`.
- **Offsets after folding.** NFD and lower-casing change string length; `locate` keeps an index array per folded unit and maps back to UTF-16 offsets of the original; cut at code point boundaries, never inside a surrogate pair.
- **Secrets under the match.** Masking is the replayed-history masking (MCP secret values, then `redactMarkdown`, then home paths) and runs on a window, widened to whitespace, then the query is re-checked on the masked window; a hit that no longer matches is dropped (A2). Tests plant tokens, an MCP secret value, URL passwords and home paths at the edge of the window, glued to Markdown (`x**ghp_...**`, the PR #614 case), and split across the window boundary.
- **Copilot and Codex previous content.** No content read for earlier sessions in v1 (Q4 (a), review question B): they are searched by title only and the end state says so.
- **Anchor honesty.** `head` is built after the full masking with one `anchorKey` (masked text, Markdown stripped, `fold`) shared by main and the window; `jumpToAnchor` compares the message head; a mismatch shows the "older than the chat shows" note instead of scrolling to a wrong message.
- **Simulator.** The faked bridge serves a corpus with no I/O; `SIM_OPEN_CHANNELS` is unchanged; `test:simguard` stays green.

## Phases (one PR each; the spec PR is phase 0)

0. Spec (this PR).
1. **Pure core and readers**: matcher/locate, text-only option on the readers, masker pipeline, the scan loop with fakes. No UI, no IPC. Everything node-tested.
2. **IPC and main wiring**: the three channels, validation, scope from main, notes, bridge and `DurbarApi` types, simulator fake. Node IPC tests.
3. **Window**: box, view switch, results view, excerpts, keyboard and live region, open and jump, palette entry, shortcut (and its `TAKEN` entry), driver and screenshots, and the docs that ship the feature (README feature line and *Safety model*, keyboard sheet, changelog fragment).
4. **Close-out**: other docs pages and site gallery, specs-index status, converge, `real:` checks by the owner (macOS/Windows paths, a real store).

## Testing

1. `test:sessionsearch` extended: `locate` corpus (accents, case, any order, offsets, surrogate pairs, empty, long), `fold('ß') === 'ß'` (no match with "ss") and `fold('İ') === 'i'`, `anchorKey` cases, parity of main's fold and the renderer's.
2. `test:convsearch` (new): scan with fake readers for the four kinds: tool output never matches (D2), title-only match (masked title), every-word rule, minimum query, caps (400 / 200 / 20 000 / 60 s with a fake clock), cancel between sessions, two quick scans leave one Codex read in flight, no kept transcript (readers' fake counts reads), batches (size, 250 ms), notes (not installed, too large, floors off, hidden, title-only), duplicates by (adapter, folder, session id), helpers and sidechains not searched, order newest first per folder while scanning and re-sorted at done keeping the focused row.
3. Masking: secret fixtures (including an MCP secret value) at the window edge, glued to Markdown, in URL userinfo, in a home path; no secret, no home path and no full path anywhere in a batch (walk every string); fail closed when the masker throws.
4. IPC: not `fromApp` refused; query bounds and the 3-character minimum ("a bc" allowed, "x y" refused, code points counted); stale `searchId` ignored; two starts leave one scan; the window cannot name a folder or path; no `search:*` on the MCP tool list or remote control; `SIM_OPEN_CHANNELS` unchanged; no network import (source test of the module's imports).
5. Driver `scripts/shots-095.js` (waits with `until()`): type, view switches, results with marks, Enter opens at the message (open session and a resumed one on the fake backend), Escape returns, empty state, "Searching, N of M sessions" with a slow fake, end-state notes; 15 agents at both sizes unchanged with an empty box; screenshots.
6. Mutations to plant (listed in the PR): drop the tool-output filter, match raw text instead of masked, cut before masking, skip the cancel check, remove the query bound, send the raw excerpt, forget to ignore a stale `searchId`, jump without comparing the head.
