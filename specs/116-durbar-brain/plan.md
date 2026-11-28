# Implementation Plan: Durbar brain, the Office memory (spec 116)

**Branch**: `116-durbar-brain` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Issue**: #1962

## Summary

One folder of the person's own (for example a git repo `durbar-brain`) is linked in Settings > Office memory. It is off by default and main validates it (FR-004). While it is on, every session of every agent app gets the folder as an **extra read-only root**. The broker's existing `allowReadPaths` list approves reads there in Read-only and denies writes. The agent learns about the folder from a short framed **memory note** in front of the person's first message. Durbar writes only inside `<memory>/durbar/`: a metadata-only chat index `chats.md`, masked, git-ignored by default. Each entry carries an opaque chat key. A `durbar://chat/<key>` link clicked inside Durbar opens that chat. OS registration of the scheme comes in a later phase (P4). Durbar never runs git, never reads the person's other files, and never touches anything outside `durbar/`.

All references are to `116-durbar-brain` at `72281af6f` (2026-11-20); `src/` is unchanged from `origin/main` `5b52cd95c`. Line numbers are a snapshot: each build task re-checks every reference by its function name.

## Technical context

- **Language**: TypeScript in main, shared and adapters; plain JS UMD in the renderer. No new runtime dependency. P4 adds only `electron-builder` configuration (`protocols`) and Electron's own APIs.
- **Storage**:
  - three settings in `<userData>/durbar-settings.json` (`SettingsStore`): `memoryFolder`, `memoryOn`, `memoryKeepInGit`;
  - a new key store `<userData>/durbar-memory-keys.json` (0600, temp then rename);
  - the index `<memory>/durbar/chats.md`, plus `durbar/.gitignore` and the marker `durbar/.durbar-owned`.
- **Testing**: `scripts/test-*.ts` unit tests with an injected fs, a fake clock and the fake adapter, each with named mutants for every security rule. Simulator drivers at 1440x900 and 1280x800. No real session in CI; the `real:` checks T030..T032 need the owner's OK.
- **Platforms**: Windows, macOS and Linux. All path logic lives in pure functions taking `path.win32` or `path.posix` and an injected `realpath`/`lstat` (constitution VI).
- **Constraints**: constitution II (one neutral `StartOptions` field; vendor specifics stay inside each adapter), III (Read-only default, no secrets, main validates, no shell), V (10.5 px, 15 agents) and VIII (`[KNOWN GAP]` until the real checks).

## Constitution check

| Principle | How this plan meets it |
|---|---|
| I Spec Kit | Spec committed (ddcbcb62b, clarify 72281af6f); this plan and `tasks.md` come before any `src/` change; each phase's PR ticks its tasks and converges the spec. |
| II Adapters are plug-ins | One neutral field `StartOptions.readOnlyFolders`. Each adapter maps it inside itself: broker `allowReadPaths`; Claude Code also its `PreToolUse` read roots; Copilot and Codex runtime options only if research R1 and R2 show they are needed. No vendor type in renderer or `src/shared` (T006). |
| III Safe by default (non-negotiable) | Off by default; the folder is picked by main's own dialog, never sent as a path from the window. Refused folders (FR-004); reads only; Durbar writes only `durbar/` (checked writes); no process, no network. Every text written goes through `maskOutgoing`, then `cut`, then escape, with `maskTokenShapes` as a backstop. Links go through an exact grammar and are never handed to the OS. Allow all is stated, not changed (Q12). |
| IV No AI credits in tests | Fake adapter, simulator fakes for `memory:*`, temp folders; T030..T032 real checks only with Ruben's OK. |
| V Calm UI | One Settings section, one small dialog, menu items, one *Memory note sent* line; nothing on the office floor; drivers at both sizes in three worlds. |
| VI Parity | Pure containment checks tested with `path.win32` and `path.posix` from any OS; 0600 only where modes exist; junctions handled through `lstat` (Node docs; Windows unverified by a person); P4 per-OS registration planned by a pure function with an injected platform. |
| VII Quality gates | Tests per task; screenshots for P1 and P2 UI; README and limits docs in each phase. |
| VIII Honest limits | `[KNOWN GAP]`s: the agent apps' own reads outside their folder (T030..T032), P4 registration on macOS and Windows, prompt injection by the person's own files, Allow all writes. |

No violation; *Complexity tracking* is empty.

## Existing capability check (spec 021 FR-031)

| Need | Reused (path:line) | Change |
|---|---|---|
| Extra read-only folder per session | `PermissionBroker.allowReadPaths` (`src/adapters/permissions.ts:333`), `extraRoots` read in `readReason` and `readIsOutside` (`:338-350`); broker built in Copilot `copilot.ts:913`, Claude Code `claude.ts:1098`, Codex `codex.ts:1476` | Called at start with `readOnlyFolders`; a new reason `in-memory` beside `in-folder` and `attachment` |
| The reason shown | `AllowedBy` (`src/adapters/types.ts:196`), `allowedBy` (`:173`); window words in `src/renderer/whyallowed.js` | One new kind and its words, "Read in your office memory" |
| Path containment | `isInsideRoots` (`permissions.ts:197`: resolves `..` and symlinks through `realOrNearest`; case-insensitive on `win32` only), `linkedBelow` (`src/shared/linkedfolders.ts:16`) | Reused for reads; FR-004's refusal check is new and pure (see *Path containment*) |
| Claude Code's own read decision | `preToolUseDecision(mode, tool, input, roots, …)` (`src/adapters/claudeModes.ts:203`), `readIsInsideRoots` (`:171`), `claudeOptionsFor` (`:106`) | Gets the read-only roots as a separate list for reads only, never for writes |
| Codex roots | `codexWorkspaceRoots` (`src/adapters/codexModes.ts:130`); `runtimeWorkspaceRoots` sent at `codex.ts:752,914`; "limit Codex's reads" check (`:663`) | R2: whether a read-only extra root exists in Codex's protocol; if not, `[KNOWN GAP]` (no write root added) |
| Copilot extra folders | `additionalDirectories` (`copilot.ts:1021`) | R1: whether the runtime needs it to read, and whether it widens writes; added only if read-only |
| Start options | `StartOptions` (`src/adapters/types.ts:60-110`), `startOptionsOf` (`src/main/startopts.ts:14`), built in `main.ts:452` | New optional `readOnlyFolders?: string[]` |
| First-message text | Spec 111 FR-036 builder (`briefBlock`, **not built**, 111 T013); `sendOp` (`src/main/main.ts:604`), `sendWithSlash` (`src/main/agentops.ts:203`), `scheduledSendOp` (`:314`, never carries it) | See *Dependencies*: one shared chain builder |
| Checked writes in a person's folder | `NotesFile` (`src/main/notesfile.ts:1-17`, class `:82`), `readCapped` (`src/shared/cappedread.ts:36`), `.gitignore` bytes rule (`notesfile.ts:52`) | Its folder checks and atomic write move to a shared helper with no behaviour change (T011); the notes tests stay green |
| Masking | `maskOutgoing` (`src/shared/redact.ts:3200`), `maskTokenShapes` (`:639`), `cut` (`:682`) | none |
| Settings | `SettingsStore` (`src/main/settings.ts:43`, `save` `:488`), `setting()` pattern (`src/main/ipc/settings.ts:23-70`), Settings screen (`src/renderer/screens.js:408`, the *Open chat links in* row) | Three fields; a new section |
| Folder pick | `pickFolder(dev, title)` (`src/main/pickfolder.ts:6`) | none |
| IPC guard | `ipcHandle`, `fromAppFrame` (`src/main/ipcguard.ts:51,45`); simulator guard `src/main/simguard.ts` | New `memory:*` channels |
| Opening a chat | `openPanel` (`src/renderer/app.js:3102`); `sessions:resume` (`src/main/ipc/previous.ts:72`); spec 095's open path (`csRun` `app.js:2321`) | `memory:openChat` answers which of the two to use |
| Links in replies | DOMPurify allow-list `ALLOWED_URI_REGEXP` and `OK_HREF` (`src/renderer/markdown.js:21,27,33`); `openChatLink` (`app.js:4339`), click handler (`:4384`), `REFUSED_LINK` (`:4329`) | Allow exactly the chat-link grammar; one new route before *refuse* |
| Agent menu and copy | `openAgentMenu` (`app.js:8808`); clipboard pattern (`app.js:4389`) | *Memory note and tags…*, *Copy chat link*, *Remove from memory* |
| Dialogs | `askDialog`, `DurbarDialog` (`src/renderer/dialog.js`) | none |
| Session events in main | `toRenderer('agent:added')` (`main.ts:489`); rename `sessions:rename` (`previous.ts:68`); floors `parseFloors` (`src/shared/floors.ts:36`); `FolderStore` (`src/main/folders.ts:348`) | Index triggers subscribe to them |
| Search by tags | spec 095 title match (`src/main/convsearch.ts`, `startScan` `:376`) | Tags and note matched as title words (095 delta, T022) |
| Local git facts, no network | spec 063 runner (`src/main/gitstatus.ts:1-15`) | **Not used**: `.git/config` is read as a file (no process at all, FR-012) |

Nothing existing gives a session an extra read-only folder, writes a file about sessions, or opens a chat from a link: those parts are new.

## Module layout

| Unit | Kind | Job | FR |
|---|---|---|---|
| `src/shared/memoryfolder.ts` | pure, no imports beyond `path` types | `checkMemoryFolder(candidate, ctx, flavor)`, `parseChatLink(s)`, `CHAT_LINK_RE`, `newChatKey(bytes)` (base32), `remoteHosts(configText)` (answers hosts, none, or could-not-check) | FR-004, FR-030, FR-040, FR-051 |
| `src/shared/chatindex.ts` | pure | `chatIndexText(entries, floors)`: order, header, per-field mask, cut, escape, backstop | FR-031, FR-032 |
| `src/main/ownedwrite.ts` | main, injected fs | Checked folder and atomic write taken out of `NotesFile` (real folder, not a link, inside parent, `O_EXCL`/`O_NOFOLLOW` temp, re-check, rename, Windows retry) | FR-011 |
| `src/main/memorykeys.ts` | main, injected fs | `MemoryKeyStore`: key -> folder key, app, session id, tags, note, dates, state; at most 2,000; 0600 | FR-030, FR-033, FR-035 |
| `src/main/memoryfile.ts` | main | `durbar/` marker, `.gitignore`, writes `chats.md` with `ownedwrite`, 5 s coalescing, 1 MB cap | FR-010..FR-013, FR-055 |
| `src/main/memoryops.ts` | main, pure logic with injected deps | pick, apply, status, stop, keep-in-git, entry, set entry, copy link, remove, open chat, the read-root list for `startOptionsOf`, re-checks | FR-001..FR-004, FR-020, FR-041..FR-044 |
| `src/main/ipc/memory.ts` | IPC | the channels below | all |
| `src/adapters/*` | existing | `readOnlyFolders` mapped per adapter | FR-020, FR-021, FR-023 |
| `src/preload/preload.ts`, `src/shared/api.ts` | existing | bridge members and types | — |
| `src/renderer/memory.js` (new UMD) + `copy-assets.js` + `index.html` | renderer | Settings section, *Memory note and tags* dialog | FR-002, FR-003, FR-035 |
| `src/renderer/app.js`, `markdown.js`, `whyallowed.js` | existing | menu items, link route, allow-list, reason words, *Memory note sent* line | FR-021, FR-022, FR-041 |
| `src/renderer/sim.ts` | simulator | in-memory fakes of `memory:*`, a temp memory folder, a simulated reply with a link | FR-081 |
| P4: `src/main/oslink.ts` | main, pure planner with injected platform | registration plan per OS, argv and `open-url` extraction, single-instance wiring | FR-046 |

## IPC channels (all `ipcHandle`, only the app's own page, arguments checked in main)

| Channel | Arguments | Answer | Notes |
|---|---|---|---|
| `memory:status` | none | `{ on, path (with ~), state: on/off/notFound/refused, reason?, entries, lastWritten?, keepInGit, remote? }` | `remote` is a masked host only |
| `memory:pick` | none | `{ token, path, refused?, remote? }` | main's own folder dialog; the token (10 min, in memory) stands for the checked path; the window never sends a path |
| `memory:apply` | `token` | `{ ok, error? }` | after the window's confirmation (FR-003); re-checks FR-004 |
| `memory:setOn` | `boolean` | `{ ok }` | off: new sessions get nothing |
| `memory:stop` | none | `{ ok }` | clears the path; files untouched |
| `memory:setKeepInGit` | `boolean` | `{ ok, remote? }` | rewrites `.gitignore` (FR-055) |
| `memory:entry` | `agentId` | `{ tags, note, key? }` | main sessions only |
| `memory:setEntry` | `agentId, { tags, note }` | `{ ok, tags, note }` (masked as stored) | FR-035 limits checked in main |
| `memory:copyLink` | `agentId` | `{ ok, link }` | creates the key if missing |
| `memory:remove` | `agentId \| key` | `{ ok }` | removes the entry |
| `memory:openChat` | `key` (string, at most 40 characters) | `{ kind: 'open', agentId } \| { kind: 'previous', agentId, sessionId } \| { error: 'unknown' \| 'folderGone' }` | `parseChatLink` already ran in the window; main re-runs it on the key |
| push `memory:changed` | — | status | after a write or a refusal |

## Stores

- **Settings** (`SettingsStore`): `memoryFolder?: string` (absolute real path), `memoryOn: boolean` (default false), `memoryKeepInGit: boolean` (default false). Parsed tolerantly; a bad value reads as off.
- **`MemoryKeyStore`** (`durbar-memory-keys.json`, 0600): `{ v: 1, entries: [{ key, folderKey, app, sessionId, tags[], note, created, lastActive, state }] }`. Keys are 16 random bytes in base32 (26 characters), from `crypto.randomBytes`. Never exported (FR-060), never logged.
- **Index file** (`<memory>/durbar/chats.md`): generated from the key store and the live agents; never read back (Q9 a).

## Masking points (exact)

| # | Where | What | How |
|---|---|---|---|
| M1 | `chatIndexText` (`src/shared/chatindex.ts`) | session name, folder name, floor name, each tag, note | `maskOutgoing` -> `cut` (name 80, folder 40, floor 40, tag 32, note 200) -> Markdown escape (`\`, `[`, `]`, `(`, `)`, `<`, `>`, `` ` ``, `*`, `_`, `#` and `-` at line start, `|`; CR/LF/TAB to space; control and bidi characters removed) |
| M2 | `chatIndexText` end | the whole file text | `maskTokenShapes(text, MASK)`; a change there is counted in the test as a bug (109 FR-021 pattern) |
| M3 | `memory:setEntry` in main | tags and note as stored | `maskOutgoing` before storing; the answer returns the stored text, so the dialog shows exactly what is written |
| M4 | memory note builder | the folder path and the entry file name | `maskOutgoing` inside the shared chain builder (the same call as 111 FR-036) |
| M5 | `remoteHosts` | the git remote shown in Settings and the confirmation | user info (`user:token@`) dropped before anything else, then host only, `maskTokenShapes`, `cut` 64 |
| M6 | toasts and Settings lines | fixed sentences only; no key, path inside the memory folder or index text echoed | — |
| M7 | 095 tag match | tags and note | matched on the stored (already masked) text |

No log line carries a path inside the memory folder, a key, a tag or a note (source test in T013 and T014).

## Path containment (Windows, macOS, Linux)

**Picking the folder (FR-004, `checkMemoryFolder`, pure, one `flavor`).** The input is main's dialog result, resolved with `realpath` (`fs.realpathSync.native`); a failure means refused. The comparison key is case-folded on `win32` **and** `darwin`; folding is stricter on macOS, and over-refusing is the safe side. Refused when (rules 1..6):

1. the path is not absolute, is drive-relative (`C:foo`), or starts with `\\?\`, `\\.\` or `\\` (UNC and device paths; v1);
2. it is a file-system root (`flavor.parse(p).root === p`) or the home folder itself;
3. it is equal to, inside, or holds `userData`, `~/.copilot`, `~/.claude`, `~/.codex` (each also resolved with `realpath`);
4. it is equal to, inside, or holds any office folder (each folder's real path; `.code-workspace` folders included);
5. it is, is inside, or contains a **secret location**, each resolved with `realpath`: `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.config`, `.npmrc` under the home folder; on win32 `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%\AppData`; on darwin `~/Library`; on linux `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` ("contains" covers a parent such as `~/.config` or `~/Library`);
6. `lstat` says it is not a directory.

The check runs again at every start, on `memory:apply`, and when an office folder is added. When a new office folder breaks rule 4, the **memory turns off** (`state: refused`) and Settings names the clash. The folder is still added: adding a folder is the person's main action, and the memory is the extra. (The spec left this to the plan; decided here, and recorded in the spec's *Changes* by T008.)

**Agent reads.** `isInsideRoots` with the session's broker: `..` collapsed and symlinks resolved, so a link inside the memory folder pointing out of it counts as outside. Today it is case-insensitive on `win32` only. On macOS a case-variant path therefore counts as outside: denied, which is the safe side. This is noted as `read:` and not changed here (it is spec 003's rule). Junctions are reported by `lstat`/`realpath` like symlinks (Node docs; no Windows device check, `[KNOWN GAP]` as in spec 043).

**Durbar's writes.** Only `<memory>/durbar/{chats.md,.gitignore,.durbar-owned}` and temp files `durbar/.chats.md.<random>.tmp` (all four named in FR-010):

- `durbar` must be a real folder (`lstat`, not a link or junction) whose real path's parent is the memory folder's real path, holding the marker;
- a `durbar`, `Durbar` or `DURBAR` that is a link, a file, or a folder without the marker means no write and a Settings line (on case-insensitive file systems these are the same entry);
- files are opened `O_CREAT|O_EXCL|O_WRONLY` (plus `O_NOFOLLOW` where defined); everything is re-checked before the rename; on Windows a refused rename is retried once after 200 ms (the `NotesFile` rule).

Fixed names only, so no alternate data stream (`name:stream`) or reserved device name (`CON`, `NUL`) can come from the person's text.

## Data flow

1. **Link**: Settings > *Choose folder…* -> `memory:pick` (main dialog, `checkMemoryFolder`, `.git/config` through `readCapped` 64 KB `O_NOFOLLOW` -> `remoteHosts`) -> window confirmation (FR-003) -> `memory:apply(token)` -> settings saved -> `memory:changed`.
2. **Session start**: `main.ts:452` adds `readOnlyFolders: memoryOps.readRoots()` (empty while off or refused) -> each adapter calls `broker.allowReadPaths` (and Claude Code's read-roots list).
3. **First typed message**: `sendOp` -> `sendWithSlash` expansion -> the shared chain (rules (114), memory note, role brief (111)) masked once -> sent; `memoryNoteSent` recorded per session id; never on scheduled, Autopilot, handover or remote sends.
4. **Index**: session added, renamed, ended or removed, floor or folder change, `setEntry` -> `MemoryKeyStore` -> coalesced 5 s -> `chatIndexText` -> `memoryfile` checked write.
5. **Link click**: markdown keeps the `href` only for the exact grammar -> `openChatLink` route `memory` -> `memory:openChat(key)` -> `openPanel(agentId)` or the `sessions:resume` path; nothing is sent to any agent.

## Dependencies

- **Spec 111 FR-036 (the framed first-message block, 111 T013, not built).** P1 does **not** wait. T002..T008 and T010 (Settings, refusal checks, read roots) ship alone: agents can already read the folder when the person names it. T009 (the memory note) builds **one shared chain builder** in main, `firstMessageChain(parts)`: nonce, `maskOutgoing`, preview, once per session id, never on scheduled, Autopilot, handover or remote sends. Whichever of 116 T009 and 111 T013 starts first builds it, and the other reuses it. The coordinator tells both owners (same coordinator today) and records it in both specs' *Changes*. If 111 T013 is in review when T009 starts, T009 waits for it rather than building a second one.
- **Spec 114** (issue #1959, not written): Q10 a fixes the order (general, floor, memory note, role). Spec 114 adds its parts to the same builder; nothing here waits for it.
- **Spec 109** (specified, not built): the export change (FR-060, T029) is a pointer delta made in 109's own build PR, or after it lands.
- **Spec 095** (built): the tag match (T022) is a dated delta in 095's *Changes* in the same PR.
- **Spec 006**: P4's single-instance lock is a delta there (T025).
- **Priority** (AGENTS.md FR-081): this is a new feature (level 4).

## Phases (one small PR per task or pair, Refs #1962 until the last)

| Phase | Tasks | Content | Risk / who | Waits for |
|---|---|---|---|---|
| P1 | T002..T010 | Refusal checks, settings and `memory:*` (pick, apply, status, stop, setOn), remote reader, read roots in all three adapters with the `in-memory` reason, Settings section, office-folder re-check, memory note (shared builder), research R1/R2, docs | High (adapters, permissions): senior; reviewer-senior | spec committed; T008 see *Dependencies* |
| P2 | T011..T018 | `ownedwrite` extraction, key store, `chatIndexText`, `memoryfile`, triggers, tags dialog, *Copy chat link*, Settings index line and *Keep in git*, docs | High for T011..T015 (writes in a person's folder): senior; T016..T018 UI and docs: junior | P1 |
| P3 | T019..T024 | `parseChatLink`, `memory:openChat`, markdown allow-list and link route, Notes rendering, spec 095 tag match, end-to-end simulator scene, docs | High for T019..T021 (link handling): senior; T022..T024 junior | P2 (keys) |
| P4 `[LATER]` | T025..T028 | Single-instance lock (spec 006 delta), OS registration per platform, argv and `open-url` parsing, packaging config, per-OS person checks | High: senior; reviewer-senior | P3; owner says when |
| Cross | T029 | spec 109 export pointer | Medium | 109 built |
| Real | T030..T032 | one tiny prompt per agent app | owner's OK | P1 |
| Converge | T033 | spec tags, index status | Low: coordinator | each phase |

## Research (done before or inside the first P1 adapter task, `read:` only)

- **R1 Copilot** (T005, 2026-11-24, `read:` only; installed SDK 1.0.22, `package.json` pins 1.0.24; the runtime is a binary, not read). *Certain from types:* `SessionConfig.additionalDirectories` is documented "Additional directories the agent may access beyond the working directory" (`node_modules/@github/copilot-sdk/dist/types.d.ts:2364-2367`; also `dist/generated/rpc.d.ts:12780`, "already granted to the resident session"). "Access" does not say read or write and no read-only form exists in the types (grep of `dist/*.d.ts` and `generated/*.d.ts`: only these four `additionalDirectories` fields, no read-only list), so it must be treated as a possible write grant: it is **not** used for the memory folder. The `read` request carries `path` (`dist/generated/session-events.d.ts:9432`, `PermissionRequestRead`), and Durbar already approves reads outside the roots through its own broker for attached files (`copilot.ts:1239-1240`, `allowReadPaths`, `permissions.ts:333`), so `allowReadPaths` is the existing read-only route. *Inferred (`read:`):* that the runtime asks the broker for a read outside `cwd` instead of refusing first (spec 003 FR-011 left this unverified). If it refuses first, the folder is unreadable in Copilot: `[KNOWN GAP]` until T030; the fallback is no `additionalDirectories`.
- **R2 Codex** (T005, 2026-11-24, `read:` our code and the spec 012 real checks; the Codex protocol types are not in `node_modules` (the app is a separate install, not run here), so no `node_modules` line). *Certain from our code:* yes, a read-only root distinct from a workspace root exists, but in the **profile**, not in `runtimeWorkspaceRoots`: `permissions.durbar_ro.filesystem` is a table of path to `read` (`codexModes.ts:53` `CODEX_RO_FILESYSTEM`, `:70` `codexProfileToml(extraRead)`, `:115` `codexProfileArgs`), passed as `-c` at `app-server` spawn (`codex.ts:397`). Spec 012 FR-138 added Codex's install folder this way and it worked in a real check (the `bwrap ... No such file` failure went away), so an extra `"<abs path>"="read"` entry is a read-only root, validated by `codexReadRoot` (`codexModes.ts:60`). `runtimeWorkspaceRoots` (`codex.ts:752,914`, `codexModes.ts:130`) are `:workspace_roots`, which Durbar's profile also lists as `read`; in Allow all (`danger-full-access`) the roots are not a limit. A read outside the profile is refused by the OS sandbox, not asked (`codexModes.ts:49-50`, "anything not listed is unreadable"; spec 012 Q6). Per mode: Read-only and Ask first = profile `durbar_ro`, the extra entry gives reads and no writes; Allow all = whole disk, nothing to add. *Inferred (`read:`):* that one `-c` table with an entry per memory folder behaves like the install root, and that the memory folder is fixed at spawn (the profile is a spawn argument), so the child must start with it: T032.
- **R3 Claude Code** (T005, 2026-11-24, `read:` our code and spec 087 research; `@anthropic-ai/claude-agent-sdk` is **not** in `node_modules` (loaded at run time, types written by hand from SDK 0.3.302, `claudeSdk.ts:5`), so no `node_modules` line). *Certain from our code and research:* `additionalDirectories` is the SDK form of `--add-dir` (`claudeSdk.ts:95`, `claude.ts:397`) and grants **writes**: spec 087 research lists "Writes: the working directory, `$TMPDIR` and `--add-dir` folders" (`specs/087-os-sandbox-floor/research.md:33`), and `claude.ts:1623` says a folder left out of the sandbox is not an `--add-dir` "(Claude would grant it writes)". So it is **not** used for the memory folder. Reads are decided by Durbar's own code: `readIsInsideRoots` and `decideTool` (`claudeModes.ts:171,185`) allow a read inside the roots, deny it outside in Read-only and ask in Ask first; `preToolUseDecision` (`:203`) has no opinion on an allowed read. *Inferred (`read:`):* that a read-root list given to these two functions is enough, because `canUseTool` and the hook run for every tool call and `settingSources: []` removes user rules; whether Claude Code's own cwd rule asks first before `canUseTool` for a read outside `cwd` in `dontAsk` is not read: T031. Fallback: none that adds a write root; if `dontAsk` denies before `canUseTool`, the folder is unreadable in Read-only, `[KNOWN GAP]`.

## Test plan (zero AI credits)

- `test:memoryfolder`: FR-004 table with `path.win32` and `path.posix` (root, home, each secret location as itself, inside and as a parent (`~/.config`, `~/Library`, `%APPDATA%`), `C:foo`, UNC, `\\?\`, case variants on win32 and darwin, office folder inside and around, symlink to an office folder through injected `realpath`). Mutants: case fold removed; "holds" direction dropped; UNC allowed.
- `test:memoryops`: token flow (the window never sends a path), status, setOn, stop, re-check on folder add, read roots empty while off. Mutants: path accepted from the window; roots given while off.
- `test:memoryremote`: `.git` as a file (worktree), `include`/`includeIf`: answer "could not check", never "no remote"; `.git/config` with `user:token@host`, `insteadOf`, 64 KB + 1, a FIFO and a symlink (injected fs). Mutant: user info shown.
- `test:memoryroots` per adapter (fake runtimes): a read inside is approved in Read-only and Ask first with `in-memory`; a write inside is denied in Read-only and asked in Ask first; a symlink out of the folder is outside; Allow all unchanged. Mutants: the folder passed as a write root; `extraRoots` used for writes; Claude Code `PreToolUse` read roots also used for writes.
- `test:ownedwrite` plus the existing `test:notesfile` unchanged: link, junction (simulated with `isSymbolicLink`), file, foreign folder, parent swap between check and rename, `O_NOFOLLOW` missing (Windows flags).
- `test:chatindex`: golden file; hostile names (`](javascript:x)`, `<img onerror=…>`, a token, a newline, `# heading`, bidi); no session id, no absolute path, no model. Mutants: escape removed, mask removed, backstop removed.
- `test:memoryfile`: a fake fs records every read and write: a read outside FR-050's list or a write outside `durbar/` fails; marker, `.gitignore` bytes, keep-in-git, coalescing with a fake clock, 2,000 and 1 MB caps, import-list source test (no `child_process`, `net`, `http`, `https`).
- `test:chatlink`: grammar table (valid; uppercase scheme; `durbar:chat/`; `durbar://Chat/`; path parts; `?`, `#`, `%`; 25 and 27 characters; base32 out of alphabet; 41+ characters). Mutants: prefix match only; case-insensitive key; `URL` parsing.
- `test:memoryopen`: open, previous, unknown, folder gone; never calls an adapter `start` or `send`.
- Drivers (simulator, temp folder): `shots-116-settings`, `shots-116-tags`, `shots-116-link` in Flat, Retro and Real office at both sizes; `check:office` unchanged.

## Real checks (separate; owner's OK; spend credits)

T030 (Copilot), T031 (Claude Code), T032 (Codex): one tiny Read-only prompt each, "Read <memory>/notes/hello.md and reply with its first line" (a temp folder holding one line, no real data). Each records the version, the result and the reported usage in the spec. Cost: about 1 premium request on Copilot (times the model's multiplier), and a few thousand input tokens each on Claude Code and Codex (cents in USD). The memory note adds about 100 input tokens. Until done, FR-023 is `[KNOWN GAP]` per app.

## Complexity tracking

(none)

## Risks

- **The agent apps' own path rules** (main open risk): Durbar's broker can approve a read that the runtime refuses, or that the runtime's sandbox blocks (Codex roots, spec 087 sandboxes). Mitigation: R1..R3 first; never add the folder as a write root to get reads; `[KNOWN GAP]` per app until T030..T032.
- **Writes in a person's repo**: a bug there damages the person's own work. Mitigation: one shared checked writer with the notes tests as a guard, a marker, fixed names, a fake-fs test that fails on any path outside `durbar/`.
- **Two first-message builders** (111 and 116): mitigated by one shared builder (*Dependencies*).
- **Link handling**: a loose regex in `markdown.js` would let other `durbar:` URLs through. Mitigation: one exact grammar shared by markdown, window and main, with mutants. P4 adds outside input through argv and `open-url`: the same parser, at most one link per event, never a send or a start.
- **Single-instance lock** (P4) changes what happens today when Durbar is started twice (specs 006, 044, 083). Mitigation: a later phase with its own delta and the owner's go.
- **Prompt injection by the person's own files**: framed as notes, the mode unchanged; stated in Settings and docs (FR-053), `[KNOWN GAP]`.
- **Index exposure**: names of folders and chats in a pushed repo. Mitigation: git-ignored by default, remote warning, metadata only, masked.
- **macOS case**: `isInsideRoots` folds case on Windows only, so a case-variant read on macOS is denied (safe, but surprising). Noted; any change belongs to spec 003.
