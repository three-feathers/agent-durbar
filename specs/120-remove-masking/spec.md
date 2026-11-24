# Feature Specification: Remove masking as app functionality (proposal for the three owners)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Remove masking as app functionality (proposal, 2026-11-24): the screen shows what the agent sent; Durbar keeps agent text out of its own logs, saved state and anything that leaves the machine by structure, not by masking; options A, B, C, inventory, the principle III clarification and a staged deletion plan
status: draft
note: proposal only; nothing changes until all three owners agree in writing; Q42 and Q45 answered by Vikram (option 1 each), the other owners to agree; Q43, Q44 open; facts checked by Paco's side (review of PR 2121)
-->

**Feature Branch**: `120-remove-masking` (spec, plan and tasks only).

**Created**: 2026-11-24

**Status**: **Proposal. Nothing here changes behaviour until the three owners (Vikram, Paco, Ruben) agree in writing.** No file under `src/` changes in this PR, nothing is deleted, the constitution is not edited.

**Input**: the owner Vikram, Telegram, 2026-11-24, after a day in which most review rounds were masking (#2098 five rounds, #2112, #2119, #2108, and masking-adjacent work on #2116):

> "I prefer we don't keep it as app functionality as app is not designed for that, app is for user experience and not security"

and earlier the same day:

> "agent apps and LLMs themselves have to take responsibility to handle masking or warn about secrets rather than handling it in apps"

and at 17:51 UTC, his reading of principle III:

> "Never logging is correct and we actually don't log any user text in the app itself except what gets logged in agent apps; transmission is what the user explicitly sends to agent apps."

Paco's bot suggested a middle option (mask only where text leaves the machine, freeze on-screen masking). Paco and Ruben have **not** decided.

## 1. The decision and the options

"Masking" here means Durbar searching agent text for things that look like secrets (known shapes, the value after a secret-sounding name, the home folder, values Durbar knows) and replacing them before showing, storing or sending the text.

| Option | What it means | What it costs |
|---|---|---|
| **A. Keep as is** | Every surface keeps masking; the daily masking batch goes on (spec 012, spec 119's probe harness still to build). | The largest cost in review: 30 of 404 merged PRs in 14 days were masking, but they took 100 of 942 owner-account reviews and 66 of 372 change requests (section 2.3). `redact.ts` alone is 3,681 lines and grows each batch. Every new screen that shows agent text needs a mask and a sink-table row (spec 012 FR-197). Masking is best effort by its own docs: it never promised to catch every secret. |
| **B. Mask only where text leaves the machine** | Freeze on-screen masking (no new work), keep masks on logs, diagnostics, exports, notes and messages to agents. | Keeps `redact.ts` and its heavy review for the outbound sinks. Most outbound sinks hold little or no agent text once section 3's design is done, so B keeps the expensive part to guard a small surface. Screens would still mask (frozen), so the over-masking bugs of #2060 stay. |
| **C. Remove masking as app functionality** (the owner's stated preference) | The screen shows what the agent app sent. Durbar keeps agent text out of its own logs, saved state and anything that leaves the machine **by not putting it there**, and says so in one honest line. Messages the person sends are theirs. | One principle III clarification (section 4). About 4,650 lines of masking code in `src/` and about 11,600 lines of dedicated tests go, in stages (section 5). A person who shares their screen shows what is on it. The five places in section 3.2 that write agent text today without a user action must be changed **first** (stage 1); the Undo copies stay as one named exception (Q45). |

This spec writes out C in full, because it is the owner's preference and the one with a design to check. A and B need no new design.

## 2. Inventory (measured on `origin/main` at `e9a712197`, 2026-11-24)

### 2.1 Masking code by family

Method: masking files are the ones whose job is masking (`src/shared/redact.ts`, `src/main/mcpmask.ts`, `convmask.ts`, `activitymask.ts`, `src/renderer/safetext.js`), counted with `wc -l`. Call lines are lines outside `redact.ts` that call a masking function (`git grep -c -E` over `src/` for `redact(`, `redactMarkdown(`, `maskSecretCommand(`, `maskSecretArgs(`, `maskSecretUrl(`, `maskHomePaths(`, `maskNoteText(`, `maskOutgoing(`, `maskSplitTokens(`, `maskLinkSplitTokens(`, `maskTokenShapes(`, `createDebugSink(`, `hiddenSpans(` and the wrappers `maskMcp*`, `maskActivity*`, `maskConv*`). Total: **156 call lines in 51 files**; a few are comments. The family of a file is a judgment from its name and its comment. The window side also reaches the masks through `window.DurbarRedact` and `DurbarSafeText`: a broader count (`redact|DurbarSafeText|safeText|mask[A-Z(]|masked`, comments included) gives 427 lines in 27 renderer files.

| Family | Files (call lines) | Masking-only code |
|---|---|---|
| The shared library | `src/shared/redact.ts` | 3,681 lines |
| Screen and window (desk, tooltips, inbox, cards, toasts, chat header, announcements, typing line, monitor) | `safetext.js` (9), `app.js` (7), `sim.ts` (2), `screens.js` (2), `liveact.js` (2), `mcpwords.js` (2), `cuttext.js` (1); plus `helpercard.js`, `notes.js`, `harnesses.js`, `slashsuggest.js`, `sandboxtext.js`, `brainview/dock.js` through `DurbarSafeText` | `safetext.js` 260 lines |
| Main-side shown text (errors, update notes, folder setup, names, loop pace, edits, harness setup, adapters' permission text and slash commands) | `ipcerror.ts` (2), `ipc/characters.ts` (2), `ipc/model.ts` (1), `ipcguard.ts` (1), `hardening.ts` (2), `updatecheck.ts` (1), `selfupdate.ts` main (1) and shared (2), `remote.ts` (1), `newfolderop.ts` (1), `newfolder.ts` (3), `names.ts` (2), `looppace.ts` (2), `edits.ts` (2), `foldersetup.ts` (1), `harnesssetup.ts` main (2) and shared (1), `autopilotops.ts` (1), `codex.ts` (4), `detect.ts` (2), `permissions.ts` (1), `slashcommands.ts` (4); conversation search `convmask.ts` (2) | `convmask.ts` 227 lines |
| MCP (errors, configs, tool lists, sign-in, Durbar MCP read tools) | `mcpmask.ts` (19), `mcpglobal.ts` (6), `mcp/readtools.ts` (5), `mcpsession.ts` (4), `mcptoolsop.ts` (3), `mcptoken.ts` (2), `mcpstore.ts` (1), `mcpsignin.ts` (1), `mcpcontextop.ts` (1), `main.ts` (2) | `mcpmask.ts` 440 lines |
| Notes (store, project file, export) | `notesstore.ts` (3), `notesfile.ts` (1); the export writes text the store already masked | in `redact.ts` (`maskNoteText`) |
| Helper cards and brain view | `brainstate.ts` (16), `brainsurface.ts` (3) | (part of those files) |
| Tool chips and their Copy | `toolusage.ts` (1), `app.js` `TOOLMASK`, `toolargcopy.ts` (`argsMasked`) | (part of those files) |
| Activity log | `activitymask.ts` (3), `activity.ts` (5), `main.ts` `logActivity` | `activitymask.ts` 41 lines |
| Logs (stderr lines, `DURBAR_LOG` debug log) | `main.ts` console lines (6) and `createDebugSink` (1), `ipcerror.ts`, `mcpstore.ts`, `detect.ts`, `sandboxpolicy.ts` (1) | `createDebugSink` in `redact.ts` |
| Messages to agents (`maskOutgoing`) | `teamtemplate.ts` (1, the brief a team member gets); spec 084's send check (not built) | `maskOutgoing` in `redact.ts` |
| The sandbox's own masks | `sandbox.ts` (2), `sandboxpolicy.ts` (1), `sandboxRoots.ts` (1) | (part of those files) |

Not masking, and kept under every option: `cut`, `unhide` and `HIDDEN_CHARS` (invisible characters made visible: a spoofing guard, not a secret guard), `shQuote`, `shellWords`, `parseFlag`, `hasShellJoin`, and `secretFlag` / `envVarName` (the adapters use them to keep secret-named environment variables out of a child process: environment hygiene, not display). They live in `redact.ts` today and move to a small text helper in stage 4.

### 2.2 Tests

Method: `ls scripts | grep -i -E 'redact|mask|secret|safetext'` plus `scripts/fixtures/redact-main-ref.ts`, counted with `wc -l`; mixed files by `git grep -l` for the masking names in `scripts/`.

- **28 dedicated files, 11,627 lines.** The largest: `test-redact.ts` 3,234; `fixtures/redact-main-ref.ts` 2,178; `test-redact-shapes.ts` 892; `test-redact-growth.ts` 610; `test-live-mask.ts` 552 (the FR-197 sink table); `test-toolargs-mask.ts` 493; `test-safetext.ts` 338; `test-convmask.ts` 324; `check-done-desk-mask.js` 315; `test-mask-paths.ts` 300; `test-maskoutgoing.ts` 293.
- **85 more script files** mention masking (113 in all), mostly a few asserts each: `test-liveact.ts` (158 lines mention it), `test-edits.ts`, `test-brainstate.ts`, `test-mcp-global.ts`, `test-mcp-tools.ts`, `test-activity.ts`, `test-toolargcopy.ts`, `test-helpercard.ts` and others. Their masking asserts change; the files stay.

### 2.3 Review cost, last 14 days

Method: merges on `origin/main`'s first-parent line up to `e9a712197` with a committer date from 2026-11-10 00:00 CET (`git log --merges --first-parent --since`): 407 PR merges (403 from 00:00 UTC; Paco's side counted 381 locally, cause of the difference not found). A PR counts as masking when its title says mask, redact, secret or token shape, or its diff touches a masking file or test (`redact.ts`, `mcpmask.ts`, `convmask.ts`, `activitymask.ts`, `safetext.js`, `scripts/test-redact*`, `test-live-mask*`, `test-mask*`, specs 119 and 012's coverage list). That gave 32 (19 by title alone, as Paco's side also counted); two were taken out by reading the title (#1282 brain view, #1637 an MCP status code). Reviews: `gh pr list --state merged --search "merged:>=2026-11-10"` (404 PRs; the 3-PR difference is the time zone of the cut), counting reviews by the three owners' accounts (which the agents use).

| | PRs | Reviews | Change requests |
|---|---|---|---|
| All merged PRs | 404 | 942 | 372 |
| Masking PRs | 30 (7 %) | 100 (11 %) | 66 (18 %) |

Most rounds: #1721 (13 reviews, 11 change requests), #2098, #1899, #1872, #1824 (6 and 5 each).

### 2.4 Open masking work, and what happens to each under C

| Item | Today | Under C |
|---|---|---|
| #1320 masking gaps for the daily batch (tracking) | open | closed: no daily batch (stage 0) |
| #1981 the task line's rules break benign flags and query text | open | closed by stage 2 (no task-line mask) |
| #1999 every renderer site must pass the mask | open | closed: the opposite direction |
| #2060 owner's 12 usability changes | 4 done, 1 mostly | 1 (errors show their own words, *Copy details*) and 3 (long arguments, "N more characters") stay as plain UI work without the mask; 2, 5, 6, 7, 8 are done by removal; 10 (loop limits as warnings) is not masking and stays; 12's spec 084 send block becomes moot (no mask to change a message), spec 105's file guard is not masking and stays |
| PR #2112 network share paths shown whole | open | superseded by stage 3 (paths are shown as written); close or land only its screen part |
| PR #2119 long tool arguments say how many more characters | open | keep the UI part, drop "masked" from it |
| PR #2108 errors show their own words, masked | open | keep, without the mask; the stderr log line it touches is stage 1's |
| #2113 a Windows network path loses a separator on Markdown surfaces | open | a display bug, stays a bug (not masking) |
| #2120 a user and password in a network path's server part are shown | open | closed as "the screen shows what the agent sent"; stage 1's marker test covers logs |
| PR #2116 (Ruben) Durbar brain memory | open | untouched; it is not a masking PR |

## 3. The design of C without breaking principle III

### 3.1 Starting point: the owner's reading

Principle III says "Agent Durbar never reads, stores, logs or transmits tokens or credentials... No telemetry." The owner reads it as: **Durbar writes no user or agent text to its own logs; the only transmission is what the person explicitly sends to agent apps.** Under C that is met by **not putting agent text where it is kept or leaves the machine**, not by masking it. The screen is not a log and not a transmission: it shows what the agent app sent, to the person who started the agent.

### 3.2 Does the code hold the owner's reading? (checked 2026-11-24)

Method: every `console.*` call in `src/main`, `src/adapters`, `src/shared`, `src/preload` (17), every `writeFileSync`/`appendFileSync`/`writeFile` in `src/main` and `src/adapters` (36), every producer of an activity row (`logActivity` and the `log` callbacks wired to it), the saved fields of `schedules.json`, the network callers, the clipboard writers, the OS notification and the Durbar MCP read tools; each read at the line. `read:` for what a site writes at run time; nothing was run. Paco's side's fact check (review of #2121, 2026-11-24) found E5 and the Undo copies, which the first draft missed.

**Mostly yes. Five places write agent-derived text without a user action today, all masked; they are the only places C must change before any mask goes (stage 1). One more, the Undo copies, has never been masked and stays as one named exception (Q45).**

| # | Sink | What it holds today | Masked today | After stage 1 |
|---|---|---|---|---|
| E1 | **Activity log file** `activity.json` in userData (`src/main/main.ts:384-386` `logActivity`, `src/shared/activity.ts:77`, written by `src/main/activitystore.ts:98`), up to 5,000 rows, kept across runs | permission rows: the request text (a command line, a tool name with its arguments, a URL), first 160 characters; loop rows: the agent's pace reason (E5); every row: the folder path | yes (`maskActivityAction`) | per row kind, FR-443 |
| E2 | **stderr lines** (`src/main/ipcerror.ts:19` `failText`; `src/main/main.ts:1264`; `src/main/main.ts:1321` `DRIVER FAILED`, test drivers only) | the stack and message of any error caught behind a window request, which can be an agent app's or SDK's own error text with paths; a save error's message; a test driver's failure stack | yes (`redact`) | FR-444. Not a file Durbar writes, but a desktop launcher or the OS may keep stderr (`read:`, not checked per OS) |
| E3 | **`DURBAR_LOG` debug log** (`src/main/main.ts:424-427`, sink `src/shared/redact.ts:2454`), developer and test only (a packaged build ignores it unless `DURBAR_DEV=1`) | every normalized event (replies, tool arguments and output) and the adapters' debug lines, with the agent app's last stderr lines (`src/adapters/claude.ts:2058`, `src/adapters/codex.ts:1770`) | yes, once at the sink | FR-445 |
| E4 | **Durbar MCP read tools** (`src/main/mcp/readtools.ts:191-203`, `src/main/mcpglobal.ts:65-67`): sent to a connected agent app while the person has the Durbar MCP server on | each MCP server's `command`, `args` and `url` (spec 041 FR-010) | yes (`mcpmask`) | FR-446 |
| E5 | **The loop pace reason** (spec 072): `cleanReason` (`src/shared/looppace.ts:36-39`) takes the agent's own reason from its `loop: next N min` or `loop: stop` line, 120 characters | saved in `schedules.json` as `loop.lastAsk.reason` (`src/main/schedules.ts:50,211,757`) and inside `loop.ended.text` ("Stopped by the agent: ...", `schedules.ts:641-654,752`); copied into `activity.json` loop rows (`src/main/main.ts:713-716`, `src/main/loopwiring.ts:84-97`) | yes (`redact`) | FR-453 |

| | Sink | Why it is not an exception |
|---|---|---|
| N1 | **Notes** kept from an agent reply (`src/main/notesstore.ts:371`) and the project notes file (`src/main/notesfile.ts:105`) | a user action (*Save to notes*; the project switch says it writes into the project, which may be pushed): stored as saved (FR-447). Masked today (`maskNoteText`) |
| U1 | **Undo copies**: `checkpoints/` in userData holds copies of files an agent edits (`src/main/checkpoints.ts:193,302`), private, bounded, emptied when the store starts (`checkpoints.ts:9-10`), so a crash leaves them until the next start | never masked; file contents on disk without a per-file action: a **named exception**, a visible local feature (Q45, answered by Vikram) |

**Not exceptions** (checked at the line): OS notifications carry the agent's name and fixed words, never the request (`src/renderer/app.js:4859`); the window title holds a count; the crash marker holds session ids (`crashmarker.ts`); the away summary holds counts (`summarydays.ts`, `daily.ts`); usage stores hold numbers; held prompts, scheduled prompts, team briefs and session names are the person's own text (the loop pace reason in `schedules.json` is the agent's: E5); the other stderr lines are fixed words, field names, an adapter id or a file's base name. Network: the update checker and self-update read release lists and files, agent app setup downloads installers, MCP sign-in talks to a server's sign-in pages, and the session browser (spec 080) loads the pages the person opens; none of these puts agent text into a request Durbar makes (`read:` at the callers, not traced per request).

### 3.3 Every sink after C

| Sink | Agent text in it after C | Kind |
|---|---|---|
| The screen (every window surface) | everything the agent app sent | display, not a log |
| `activity.json` | none: per row kind, FR-443 | saved state |
| `schedules.json` | none: the pace minutes and source, fixed end words (E5) | saved state |
| stderr | none: place, class name, code (E2) | log |
| `DURBAR_LOG` | none: kinds, ids, lengths, codes (E3) | developer log |
| Durbar MCP read tools | none: names, transport, state (E4) | sent to a local agent app |
| Undo copies | copies of edited files (named exception, Q45) | saved state, emptied at the next start |
| Notes store, project notes file | what the person saved | user action |
| Activity export, notes export | what the person sees in the log or notes | user action, asks for a file |
| *Copy* on a tool chip, a message, an MCP error (*Copy diagnostics*) | what the person sees, as the agent sent it | user action |
| Messages and briefs sent to an agent app | what the person typed | user action (`maskOutgoing` goes, FR-448) |
| OS notifications, crash marker, usage, away summary | none (as today) | saved state |
| Durbar's own network requests | none (as today, section 3.2) | |

There is no chat channel, issue-report form or telemetry in the app (`git grep` for chat services, `issues/new` and report links in `src/`: none).

### 3.4 Requirements (apply only after the owners' written yes)

- **FR-441** The window shows agent text as the agent app sent it, with invisible and control characters still made visible (spoofing guard, kept). No surface masks secret-shaped text.
- **FR-442** Durbar writes no agent text (replies, thinking, tool arguments or output, commands, URLs, file contents, an agent app's error text, the agent's pace reason) to its own logs, saved state or anything that leaves the machine, except (a) by an explicit user action (a Copy button, an export, *Save to notes*, sending a message, a switch that says what it writes) and (b) the Undo copies of edited files (a visible local feature, emptied at the next start; Q45).
- **FR-443** The activity log, per row kind (`ACTIVITY_DECISIONS`, `src/shared/activity.ts:18`; producers read at each call):
  - permission rows (`allowed-once`, `allowed-session`, `denied`, `auto-allow-all`, `auto-session-grant`; `main.ts:394`): the kind of request, the tool name (an MCP or custom tool's name; a command or a URL gives no name, only its kind) and the request's length in characters; never command or URL text (Q42 option 1, the proposed default);
  - `loop-pass`, `loop-end` (`loopwiring.ts:86-97`): Durbar's fixed words and numbers; never the agent's reason (E5); `loop-start`, `loop-skip`, `loop-hold`: fixed words and numbers, as today;
  - `mode-change` (`agentops.ts:76`, `ipc/previous.ts:92`), `limit-change` (`agentops.ts:109`), `remote-on`/`remote-off` (`ipc/remote.ts:41`), `autopilot-on`/`-end`/`-off` (`autopilotops.ts:190,335,463`), `session-deleted` (`prevsessions.ts:162`): Durbar's fixed words, mode names, numbers, an app name, a short session id; kept as today;
  - `mcp-restart` (`main.ts:240`, `mcpsigninrefresh.ts:762,1093`): fixed words and the MCP server's configured name; kept as today;
  - every row keeps time, agent, folder, app and mode. The live chat still shows what was asked while the app runs (Q42). An older row's stored action text is rewritten to the new form on the first read after the change.
- **FR-444** A main-process log line names a fixed place, an error class name and a code, never an error message, stack text or path from an agent app or the system. One named exception: a test driver's own failure (`DURBAR_DRIVER`, never in a packaged build without `DURBAR_DEV=1`) prints the driver's stack, which CI needs; drivers run on simulated agents only.
- **FR-445** The `DURBAR_LOG` debug log records event kinds, ids, phases, lengths and codes, never a text field, argument, output or stderr text.
- **FR-446** The Durbar MCP read tools return an MCP server's name, transport, on/off and health, never its command, arguments or URL.
- **FR-447** Notes, exports and Copy hold what the person sees, unmasked; each is a user action. The project notes switch says that the file goes into the project folder and may be pushed with it.
- **FR-448** Text the person sends to an agent app (a message, a team brief, a hook explanation request) is not masked or blocked. Spec 084's send check becomes moot.
- **FR-449** Values Durbar itself holds that are secret by their field (an MCP server's environment or header value the person entered) are never sent to the window, a log or another agent: the window gets "set" or "not set". This is structure, not text masking, and it stays.
- **FR-450** **The planted-marker tests** (`npm test`, 0 credits). A unique invented value, made at run time with a random body (never a committed shape), is fed in as each kind of agent output: reply, thinking, tool name, tool arguments, tool output, a command, a URL, an agent-chosen session title, a loop pace line (`next` and `stop` reasons), a question, a permission summary, an MCP error, an agent app's error and its stderr. **Each sink has its own test and its own mutant**: a mutant that writes the marker into that sink must make the run fail at that sink's own named assert (not at a shared one). Where each sink is reached, because the window simulator (`DURBAR_SIM`) never reaches main and the scheduler does not start under it (`main.ts:1275`):

  | Sink | Test kind |
  |---|---|
  | `activity.json`, every row kind | unit test: each producer (`logActivity` with a permission event, `loopActivity`, the mode, limit, remote, Autopilot, session and MCP restart lines) into an `ActivityStore` on a temp folder; the file read back |
  | `schedules.json` (E5) | unit test: `SchedulesStore` and `loopwiring` with a fake clock, pace lines carrying the marker; the file read back |
  | stderr (E2) | unit test: `failText` and the save-error path with a captured `console`; an agent-app error object carrying the marker |
  | `DURBAR_LOG` (E3) | unit test: the debug sink fed events of every kind; the file read back |
  | adapters' stderr tails (E3) | unit test with a **fake transport**: the Claude and Codex exit handlers run on a fake child whose stderr carries the marker; the debug lines captured |
  | Durbar MCP read tools (E4) | unit test: `readtools` with fake deps whose MCP server configs carry the marker |
  | crash marker, usage, away summary | unit test: each store's file after a run whose events carry the marker |
  | the screen, Copy, exports | window driver under `DURBAR_SIM`: the marker is shown where the agent sent it; Copy and export hold exactly what is shown |
  | end to end through main | `DURBAR_SIM_MAIN` with `FakeAdapter` (`src/main/mcp/simmain.ts`), where its events reach the router; `[KNOWN GAP]` not checked which sinks it reaches, so it adds to the unit tests and never replaces them |

- **FR-451** docs/safety.md says in one line: **"The screen shows what the agent sent; do not share your screen with secrets on it."** and lists, without "masked", what Durbar keeps and what it never writes.
- **FR-453** The loop's saved state keeps the pace minutes and its source (`agent`, `default`, `clamped`) and Durbar's fixed end words ("Stopped by the agent"), never the agent's reason; the window may show this run's reason from memory.

## 4. The constitution III amendment (proposed text; the constitution file is not edited in this PR)

Principle III's text never names masking: masking was how agents read "never reads, logs or transmits tokens" for the screen. Two sentences of principle III are **already untrue today**, with or without masking:

1. **"Saved state (folder list) holds paths and choices only."** Saved state also holds text the person asked Durbar to keep (scheduled and held prompts, notes, team briefs, session names), the activity log, and the agent's loop pace reason (E5).
2. **"Agent Durbar never ... stores ... tokens or credentials."** Durbar keeps the secret values a person types in for an MCP server (environment and header values), encrypted with the OS secret store and not written at all without it (`src/main/mcpstore.ts`), and its own MCP connection key in a private file (`src/main/mcp/auth.ts`).

Proposed: replace the sentence "Saved state (folder list) holds paths and choices only." and add one bullet after "Agent Durbar never reads, stores, logs or transmits tokens or credentials...", whose other words stay, "No telemetry" included:

> - Saved state holds paths, choices and the text the person asked Durbar to keep (prompts, notes, briefs, names). The only secrets Durbar keeps are the values a person enters for an MCP server, kept only encrypted by the operating system's secret store, and its own local connection key in a private file. Sign-in to the agent apps stays with the vendor runtime.
> - **Amendment 4 (proposed, 2026-11-24, owner):** the window shows agent output as the agent app sent it; Durbar does not search it for secrets and does not mask it. Durbar does not put agent output (replies, tool arguments and output, commands, file contents, an agent app's error text, the agent's pace reason) into its logs, saved state, diagnostics or anything that leaves the machine, except by an explicit user action (a Copy button, an export, saving a note, sending a message, a switch that says what it writes) and except the Undo copies of edited files (local, emptied at the next start, a feature the person sees; see Q45). What the person sends to an agent app is theirs. Why: the agent apps and models own secret handling in their output; Durbar's part is not to keep or forward it.

**Version: 1.2.0 to 1.3.0, MINOR**, as proposed: no principle is removed; the rewording of the two sentences describes what Durbar already does and the owners already approved (MCP secrets in spec 019 and 058, the connection key in spec 041), and the new bullet adds a checkable rule (FR-442, FR-450). Not PATCH: it adds a rule and changes stored behaviour (FR-443, FR-453). If the owners read the rewording of "never stores tokens" as a redefinition, it is MAJOR (2.0.0): their call. Made with `/speckit.constitution` in its own PR after the owners' yes, with the Sync Impact Report (stage 0).

**The two published advisories are not about masking** (relayed by Paco's bot, an owner's agent, 2026-11-24; the fix PRs read at their merge commits). Both are patched in 0.1.15 and both fixes are structural:

- **GHSA-9w5g-g9x5-5pq4**: how Claude Code's `CLAUDE.md` imports were handled; fixed by #1383: `claudeMdPrompt` with `claudeMdNodeIo` and `notPath` in `src/adapters/claude.ts`; tests in `scripts/test-claude-adapter.ts`.
- **GHSA-5h28-qhj8-q5m9**: the agent-file confirmation trusted the file on disk rather than the bytes the person was shown; fixed by #1416: the `agents:selectProfile` handler in `src/main/ipc/profiles.ts`; `readAgentFile`, `hashAgentFile`, `shownSha` and `AgentTrustStore` in `src/main/agenttrust.ts`; `claudeAgentOfBytes`, `listClaudeAgents`, `claudeAgentDirs` in `src/adapters/claudeAgents.ts`; `linkedInProject`, `linkedBelow` in `src/shared/linkedfolders.ts`; the confirmation paths in `src/renderer/app.js`, `src/renderer/sim.ts`, `src/adapters/claude.ts`, `src/adapters/copilot.ts`, `src/adapters/types.ts`, `src/shared/api.ts`, `src/main/simguard.ts`. New suite `scripts/test-agentconfirm.ts`; also changed `scripts/test-claude-adapter.ts`, `scripts/test-adapter-contract.ts`.

Neither fix calls a mask (`git grep` for `redact` or `mask` in `agenttrust.ts`, `claudeAgents.ts`, `test-agentconfirm.ts`, `test-agentprofiles.ts`: none), so option C needs nothing from them except **keeping both fixes** (FR-452).

- **FR-452** No removal stage changes the functions named above for #1383 and #1416, except to remove a mask call next to them (none today); a stage that edits `app.js`, `sim.ts`, `claude.ts` or `copilot.ts` names the fix lines it did not touch. `test-agentconfirm.ts`, `test-adapter-contract.ts`, `test-claude-adapter.ts` (its #1383 and #1416 asserts; a stage changes only its two masking mentions) and `test-agentprofiles.ts` (older, covers `hashAgentFile`) stay and stay green; each stage PR says it ran them.

## 5. The staged plan (each stage one small PR, in order; none starts before the written yes)

Line counts: `wc -l` of the files a stage deletes, plus the call lines of section 2.1 it edits; new code is an estimate.

| Stage | What | Lines changed (estimate) |
|---|---|---|
| 0 | Owners' rule line: no new masking work, no daily masking batch, spec 119 paused; the constitution amendment PR | ~30 |
| 1 | E1 to E5 carry no agent text (FR-443..FR-446, FR-453); FR-449; **the planted-marker tests, one per sink with its mutant (FR-450)** | ~800 (about 500 new test lines, 300 changed) |
| 2 | Window masks go: `safetext.js` (260), the renderer call sites (~25 call lines, ~400 mention lines), the FR-197 sink table `test-live-mask.ts` (552), the window drivers `check-done-desk-mask.js`, `check-toolchip-mask.js`, `check-console-mask.js`, `check-question-header-mask.js` (710), `test-safetext*.ts` and corpora (603), `test-announce-mask.ts` (260) | ~2,800 deleted |
| 3 | Main-side shown-text masks go: `convmask.ts` (227), `mcpmask.ts` (440), `activitymask.ts` (41), ~90 call lines in main, MCP, notes, brain view, adapters; `test-convmask.ts`, `test-mcp-errormask.ts`, `test-toolargs-mask.ts`, `test-mask-paths.ts`, `test-notesmask.ts`, `test-overmask.ts` (1,568); asserts in the 85 mixed test files | ~2,600 |
| 4 | `redact.ts` (3,681) goes; the kept helpers move to a small text module; `test-redact*.ts`, growth and held libraries, `redact-main-ref.ts`, `test-maskoutgoing*.ts`, `sandbox-real-mask.ts` (7,934) | ~11,600 deleted |
| 5 | Docs and spec status: dated deltas in specs 012, 041, 052, 084, 105 (and 005, 045, 058, 083, 119, which also name the mask), docs/safety.md (FR-451), docs/features.md (14 masking lines), README (1), docs/agent-notes.md (8), changelog fragment telling users | ~200 |

**Tests that must stay after every stage:** the planted-marker test (FR-450); the advisory fixes' tests (`test-agentconfirm.ts`, `test-agentprofiles.ts`, `test-adapter-contract.ts`, and the #1383 and #1416 asserts of `test-claude-adapter.ts`, FR-452); the invisible-character tests (`unhide`); the environment-hygiene tests (`secretFlag`, `envVarName`); spec 041 FR-012's read-tool tests; FR-449's "set / not set" tests.

## 6. Risks and honest limits

- **Screen sharing.** A person who shares their screen, records it or takes a screenshot shows what the agent printed, secrets included. The docs line says so; that is the person's choice (owner, 2026-11-23, #2060).
- **Copying a secret into a note.** If an agent prints a secret and the person saves or copies it, the note, the export or the clipboard holds it. Notes stay in userData (0600) unless the project switch is on.
- **Third-party logs.** The agent apps, the models' vendors and the OS keep their own logs and histories; Durbar never controlled them and does not now.
- **Managed or shared machines.** On a machine others can watch or administer, the screen shows more than before. An agent app's own organization policy (spec 076) is unchanged; Durbar adds no lock of its own.
- **The Undo copies** (`checkpoints/`) hold copies of edited files while the app runs, and after a crash until the next start (never masked): the named exception of FR-442 (Q45).
- **stderr** may be kept by a desktop launcher or the OS; after stage 1 it holds no agent text, but older runs' lines stay where the OS put them.
- **What Durbar still does not do** (principle III's other bullets stay): it does not store sign-ins (the vendor runtime does), has no telemetry, starts read-only, spawns no shell with user text, validates IPC in main, and parses untrusted files with caps.
- `[KNOWN GAP]` Not verified: what each OS does with stderr of a desktop-launched app; any run of the app (this is a reading of the code at `e9a712197`).

### Open questions for the owners (plain words)

- **Q42** The activity log today keeps the command or tool request (first 160 characters, masked) across restarts. Option 1: keep only the kind of request, the tool name and the length (no command or URL text); the live chat still shows what was asked while the app runs. Option 2: keep the full request as today (local saved state, so FR-442 would need an exception). **Answered by the owner Vikram, 2026-11-24 (option 1); the other two owners still to agree in writing.** FR-443 uses option 1 as the proposed default.
- **Q43** May *Copy diagnostics* or *Copy details* include the agent app's own error text, as shown on screen, when the person presses it? (This spec says yes: it is the person's action and copies what they see.)
- **Q44** Who tells existing users, and how: a changelog line plus the docs/safety.md line in the release that ships stage 2, or also a one-time note in the app?
- **Q45** Undo keeps copies of the files an agent edits (`checkpoints/` in userData: private, bounded, emptied at the next start, so a crash leaves them until then). Either (a) keep them as a **named exception** in FR-442 and the amendment ("copies for Undo, local, emptied at the next start, a feature the person sees"): no code cost, Undo works as today; or (b) Undo keeps only **hashes and paths**: no file content on disk, but Undo can then only tell that a file changed, not put it back, so spec 065's Undo is lost (or would need git, which spec 065 avoids). Which one? **Answered by the owner Vikram, 2026-11-24 (option 1; reason: local data like the agent apps' sessions); the other two owners still to agree in writing.** FR-442 and the amendment use option 1.

## 7. What is not decided

**Everything.** This is a proposal: nothing here changes behaviour until the three owners agree in writing. If they pick A or B, this spec is marked `superseded` with the decision; if C, stage 0 starts with the owners' rule line and the constitution amendment PR.
