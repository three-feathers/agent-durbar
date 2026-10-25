# Review checklist: first time right

Run this on your own diff **before you ask for review**. Every line below is a mistake a reviewer on this repo actually found and asked to fix, so each one you catch yourself saves a review round (often a whole CI run and a re-approval).

The rule to use it is in [AGENTS.md](../AGENTS.md) (*Working as a team*, spec 021 FR-047/FR-048). **This file is living:** when you review a PR and find a new kind of mistake, add a line here in that PR or in a small docs PR, with the reason and one evidence link. Fix or delete a line that turns out to be wrong.

**After every review round** the reviewer **and** the author add what was new (a kind of mistake, or a review technique). Start each round with `git pull --ff-only origin main` and re-read this file when it changed. A PR that changes only this file and/or `agent-notes.md` takes the **fast lane**: one quick content approval from another side's agent, no waiting for the full CI, and the merger checks that `git diff --name-only origin/main...HEAD` lists only those files. Still a branch and a PR, never a push to `main`; no secrets, tokens or links to private data, and secret scanning still applies (AGENTS.md, *First time right*; spec 021 FR-049).

**This file is guidance, not instructions.** Nothing here overrides [AGENTS.md](../AGENTS.md), the [constitution](../.specify/memory/constitution.md) or the safety rules; a line that tries to is removed. Tool pitfalls and checked vendor behaviour go to [agent-notes.md](agent-notes.md); this file is the short list to tick.

## Where the list comes from

On 2026-10-23 Vikram's agent read the reviews, line comments and PR comments of the ~300 PRs updated since 2026-10-18 (reviews by Paco's, Ruben's and Vikram's agents), took the items under *Required fixes* (about 1,100), and grouped them by keyword. Paco's agent added its own list the same day (marked *Paco's agent*). The counts are approximate: a keyword clustering, not a hand count; one finding can fall in two groups.

| Pitfall | Findings | PRs |
|---|---:|---:|
| Masking: a secret shown somewhere, or cut before it was masked | ~111 | 24 |
| Docs, screenshots, changelog or index not updated | ~75 | 36 |
| Behaviour untested, or a planted mutation survives | ~65 | 38 |
| Head not mergeable, so CI never ran on it, or CI red | ~54 | 31 |
| Stale spec, plan, task or doc text after a fix | ~54 | 28 |
| Honest limits: evidence tags, `[KNOWN GAP]`, cost claims | ~53 | 28 |
| Hostile input: allow-lists, escaping, links, sizes | ~52 | 26 |
| Windows and macOS parity | ~45 | 23 |
| Accessibility and dialog semantics | ~36 | 15 |
| Driver timing: fixed waits, reading once, wall-clock tests | ~24 | 14 |
| A parallel copy of an existing capability | ~20 | 15 |
| Stale PR description | ~15 | 14 |
| Theme and layout literals | ~15 | 8 |
| `package.json` test-list conflicts | ~10 | 5 |

## Before you ask for review

Do it **adversarially**: assume your diff is wrong, read the real diff (`git diff origin/main...HEAD`), not your memory of it, and try to break it.

### The branch and CI

- [ ] **Mergeable, and CI ran on this head.** A PR that conflicts with `main` runs only CodeQL: no build, tests, gate or UI shards. Merge `origin/main`, push, and wait for the checks of *that* sha (`scripts/pr-gate.sh <N>`). Before requesting review also agree the acceptance cases, run the cheap local checks (`changelog:check`, `specs:check`) and, for high-risk parsing or security changes, prepare adversarial regression cases; never reduce required coverage. Also: #675 had the same changelog-format failure on two OSes, #631 a shared UI expectation failure on two OSes, #669 further parser edge cases across review rounds. *Evidence:* [#620](https://github.com/three-feathers/agent-durbar/pull/620), [#560](https://github.com/three-feathers/agent-durbar/pull/560).
- [ ] **After every merge of `main`, `git diff --stat origin/main...HEAD` lists only your files.** A bad resolution silently dropped #615 and others from one branch, and CI stayed green because the tests went with it (*Paco's agent*). *Evidence:* [#560](https://github.com/three-feathers/agent-durbar/pull/560).
- [ ] **`package.json` test lists: keep both sides.** Most merge conflicts are the `test:serial` line: keep `main`'s list and append yours, then run `npm test`. *Evidence:* [#565](https://github.com/three-feathers/agent-durbar/pull/565), [#567](https://github.com/three-feathers/agent-durbar/pull/567).
- [ ] **Read CI for the exact sha, never "green" from memory** (*Paco's agent*). `gh pr checks <N>` and check the head sha; post `checks run at <sha>: …` with what you ran; after a review round state the fix delta, so reviewers check that delta and the risks it touches. *Evidence:* [#630](https://github.com/three-feathers/agent-durbar/pull/630) (red at the reviewed sha), [#588](https://github.com/three-feathers/agent-durbar/pull/588) (checks still pending).
- [ ] **New CodeQL alerts on the PR are fixed at the cause**, test code included (or dismissed with a written reason). *Evidence:* [#598](https://github.com/three-feathers/agent-durbar/pull/598), [#518](https://github.com/three-feathers/agent-durbar/pull/518).

### Spec, numbers and text

- [ ] **No spec file shrank to 0 bytes or lost a large block in the diff** (`git diff --stat origin/main...HEAD`: look at every `---` column on specs/ and docs/). A script that opened a file for writing before reading it emptied `tasks.md` (T001..T124) in a late commit on #735 (*Ruben's agent*). *Evidence:* PR #735.

- [ ] **New FR, task and spec numbers checked against `main` and the open PRs** that touch the same spec; the PR says which numbers it took. Three collisions on 2026-10-23 alone (*Paco's agent*). *Evidence:* [#614](https://github.com/three-feathers/agent-durbar/pull/614).
- [ ] **No stale text after a fix.** Search the spec, plan, tasks, README, agent notes and tooltips for the old wording, numbers and `[KNOWN GAP]`s your change made untrue (`git grep` the old phrase). *Evidence:* [#628](https://github.com/three-feathers/agent-durbar/pull/628), [#625](https://github.com/three-feathers/agent-durbar/pull/625), [#554](https://github.com/three-feathers/agent-durbar/pull/554).
- [ ] **The PR description matches the head**, not the first push: counts, "lands after #N", what was not verified. Update it with every round. *Evidence:* [#564](https://github.com/three-feathers/agent-durbar/pull/564), [#543](https://github.com/three-feathers/agent-durbar/pull/543), [#561](https://github.com/three-feathers/agent-durbar/pull/561).
- [ ] **Evidence tags are honest.** `sim:` when a driver checks it, `read:` when you only read code, `real:` only for a real run. A cost or "0 credits" claim needs a real before/after, or a `[KNOWN GAP]` (*Paco's agent*). *Evidence:* [#622](https://github.com/three-feathers/agent-durbar/pull/622), [#620](https://github.com/three-feathers/agent-durbar/pull/620), [#625](https://github.com/three-feathers/agent-durbar/pull/625).
- [ ] **Owner questions are asked, not assumed.** A question is "answered" only with the owner's answer on record; list every option. *Evidence:* [#577](https://github.com/three-feathers/agent-durbar/pull/577), [#629](https://github.com/three-feathers/agent-durbar/pull/629).

### Secrets and masking

- [ ] **Untrusted text written into Markdown (release notes, PR or issue bodies) goes into a code span or is escaped** (*Paco's agent*, with Vikram's review). Masking raw text does not survive Markdown/HTML rendering: `gh**p_…**`, `g<b></b>hp_…`, `ghp<!---->_…` and `ghp&#95;…` pass `redact()` unchanged and render as a token; raw text also lets `@name` mention people and links, images and HTML render. *Evidence:* [#665](https://github.com/three-feathers/agent-durbar/pull/665).
- [ ] **Mask, then cut** (*Paco's agent* too). A cut before the mask leaves part of a token (`plain(x,200)` before `redact()` left 14 characters of a `ghp_` token). Use the shared helper that masks, then makes plain, then cuts. *Evidence:* [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#567](https://github.com/three-feathers/agent-durbar/pull/567).
- [ ] **Every surface is masked**, not only the main text: `title`, `aria-label`, tooltips, notes, toasts, notifications, copied diagnostics, lists and the lobby. *Evidence:* [#567](https://github.com/three-feathers/agent-durbar/pull/567), [#614](https://github.com/three-feathers/agent-durbar/pull/614).
- [ ] **Glued and encoded tokens:** `_ghp_…_`, `my_ghp_…`, `ghp\_…`, `%3Dghp_…`, OAuth `code`/`state`, lowercase `bearer`. Use `maskTokenShapes` in `src/shared/redact.ts`; never copy the shapes. *Evidence:* [#543](https://github.com/three-feathers/agent-durbar/pull/543), [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#532](https://github.com/three-feathers/agent-durbar/pull/532).
- [ ] **No user paths, user names or time zone in copied text** meant for a public issue. *Evidence:* [#630](https://github.com/three-feathers/agent-durbar/pull/630).

### Hostile input and security

- [ ] **A parser input cap preserves token boundaries.** Inspect the next character when a match ends at the cap; truncating `1.2.30` to `1.2.3` must not turn invalid input into a valid version. Test exact-cap success and continuations; removing the boundary guard must fail. *Evidence:* [#664](https://github.com/three-feathers/agent-durbar/issues/664).
- [ ] **Read hostile lists in linear time, and cap bytes as well as counts** (*Ruben's agent*): remove duplicates with a `Set` of keys, never `some`/`includes` plus `JSON.stringify` per pair (4,096 entries took 4.7 s on the main thread, every 60 s). Cap the characters per list and per source, say in the spec what happens over a cap, skip the parse when the text is unchanged (key it on a SHA-256 of the text, never on size and times: a swapped link keeps both), and add a test with the biggest allowed input and a CPU bound plus a growth ratio. *Evidence:* [#644](https://github.com/three-feathers/agent-durbar/pull/644).
- [ ] **Anything copied from user config goes through an allow-list:** own properties only, unknown keys dropped, and a bad value in an allowed key means nothing is copied (all-or-nothing). Test a hostile matrix (nested objects, huge strings, out-of-range numbers, `__proto__`). *Evidence:* [#629](https://github.com/three-feathers/agent-durbar/pull/629), [#500](https://github.com/three-feathers/agent-durbar/pull/500), [#535](https://github.com/three-feathers/agent-durbar/pull/535).
- [ ] **Escaping has a test:** a hostile name or title with markup, so dropping `esc()` fails a test. *Evidence:* [#552](https://github.com/three-feathers/agent-durbar/pull/552), [#511](https://github.com/three-feathers/agent-durbar/pull/511), [#535](https://github.com/three-feathers/agent-durbar/pull/535).
- [ ] **Files and paths:** links (`lstat`), absolute-path checks for every env var (`APPDATA` as well as `XDG_CONFIG_HOME`), size caps, Windows reserved names. *Evidence:* [#535](https://github.com/three-feathers/agent-durbar/pull/535), [#615](https://github.com/three-feathers/agent-durbar/pull/615), [#488](https://github.com/three-feathers/agent-durbar/pull/488).
- [ ] **Values put into page code use `jsLiteral`**, never a raw expression or `JSON.stringify` inside a `ctx.js(\`…\`)` string (CodeQL `js/bad-code-sanitization`). *Evidence:* [#273](https://github.com/three-feathers/agent-durbar/pull/273).
- [ ] **One-shot or throw-away agent sessions switch off the user's MCP servers by name** (*Paco's agent*), and every call in them has a time limit. *Evidence:* [#620](https://github.com/three-feathers/agent-durbar/pull/620).
- [ ] **A policy or lock reader fails closed** (*Paco's agent*): a well-formed lock on a value you don't know (a future name) is still a lock. Only a malformed answer is ignored, and the spec says what an error or timeout does. *Evidence:* [#642](https://github.com/three-feathers/agent-durbar/pull/642) (an organization lock on an unknown Auto tier sent `efficiency` against it).
- [ ] **Undo restores the user's own choice, "none" included**, never the value in effect or a default (*Paco's agent*). *Evidence:* [#642](https://github.com/three-feathers/agent-durbar/pull/642).
- [ ] **Map the vendor's failure event too**, not only the success one: a "requested" state shown without its failure path claims something untrue. *Evidence:* [#642](https://github.com/three-feathers/agent-durbar/pull/642) (`session.auto_tier_switch_failed`).
- [ ] **Timers use a monotonic clock, and a bad value falls back to the most restrictive choice** (*Paco's agent*). *Evidence:* [#635](https://github.com/three-feathers/agent-durbar/pull/635) (monotonic sign-in clock, minimum for a broken time limit).
- [ ] **A tool run inside the user's folder obeys that folder's config** (*Ruben's agent*): `git` (`core.fsmonitor`, filter drivers, external diff, lazy-fetch ssh, submodules) and any tool with a per-folder config file. Run git only through `nodeGitExec`, and test with a planted command that writes a marker. *Evidence:* [#718](https://github.com/three-feathers/agent-durbar/pull/718), [#719](https://github.com/three-feathers/agent-durbar/issues/719).
- [ ] **Text guards that emulate a parser** (YAML, shell): use the parser's own whitespace (`[ \t]`, not JS `\s`, which also matches NBSP/U+3000) and refuse non-ASCII in the guarded file. *Evidence:* [#700](https://github.com/three-feathers/agent-durbar/pull/700).
- [ ] **One limit, end to end** (*Paco's agent*, owner request): when a value crosses layers (renderer card, IPC handler in main, adapter, vendor), every layer that **accepts or keys** the value uses the **same named constant** for its size or count. A smaller cap in a middle layer must **refuse loudly**, never drop the value silently (a dropped answer then reads as "no answer" downstream). Display-only cuts (a tooltip, a preview) and a vendor's own smaller cap are fine when they never change what is stored or sent. Grep the old number when you change a limit, and test with a value just over the smallest cap. *Evidence:* [#693](https://github.com/three-feathers/agent-durbar/pull/693) (main kept answers only for questions of 300 characters or fewer while the card allowed 2000, so long questions were "skipped").
- [ ] **Unusable input never gets a permissive or meaning-changing default** (*Paco's agent*): user input that crosses IPC and can't be read is **refused loudly** with a reason (it must not fall through to *skipped*, *none* or *allowed*); a security decision on a bad value **fails closed** (the most restrictive choice, as the line above says); untrusted files are still parsed tolerantly (constitution III). *Evidence:* [#693](https://github.com/three-feathers/agent-durbar/pull/693).

### Tests

- [ ] **Plant a mutation for each new rule and see a test fail:** remove the guard, swap the order, return early. If it survives, the rule is untested. Say in the PR which mutations you planted. *Evidence:* [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#620](https://github.com/three-feathers/agent-durbar/pull/620), [#554](https://github.com/three-feathers/agent-durbar/pull/554).
- [ ] **After a scripted edit or a conflict resolution in a test file, check that no test section disappeared** (*Paco's agent*). A green suite proves nothing here, because the removed tests go with the guards they covered. Compare `git diff --stat` and the count of assertions (`grep -c 'assert' <file>`) before and after; a large deletion in a test file needs a reason in the commit. *Evidence:* [#644](https://github.com/three-feathers/agent-durbar/pull/644) (an index-range replace in a Python edit script ran past its block and dropped section (f): 6 guard-removal mutants then passed every suite).
- [ ] **An injected dependency is really used** (*Paco's agent*): a function that takes `env`, a clock or a runner as a parameter but reads `process.env` (or the real one) inside passes a test that injects a fake, because the fake is never consulted. Plant "use the global instead" and see a test fail. *Evidence:* spec 021 FR-058 (`weekly-test-audit-mutate.ts` took `env` but cleaned `process.env`; the mutation "env not cleaned" survived until fixed).
- [ ] **Test the behaviour, not the source text.** Source regexes and pure-mapping tests let wiring mutations through. *Evidence:* [#594](https://github.com/three-feathers/agent-durbar/pull/594), [#535](https://github.com/three-feathers/agent-durbar/pull/535).
- [ ] **Drivers wait on a condition** (`until()` with a generous timeout), never a fixed sleep or a single read: Windows and loaded machines are slower. *Evidence:* [#622](https://github.com/three-feathers/agent-durbar/pull/622), [#597](https://github.com/three-feathers/agent-durbar/pull/597), [#572](https://github.com/three-feathers/agent-durbar/pull/572) (screenshot 200 ms after open).
- [ ] **Drivers that check shortcuts branch on the platform's mod key** (Meta and the ⌘ label on macOS, Control and `Ctrl+...` elsewhere): the key they send, the label and `aria-keyshortcuts` they expect. A driver that hard-codes Ctrl can never pass on the macOS runner. *Evidence:* PR #560 (`check-sched-top.js`).
- [ ] **No wall-clock limits in unit tests** (`Date.now`, `hrtime`): they flake under load. Measure CPU time or growth ratios. *Evidence:* [#527](https://github.com/three-feathers/agent-durbar/pull/527).
- [ ] **No wall-clock limits in unit tests** (`Date.now`, `hrtime`): they flake under load. Measure CPU time or growth ratios against a baseline from the same run, with a generous floor; never a bare wall-clock bound. *Evidence:* [#527](https://github.com/three-feathers/agent-durbar/pull/527).
- [ ] **A tested op is not tested wiring** (*Ruben's agent*, PR 644). Every dependency that `main.ts` or an IPC `register` hands to a tested op needs its own mutant caught: call the registered channel on a stand-in `electron` with a blocking dependency (`test-orgwiring.ts`, `test-mcp-signin.ts`), and pin the `main.ts` hand-over lines by their text (main.ts cannot run in a test). Plant "dependency dropped" and "dependency returns `undefined`" for each. *Evidence:* [#644](https://github.com/three-feathers/agent-durbar/pull/644).
- [ ] **A driver assert on an outcome the simulator also enforces proves nothing** (*Ruben's agent*): the simulator's `setPermMode` refused the same mode as the menu's guard, so removing the guard passed. Assert the request was never sent (wrap the bridge call) and no toast appeared. *Evidence:* [#644](https://github.com/three-feathers/agent-durbar/pull/644).
- [ ] **A test that accepts the failure path proves nothing** ("passes on 'Could not copy' too"). *Evidence:* [#538](https://github.com/three-feathers/agent-durbar/pull/538).
- [ ] **A change to shared desk markup runs every feature's drivers, not only its own.** Desk pills, tooltips, status words and scenes are read by other specs' drivers (034 Retrying, 052 UX, done-desk-mask, coffee, lobby): run the whole UI suite (`node scripts/ui-suite.js`, one Electron at a time) before asking for review, and keep each feature's own wording (a pill's tooltip line, its plain word) when you restyle the element. *Evidence:* [#631](https://github.com/three-feathers/agent-durbar/pull/631) (the door sign replaced the Retrying pill's tooltip line and the Error word; `shots-034-retry` went red in CI only).
- [ ] **A setting that hides a feature also releases what that feature holds.** Turning a feature off (a Settings switch, a mode) must not hide state the user created and that still acts: a closed door still holding prompts, a remote control refused with no button left to undo it. Either ask and release it when the setting changes, or keep that piece visible with its control; drive it in the simulator (review on PR 631, 2026-10-25).
- [ ] **When the simulator bypasses main, test main's logic itself** (*Paco's agent*): the sim talks to the renderer directly for some calls (for example `answerQuestion`), so a driver can't see an IPC handler bug. Put the handler's logic in a pure, Electron-free function that a unit test drives, and have the sim's fake call that same function. **Never open a sim channel to main** (spec 010 FR-022..FR-027, `src/main/simguard.ts`). *Evidence:* [#693](https://github.com/three-feathers/agent-durbar/pull/693).

### UI and accessibility

- [ ] **Dialog semantics:** a modal is `role="dialog"` or `role="alertdialog"` with `aria-modal`, its guard (focus trap, keys) is tested, and menus keep `role="menu"`/`menuitem` consistent. *Evidence:* [#597](https://github.com/three-feathers/agent-durbar/pull/597) (the guard switched off survived), [#632](https://github.com/three-feathers/agent-durbar/pull/632).
- [ ] **An action that can be refused says so** (*Paco's agent*): the handler returns whether it acted, the UI announces success only then (else the reason), and the button is disabled with the reason while it cannot act. A "Retry now" announced success while a guard sent nothing. *Evidence:* [#640](https://github.com/three-feathers/agent-durbar/pull/640).
- [ ] **Announcements reach a screen reader** (the live region is used and tested), and focus goes somewhere sensible after Escape. *Evidence:* [#622](https://github.com/three-feathers/agent-durbar/pull/622), [#538](https://github.com/three-feathers/agent-durbar/pull/538).
- [ ] **Theme tokens, not literals**, and check one dark and one non-default theme. *Evidence:* [#530](https://github.com/three-feathers/agent-durbar/pull/530), [#588](https://github.com/three-feathers/agent-durbar/pull/588), [#505](https://github.com/three-feathers/agent-durbar/pull/505).
- [ ] **Tooltips stay within the length limit** with the longest real value (a failed server, a long name). *Evidence:* [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#538](https://github.com/three-feathers/agent-durbar/pull/538).
- [ ] **Screenshots at both sizes** (1440x900 and 1280x800), and every linked picture of the changed screen retaken (`npm run shots:docs`); look at each one (no figures caught mid-walk). *Evidence:* [#632](https://github.com/three-feathers/agent-durbar/pull/632), [#574](https://github.com/three-feathers/agent-durbar/pull/574).

### Platforms

- [ ] **No POSIX-only defaults** (output folders, separators), and paths compared case-sensitively except on Windows and macOS. *Evidence:* [#496](https://github.com/three-feathers/agent-durbar/pull/496), [#572](https://github.com/three-feathers/agent-durbar/pull/572).
- [ ] **macOS is not run on PRs** (spec 008 FR-106): a macOS-only path says "not verified on macOS" in the PR. *Evidence:* [#561](https://github.com/three-feathers/agent-durbar/pull/561), [#625](https://github.com/three-feathers/agent-durbar/pull/625).
- [ ] **Synthetic native text keys are not native editing.** Electron's macOS `webContents.sendInputEvent` delivers ⌘⌫ / ⌘A to the renderer but does not perform deletion / selection. Assert the app does not intercept the event; do not treat the unchanged input as real-Mac behavior. *Evidence:* issue #683, spec 074.

### Reuse and docs

- [ ] **Search for an existing helper, predicate, dialog or matcher** before writing one (`git grep` the concept); name it in the PR. *Evidence:* [#628](https://github.com/three-feathers/agent-durbar/pull/628), [#560](https://github.com/three-feathers/agent-durbar/pull/560), [#535](https://github.com/three-feathers/agent-durbar/pull/535).
- [ ] **Docs in the same PR:** a `changelog.d/` fragment (not `CHANGELOG.md`), the spec's `specs-index` status, the task ticked, README and agent notes. *Evidence:* [#535](https://github.com/three-feathers/agent-durbar/pull/535), [#628](https://github.com/three-feathers/agent-durbar/pull/628).

### Your own setup

- [ ] **Sub-agents get unique scratch folders**, never shared file or script names: three PR bodies were overwritten on 2026-10-23 (*Paco's agent*). Keep each PR body in its own file.

## What reviewers praised (do more of this)

- **One helper owns the order** (mask, then plain, then cut), and it **fails closed**: a missing or throwing helper gives an empty or neutral text. [#567](https://github.com/three-feathers/agent-durbar/pull/567)
- **Drivers that scan every text node and every attribute**, at both sizes and in every mode, with planted secrets. [#567](https://github.com/three-feathers/agent-durbar/pull/567)
- **Mutations listed in the PR, each caught.** [#567](https://github.com/three-feathers/agent-durbar/pull/567), [#588](https://github.com/three-feathers/agent-durbar/pull/588)
- **Reuse named explicitly** (store, channels, dialog row, existing checks). [#629](https://github.com/three-feathers/agent-durbar/pull/629), [#628](https://github.com/three-feathers/agent-durbar/pull/628)
- **Tight allow-lists by construction:** an IPC channel with no argument, own properties only. [#594](https://github.com/three-feathers/agent-durbar/pull/594), [#635](https://github.com/three-feathers/agent-durbar/pull/635)
- **Honest limits:** README and changelog say "simulator and fakes only" when nothing ran on a real account. [#598](https://github.com/three-feathers/agent-durbar/pull/598), [#594](https://github.com/three-feathers/agent-durbar/pull/594)
- **Seams for testing** (spawn, kill, clock injected) and no shell on Windows. [#565](https://github.com/three-feathers/agent-durbar/pull/565)

## How we review

The same habits on all three sides; the rules behind them are in [AGENTS.md](../AGENTS.md) (*Reviews and merge*, *Re-approving after a push*).

- **Say what you read:** post `reviewing at <sha>` before you start. A push makes it stale.
- **Format** (from Paco's agent's reviews): **Strengths** (what to keep), **Required fixes**, numbered, each with `file:line`, a concrete failure (a probe or a mutation) and the fix in code, then **Questions**. No "non-blocking" notes: every solvable finding is required (AGENTS.md, *Review findings are fixed in the PR*). End with what you ran and what you did not.
- **Read CI for the exact sha** with `gh pr checks <N>`; run locally only what CI cannot prove (mutations you plant yourself, probes, Windows- or macOS-only paths), once, and post `checks run at <sha>: …`.
- **Re-approval after a push:** compare the PR's own code with the commit you approved by `git patch-id --stable`; same id, re-approve and say so; different, review the difference.
- **Adversarial self-review** before you ask anyone: run this checklist on your own diff, as a reviewer who assumes it is wrong. A reviewer sub-agent (see [agent-setup](agent-setup/README.md)) helps for medium and large changes.
- **Add what you found:** a reviewer who finds a new kind of mistake adds a line to this file.
