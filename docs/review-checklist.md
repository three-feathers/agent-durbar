# Review checklist: first time right

Run this on your own diff **before you ask for review**, as a reviewer who assumes it is wrong: read the real diff (`git diff origin/main...HEAD`), not your memory of it. Every line is a mistake a reviewer here actually found. The rules around it (review-ready, learn after every round, fast lane) are in [AGENTS.md](../AGENTS.md) (*First time right*, FR-047..FR-049). Add a line when you find a new kind of mistake (reason and one evidence link); fix or delete a wrong one. Guidance only: nothing here overrides AGENTS.md, the constitution or the safety rules. Tool pitfalls go to [agent-notes.md](agent-notes.md).

## Where the list comes from

On 2026-10-23 Vikram's agent grouped the ~1,100 *Required fixes* in reviews of ~300 PRs since 2026-10-18 by keyword (approximate counts; Paco's agent added its own list):

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

## The branch and CI

- [ ] **Mergeable, and CI ran on this head.** A conflicting PR runs only CodeQL (no build, tests, gate or UI). Merge `origin/main`, push, read the checks of *that* sha (`scripts/pr-gate.sh <N>`). [#620](https://github.com/three-feathers/agent-durbar/pull/620), [#560](https://github.com/three-feathers/agent-durbar/pull/560)
- [ ] **After every merge of `main`, `git diff --stat origin/main...HEAD` lists only your files**: a bad resolution silently dropped another PR's code and its tests. [#560](https://github.com/three-feathers/agent-durbar/pull/560)
- [ ] **`package.json` test lists: keep both sides** of a `test:serial` conflict, then `npm test`. [#565](https://github.com/three-feathers/agent-durbar/pull/565)
- [ ] **CI for the exact sha, never "green" from memory**: `gh pr checks <N>`, then post `checks run at <sha>: …`. [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#588](https://github.com/three-feathers/agent-durbar/pull/588)
- [ ] **New CodeQL alerts fixed at the cause**, test code included (or dismissed with a reason). [#598](https://github.com/three-feathers/agent-durbar/pull/598)

## Spec, numbers and text

- [ ] **No spec or doc file shrank to 0 bytes or lost a block**: check every `-` column of `git diff --stat` on `specs/` and `docs/` (a script emptied `tasks.md`). PR #735
- [ ] **New FR, task and spec numbers checked** against `main` and open PRs; the PR names them. [#614](https://github.com/three-feathers/agent-durbar/pull/614)
- [ ] **No stale text after a fix**: `git grep` the old wording, numbers and `[KNOWN GAP]`s in spec, plan, tasks, README, notes and tooltips. [#628](https://github.com/three-feathers/agent-durbar/pull/628), [#625](https://github.com/three-feathers/agent-durbar/pull/625)
- [ ] **The PR description matches the head**: counts, "lands after #N", what was not verified. [#564](https://github.com/three-feathers/agent-durbar/pull/564), [#561](https://github.com/three-feathers/agent-durbar/pull/561)
- [ ] **Evidence tags are honest**: `sim:` for a driver, `read:` for reading, `real:` only for a real run; a cost or "0 credits" claim needs a real before/after or a `[KNOWN GAP]`. [#622](https://github.com/three-feathers/agent-durbar/pull/622), [#625](https://github.com/three-feathers/agent-durbar/pull/625)
- [ ] **Owner questions are asked, not assumed**: "answered" only with the owner's answer on record; list every option. [#577](https://github.com/three-feathers/agent-durbar/pull/577), [#629](https://github.com/three-feathers/agent-durbar/pull/629)

## Secrets and masking

- [ ] **Untrusted text in Markdown (release notes, PR or issue bodies) goes in a code span or is escaped**: `gh**p_…**`, `g<b></b>hp_…`, `ghp<!---->_…`, `ghp&#95;…` pass `redact()` and render as a token; raw text can also `@mention`, link and render HTML. [#665](https://github.com/three-feathers/agent-durbar/pull/665)
- [ ] **Mask, then cut**: a cut first leaves part of a token; use the shared helper (mask, plain, cut). [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#567](https://github.com/three-feathers/agent-durbar/pull/567)
- [ ] **Every surface is masked**: `title`, `aria-label`, tooltips, notes, toasts, notifications, copied diagnostics, lists, the lobby. [#567](https://github.com/three-feathers/agent-durbar/pull/567), [#614](https://github.com/three-feathers/agent-durbar/pull/614)
- [ ] **Glued and encoded tokens** (`_ghp_…_`, `my_ghp_…`, `ghp\_…`, `%3Dghp_…`, OAuth `code`/`state`, lowercase `bearer`): use `maskTokenShapes` in `src/shared/redact.ts`, never a copy. [#543](https://github.com/three-feathers/agent-durbar/pull/543), [#532](https://github.com/three-feathers/agent-durbar/pull/532)
- [ ] **No user paths, user names or time zone** in text meant for a public issue. [#630](https://github.com/three-feathers/agent-durbar/pull/630)
- [ ] **A mask for a shared file must not depend on what happens to be known at write time**: shapes always, all values, wait while locked. PR #931

## Hostile input and security

- [ ] **Outside text never reaches an agent** (FR-060): a script, workflow or brief that reads GitHub text filters by author and latest editor **before** printing a body or title (`scripts/trusted-lib.sh`), and passes titles, branches and bodies through `env:`. A fixture with an outside injection payload must not appear in the output (`scripts/test-trusted-content.ts`).
- [ ] **A parser input cap keeps token boundaries**: when a match ends at the cap, inspect the next character (`1.2.30` cut to `1.2.3` must not pass); test exact-cap and continuation; removing the guard fails. [#664](https://github.com/three-feathers/agent-durbar/issues/664)
- [ ] **Hostile lists in linear time, bytes capped as well as counts**: dedupe with a `Set` of keys (never `some` + `JSON.stringify`: 4,096 entries took 4.7 s on the main thread), cap per list and per source, skip an unchanged text by SHA-256 (not size and times), test the biggest input with a CPU bound. [#644](https://github.com/three-feathers/agent-durbar/pull/644)
- [ ] **User config is copied through an allow-list**: own properties, unknown keys dropped, all-or-nothing; test nested objects, huge strings, out-of-range numbers, `__proto__`. [#629](https://github.com/three-feathers/agent-durbar/pull/629), [#535](https://github.com/three-feathers/agent-durbar/pull/535)
- [ ] **Escaping has a test**: a hostile name with markup, so dropping `esc()` fails. [#552](https://github.com/three-feathers/agent-durbar/pull/552)
- [ ] **Files and paths**: links (`lstat`), absolute-path checks for every env var (`APPDATA` and `XDG_CONFIG_HOME`), size caps, Windows reserved names. [#535](https://github.com/three-feathers/agent-durbar/pull/535), [#615](https://github.com/three-feathers/agent-durbar/pull/615)
- [ ] **Values put into page code use `jsLiteral`**, never `JSON.stringify` inside `ctx.js(\`…\`)` (CodeQL `js/bad-code-sanitization`; `test:uisuite` refuses raw `${...}`). [#273](https://github.com/three-feathers/agent-durbar/pull/273)
- [ ] **Throw-away agent sessions switch off the user's MCP servers by name**, and every call has a time limit. [#620](https://github.com/three-feathers/agent-durbar/pull/620)
- [ ] **A policy or lock reader fails closed**: a well-formed lock on an unknown value is still a lock; only malformed answers are ignored; the spec says what an error or timeout does. [#642](https://github.com/three-feathers/agent-durbar/pull/642)
- [ ] **Undo restores the user's own choice, "none" included**, never the effective value or a default. [#642](https://github.com/three-feathers/agent-durbar/pull/642)
- [ ] **Map the vendor's failure event too**, not only success (`session.auto_tier_switch_failed`). [#642](https://github.com/three-feathers/agent-durbar/pull/642)
- [ ] **Timers use a monotonic clock; a bad value falls back to the most restrictive choice.** [#635](https://github.com/three-feathers/agent-durbar/pull/635)
- [ ] **A tool run inside the user's folder obeys that folder's config**: run git only through `nodeGitExec`, test with a planted marker command (details in [agent-apps.md](agent-apps.md)). [#718](https://github.com/three-feathers/agent-durbar/pull/718), [#719](https://github.com/three-feathers/agent-durbar/issues/719)
- [ ] **Text guards that emulate a parser** (YAML, shell) use its whitespace (`[ \t]`, not JS `\s`, which matches NBSP) and refuse non-ASCII. [#700](https://github.com/three-feathers/agent-durbar/pull/700)
- [ ] **One limit, end to end**: every layer that accepts or keys a value (renderer, IPC, adapter) uses the same named constant; a smaller middle cap refuses loudly, never drops silently. Display-only cuts are fine. Grep the old number; test just over the smallest cap. [#693](https://github.com/three-feathers/agent-durbar/pull/693)
- [ ] **Unusable input never gets a permissive default**: unreadable IPC input is refused with a reason (not *skipped*, *none* or *allowed*); a security decision on a bad value fails closed; untrusted files are still parsed tolerantly (constitution III). [#693](https://github.com/three-feathers/agent-durbar/pull/693)
- [ ] **Outside and Dependabot PRs: a human decides** (FR-062) on lockfile changes (new packages, `resolved`, `integrity`) and binaries; a new dependency only when a spec or plan names it. Never widen `test:supplychain`'s allow-list without an owner decision.

## Tests

- [ ] **Plant a mutation per new rule and see a test fail** (remove the guard, swap the order, return early); list them in the PR. [#630](https://github.com/three-feathers/agent-durbar/pull/630), [#554](https://github.com/three-feathers/agent-durbar/pull/554)
- [ ] **After a scripted edit or conflict resolution in a test file, no section disappeared**: compare `git diff --stat` and `grep -c assert` before and after. [#644](https://github.com/three-feathers/agent-durbar/pull/644)
- [ ] **An injected dependency is really used** (`env`, a clock, a runner): plant "use the global instead". FR-058
- [ ] **A test of a script's refusal is safe when the refusal breaks**: fakes first on `PATH` for every outside tool (record and fail), remotes pointing nowhere, assert none was called. FR-058
- [ ] **Test the behaviour, not the source text**; source regexes let wiring mutations through. [#594](https://github.com/three-feathers/agent-durbar/pull/594)
- [ ] **A source-scan test must not pass vacuously**: resolve the repo root (walk up to `package.json`, not `__dirname/../src` from `dist-scripts/`), assert a minimum match count, check the mutant through `npm run test:<x>`. PR #832
- [ ] **Repo files read as text split on `/\r?\n/`**: Windows CI checks out CRLF; check a scan against a CRLF copy (`sed -i 's/$/\r/'`). PRs #825, #832
- [ ] **Drivers wait on a condition**: `assert.ok(await until(...), '<what>')`, never a fixed sleep or single read (`until()` returns `false`, it does not throw). [#622](https://github.com/three-feathers/agent-durbar/pull/622), [#845](https://github.com/three-feathers/agent-durbar/pull/845)
- [ ] **A same-before-and-after driver check reads one settled render**: a DOM read before an action can lag the model, so do the action and its undo, then read, act and read in one page task. [#864](https://github.com/three-feathers/agent-durbar/pull/864)
- [ ] **Shortcut drivers branch on the platform's mod key** (Meta and ⌘ on macOS, Control elsewhere) for the key, label and `aria-keyshortcuts`. PR #560
- [ ] **No wall-clock limits in unit tests**: CPU time or growth ratios against a baseline from the same run, with a generous floor. [#527](https://github.com/three-feathers/agent-durbar/pull/527)
- [ ] **A tested op is not tested wiring**: call the registered IPC channel on a stand-in `electron` (`test-orgwiring.ts`), pin `main.ts` hand-over lines by text, plant "dependency dropped" and "returns `undefined`". [#644](https://github.com/three-feathers/agent-durbar/pull/644)
- [ ] **A driver assert on an outcome the simulator also enforces proves nothing**: assert the request was never sent (wrap the bridge call). [#644](https://github.com/three-feathers/agent-durbar/pull/644)
- [ ] **An async test whose promise never settles exits 0**: `process.exitCode = 1` at the start, 0 only after the OK line. Spec 093 phase 2
- [ ] **A test that accepts the failure path proves nothing** ("passes on 'Could not copy' too"). [#538](https://github.com/three-feathers/agent-durbar/pull/538)
- [ ] **Office changes with floors on run every driver that loads `simfloors`** (`grep -l simfloors scripts/*.js`). Spec 092 phase 1
- [ ] **Shared desk markup changes run the whole UI suite** (`node scripts/ui-suite.js`), keeping each feature's own wording. [#631](https://github.com/three-feathers/agent-durbar/pull/631)
- [ ] **A setting that hides a feature also releases what it holds** (a closed door's prompts, a refused remote control): ask and release, or keep that piece visible. PR 631
- [ ] **When the simulator bypasses main, test main's logic in a pure function**; never open a sim channel to main (spec 010 FR-022..FR-027). [#693](https://github.com/three-feathers/agent-durbar/pull/693)
- [ ] **An inode number is not an identity**: it is reused after a delete; test delete and recreate, not only rename. PR #931
- [ ] **A safe delete also needs its failure path checked**: the rename-back, and where the file ended up. PR #931
- [ ] **A stale-breaker that looks, then deletes by path is a race**: move aside and check identity, or carry a token. Issue #723
- [ ] **A script that spends credits gates every send**: budget checked in one pure function right before each send; unknown usage is unknown, never 0; only the exact command runs in a mode with no approval card; take a baseline first; plant cap-raised, extra-prompt and stop-disabled mutants. [#827](https://github.com/three-feathers/agent-durbar/pull/827)
- [ ] **Main changes what the window reads in one synchronous step, then awaits teardown**: a tab list updated before its active tab let a driver name a removed tab (spec 080 closeTab, 2026-10-31).
- [ ] **A handler main gives Electron answers on every path**: `setWindowOpenHandler` code that calls main's own logic is wrapped so a throw still returns `deny` (and a test makes it throw); a page's request never moves the keyboard focus unless the page itself had it (spec 080, review of #915, 2026-10-31).
- [ ] **A driver runs a page's script in that page's own `webContents`**, not in "the attached view": a page that opens a tab stops being the attached one mid-step (spec 080 `check-browser-tabs`, 2026-10-31).
- [ ] **A menu row sends only its own field**, merged when its turn comes; a fake answers as the real runtime does (spec 030).
- [ ] **Mutate each guard both ways**: surviving mutants hid four real gaps (#935).
- [ ] **No unquoted `$` or heredoc in a shell comment body**: `$0.0066` became `/bin/bash.0066`.
- [ ] **Sub-agents get unique scratch folders and one PR-body file each**: files overwritten on 2026-10-23 and again 2026-10-31.

## UI and accessibility

- [ ] **Dialog semantics**: `role="dialog"`/`alertdialog` with `aria-modal`, the guard (focus trap, keys) tested, menus with consistent `menu`/`menuitem`. [#597](https://github.com/three-feathers/agent-durbar/pull/597), [#632](https://github.com/three-feathers/agent-durbar/pull/632)
- [ ] **A refusable action says so**: the handler returns whether it acted, the UI announces success only then, the button is disabled with the reason. [#640](https://github.com/three-feathers/agent-durbar/pull/640)
- [ ] **Announcements reach a screen reader** (live region used and tested); focus lands sensibly after Escape. [#622](https://github.com/three-feathers/agent-durbar/pull/622)
- [ ] **Theme tokens, not literals**; check one dark and one non-default theme. [#530](https://github.com/three-feathers/agent-durbar/pull/530), [#588](https://github.com/three-feathers/agent-durbar/pull/588)
- [ ] **Tooltips stay within the limit** with the longest real value. [#630](https://github.com/three-feathers/agent-durbar/pull/630)
- [ ] **Screenshots at 1440x900 and 1280x800**, every linked picture of the changed screen retaken (`npm run shots:docs`) and looked at (no figures mid-walk). [#632](https://github.com/three-feathers/agent-durbar/pull/632), [#574](https://github.com/three-feathers/agent-durbar/pull/574)

## Platforms

- [ ] **No POSIX-only defaults** (output folders, separators); paths compared case-sensitively except on Windows and macOS. [#496](https://github.com/three-feathers/agent-durbar/pull/496)
- [ ] **macOS runs on PRs only for platform-sensitive paths** (spec 008 FR-106, FR-135): say "not verified on macOS" for a macOS-only path. [#561](https://github.com/three-feathers/agent-durbar/pull/561)
- [ ] **Synthetic native text keys are not native editing**: macOS `sendInputEvent` ⌘⌫ / ⌘A reach the renderer but do not edit; assert the app does not intercept them, claim nothing about a real Mac. Issue #683

## Reuse and docs

- [ ] **Search for an existing helper, predicate, dialog or matcher** first (`git grep` the concept) and name it in the PR. [#628](https://github.com/three-feathers/agent-durbar/pull/628), [#560](https://github.com/three-feathers/agent-durbar/pull/560)
- [ ] **Docs in the same PR**: `changelog.d/` fragment, `specs-index` status, task ticked, README and notes. [#535](https://github.com/three-feathers/agent-durbar/pull/535)

## How we review

- **Format**: **Strengths**, **Required fixes** (numbered, each with `file:line`, a concrete failure from a probe or mutation, and the fix), then **Questions**; end with what you ran and what you did not.
