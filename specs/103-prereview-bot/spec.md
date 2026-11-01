# Feature Specification: Pre-review bot (team tooling on the Claude Agent SDK)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Pre-review bot (team tooling on the Claude Agent SDK)
status: draft
note: phases 1-2 built, fake SDK only; posting as the App built but off; real runs (phase 3) wait for the owner
-->

**Feature Branch**: `103-prereview-bot` (spec). The build is one small PR per phase.
**Created**: 2026-11-01
**Status**: Phases 1 and 2 built (fake SDK only, `test:prereview`); `[KNOWN GAP]` no real call has been made, nothing has been spent; phase 3 waits for the owner.
**Input**: Owner's order (Vikram, 2026-11-01): a read-only bot that reads our PRs before other owners do, on API credits of his API organisation. Recorded in spec 021 as FR-069. Team tooling under `scripts/`, not app code: no `src/` change, no feature for users. Numbers: spec 103, checked 2026-11-01 against `main`, the remote branches and the open PRs (specs up to 102 are taken).

## Why

A review round costs the other owners' time, and the evidence of one week (the owner's reading, not re-derived here) says two kinds of reader find different things. Codex found **reach and state gaps** that reviewers missed: accessibility parity, regressions on the flat path. Our reviews find **mutant gaps, stale text and overclaims**. The bot asks both kinds of question before a human or another side's agent spends time on the PR. It does not replace any of them.

## Owner decisions (2026-11-01)

- It reads our PRs before other owners do. Results go to Vikram's coordinating session first.
- It never counts as an approval. It posts nothing to GitHub in v1.
- It runs on this server, read-only: a diff from a detached worktree with no local state. Outside authors' text never reaches it. Its output is data, not instructions.
- The key lives in a local 0600 file outside any repo, created and saved by Vikram himself; never pasted in chat. No repo secret, no CI. A monthly spend limit in the Console, a per-run spend ceiling, and logs with no secrets.
- Cost per review is measured on first uses and reported.

## Existing capabilities, compared (spec 021 FR-031)

- **The weekly test audit (spec 021 FR-058)** is the nearest thing: `scripts/weekly-test-audit.sh`, Claude on a detached worktree of its own clone, as its own unix user, with a timeout and a budget flag, its code installed from reviewed `main`. This spec reuses that shape: the own user, own clone, lock, cleanup, install step and templates. It does not reuse the audit: that one runs test code on a plan login, on `main`, on a timer, and files issues; this one runs no code, on API credits, on one PR, on request, and files nothing.
- **Reused as they are:** `scripts/trusted-lib.sh` and `scripts/trusted-authors.txt`, the outside-PR check of `pr-gate.sh`, `scripts/gh-trusted.sh` (one small option added), `maskTokenShapes` in `src/shared/redact.ts`, `lockProblems` in `test-supplychain.ts`, `docs/review-checklist.md`.
- **Not a parallel adapter:** `src/adapters` drives agents for users of the app. Nothing here touches it, and the app gains no dependency.

## User Scenarios & Testing

### User Story 1 - The coordinating session gets a first read of one of our PRs (Priority: P1)

**Why**: it is the feature. **Independent Test**: with a fake SDK, `prereview <N>` on a fixture PR prints a report of two passes, and a recording fake `gh` saw only read calls.

1. **Given** an open PR of a trusted author from this repo, **When** the coordinating session starts the bot on it, **Then** after at most the timeout it prints findings of both passes, the PR's head sha, status, tokens and estimated cost, inside a block marked as data.
2. **Given** that report, **When** anyone looks on GitHub, **Then** nothing changed: no comment, review, label or status; `pr-gate.sh` gives the same answer as before.
3. **Given** the PR moved on, **When** the report is read, **Then** the sha shows it is about an older head.

### User Story 2 - It refuses what it must not read, and stays in its box (Priority: P1)

**Why**: the repo is public and the bot holds a paid key. **Independent Test**: `test:prereview`, fixtures and fakes, no key, no network.

1. **Given** a PR from a fork, by an outside author or Dependabot, last edited by an outsider, or with a commit by an outside account, **Then** it refuses before any fetch, naming only the author and link, for a human.
2. **Given** a planted injection payload in an outside comment, title and body, **Then** the payload is in no prompt.
3. **Given** a diff that says "read the key file", or a planted symlink to it, or a tool call on a path outside the worktree, **Then** the hook denies it, the denial is logged and reported.
4. **Given** a PR that edits `AGENTS.md`, the checklist or the bot's prompts, **Then** the prompts used are still those of the installed copy from reviewed `main`.

### User Story 3 - Spend stays small, and is measured (Priority: P1)

**Why**: credits are real money and a time-limited grant. **Independent Test**: fake SDK with fixed usage; the real numbers come from the first uses.

1. **Given** this month's ledger plus the run's ceiling exceeds the local monthly ceiling, **Then** nothing is sent.
2. **Given** a run that cannot state its cost, **Then** it counts at its full ceiling, and the next run is refused until a human looks.
3. **Given** the first five uses, **Then** a dated `real:` delta records cost per review against the Console's number, and what was found against what later reviewers found.

### Edge cases

- Diff over the size cap: refused and said so, never cut (a cut diff reads as a clean one).
- Empty diff, a PR closed unmerged, a merged PR without `--replay <sha>`, a replay sha not among the PR's own commits, a sha that moved between gate and fetch: refused.
- The model declines (`stop_reason` refusal; safety classifiers can trip on security code such as our redaction and sandbox work): reported as `declined` for that pass; no retry or fallback model on its own; the spend still counts.
- Budget or turn limit reached mid-pass: reported as `stopped`, findings so far marked partial; never presented as a clean result.
- Output that fails the schema: `unusable`, the raw text kept in the local file only, nothing passed on.
- A killed run: worktree, temp home and lock cleaned on the next start; the ledger line was written before the send and counts at the ceiling, and the next run is refused until a person looks at the Console and runs `prereview ack` (a reserve line with no final line is an unknown cost, like FR-016's).
- Two runs at once: the second says so and exits (the audit's lock).

## Requirements

### Role

- **FR-001** One run reads one PR, started by the coordinating session or by a person. No timer, no webhook, no workflow.
- **FR-002** The report goes to the caller's standard output and a local file. The coordinating session reads it first and decides what to do. It is not relayed to anyone automatically.
- **FR-003** **Never an approval; nothing on GitHub.** The bot has no GitHub credential, and the code has no write call. `pr-gate.sh`, the merge conditions and *One full review* (spec 021 FR-056) do not read it. A report is not a `checks run at` line and is not cited as a review: findings a person or agent has confirmed and fixed are just their own work.

### What it reads

- **FR-004** **Refuse first.** Before anything else, by GitHub login and through `trusted-lib.sh`: not a fork; author and latest editor of title and body in `trusted-authors.txt`; `dependabot[bot]` refused (its body is upstream text, a human decides its PRs); every commit's author login trusted, and a commit with no linked login refuses too. Refusal shows author and link only.
- **FR-005** **Text.** The diff, and a PR's title and body only through `scripts/gh-trusted.sh <N> --pr-text`, a new option printing only those two with the existing filter. No comments or reviews: they are not needed, and an independent read should not start from them. `--diff-only` drops the title and body. Commit messages and branch names are not passed.
- **FR-006** **Tree.** A detached worktree of the checked sha in a fresh temp folder, from the bot's own clone, never anyone's checkout (spec 021 FR-050): no hooks, no fsmonitor, no ext-diff or textconv, symlinks removed before the agent starts. Nothing is installed or run in it. Removed afterwards. No state carries between runs.
- **FR-007** **Fixed instructions.** System prompt, pass prompts and checklist come from the installed copy, made from reviewed `main` by an `install` step (as FR-058's filer), never from the PR's worktree. A PR that changes the bot is read by the old bot.

### The agent's box

- **FR-008** **Tools.** Exactly `Read`, `Grep`, `Glob`, no others: `tools` and `allowedTools` set to these, `permissionMode: 'dontAsk'`, `permissionPrompts: 'none'`, `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, no plugins, no additional directories, `persistSession: false`, no sub-agents. No shell, no write, no web.
- **FR-009** **Confinement.** A `PreToolUse` hook on every call (hooks run before every other permission step) allows only those three tools, and only on paths that resolve, links followed, inside the worktree and outside its `.git`; patterns with an absolute path or `..` are refused; anything it cannot read is refused. Each denial is logged by tool and a masked path, and reported.
- **FR-010** **Checked at start.** The SDK's `init` message must show `apiKeySource: "ANTHROPIC_API_KEY"`, exactly those tools, no MCP server, no plugin, `dontAsk`, and the worktree as `cwd`. Otherwise the run aborts as `misconfigured`. A plan login can therefore not be used by accident.
- **FR-011** **Environment.** The SDK's `env` (which replaces the environment) holds only the key, `PATH`, a temp `HOME` and `CLAUDE_CONFIG_DIR`, and the temp folder. A set `GH_TOKEN`, `GITHUB_TOKEN` or a gh login for the user refuses the run, as the audit does.
- **FR-012** **A separate unix user** (`durbar-prereview`; **owner question Q1**, recommended). The boundary that holds if the hook has a bug. FR-058 measured on a similar host that a user unit's sandbox lines can be silently ignored, so the guard is the user, not `InaccessiblePaths=`. Without it, `[KNOWN GAP]`: the model's process could reach whatever the operating account can, the hook alone in the way.

### The key and the limits

- **FR-013** **The key file** is outside any repo, mode 0600, owned by the running user. The bot checks all of that with `lstat` (a regular file, no link, no git folder above it) and the key's shape, refuses otherwise, and never prints the value. It reads it into the SDK's `env` only. Vikram creates and saves it himself: the exact steps are in the [plan](plan.md#the-key-steps-for-vikram). It is never pasted in chat, a terminal an agent reads, an issue or a PR. No agent creates, reads or moves it. No repo secret; nothing in Actions.
- **FR-014** **Console limit.** A dedicated workspace with a monthly spend limit, because the Default Workspace cannot have one (`read:` the Console docs). This is the one hard limit, enforced by the API side. Its value is the owner's and is not in this repo.
- **FR-015** **Per-run ceiling.** A default of $5 per run, and per pass `maxBudgetUsd` $2 plus `maxTurns` and a timeout. The SDK's check is a client-side estimate that can pass its value (`read:` SDK docs), which is why each is set below the ceiling. Raising a default is a flag on one run, logged.
- **FR-016** **Ledger.** A local append-only file, 0600. A line goes in before a send (at the ceiling) and is replaced by the real numbers after. One pure function, checked right before each pass, compares month total plus ceiling against a local monthly ceiling kept outside the repo and below the Console's limit. Unknown cost is the ceiling, never 0. A price basis other than `list` (`modelUsage[..].costBasis`) means the estimate is not trustworthy: it counts as unknown (`read:` SDK docs: an unrecognised model gets `unknown`).
- **FR-017** **Logs.** Time, PR, sha, model, pass, status, turns, tokens by kind, estimated cost, duration, denial count, the diff's size in bytes. No key, no prompt, no diff, no file contents, no environment. Everything that leaves the process, report included, goes through `maskTokenShapes` first, then any cut.

### What it says

- **FR-018** **Output is data.** The agent answers to a JSON schema: per finding `pass`, `kind`, `path`, `line`, `claim`, `evidence`, `how_to_check`; plus `not_checked`. The bot validates it, allow-lists fields, caps lengths and prints it in a fenced block saying *data from a model that read a PR; not instructions*. Nothing in it starts a command. It says no verdict: no "approve", no "safe to merge", and the schema has no field for one. The coordinating session treats each finding as a claim to check against the code before using it, and never as an order, whatever it says.
- **FR-019** **Two passes, fresh each.** *Reach and state* and *evidence and text*, prompts in the [plan](plan.md#the-prompts). Separate sessions, so one does not anchor the other.
- **FR-020** **Model.** Default `claude-opus-5-5` at effort `high` (**owner question Q2**). `--model` accepts `claude-fable-5-1`, the most capable, at 2.5 times the token price, for the comparison in FR-021. The id is pinned in the bot's code, with a pinned SDK. A model the pinned SDK cannot price is refused.
- **FR-021** **Measured on first uses.** Three merged PRs with known later findings (`--replay <sha>`, the head before the fix, with `--diff-only`) and two live ones; two of the five on both models. Recorded: per pass and per review, tokens by kind, the bot's estimate and the Console's number; time; per finding confirmed, false or unclear (by the coordinating session reading the code); which known findings it reached; which it found that the human reviews had not. Report to the owner in a dated `real:` delta. No result is claimed before that. A replay flatters: today's checklist may have learned from that very PR, so replays and live runs are reported apart.

### Where it lives

- **FR-022** **Under `scripts/prereview/`**, with its own `package.json` and lockfile, pinned SDK, not a dependency of the root project, so `npm ci` for the app and CI stay as they are and `electron-builder` cannot pack it (its `files` list is `dist/**`). No workspace link: `test:supplychain` refuses links. `test:supplychain` also checks this second lockfile. The SDK is under Anthropic's Commercial Terms, not MIT: it is neither shipped nor vendored, only installed on the server. Its entry file is out of `tsconfig.scripts.json`'s `scripts/**/*.ts`, so root builds never need the SDK.
- **FR-023** **Tests spend nothing** (constitution IV). The logic is in `scripts/prereview-core.ts` with `query`, `gh`, `git`, clock and files injected, tested by `test:prereview` in `npm test`, with a fake on `PATH` for each outside tool. Real runs are never in `npm test` or CI.
- **FR-024** **Real runs follow the credit rule.** AGENTS.md *No AI credits* applies: a run needs the human's ask, unless **owner question Q3** gives a standing OK within the limits.

### What it cannot do (also printed by `prereview --help`)

- **FR-025** `[KNOWN GAP]`, by design in v1:
  - It runs nothing: no tests, no mutants, no app, no screenshots. A "mutant gap" is its reading of a test, not a surviving mutant. Evidence from it is `read:`, never `sim:`, `test:` or `real:`.
  - It cannot prove absence. An empty report means it found nothing in its limits, and does not mean safe.
  - It does not see comments, reviews, CI, or any other PR, and cannot follow a link.
  - Text a trusted author pasted into the diff from elsewhere is not filtered; a hostile file in the repo is still read. The box and FR-018 are the answer to that, not a filter.
  - It can be wrong in a confident voice. It can be declined on security-heavy diffs.
  - The cost it prints is an estimate; the Console holds the real number.
  - A key on one server is one secret to guard: an account with sudo there can read the file whatever its mode.
  - Linux only, one server. Not on Windows or macOS (constitution VI: stated gap; ops tool, like FR-058).

## Success Criteria

- **SC-001** `test:prereview` passes with every planted mutant of T010 caught: refusal removed, hook allowing outside paths, symlink kept, environment leak, outside payload in a prompt, a `gh` write call, unknown cost as 0, ceiling raised, an extra send.
- **SC-002** Over the first five uses: no denied call the box did not report, no secret in any log (a scan of the logs and reports), nothing on GitHub.
- **SC-003** The dated delta exists with cost per review measured; each run within its ceiling, or its overrun recorded.
- **SC-004** The owner decides from that delta whether v1 stays, changes model, or stops.

## Assumptions and open questions

`[KNOWN GAP]` Not yet verified:
- Whether this grant pays for Agent SDK traffic under an API key. The owner knows it does not pay for Claude Code *sessions*; a key in our own workspace should be ordinary API use, and the first run must confirm it on the Console's usage and credit pages before any second run.
- That the SDK's options act as the docs say (`read:` code.claude.com Agent SDK docs, SDK 0.3.316, 2026-11-01): T011's first real run is what checks them, starting at the smallest diff.
- All cost numbers in the plan are arithmetic on list prices, not measurements.
- The "evidence week" is the owner's account; no record of it is in the repo, so the replay PRs must come from him or his coordinating session (Q5).

**Questions for the owner; recommendations in the [plan](plan.md#recommendations-on-the-open-questions).** Q1: a separate unix user? Q2: which default model? Q3: a standing OK for runs inside the ceilings? Q4: which PRs? Q5: which PRs for the replays?

## Changes

### 2026-11-01: build scope, a Codex runner, results folder, and an off posting path (owner order)

Owner's order (Vikram, 2026-11-01), recorded here before the code. Numbers taken: FR-026..FR-029, T015..T018 (spec 103 only).

- **Build scope of the first build PR:** phases 1 and 2 (T002..T010) that need no key and spend nothing: all tests use a fake query and a fake runner. The branch is `103-prereview-bot-build` (the spec's own branch name is taken by the open spec PR, and renaming it would close that PR). T009 differs from the task text: **`AGENTS.md` is not edited** (owner's order). The line "a pre-review is not a review" is already FR-003 here; it replaces nothing and is left to the owners to add. Phase 3 (T011..T014) still waits for the owner and the key.
- **FR-026 [REMOVED 2026-11-01, see the last delta]** The optional Codex runner (`codex exec` in a read-only sandbox) was built and then removed from the PR by the owner's decision: its sandbox has no hook and can read every file of its unix user, no list of names covers what that user can read, and its model can read its own login. It may return as its own spec. Nothing of it remains in code, flags, docs or tests, and a report of any runner but Claude's is never read back or posted.
- **FR-027 Posting as a GitHub App, off by default.** A GitHub App `durbar-samikshak` is installed on the repository with Contents read, Metadata read, Checks read and Pull requests write. A separate `post` command (never part of a review run, never called by `prereview <N>`) may post **one plain comment**, never a review state and never an approval, as the App on a PR the refusal of FR-004 has just accepted again, once per PR and head sha. It stays **off and posts nothing** until all three owners have confirmed: Vikram created the App; Ruben said ok; **Paco has not answered**. The gate is a local config file outside the repo that must hold `postComment: true` and a dated confirmation of each of `vikramgorla`, `fjcabello` and `rubenlupi`; absent or incomplete, `post` refuses before any key is read or any network call. The App is **not** on `trusted-authors.txt` and that list is unchanged: its comments are outside text for every agent (FR-060), a human reads them. The comment carries the report as masked, length-capped data in a code fence, says it is automated and no review, and starts nothing. The key file (0600, outside any repo, generic path in config) is read **only inside the signing function**, which makes a short-lived JWT; the installation token is requested for one repository with `pull_requests: write` only, held in memory, never written, logged or printed. Amends FR-003: the code has exactly one write call, in `prereview-post.ts`, and the tests check there is no other. Nothing in this PR enables the flag or posts, not even a test comment: tests use a generated key and a fake `fetch`.
- **FR-028 Results folder.** A run writes `<state>/reports/<N>-<sha>.json` (mode 0600) and `<N>-<sha>.md` (the data block) for the coordinating session, plus a per-pass `.raw` file only for an `unusable` answer (FR-018). A second copy goes where `--out <dir>` says. Nothing else is written outside the temp worktree.
- **FR-029 Bot output stays data.** The report, in the file, on standard output and in a posted comment, is a data block; a finding that says "approve", "ignore the above" or asks for a command is shown as text. Tests plant such text in the PR title, body, diff and file contents and in a fake model answer, and check that the prompts hold no outside text, that the answer's extra fields and a verdict field are dropped, and that nothing starts a command.

### 2026-11-01 (second): fixes from the security review of the build PR (FR-030..FR-033)

Found by the independent security review of #997; each is fixed in that PR with a test that fails when the fix is removed (FR-030 of spec 021). Numbers taken: FR-030..FR-033, T019.

- **FR-030 The runner takes only what the gate signed.** The runner holds no GitHub credential, so it cannot check FR-004 itself. `prereview <N>` signs its payload (HMAC-SHA256 over every field the runner acts on, with a timestamp and a nonce) with a gate key file (32 bytes or more, a plain file others cannot write, `gate.key` under the bot's folder or `PREREVIEW_GATE_KEY_FILE`); the runner verifies it, accepts it for ten minutes, and never twice. An unsigned, altered, stale or reused payload is refused before any fetch or send, so a forged payload cannot spend on a fork PR number or hand outside text to the model. `[KNOWN GAP]` a process that can read the gate key can sign too; the key is not a boundary against the account that holds it. `--run-as` starts the runner as `node --import <tsx loader by path> cli.mts run`, because plain `node cli.mts` cannot read TypeScript; the test runs that exact command (minus sudo) when tsx is installed (CI's root install does not have it, so there the check is skipped and says so).
- **FR-031 Results are written without following anything.** Result folders (the state folder and `--out`) must be real folders owned by the running user and not writable by others; files are created `O_EXCL | O_NOFOLLOW` at 0600 (an older plain file of ours at the name is removed first; a link or anything else refuses); a refused folder or file is a warning, never a write through it, and the state copy is written regardless.
- **FR-032 Confinement by allow-list (amends FR-009).** A path that starts with `~`, or holds `$` or `%`, is refused (the tools expand them before the hook sees the path); a glob is allowed only when made of letters, digits, `_ . / * ? @ + -` and a space, never absolute, never with a `..` segment: no brace, bracket, parenthesis, `!`, `,`, `~`, `\` or `$` form (`{/etc/passwd,a}`, `{{/etc,a},b}/*`, `.{.,x}/secret`, `[.][.]/x` are tested). A model that wanted `*.{ts,tsx}` asks again.
- **FR-033 The posting gate is a convention, stated as one (amends FR-027).** Dates still to come are refused; the config must be owned by the operating user (the one who runs `post`), in a folder of theirs that others cannot write, outside the bot's state folder (`PREREVIEW_POST_CONFIG`); `post` refuses a report whose sha is not the PR's current head and a replay report. `[KNOWN GAP]` any process of the operating account can edit the file or the key; the gate stops a mistake and the bot's own user, not that account. With one account for both it is a convention only.
- Also: a pass killed after its reserve line, or aborted without a stated cost, needs `prereview ack` before the next run (user story 3.2); `GH_CONFIG_DIR`, `XDG_CONFIG_HOME` and `GH_HOST` refuse a run like `GH_TOKEN`; Dependabot watches `scripts/prereview`; `tsx` 4.23.15 (esbuild 0.28.2) replaces 4.19.2, which `npm audit` flagged (two moderates, esbuild's dev-server advisory and tsx through it); audit of the new lockfile: 0 vulnerabilities.

### 2026-11-01 (third): the Codex runner is removed; fixes from the second security review (FR-034..FR-038)

Owner's decision, then the re-review of #997 at e0420d52 (it did not approve). Numbers taken: FR-034..FR-038, T020.

- **FR-034 No Codex runner.** Code, the `--runner` flag, `codexStartProblems`, the `durbar-prereview-codex` user, docs and tests are gone. `revalidateReport` throws on a report with any pass not from the Claude runner, so `post` can never publish one. FR-012's separate unix user stays for the Claude runner. (Supersedes FR-026 and its FR-030 and FR-033 mentions of it.)
- **FR-035 The hook refuses what the binary normalises differently (amends FR-009, FR-032).** The binary trims a Read path but not a Grep or Glob path or pattern, so `" /abs/dir"` resolved here as a look-alike folder inside the worktree while the tool read `/abs/dir`: outside content reached the next model request (found by the re-review; shown with the real binary). Every path, glob and pattern is refused if it has leading or trailing whitespace, a quote, a backtick or any control or separator character; the glob allow-list no longer has a space. `~`, `$`, `%` and drive forms stay refused. `StructuredOutput` is allowed with any object input and its fields are never opened as paths. `/proc`, `/sys`, `/dev` and `/etc` are outside the worktree and tested to be refused.
- **FR-036 The check matches the real SDK (amends FR-008, FR-010).** At the pinned 0.3.310 the real `init` lists the tools `Glob, Grep, Read, StructuredOutput` (the last is added by `outputFormat: json_schema`), plugins `cc-plugin-agents-md` and `cc-plugin-plugin-authoring` (path `builtin`), agents `claude`, `general-purpose`, `statusline-setup`, and skills `doctor`, `plugin-authoring`. `[KNOWN GAP]` no option or environment variable switches the built-in plugins and agents off; they are harmless because the session has no Task, Agent or Skill tool, and the check allows exactly these names and fails closed on any other. The environment (`minimalEnv`) now also sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `_FILE_MENTIONS`, `_ATTACHMENTS`, `_CLAUDE_MDS`, `_BUNDLED_SKILLS`, `_EXPLORE_PLAN_AGENTS` and `_AUTO_MEMORY`, and the options `skills: []`; each was checked against the real binary (side traffic took a scripted reply; `@file` text and the PR's `CLAUDE.md` are not read into the prompt).
- **FR-037 The real binary is tested.** `test:prereview` drives the real pinned SDK through `claudePass` against a loopback mock of the Messages API with a fake key: a scripted model makes 14 hostile calls (leading and trailing spaces, braces, a planted link, `/proc/self/environ`, `~`, `$HOME`, Bash) plus one legitimate read, a canary file outside the worktree and markers in the worktree's `CLAUDE.md`, skills, settings hook and `.mcp.json`; none reaches a request body, the hooks and servers never run, only `POST /v1/messages` is sent, the answer arrives through `StructuredOutput` and the pass is `ok`. It needs `npm ci --prefix scripts/prereview`; the CI job "Build and test (ubuntu-latest)" installs it, everywhere else it is skipped with a printed line. The fake SDK stays for the cases the binary cannot produce.
- **FR-038 `ack` needs a person.** A terminal on standard input and output and the typed word `looked`; it shows the last sends first. Under the separate-user layout the ledger is the bot user's, so `prereview ack --run-as <user>` starts the same command as that user with the terminal handed over (sudo may ask for the operator's password). `[KNOWN GAP]` a terminal check stops a script or an agent, not a person who is told to type the word.
- **Decided, not built (item 6 of the review): the key stays a file the bot user reads.** Keeping the key off the bot uid's disk and handing it through the environment would not help: the key must then sit in the environment of the `claude` process, and `/proc/<pid>/environ` is readable by the same uid, which is exactly what a hook escape reads (the real test shows the hook and the binary refuse `/proc/self/environ`, but a hook bug is the case this guards). A real boundary is a key held by another uid: a small forwarding proxy owned by the operator that adds the key, allows only `POST /v1/messages` and enforces a spend ceiling, with the bot given a dummy key and `ANTHROPIC_BASE_URL`. That is a new component with network code: left as a follow-up spec for the owner to decide.
