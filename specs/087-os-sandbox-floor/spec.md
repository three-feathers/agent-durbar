# Feature Specification: The agent app's own OS sandbox as the safety floor under Read-only and Ask first

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: OS sandbox floor (issue #611): under Read-only and Ask first Durbar also turns on each agent app's own OS sandbox (Claude Code's bash sandbox, Copilot's local sandbox; Codex's read-limited profile already does it), so a command that slips past Durbar's checks still cannot write outside the folder or reach the network; Allow all keeps the app default; the chat header says Sandboxed or Not sandboxed, and why
status: Built 2026-10-25 (simulator and fakes only): Claude Code and Copilot floors, Codex state and card line, the chip, tooltips, the sandbox note with Continue / Always / Change mode…, Settings > Agent apps line, the policy rule; real check on Linux 2026-10-25 (T060): Claude Code's sandbox refused a Read-only write (verified for Linux Read-only only); Copilot's floor was on, Durbar refused the Read-only command first, and in Ask first an approved write outside the folder was not refused (K15, cause unknown); macOS and Windows not verified (T061, T062 open); the policy key is not reachable until spec 076 has a reader. 2026-10-27 delta (issue #806): Restart without the sandbox built 2026-10-27 (FR-022, simulator and fakes only, not on a real session); 2026-10-28 T066 real run on Linux (CLI 1.0.98): verdict A, a running Copilot floor can be cleared in place (K16 resolved for Linux), so FR-022c is built (fakes and simulator): a switch to Allow all lowers the floor and Restart without the sandbox stays only as the fallback after a refused or unanswered lowering; macOS and Windows not verified
-->

**Feature Branch**: `087-os-sandbox-floor` (touches 003 permission modes, 012 Claude and Codex adapters, 002 Copilot adapter, 018 mode switch, 076 organization policy, 081 Settings > Agent apps, 010 simulator)

**Created**: 2026-10-25

**Status**: Built (2026-10-25) on the simulator and with fakes; Linux checked on a real session 2026-10-25 (T060: Claude Code verified in Read-only; Copilot Ask first let an approved write outside the folder through, K15) and 2026-10-28 (T066: a Copilot floor cleared in place and put back, K16); macOS and Windows not verified (T061, T062 open). See *Changes*.

**Input**: Issue #611, owner decision (Vikram, 2026-10-23, *go*): "Today Read-only / Ask first are enforced by Durbar's permission
checks. Turn on each agent app's real OS sandbox underneath, so writes outside the folder or network calls are blocked by the OS
even if something slips past a check: Read-only → OS read-only; Ask first → writes only inside the folder (+ allowed roots),
network asks or is off; Allow all → app default (or managed policy). Show *Sandboxed* on the agent; honest text where an app/OS
has no sandbox." Closes spec 076 FR-173's open point. Size L.

All vendor facts are in [research.md](research.md), each with `read:` and its source. Nothing here was run on a real session.

## Why

Durbar's modes are enforced in Durbar's own code: the Copilot permission broker, Claude's `PreToolUse` hook and `canUseTool`,
Codex's approval replies. A bug there, a tool kind a newer runtime adds (spec 003 FR-015), a folder allow rule the person accepted
(constitution III Amendment 1), or a local MCP server (a child process with the person's full rights) can each run a command
that Durbar never saw. The agent apps ship OS sandboxes (Seatbelt, bubblewrap, ProcessContainer, MXC) that confine what such a
command can touch. Durbar turns them on underneath its own checks: two locks instead of one.

What exists already (research R1): Codex's Read-only and Ask first already run in an OS-enforced read-limited profile and refuse
to start where it cannot be enforced (spec 012 FR-086..FR-091, FR-138, FR-140, FR-162). Copilot and Claude Code run with no OS
sandbox in every mode.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read-only is read-only for the OS too (Priority: P1)

A person starts a Copilot or Claude Code agent in Read-only. Durbar denies writes and shell as before. In addition, any shell
command that does run (an accepted folder allow rule such as `Bash(npm test:*)`) runs in the app's OS sandbox with no write access
and no network, so it cannot change files or send data out. For Copilot, local MCP servers run in that sandbox too; Claude Code's
sandbox does not cover MCP servers (research R2), and the tooltip says so (FR-010).

**Why this priority**: it is the default mode (constitution III) and the promise the product makes first.

**Independent Test**: with injected platform facts and fake adapters, the settings each adapter would send in Read-only are the
read-only floor (unit tests); on the simulator the chat header shows *Read-only · Sandboxed*.

**Acceptance Scenarios**:

1. **Given** Claude Code on macOS or on Linux with `bubblewrap` and `socat`, **When** a Read-only session starts, **Then** the
   `--settings` JSON has `sandbox.enabled: true`, `failIfUnavailable: true` (FR-007), `allowUnsandboxedCommands: false`,
   `autoAllowBashIfSandboxed: false`, the session roots in `denyWrite`, reads outside the roots denied and no allowed domain.
   *(test:)*
2. **Given** Copilot on a host whose `sandbox.getHostSupport()` says `supported: true`, **When** a Read-only session is created,
   **Then** Durbar sets `sandboxConfig` with `enabled: true`, `addCurrentWorkingDirectory: false`, the roots in `readonlyPaths`,
   `allowOutbound: false`, `allowLocalNetwork: false`, `allowDevToolAccess: false`, no `allowBypass`, `auth` off, before the
   first message is sent. *(test:)*
3. **Given** Codex, **When** Read-only starts, **Then** nothing changes from spec 012 (`durbar_ro`, fail closed). *(test: existing)*
4. **Given** any of the three in Read-only with the sandbox on, **When** the chat opens, **Then** the mode chip reads
   *Read-only · Sandboxed* and its tooltip names the mechanism and what it covers (FR-010), and, until a real check is recorded for
   that app and OS (FR-020), adds "requested; not verified on a real session". *(sim:)*

### User Story 2 - Ask first: approved commands stay inside the folder (Priority: P1)

In Ask first the person approves a shell command. It runs, but the OS lets it write only inside the session's folders (and the
app's temporary folder), never into protected files (`.git/hooks`, `.git/config`, shell startup files, the app's own settings),
and with network off (decision Q2).

**Why this priority**: today an approved command runs with the person's full rights; one careless *Approve* can touch anything.

**Independent Test**: unit tests on the mapping per app and per OS; simulator shows *Ask first · Sandboxed*.

**Acceptance Scenarios**:

1. **Given** Claude Code in Ask first with the sandbox available, **When** the session starts, **Then** writes are allowed only in
   the working directory, `--add-dir` folders and `$TMPDIR`, `autoAllowBashIfSandboxed` is `false` so every command still reaches
   Durbar's card, and `allowUnsandboxedCommands` is `false`. *(test:)*
2. **Given** Copilot in Ask first, **When** the session is created, **Then** the roots are `readwritePaths`, the protected paths are
   `deniedPaths` where the host reports the `denied_paths` capability, and network follows Q2. *(test:)*
3. **Given** Codex in Ask first, **Then** it keeps `durbar_ro` (every write asks; decision Q3). *(test: existing)*
4. **Given** Claude Code or Copilot in Ask first, **When** Durbar's card is answered *Approve*, **Then** the command runs inside the
   sandbox; Durbar never answers a vendor's "run outside the sandbox" request with yes (Claude `dangerouslyDisableSandbox`, Copilot
   bypass, both also turned off by FR-002). *(test:)*
5. **Given** Codex in Ask first, **When** an approval card for a command or a file change is shown, **Then** it says "If you
   approve, Codex may run this outside its sandbox" or, for a file change, "…writes this outside its read-only sandbox" (FR-021), because an approved escalation may leave `durbar_ro` (K6); the chip's
   tooltip says the same. *(test:)*

### User Story 3 - Honest when there is no sandbox (Priority: P1)

On native Windows Claude Code has no sandbox; Copilot needs a recent Windows 11 build; on Linux `bubblewrap` may be missing or
blocked by AppArmor. The person sees *Not sandboxed* with the reason and what would fix it, never a silent fallback.

**Why this priority**: constitution VIII (honest limits); a floor that silently disappears is worse than none.

**Independent Test**: injected platform facts (win32; linux without `bwrap`; Copilot `supported: false, reason`) give the
documented state and text; the simulator shows each state.

**Acceptance Scenarios**:

1. **Given** Claude Code on native Windows in Read-only, **When** the session starts, **Then** it follows FR-007 and the chip reads
   *Read-only · Not sandboxed*; the tooltip says "Claude Code has no OS sandbox on Windows; Durbar's own checks still apply". *(test:, sim:)*
2. **Given** Copilot with `getHostSupport()` → `supported: false, reason: R`, **Then** the tooltip and Settings > Agent apps show R
   (masked, clipped to 200 characters) and the fix from research R4. *(test:)*
3. **Given** an organization policy that requires the sandbox (FR-019), **When** it is unavailable, **Then** Read-only and Ask
   first are refused with the reason, nothing is spawned, and no weaker mode is offered automatically; the refusal note carries the
   existing *Change mode…* button (spec 012 FR-087, `modeRefusalAction`). *(test:, sim: `simsendfail=sandbox`)*
4. **Given** Claude Code on Linux where `bwrap` is present but AppArmor blocks its user namespaces (or a dependency is missing, or
   the CLI is older than the minimum), **When** a Read-only session starts, **Then** the CLI exits at start because
   `failIfUnavailable` is `true` and before Claude's `system`/`init` message; Durbar **re-sends nothing**: the person's message
   stays in the chat as not sent, a note names the reason and offers *Continue without the OS sandbox* and *Change mode…*, and the
   chip reads *Not sandboxed*. Only after *Continue* does Durbar relaunch (FR-007a), and the person sends again. It never reads
   *Sandboxed* for a session that did not reach `init` with `failIfUnavailable: true` (FR-006). *(test:)*
5. **Given** Claude exits before `init` in a way Durbar cannot classify as a sandbox exit, **Then** the existing crash path handles
   it (*Claude stopped unexpectedly… Send a message to resume.*), the state stays `unknown`, and nothing relaunches without the
   sandbox. *(test:)*

### User Story 4 - Allow all and managed policy (Priority: P2)

Allow all keeps the app's default. When the vendor's managed policy forces a sandbox on, Durbar does not fight it and says
*Sandboxed (managed)* where the app reports it.

**Acceptance Scenarios**:

1. **Given** Allow all, **Then** Durbar sends no sandbox setting for Claude or Copilot and keeps `danger-full-access` for Codex. *(test:)*
2. **Given** Copilot reports a managed sandbox floor for the session, **Then** the chip says *Allow all · Sandboxed (managed)*. *(test:; real: open)*

### Edge Cases

- **Mode switch** (spec 018): the floor in force is the one shown. A switch to a wider mode does not widen the sandbox before the
  app applies it (Claude: at the next spawn; Copilot: `options.update`; Codex: FR-144 next message). A switch to a narrower mode
  narrows Durbar's checks at once, which deny anyway. Copilot from Read-only or Ask first to **Allow all**: Durbar sends no new
  `sandboxConfig`, so the floor already set stays for the rest of that session (the safer direction; whether a later update could
  clear it is unverified, K16) and the chip reads *Allow all · Sandboxed (until a new session)*; a new session in Allow all starts
  with the app default. Since 2026-10-27 (*Changes*, FR-022..FR-022c, issue #806) the person can restart the same conversation without
  the sandbox, with their own confirmation; nothing restarts or widens by itself. **Since 2026-10-28 (FR-022c, K16 resolved on Linux)**
  the switch to Allow all, which the person confirms in a dialog that now says so, lowers Copilot's floor in place; the kept floor and the
  restart remain only when the app refuses or does not answer the lowering.
- **Workspace with several folders**: every folder of the `.code-workspace` is a root (as `--add-dir` and `runtimeWorkspaceRoots`).
- **A root that is a filesystem root, a UNC share root or holds `..`**: dropped, as `codexWorkspaceRoots` does; an empty root list
  refuses Read-only and Ask first (same rule as spec 012 FR-091).
- **A session write grant outside the roots** (spec 003 FR-003): Claude's and Copilot's file tools are not OS sandboxed (research
  R2, R4), so an approved Edit still works; a shell command there still fails. The grant chip does not claim more.
- **The sandbox fails during a session** (Copilot "unsupported-policy", a Claude command that the proxy blocks): shown as the tool's
  error; Durbar never retries the command outside the sandbox.
- **Resume** (spec 006, 012 FR-093): a resumed session gets the floor of its mode again; Codex's wider-sandbox resume check stays.
- **Paths with quotes, newlines or control characters**: never put into a settings JSON or profile unescaped; such a root is
  dropped (the profile only narrows).

## Requirements *(mandatory)*

### Functional Requirements

**A. The floor per mode**

- **FR-001** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`, 27 cells) The floor (what the OS lets a sandboxed process do) per Durbar mode, for every app that has a sandbox:

  | Mode | Writes | Reads | Network | Run outside the sandbox |
  | --- | --- | --- | --- | --- |
  | Read-only | none (the app's own temp folder only where the app needs it to run); no toolchain or cache grants (FR-004) | the session roots, system files and the app's own install (decision Q4) | off | never |
  | Ask first | the session roots and the app's temp folder; protected paths (FR-014) never | as Read-only | off (decision Q2) | never |
  | Allow all | app default or managed policy | app default | app default | app default |

- **FR-002** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts` scan of every cell) The floor is **under** Durbar's checks, never instead of them. Nothing in this spec approves a call that Durbar would
  deny or ask about today. In particular Claude Code's `autoAllowBashIfSandboxed` is always `false` (its default `true` would
  auto-approve sandboxed Bash; `read:` research R2), Claude's `allowUnsandboxedCommands` is `false`, and Copilot's `allowBypass` is
  never sent (fail closed, `read:` research R4).
- **FR-003** `[IMPLEMENTED]` (test: `scripts/test-claude-sandbox.ts` AC1, `scripts/test-sandbox-floor.ts`) **Claude Code** (CLI transport, `--settings` JSON): Read-only and Ask first add a `sandbox` block, built in the
  Claude adapter (`src/adapters/claudeSandbox.ts`) and merged into the `--settings` JSON in `claude.ts`, never in `src/shared`
  (constitution II): `enabled: true`, `failIfUnavailable: true` (always, FR-007), `allowUnsandboxedCommands: false`,
  `autoAllowBashIfSandboxed: false`, `excludedCommands: []`; `filesystem.denyRead: ["~/"]` and `filesystem.allowRead` = the roots
  (decision Q4); Read-only also `filesystem.denyWrite` = the roots (K2); `network.allowedDomains: []`, `network.strictAllowlist: true` (decision Q2).
  The `sandbox` key of the final `--settings` JSON is exactly this block (spec 061's folder setup carries no `sandbox` key today;
  if it ever does, Durbar's block replaces it). Minimum Claude Code version: **2.1.309** (FR-003a; was 2.1.219) (the newest key this block relies on,
  `strictAllowlist`, `read:` research R2); an older or unreadable version gets no block and counts as unavailable (FR-007).
  `[KNOWN GAP]` K1, K2, K4.
- **FR-004** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts`, `scripts/test-sandbox-floor.ts`) **Copilot** (SDK 1.0.22): before the first send of a created or resumed session, Durbar calls
  `session.rpc.options.update({ sandboxConfig, sandboxConfigSource: 'session_flag' })` with `enabled: true`,
  `addCurrentWorkingDirectory: false`, `userPolicy.filesystem` (Read-only: roots in `readonlyPaths`; Ask first: roots in
  `readwritePaths`, protected paths in `deniedPaths` when the host reports `denied_paths`), `userPolicy.network`
  (`allowOutbound: false`, `allowLocalNetwork: false`), `sandboxMcpServers: true`, `sandboxLspServers: true`, `auth: { git: false,
  gh: false }`, **`allowDevToolAccess: false`** in both modes, no `allowBypass`. `allowDevToolAccess: true` would also grant
  **writes** (scratch caches, the gh CLI cache, Cargo's registry and git store; `read:` SDK `rpc.d.ts` `SandboxConfig.allowDevToolAccess`),
  which breaks FR-001 and gives a place to plant code. Instead Durbar adds the folders of the session's `PATH` entries as
  `readonlyPaths`: absolute, normalised by FR-015's rule, and **dropped when the entry equals the home folder, is an ancestor of it
  (`/home`, `/Users`, `C:\Users`) or is a profile root of any user** (compared case-insensitively on Windows and macOS), so
  `~/.ssh` and `~/.aws` never become readable through it. Where the host reports `denied_paths`, `~/.ssh`, `~/.aws` and
  `~/.config/gh` also go into `deniedPaths`. Left as is, and said in the tooltip's details: a sandboxed command can read the
  contents of `PATH` folders under home (for example scripts in `~/.local/bin`). Cost: inside the sandbox a tool cannot write its
  cache (npm, Cargo, gh, pip) and a toolchain found only through an environment variable (`GOROOT`, `JAVA_HOME`, `VIRTUAL_ENV`) and
  not on `PATH` is not readable; such a command fails with the tool's own error. If the update is refused, the session is handled
  as *unavailable* (FR-007). `[KNOWN GAP]` K8, K9, K10.
- **FR-005** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`, existing `test-codex-modes`) **Codex**: unchanged (spec 012 FR-086..FR-091, FR-138, FR-140, FR-162). Ask first keeps `durbar_ro` and does not move
  to `workspace-write`, because Codex runs writes inside writable roots without asking, which would break Ask first's "each request
  is left pending for the user" (constitution III; decision Q3). `[KNOWN GAP]` K6: whether an approved escalation runs unsandboxed; FR-021
  makes the card say so.

**B. Detection and when there is none**

- **FR-006** `[IMPLEMENTED]` (test: `scripts/test-claude-sandbox.ts`, `scripts/test-copilot-sandbox.ts`) Each adapter answers, before a Read-only or Ask first session starts, whether its sandbox can run, as a normalized
  `SandboxState` (FR-011), from a pure function with injected facts (constitution VI):
  - Copilot: `client.rpc.sandbox.getHostSupport()` (`supported`, `reason`, `capabilities`); a missing method (older runtime) or an
    error counts as unavailable with reason "this Copilot cannot report its sandbox".
  - Claude Code: a version below 2.1.309 or unreadable → unavailable ("this Claude Code is too old for Durbar's sandbox
    settings"); `win32` → unavailable ("no OS sandbox on Windows; WSL2 only"); `linux` → `bwrap` and `socat` found on `PATH`
    (located like spec 012's detection, no shell) else unavailable with the package names; `darwin` → candidate. These checks only
    decide whether to try; they never set `on`. The state becomes `on` only when the CLI, started with `failIfUnavailable: true`,
    sends its `system`/`init` message (the existing `initSeen` flag in `claude.ts`), so an AppArmor block, a missing ripgrep or
    seccomp helper, or anything else the CLI checks itself is caught by the CLI, not guessed by Durbar. Before that the state is
    `unknown` (*Sandbox: checking*). A **sandbox exit** is an exit before `init` whose stderr tail or exit code matches the CLI's
    sandbox-unavailable message (a pure classifier, masked); every other exit before `init` goes to the existing crash path
    (`onExit`) and is never treated as a sandbox exit. `[KNOWN GAP]` K4: the message, the exit code, and whether the CLI checks the
    sandbox before `init` at all (if it checks later, the first sandboxed command fails instead and FR-008 applies).
    The version comes from the existing probe (`detectClaude` → `parseVersion`, `src/adapters/detect.ts`), compatible with the
    hardening in PR #698; an unparseable version counts as unavailable.
  - Codex: the existing `codexReadEnforceable` plus the start result.
- **FR-007** `[IMPLEMENTED]` (test: `scripts/test-claude-sandbox.ts` AC2-AC8, `scripts/test-copilot-sandbox.ts` AC1-AC4; sim: `scripts/check-sandbox-floor.js`) **When the sandbox is unavailable** (owner decision Q1, 2026-10-25). Claude Code is always launched with
  `failIfUnavailable: true` in Read-only and Ask first, so the CLI itself confirms the sandbox or exits; Durbar never shows
  *Sandboxed* on a guess.
  - Default (no policy): **the person decides; nothing runs without the sandbox until they do.** Nothing is re-sent, ever
    (as spec 006 FR-044 and the crash path). The message that was in flight is shown as not sent, and a chat note says
    "<App> could not start its OS sandbox: <reason>. Nothing was sent." with two buttons: *Continue without the OS sandbox* and the
    existing *Change mode…* (`modeRefusalAction`; the confirmation uses the shared `askDialog`). The chip reads *Not sandboxed*.
    - Claude: the start exit of FR-006, or a pre-check that already says unavailable (then nothing is spawned).
    - Copilot: `getHostSupport()` says no, or `options.update` is refused; the first `send` is held back.
    - **FR-007a** *Continue* (one click, for this session): Claude relaunches with the **same argv minus the `sandbox` key** of the
      `--settings` JSON: the same `--permission-mode`, `--allowedTools`/`--disallowedTools`, `PreToolUse` hook and `canUseTool`
      (`--permission-prompt-tool stdio`), and the same `--session-id` (or `--resume <id>` if the session already exists on disk).
      Copilot keeps the session and sends without `sandboxConfig`. Durbar's own checks are unchanged in both. Nothing is re-sent:
      the person sends again.
    - **FR-007b** The session remembers *sandbox unavailable, continued* (in memory, for its life): the mode-switch relaunch
      (spec 012 FR-116) and a resume within the same run of Durbar do not try the sandbox again, so there is no exit-after-exit
      loop. The memory is not saved: a **new session** (same folder or not) tries the sandbox again, and after **Durbar restarts** a
      resume of the same session tries again and, if it is still unavailable, shows the note once more.
    - **FR-007c** *Always continue on this computer for <App>* is offered **only where the host can never sandbox that app**:
      today that is only Claude Code on native Windows (`win32`; research R2). It is **not** offered for a fixable cause (a missing
      `bwrap`, `socat` or `slirp4netns`, an AppArmor block, an old Claude Code, a Windows 11 build without ProcessContainer, or any
      Copilot `supported: false`). The stored choice (a choice, no path or secret; shown and undone in Settings > Agent apps,
      FR-012) **only skips the note**: the pre-check (FR-006) and, where it passes, the sandbox attempt still run in every session,
      so a host or an app version that becomes sandbox-capable is sandboxed again by itself and the choice no longer applies.
    - **FR-007d** `permissions.requireOsSandbox` (FR-019) **ignores** a stored *Always continue* and a session's *Continue*: with
      the key set, an unavailable sandbox is refused every time.
  - When an organization policy requires the sandbox (FR-019): **refused**, nothing runs; the refusal text contains "Read-only and
    Ask first need" so the existing `MODE_REFUSAL` / `modeRefusalAction` (spec 012 FR-087) adds the *Change mode…* button; no new
    refusal path.
  - Codex keeps failing closed (its sandbox is its only read limit).
  - Never: a silent fallback, an automatic relaunch without the sandbox, a re-sent prompt, an automatic switch to another mode,
    or weaker settings than "no sandbox, Durbar's checks".
- **FR-008** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts`) A sandbox the app reports as lost during a session turns the chip to *Not sandboxed* with the app's reason at once;
  the session is not ended. The only surface named in the sources is Copilot's `session.warning` with `warningType: 'sandbox'`
  (`read:` SDK `rpc.d.ts`, `SandboxHostCapabilityName` doc); `sandboxConfigSource` is an input on the update and open params and
  has no getter or event, so it is not read. `[KNOWN GAP]` K12: whether Copilot or Claude report a lost sandbox in any other way.

**C. What the person sees**

- **FR-009** `[IMPLEMENTED]` (sim: `scripts/check-sandbox-floor.js`, both sizes) The chat header's mode chip (spec 018) shows the floor in words after the mode: *Read-only · Sandboxed*,
  *Ask first · Not sandboxed*, *Read-only · Sandbox: checking* (state `unknown`, until the start confirms it),
  *Allow all · Sandboxed (managed)*, *Allow all · Sandboxed (until a new session)*. `on` is shown only after the app confirmed it
  (FR-006, FR-007). Allow all with no sandbox shows nothing extra (it is the app
  default the person chose). The office card does not get a new word (layout, constitution V); the card's mode icon tooltip carries
  the same text. Never colour alone; text at least 10.5px; the 15-agent layouts at 1440x900 and 1280x800 do not change (decision Q5).
- **FR-010** `[IMPLEMENTED]` (sim: `scripts/check-sandbox-floor.js`; `src/renderer/sandboxtext.js`) The tooltip and the mode menu say exactly what is covered, per app: Copilot "Shell commands and MCP servers run in
  <mechanism> (writes: <none | this folder>, network: off). File reads and edits are checked by Durbar."; Claude Code "Shell
  commands run in <mechanism> (…). MCP servers, hooks, the status line, file reads and edits are outside it."; Codex "Commands and file
  changes run in the Codex sandbox (writes: none, network: off). If you approve a command, Codex may run it outside the sandbox."
  Mechanism plain names: macOS sandbox, bubblewrap, Windows ProcessContainer, Codex sandbox. **Until a real check for that app and
  OS is recorded** (T060-T062; a constant list in the adapter, empty at first), the tooltip ends with "Requested; not verified on a
  real session." (constitution VIII). No claim of a coverage the research does not back.
- **FR-011** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts` T013) Adapters report a normalized `SandboxState`: `{ state: 'on' | 'off' | 'unknown', mechanism?: 'seatbelt' |
  'bubblewrap' | 'processcontainer' | 'vendor', managed?: boolean, untilNewSession?: boolean, covers: Array<'shell' | 'mcp' |
  'files'>, approvedMayLeave?: boolean, verified: boolean, reason?: string }`. The type is declared next to `AgentInfo` in
  `src/shared/api.ts` and holds no vendor name or vendor setting key; the vendor keys stay in `src/adapters/` (constitution II).
  `reason` is masked by the existing redaction and clipped to 200 characters. An adapter without the field shows nothing (the UI
  degrades, constitution II).
- **FR-012** `[IMPLEMENTED]` (sim: `scripts/check-sandbox-floor.js`; `[KNOWN GAP]` there is no Organization page yet for the FR-173 pointer) Settings > Agent apps (spec 081) shows one line per installed app: *OS sandbox: available (macOS sandbox)*, or
  *not available: <reason>* with the fix (Linux packages, the Ubuntu AppArmor note already in the README for Codex, the Windows
  build Copilot needs). The Organization page's FR-173 note (spec 076) points to this line.
- **FR-013** `[IMPLEMENTED]` (test: `scripts/test-claude-sandbox.ts`, `scripts/test-copilot-sandbox.ts` AC2) Mode switch (spec 018): the chip shows the floor in force, not the one asked for. Claude Code applies a new floor at the
  next spawn (the existing relaunch with `--resume` at the next message, spec 012 FR-116; until then the hook keeps the stricter of
  the launched and current mode, FR-115), Copilot through `options.update` at the switch, Codex as today (FR-144).

**D. Paths and safety**

- **FR-014** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts`) Protected paths for Ask first: `.git/hooks`, `.git/config` inside each root, plus what the app already protects
  (Claude's list, Codex's `.git`/`.codex`/`.agents`/`.aws`). Durbar adds them to Copilot's `deniedPaths` only where `denied_paths`
  is reported; where it is not, the tooltip does not claim them.
- **FR-015** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts` T010) Roots come only from the main process (the session's cwd and workspace folders, spec 006 FR-019), normalised like
  `codexWorkspaceRoots`; a filesystem root, a share root, a `..` or a control character drops that root; an empty list refuses
  Read-only and Ask first. No path from the renderer.
- **FR-016** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts` scan; argv only) No secret goes into a sandbox setting. Durbar never turns on the vendors' credential injection (Copilot `auth.git`,
  `auth.gh`, `credentials`; Claude `credentials` masking) in these modes, never logs the settings JSON with paths outside debug,
  and spawns with argv only (no shell, constitution III).

**E. Policy, simulator, tests, evidence**

- **FR-017** `[IMPLEMENTED]` (sim: `scripts/check-sandbox-floor.js`) The simulator gives sim agents each state (on per mechanism, off with a reason, managed) so the chip and tooltip are
  checked with zero credits (constitution IV).
- **FR-018** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`) Pure modules with unit tests: `claudeSandboxSettings(mode, roots)`, `claudeSandboxState({ platform, version,
  haveBwrap, haveSocat, startExit })`, `copilotSandboxConfig(mode, roots, pathDirs, host)`, `copilotSandboxState(host, warning?)`,
  Codex's state from its existing checks; every OS through injected platform values.
- **FR-019** `[IMPLEMENTED]` for the rule (test: `scripts/test-sandbox-floor.ts` T050; adapter refusals in the T020/T021 tests) `[KNOWN GAP]` not reachable in the app: spec 076 has no policy reader yet, so `requireOsSandbox()` answers `false` (the reader: issue #734) Organization policy (spec 076): a new key `permissions.requireOsSandbox` (boolean, default `false`) makes FR-007
  refuse instead of warn. It can only narrow (spec 076's narrow-only rule); bad values count as `true` (fail closed). Confirmed by
  owner decision Q1.
- **FR-020** `[IMPLEMENTED]` Linux, Claude Code, Read-only only (real: T060, 2026-10-25, *Changes*) `[KNOWN GAP]` Linux Copilot (Read-only: Durbar refused the command first; Ask first: an approved write outside the folder was **not** refused, K15), Linux Claude Ask first and network, macOS (T061), Windows (T062) Real checks are separate tasks (constitution IV): one tiny read-only prompt per app and OS within the owner's budget
  (macOS, Linux, Windows), recording that a sandboxed command cannot write outside the folder or reach the network. Until then each
  claim is `sim:`/`test:` only, and both the tooltip (FR-010) and the README say "not verified on a real session".
- **FR-021** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`; sim: `scripts/check-sandbox-floor.js` whole line at both sizes) **Codex approval cards in Ask first** say what approval may mean, in a line of its own that is never cut (a separate
  normalized field on the permission, `sandboxNote`, not appended to the one-line `summary` that already carries file names and the
  undo note): `commandExecution` "If you approve, Codex may run this outside its sandbox."; `fileChange` "If you approve, Codex
  writes this outside its read-only sandbox." (filled in `codexPermission`, `src/adapters/codexModes.ts`),
  and the Codex `SandboxState` has `approvedMayLeave: true` so the chip tooltip says it too. Removed only when a real check (or the
  vendor docs) shows an approved escalation stays sandboxed (K6). Read-only is unaffected (every approval is declined).
- **FR-021a** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts`, `scripts/test-sandbox-floor.ts`; sim: `scripts/check-sandbox-floor.js`
  card line and tooltip at both sizes; added 2026-10-25 after the T060 runs, K15, review on PR #753) **Copilot approval cards in Ask
  first** get their own line, through the same `sandboxNote` field as FR-021: a `shell` request while Copilot's state is `on` carries
  "If you approve, Copilot’s sandbox may still let this write outside the folder (seen on Linux, 2026-10-25)."
  (`COPILOT_SANDBOX_NOTE_COMMAND`, `src/adapters/copilotSandbox.ts`; set on a copy of the request in `copilot.ts`, the runtime's
  object is unchanged). Other kinds (file edits, which Durbar checks itself, MCP) and a session whose sandbox is not on get no line;
  the simulator shows it only in Ask first. Copilot's `SandboxState` in Ask first with the floor on has `approvedMayLeave: true`, so
  the chip tooltip says "writes: not only this folder" (and, in Read-only, "writes: none asked; Copilot may add one", K15) and adds "An approved command could write outside the folder (Copilot, seen
  on Linux, 2026-10-25)."; it still ends with "Requested; not verified on a real session." Removed only when Durbar can make
  Copilot's sandbox hold writes to the session folders (K15). Simulator: [1440x900](../../docs/screenshots/087-copilot-card-1440x900.png),
  [1280x800](../../docs/screenshots/087-copilot-card-1280x800.png) (`scripts/check-sandbox-floor.js`, Kenji without `simkinds=mixed`).

### Key Entities

- **SandboxState** (FR-011): normalized, per agent, from the adapter; shown, never saved.
- **Session roots** (FR-015): the folders the floor makes readable (and in Ask first writable).

## Success Criteria *(mandatory)*

- **SC-001** In unit tests, for every app × OS × mode combination (3 × 3 × 3), the settings Durbar would send match FR-001..FR-005,
  and no combination sends an auto-approve or bypass setting (FR-002), every Claude cell in Read-only and Ask first has
  `failIfUnavailable: true`, and every Copilot cell has `allowDevToolAccess: false`.
- **SC-002** Every combination where the sandbox is unavailable gives a visible *Not sandboxed* with a reason, or a refusal when
  policy requires it; none starts silently unsandboxed, and no state is `on` before the app confirmed it.
- **SC-003** The 15-agent office at 1440x900 and 1280x800 is unchanged (`check:office`); the chip fits at both sizes.
- **SC-004** After the real-check tasks: on each OS where an app has a sandbox, a command in Read-only cannot create a file in the
  folder, and in Ask first cannot create one outside it, or the gap is recorded `[KNOWN GAP]`.

## Assumptions

- The vendor surfaces in research.md stay as read; Copilot's are `@experimental`, so the pinned SDK version is the contract
  (constitution II) and an upgrade re-checks them.
- Durbar's own checks stay as they are; this spec adds a floor and a display.
- The Agent SDK transport for Claude (spec 012 FR-113) gets the same block when it is used; not built here (K5).

## Owner decisions

**Decided 2026-10-25 07:03 UTC by Vikram (owner), Telegram DM: "all as recommended"**; relayed by his agent and recorded on the
PR ([#728 comment](https://github.com/three-feathers/agent-durbar/pull/728#issuecomment-6394676289)) and on issue #611. Each question below is kept with the answer that is now binding.

- **Q1 Sandbox unavailable: fail closed or warn?** **Decided (as recommended):** **warn, and the person chooses** for Claude Code and Copilot in
  Read-only and Ask first. Durbar always asks the app to fail if its sandbox cannot start (Claude `failIfUnavailable: true`); when it
  does, nothing is sent or re-sent, and the chat says why with *Continue without the OS sandbox* (this session, Durbar's own checks
  still apply) or *Change mode…*; on a computer that can never sandbox that app (Claude on native Windows), *Always continue on this computer* is offered
  once and only skips the note (round-3 review: it never turns the sandbox attempt off). *Sandboxed* is shown only after the app confirmed it. **Fail closed** (no Continue button) only when the organization
  policy key FR-019 says so; Codex stays fail closed. Why: native Windows has no Claude sandbox and most Windows builds lack Copilot's, so fail-closed by default
  would make Read-only unusable there although Durbar's checks still deny every write and shell call in it.
- **Q2 Network for sandboxed commands in Ask first: off or ask?** **Decided (as recommended):** **off** in the first build (Claude
  `strictAllowlist`, Copilot `allowOutbound: false`; Codex is already off). Asking per host needs Claude's network prompt to reach
  Durbar's card (K3), which is unverified; a follow-up can add it. Cost: `npm install`-style commands fail in Ask first and the
  error says so; Allow all remains the way to run them.
- **Q3 Codex Ask first: keep the read-only profile, or allow writes inside the folder?** **Decided (as recommended):** **keep `durbar_ro`**. A
  workspace-write profile would let Codex write inside the folder without asking, which Ask first promises never happens.
  Residual gap K6 (an approved escalation may run outside the sandbox) is recorded, not hidden.
- **Q4 Limit sandboxed reads to the session's folders for Claude Code too?** **Decided (as recommended):** **yes** (`denyRead: ["~/"]`,
  `allowRead` = roots): it matches Copilot's deny-by-default policy, Codex's profile and spec 003 FR-023, and keeps `~/.ssh` and
  `~/.aws` out of reach of a command. Cost: a tool that reads its config from the home folder (`~/.npmrc`, `~/.cargo`) may fail in
  Read-only and Ask first; the error is shown as is.
- **Q5 Where to show it?** **Decided (as recommended):** **the chat header chip and the card's mode tooltip**, plus Settings > Agent apps; no new
  word on the office card (keeps the 15-agent layout).

## Changes

### 2026-10-28: T066 run on a real session: verdict A, K16 cleared in place on Linux; FR-022c built (T072; Refs #806)

**The run** (`real:` 2026-10-28 05:35 UTC, by Vikram's agent with Vikram's OK on his Copilot account; the record is
[his comment on issue #806](https://github.com/three-feathers/agent-durbar/issues/806#issuecomment-6461550562)). Host: Linux 7.0.0-38-generic,
bubblewrap 0.9.0, Node 24.22. Runtime: Copilot CLI 1.0.98, SDK 1.0.22. Script: `scripts/sandbox-floor-real.js copilot out.json switch --spend`
from `main` (#827), after a dry run (0 prompts) that passed: signed in, tools `[bash]`, the floor `on` (bubblewrap), baseline curl exit 0 and a write to P.
**Cost: 3 prompts, 0.162 AIU** (6 priced calls), within the approved budget (Q1).

| Step | What | Result |
|---|---|---|
| 1 (prompt 1, control) | Ask first, floor on, the card approved only for exactly C | **both blocked**: `touch=1`, no file, `curl=6` |
| 2 (no prompt) | `setPermMode(allow)`, then `options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' })` | **resolved** |
| 3 (prompt 2) | C again, Allow all, same session | **both OK**: `touch=0`, the file written, `curl=0`; `sandbox.decision` `enforcement_state` `inactive` |
| 4 (prompt 3) | back to Ask first (the adapter re-sends the floor), C again | **both blocked** again (`touch=1`, `curl=6`) |

**K16 is resolved for Linux** `[IMPLEMENTED]` (`real:` above): on CLI 1.0.98 / SDK 1.0.22 that payload clears a running floor in place and a later
floor update puts it back, with no restart. `[KNOWN GAP]` macOS (`sandbox-exec`) and Windows were not run (the probe refuses Windows by design), and no
runtime newer than 1.0.98 was run (#828 brings 1.0.103).

**Two side findings of the run:**

- (a) **Cleanup.** The cleanup left the session folder F, as designed, because it held one entry the probe did not make: a `.git/` with an empty
  `hooks/` and a `config`. Ask first's floor denies `<root>/.git/hooks` and `<root>/.git/config` (FR-004), so the runtime or bubblewrap left a
  placeholder for each (read from the listing, not checked further). Fixed: `scripts/sandbox-probe-cleanup.ts` (`gitPlaceholders`, `removeOwn`,
  moved out of `sandbox-floor-real.ts`) recognises exactly a plain `.git` folder at F's top level that holds exactly a plain, empty `hooks/` folder
  and a plain, empty `config` file (the run did not record the size of its `config`; a non-empty one still leaves F, visibly), and removes them
  (non-recursively) only when nothing else in F is unknown; P never gets this allowance
  (test: `scripts/test-sandbox-floor.ts`: a hook inside, a non-empty config, a folder or link in either place, a third entry in `.git`, `.git` as a
  link, another file at F's top: each leaves F and its `.git` untouched).
- (b) **hostSupport.** `getHostSupport()` reported the `network` capability as **unsupported** on that host ("sandbox networking requires
  unprivileged user and network namespaces", the Ubuntu 24.04+ AppArmor restriction), yet curl was still blocked under the floor (exit 6, DNS
  failure): the floor cut the network some other way. So **do not rely on the reported `network` capability** to say whether the network is
  blocked (also noted under T060). Durbar does not read that capability today (it reads `denied_paths` only, FR-004).

**FR-022c built (T072, fakes and simulator only; not run on a real session through the app).** In `applySandbox` (`src/adapters/copilot.ts`),
a switch to Allow all of a Copilot session that holds a floor (`live.sandboxFloor`) sets the kept state (`untilNewSession`) first, then sends
exactly `{ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' }` with the 15 s limit of FR-004. **Resolved:** the floor
is gone, the state is `null` (no chip word, no action). **Refused or no answer:** the state keeps `untilNewSession` and *Restart without the
sandbox* stays offered (FR-022, the fallback). A **managed** state (`managed: true`) is never lowered (a policy conflict) and keeps its state; the
Copilot adapter has no managed source today, so this is a guard (test with a set state). The next send waits for the lowering to settle (as for
FR-004), and **the sandbox changes of one session now run one at a time, in order** (`setPermMode` chains them), so a narrowing right after a
lowering is sent after it and its floor is the one left; a lowering that resolves after a later switch does not overwrite that switch's state.
Narrowing to Read-only or Ask first re-sends the full floor (FR-004), as before. `allowBypass` is never sent and appears in `src/` only in
comments; `sandbox.disableForSession` is not called (source scan in `scripts/test-copilot-sandbox.ts`). The Allow all dialog's sentence for a
Copilot session with a floor is now Q4's, "<App>’s OS sandbox is also turned off for this session." (`allowAllNote`, app name from the adapter;
it replaces FR-022e's). The action's tooltip (`restartTip`) now says the fallback: "<App> did not confirm turning its sandbox off in this running
session, so it stays until a new one. Restart keeps this conversation and starts a new session in Allow all." (+ "Requested; not verified on a
real session." while `verified` is false). The simulator lowers a Copilot floor at the switch (always resolved); sim agent #14 keeps its kept
floor in Allow all to show the fallback. Claude Code and Codex are unchanged. **T073 is not needed** (its fact is this entry and the tooltip).

**Review on PR #833** (Vikram's agent, changes requested at f90faaf0; fixed in the same PR, fakes and simulator only):

1. **A lowering that answers after the 15 s limit is no longer ignored.** The adapter keeps the raw update; on a timeout it marks the lowering
   outstanding (`lowerOutstanding`). Its late answer re-runs the session's *current* mode through the same per-session chain: a late success in
   Allow all gives `null`; in Read-only or Ask first the full floor is sent again, after the lowering, and only then is the state `on`. A late refusal in
   Allow all keeps the kept floor. While the lowering is outstanding, a narrowing **fails closed**: the state is `unknown` ("Waiting for Copilot to
   answer the earlier request to turn its sandbox off.") and the sends are held as in FR-007 (the note says why), no floor is sent, and a switch to
   Allow all sends no second lowering. A lowering that resolves after a later change of the same session (`sandboxSeq`; only a direct re-apply such as a
   sign-in refresh can overlap, the switches are chained) re-runs the current mode instead of reporting `null`. Test: `scripts/test-copilot-sandbox.ts`
   with a deferred fake (`lowerDeferred`): (a) late success and late refusal in Allow all, (b) back to Ask first after the limit, both outcomes.
2. **The order is tested:** Allow all then Ask first at once with a slow lowering inside the limit gives exactly start floor, lower, floor, then the
   send (the send waits for both), state `on`; and the `sandboxSeq` case above. The reviewer's mutants M1 (the chained narrowing skips its apply) and
   M5 (no `sandboxSeq` guard) are now caught.
3. **FR-022e's `[KNOWN GAP]` is closed by showing the sentence:** the normalized state gets a neutral `heldFloor: true` (no vendor key; `src/shared/api.ts`,
   cleaned in `cleanSandboxState` and `sandboxtext.js`) whenever a floor this session set is (assumed) in force and not managed, set by the Copilot adapter
   in `setSandbox` from `live.sandboxFloor`, whatever the state word (`on`, `off` after a refused narrowing, `unknown`). `allowAllNote` shows Q4's
   sentence exactly when `heldFloor` is true and the state is not managed or already kept, i.e. whenever the switch will send the lowering. Claude Code and
   Codex never set it.
4. **A calm toast after a refused or unanswered lowering** (the coordinator's decision on the reviewer's question): the adapter's sandbox event carries
   `notLowered: true` (a closed flag; `eventguard`, and main's `outwardSandboxEvent` passes only `true`), and the window shows the existing toast
   "<App> did not turn its sandbox off; use Restart without the sandbox." (`notLoweredToast`, app name from the adapter). Sim: `?simsbxlower=refuse`
   makes the sim refuse the lowering; the driver checks the toast, the kept floor and its action at both sizes, and that a Claude switch adds no toast.

**Review on PR #833, round 2** (Vikram's agent at e5d7bf3d): (1) `refreshAuth` now clears `lowerOutstanding` with `sandboxFloor`, and a late answer is
read only for the session handle it was sent to (`lateLowering` compares `live.session`; the in-time path too), so after Ask first → Allow all (lowering
timed out) → sign-in refresh → Ask first the floor reaches the new runtime and the state is `on`, and the old runtime's answer is ignored, also while a
new lowering is outstanding. (2) The unbounded wait is accepted and written into FR-022c; the held note's reason (`COPILOT_LOWER_WAIT`) names the way
back, and End session plus a resume gives the floor again (the ended session's late answer is ignored). Test: `scripts/test-copilot-sandbox.ts`
(both sequences, the note text pinned); mutants: not clearing in `refreshAuth`, and accepting an older handle's answer, both caught.

### 2026-10-28: minimum Claude Code 2.1.309 (FR-003a, T074)

- **FR-003a** (amends FR-003): the minimum Claude Code version is **2.1.309** (was 2.1.219). `read:` Claude Code CHANGELOG, entry 2.1.309, read 2026-10-28: "Fixed sandboxed Bash commands on macOS and Linux running the shell's startup files outside the sandbox before each command" and "Fixed sandboxed commands and auto-accepted edits being able to modify the MCP config file passed with `--mcp-config`". Durbar passes an `--mcp-config` file, so below 2.1.309 the floor would be claimed over two known escapes. Behaviour below the minimum is unchanged (FR-006, FR-007): no sandbox block is sent, the state is *off* with the reason "This Claude Code is too old for Durbar's sandbox settings." and the fix "Update Claude Code to 2.1.309 or later (Settings > Agent apps)."; the session still starts and Durbar's own checks still apply. An unreadable or pre-release version (`2.1.309-beta.1`) is below.
- Numbers taken: FR-003a, T074 (free on `main` and in PR #833, which uses FR-022/FR-022a..e, K16, T066..T073).

### 2026-10-28: T066 probe built, real run not possible on this host (K16 stays open; Refs #806)

`scripts/sandbox-floor-real.ts` has the `switch` scenario of T066 (steps 1-4, hygiene items (a)-(c) of the review on PR #809), and its
verdict is a pure function, `scripts/sandbox-switch-verdict.ts` (test: `scripts/test-sandbox-floor.ts`, three planted mutants caught: a
write counted without the file on disk, A without a resolved update, step 4 expecting the wrong outcome). **The real run did not happen:
0 prompts spent, 0 AIU.** The dry run (no `--spend`; it starts the runtime and creates one session with no prompt, then deletes it) on
the owner's VPS (`real:` 2026-10-28 ~02:00 UTC, Ubuntu 24.04.5, kernel 6.8.0, Node 22.23, Copilot CLI 1.0.98 as the SDK's bundled
runtime reports it, SDK 1.0.22) showed:

- a signed-in Copilot client (`getAuthStatus`: signed in, auth kind `gh-cli`; the login and any token were not read out or printed);
- the tool limit works without a prompt: a session created with `availableTools: ['builtin:bash']`, `excludedTools: ['mcp:*',
  'custom:*']` and `mcpServers: {}` reads back exactly `[bash]` (`session.rpc.tools.initializeAndValidate()` then `getCurrentMetadata()`);
  the script refuses to send anything when the list holds any other tool;
- the runtime refuses a session cap under 30 AI credits ("Minimum session limit is 30 AI credits"), so the probe keeps 30 and stops on
  its own (see the review fixes below: before every send, at 1 AIU, unknown usage, a stray command or a turn that did not end);
- **`getHostSupport()` answers `supported: false`: "Bubblewrap (bwrap) is unavailable ... not installed or not on PATH"** (neither
  `bubblewrap` nor `socat` is installed on this VPS). So Ask first gets no floor (chip *Not sandboxed*, state `off`), the control step
  cannot show a blocked command, and the spend run refuses before its first prompt. The T060 runs of 2026-10-25 (kernel 7.0, bubblewrap
  0.9.0, socat 1.8.0.0, Node 24.22, CLI 1.0.101) were therefore on another Linux host.

**Review on PR #827** (Vikram's agent, changes requested at 4f81c360; fixed in the same PR, before any spend):

- `mayPrompt` (pure, `sandbox-switch-verdict.ts`) runs right before the one `send` and refuses a 4th prompt, any prompt once the run
  used 1 AIU, after a step whose usage could not be read (the script waits up to 30 s for a usage event with a number; a step with none
  is "usage unreadable", never 0), after a turn that did not end, and after any command that is not exactly C. A cannot-tell after step 3
  stops there: prompt 3 is not spent.
- In Allow all no card asks, so the runtime's permission handler of the probe session rejects every request that is not exactly C before
  it runs, the turn is interrupted at the first tool call whose command is not exactly C, and the exit codes are read only from the exact
  C call (`probeCalls`); a model's `echo curl=0` never counts.
- Before the first prompt, a baseline from the script itself with no shell (`execFile` with an argv): `curl` reaches example.com and a
  plain write to P works. If either fails the run refuses, since a blocked step would then mean "no network" or "no folder" (a false B).
- `switch` runs on Linux and macOS only (C is POSIX shell): it refuses on Windows up front. macOS is not run.
- Round 2 (at c3afd6f6): the permission gate is the pure `probeGateAllows(req, C)` (a shell request whose `fullCommandText` is exactly C;
  `read:` SDK 1.0.22 `session-events.d.ts` types it `fullCommandText: string`); a second exact run of C is stray too, so only the first
  result is read. **Which field holds the command:** the SDK typings give a tool start only `arguments?: JsonValue`, so it was read from
  the runtime: `tools.list` gives the `bash` tool the arguments `command` (required), `description`, `shellId`, `mode`, `detach` and
  `initial_wait` (`real:` 2026-10-28 dry run, CLI 1.0.98, no prompt; recorded as `shellToolParams`). The spend run refuses when `command`
  is missing, and a start with no string `command` is stray (fail safe). **Other tools such as `report_intent`:** they cannot start,
  because the session's tools are limited to `bash` and read back as exactly `[bash]` before any prompt; any other start that came anyway
  would be stray (the turn is interrupted, no further prompt), never ignored. The source checks strip `\r`, so a Windows (CRLF) checkout
  passes, as #825.
- A failed `stop`, session delete or folder removal is printed and makes the run exit 1 (it was a silent `.catch`). Checked 2026-10-28
  (`real:`): the two dry runs left no session folder in `~/.copilot/session-state`; they left two runtime log files (`~/.copilot/logs`,
  1.4 kB and 1.9 kB, not read) and one session operation lock file, the runtime's own.
- test: `scripts/test-sandbox-floor.ts` (the gate's branches, the exact-call selection, and source checks that the send is gated right
  before it, that there are 3 steps, that the limits come from the module and that Windows is refused); mutants in the PR.

`[KNOWN GAP]` K16 unchanged; T066 stays open. To run it: a Linux host where `getHostSupport()` says supported (bubblewrap 0.5.0 or newer
on `PATH`, and the host must let it make its namespaces: this VPS also has `kernel.apparmor_restrict_unprivileged_userns=1`), a
signed-in Copilot, then `node dist-scripts/scripts/sandbox-floor-real.js copilot <out.json> switch` (dry) and, with the owner's OK,
the same with `--spend` (at most 3 prompts). Installing bubblewrap on this VPS needs sudo and changes the host, so it is the owner's
call. T072 and T073 still wait for the verdict. (Superseded the same day: T066 ran on another Linux host, verdict A; see the entry above.)

### 2026-10-27: Copilot, a switch to Allow all keeps the sandbox: what we do about it (FR-022..FR-022c, T066..T073, K16; Refs #806)

**Problem** (owner's real session, 2026-10-27, issue #806). A Copilot session that started in Read-only or Ask first holds the floor
(FR-004). After a switch to **Allow all** Durbar sends no new `sandboxConfig` (*Edge cases*, "Mode switch"), so shell commands
still cannot write or reach the network (`npm install`, `git push`, `curl` fail) while the mode says Allow all; the chip says
*Allow all · Sandboxed (until a new session)* and the tooltip says "it stays until a new session". File edits work because Durbar checks
them itself (FR-010). This was a deliberate choice on safe grounds ("the safer direction", review round 1 on PR #728), not an SDK limit
we have shown. K8 (does `options.update` apply to a created session) is settled on Linux (above); **K16** below is the new question:
can a later update clear the floor? Claude Code is not affected (it relaunches at the next message with the new mode's argv, spec 012
FR-116; its Allow all argv has no `sandbox` key, FR-003) and neither is Codex (FR-144: the next message uses `danger-full-access`).

**What the SDK 1.0.22 typings say** (`read:` `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts`; typings only, **not** a proof of what
the runtime does; nothing was run):

- `session.rpc.options.update(params: SessionUpdateOptionsParams)` "Patches the genuinely-mutable subset of session options"
  (rpc.d.ts:34170-34178); `sandboxConfig?: SandboxConfig` and `sandboxConfigSource?: SandboxConfigSource` are both fields of the params
  (rpc.d.ts:26261, 26267). Omitting them is a patch with no sandbox change; **`null` is not in the type** (`sandboxConfig?: SandboxConfig`; Durbar sends `null` only for
  `sessionLimits`, `copilot.ts:1461`, where the type allows it). So "restore the default by omitting or by
  null" has no documented meaning.
- `SandboxConfig.enabled: boolean` is **required** ("Whether sandboxing is enabled for the session", rpc.d.ts:22225-22232), so
  `{ enabled: false }` is a type-valid value. The sub-flags (`sandboxMcpServers`, `allowDevToolAccess`, ...) "Ignored while `enabled` is
  false". No text says that `enabled: false` is honoured on a running session, or refused.
- `SandboxConfigSource` (rpc.d.ts:4390-4413) has `"session_disabled"`: "The user disabled the sandbox for the current session", next to
  `"session_flag"` (what Durbar sends today), `"never_configured"` ("The client applied the default because no sandbox preference
  was configured"), `"user_disabled"`, `"unsupported_host"` and `"repository_policy"`. The `sandboxConfigSource` doc says "explicit
  below-floor changes remain policy conflicts unless a session opt-out is authorized": a managed policy may refuse a lowering.
- The vendor models a session-scoped opt-out in two other places, neither usable as is: `SandboxSessionChange` `"disabled"` ("off for
  the rest of this session; nothing was persisted and a new session starts from managed policy") / `"restored"` ("a previous
  session-scoped opt-out was cleared and the sandbox is enforced again"), a field of a slash-command result (rpc.d.ts:4436-4440, 27129), and
  `session.rpc.sandbox.disableForSession({ requestId })` (rpc.d.ts:32888), which only works "for the exact request still pending" and
  "the effective sandbox policy permits bypass": it needs `allowBypass: true`, which Durbar never sends (FR-002). Durbar will not use it.
- There is **no getter** for the effective state: `getEnforcementStatus()` (rpc.d.ts:32874) answers only `required` / `blocked` / `reason` for
  managed policy. So "the chip follows what the app confirms" can only mean "the update resolved or was refused" (the same signal
  FR-004 uses), and the sandbox's real effect is known only from a probe (T066).
- `read:` the default of the local sandbox when nothing is sent is not stated in the typings (the "Default: true" lines are for the
  sub-flags). The owner's own report is that a **new** Allow all session has no sandbox; T066 records it as a control.

**New gap K16** (resolved for Linux 2026-10-28, `real:` T066, verdict A: cleared in place on CLI 1.0.98 / SDK 1.0.22; see *Changes* 2026-10-28; macOS and Windows `[KNOWN GAP]`): whether `options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' })` (or any
other documented value) clears a floor that is already running in a Copilot session, with CLI 1.0.101 / SDK 1.0.22, and whether a later
`enabled: true` update puts it back. Unverified; T066 settles it. (2026-10-28: the probe is built but could not run, the owner's VPS has no bubblewrap, so Copilot reports no sandbox
support there; *Changes* 2026-10-28.)

**Decision: which outcome ships until the probe runs.** **(B) ships first and by itself.** Reasons: (1) it uses only things that already
work: the mode switch stays as it is, and the new action goes through the existing Restart session path (`mcpRestartSessionOp`,
spec 058 FR-022: End session, then the same id through `ensureLive` with `startOptionsFor(a)`, which reads the agent's current mode,
`src/main/startopts.ts:24`); nothing depends on an `@experimental` call whose lowering semantics the typings do not give; (2) it never
sends a *weaker* sandbox config, so the worst a wrong guess costs is a restart that keeps a floor (the chip then shows it, FR-022b);
(3) it is the right fallback for (A) too (a refused update, a managed policy, another runtime version), so building it is not wasted if
the probe passes; (4) it is a small change in one adapter-neutral state flag, one menu item, one chip action and tests. **(A) is built
only if the probe shows the floor clears** (T072, conditional): sending `enabled: false` unverified is the one choice that could claim
"off" while the OS still enforces (harmless) or, worse for a reviewer, add a second, silent lowering path that the typings say a policy
may treat as a conflict. So: **build B now; build A only after `real:` evidence; keep B in both cases.** If the probe passes, A becomes the
default on the switch and B is offered only after an A refusal; if it fails, B is the final design.

#### Clarifications (owner answers, Paco, terminal, 2026-10-27; relayed by the coordinator, to be mirrored on issue #806)

- **Q1** The T066 probe is **approved** by Paco, budget about 3 Copilot prompts (ask again before going over). It has **not run yet**. Order unchanged: B is built first (T067-T071).
- **Q2** The restart has its **own** `askDialog`, apart from the Allow all dialog (no combined one-click button). FR-022 and FR-022a(2) stand as written.
- **Q3** The action lives in the **chat header chip and the mode menu only**, not in the office card's menu (the `modesOnly` menu of spec 003 FR-095 is a mode menu, so it is covered).
- **Q4** Yes: if A ships, the Allow all dialog says "Copilot’s OS sandbox is also turned off for this session." (FR-022c).
- **Review round 1 on PR #809** (items 1-6 and three questions) is answered in FR-022, FR-022a, FR-022d, FR-022e, T066-T071 and *Review questions answered*; new number taken: **FR-022d, FR-022e** (free on main and in open PRs #809, #810, #710).
- **Q5** Not asked. No slash-command route (`SandboxSessionChange`) and no other payload without a separate OK from the owner.

#### Requirements (new)

- **FR-022** `[IMPLEMENTED]` (outcome B; ships first; test: `scripts/test-sandbox-floor.ts` T067, `scripts/test-mcp-session.ts`, `scripts/test-copilot-sandbox.ts` T069; sim: `scripts/check-sandbox-floor.js` T070; not run on a real session) **Restart without the sandbox.** For a live session whose normalized `SandboxState` has
  `untilNewSession: true` and `managed` not true (only Copilot sets it, `copilotSandboxState`, so Claude Code and Codex never see the action),
  while the mode is **Allow all** and the adapter has `capabilities.resume`:
  - the mode menu gets an item **Restart without the sandbox** (under the three modes, same menu element, spec 003 FR-095 `modesOnly` menus
    too; not the office card's menu, Q3) and the chip's segment becomes a button with the same action; both only in that state, never for *Sandboxed*, *Not sandboxed*,
    *Sandboxed (managed)* or another mode (Read-only/Ask first: switching down re-sends the floor as today).
  - it asks first with the shared `askDialog`, through the **existing renderer flow** `mcpRestartSessionFlow` / `restartSessionAsk`
    (`src/renderer/screens.js:1060, 1104`), extended and not copied: it keeps the `needsConfirm` retry, the busy state, the sign-in card on
    `errorKind: 'auth'` (spec 058 FR-027) and the toast. The dialog (separate from the Allow all dialog, Q2) reads: title "Restart <name>
    without the OS sandbox?", body "The conversation continues in a new session in Allow all. Shell commands will no longer be limited to
    this folder and can reach the network. Nothing is re-sent; send your next message when it is ready." and **the same lines the existing
    Restart session dialog gives**: "The conversation is kept and resuming spends no AI credits."; "The running turn stops." when busy;
    "\"Approve for this session\" grants are cleared."; "Remote control turns off." when it is on (`endSession` turns it off first, spec 054
    FR-011); and, for an app whose MCP servers start with the next message (`start === 'next-message'`), "Its MCP servers start again with your next
    message."; plus the pending asks listed ("N requests waiting will be denied"). Buttons *Cancel* and *Restart without the sandbox*
    (`primary warn`). Unlike the existing flow, this dialog is **always** asked (the existing one returns `null` for an idle session with no grants
    and no remote; here the sandbox consequence needs a click every time).
  - **Neutral wording, no new channel (reason argument).** `agents:mcpRestartSession(id, confirmed, reason?)` gets an optional third argument,
    a closed value `'mcp'` (default, today's behaviour) or `'sandbox'`; main validates it (anything else is `'mcp'`) and the op uses it only for
    **words**: main's `log` line ("Session restarted with the current MCP servers" or "Session restarted without the OS sandbox"), the
    no-resume error ("... cannot be restarted with the current servers" or "<App> cannot resume a session, so it cannot be restarted without the
    OS sandbox."). The flow takes the same reason in its handlers `h` and picks the renderer words: dialog title/body/button as above, the toast
    "<name>: session restarted without the OS sandbox." (+ the next-message line when `start === 'next-message'`) and the failure toast. The mode,
    the resume and the end are the same code for both reasons; a test pins that `reason` changes no behaviour (same calls, same result).
    A source-check test pins: one registered channel, the renderer calls `agentMcpRestartSession` only from `mcpRestartSessionFlow`, and no
    "MCP" word reaches the dialog or toast when the reason is `'sandbox'`.
  - **Visibility without a new `AgentInfo` field.** The action is gated by the normalized state (`untilNewSession`, Allow all, not managed). Only
    Copilot sets `untilNewSession`, and its adapter has `capabilities.resume: true` (`copilot.ts:191`), so no renderer-side `resume` input is
    needed; the op itself still refuses an adapter without `resume` (`mcpsession.ts:262`, neutral text above) and the renderer shows that error.
    (The renderer receives `canRestartSession` today only in the `agents:mcp` reply, `mcpsession.ts:152`; not used here.)
  - the tooltip of the item and the chip button says what Durbar does, not a vendor fact (K16 is unverified): "Durbar does not turn <App>'s
    sandbox off inside a running session; it stays until a new one. Restart keeps this conversation and starts a new session in Allow all."
    (Since FR-022c, 2026-10-28, the action is the fallback after a refused or unanswered lowering, and the tooltip says so: "<App> did not confirm
    turning its sandbox off in this running session, so it stays until a new one. Restart keeps this conversation and starts a new session in Allow all.")
    <App> is the adapter's display name as the chip tooltip already gets it (`sbxTip` / `kindWord(adapterId)`, `app.js:3730`); no vendor literal in the
    renderer (constitution II). At most 300 characters (driver). T073 may turn it into a fact with `real:`. It keeps "Requested; not verified
    on a real session." while `verified` is false, and **names no platform as checked**: the probe is Linux only, so macOS (`sandbox-exec`) and Windows
    stay `[KNOWN GAP]` and neither the tooltip nor the README describes the restart as verified anywhere (constitution VIII).
- **FR-022a** `[IMPLEMENTED]` (test and sim: as FR-022) **The semantics, in one place, and no silent widening.** *Allow all* means "Durbar requests no OS floor; the app's default".
  A floor kept from an earlier mode is a **leftover that Durbar never removes on its own**; lifting it is always a separate, confirmed action
  (FR-022). This also holds for spec 058's *Restart session with these servers* (reason `'mcp'`, from the MCP dialog and Settings > MCP servers):
  it resumes in the current mode too, so on an Allow all session with a kept floor it always asks (even idle, with no grants or remote
  control) and its dialog adds "The OS sandbox kept from an earlier mode is lifted (Allow all)." (`restartSessionAsk`; test: `scripts/test-mcp-session.ts`;
  review on 32220198). Nothing remembers "without the sandbox": it is only the mode, so Read-only and Ask first stay sandboxed by default, and every new or
  resumed session in those modes gets the floor again (FR-004, FR-013). A Durbar restart, or the runtime refresh after a sign-in
  (`copilot.ts:459`, `refreshAuth`), resumes an Allow all session with the app default, i.e. **without** the floor; that path is visible, not silent
  (FR-022d). **No silent widening; the confirmations stay.** (1) The switch to Allow all keeps the existing `askDialog`
  confirmation (`changeModeInner`, `src/renderer/app.js`); nothing in this delta removes or skips it, and for a Copilot session that holds a
  floor its body also says so (FR-022e). (2) *Restart without the sandbox* is a
  second, explicit confirmation of its own (FR-022), because it widens the OS limit, which the Allow all dialog never mentioned: a
  person who confirmed Allow all has not agreed to a restart. (3) Nothing restarts, relaunches or sends by itself: not on the switch, not on
  the next message, not after a Durbar restart (a resumed session in Allow all simply has no floor, as today). **Accepted non-silent path
  (review on PR 823, option a):** *End session* (on an idle agent it does not ask, `cardOp`) followed by a message
  resumes the same id in Allow all with no floor, like a Durbar restart: the person ended the session themselves, and the new session starts in
  the mode they chose. When the session ends, the kept floor ends with it: the Copilot adapter reports the state `null` at the stop (and when a
  sign-in refresh drops a session), so an ended agent's chip never says *Sandboxed (until a new session)* (test: `scripts/test-copilot-sandbox.ts`;
  sim: `scripts/check-sandbox-floor.js`). (4) The restart never
  re-sends a prompt, never approves a pending request on its own (End session denies pending asks cleanly, `copilot.ts:1064`
  `broker.stop()`), and never changes the mode. (5) The action cannot be offered, or accepted by main, for a session that is not in
  Allow all with a kept floor: the renderer shows it only then and the existing op is unchanged, so main's check is the mode it resumes with.
  **Trust boundary (review on PR 823, question 2):** main does not check that the window asked before an idle restart; `confirmed` is required only for
  a busy agent (the running turn and its pending asks, `mcpRestartSessionOp`). The gates are the window's confirmation and the mode the person already
  set. A window that skipped the dialog gains nothing it could not get with calls it already has: `agents:setMode` to Allow all has no confirmation
  in main (only the remote-control and organization-policy refusals, `ipc/agents.ts` `agents:setMode`, `setModeOp`), and `agents:end` followed by a
  send resumes in that mode without the floor (read: `ipc/agents.ts`, 2026-10-28). `reason` is words only and is **not** a security control.
  (6) `permissions.requireOsSandbox` (FR-019) does not forbid Allow all, so it does not change this action; a managed floor (`managed: true`)
  does: no action (the new session would be sandboxed again).
- **FR-022b** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts` T069 AC1-AC3; sim: `scripts/check-sandbox-floor.js`) **Edge cases of B.**
  - *A switch during a running turn:* the switch and its Allow all dialog work as today. The restart needs `confirmed` (FR-022 of spec 058);
    the dialog says the turn is stopped; commands already running die with the session; the chat keeps its history (the same id resumes).
  - *A session with pending permission asks:* the Allow all dialog's "Also approve the N requests" box is separate and stays as is. A restart
    denies them (End session) and lists them in its dialog ("N requests waiting will be denied"); none is approved by the restart.
  - *The resume fails* (sign-in expired, `errorKind: 'auth'`, spec 058 FR-027): the agent stays ended, the error shows as for Restart
    session; the next message resumes it in Allow all with no floor. No retry loop.
  - *Switch back to Ask first / Read-only while the floor is kept:* the floor is re-sent as today (spec 087 AC2); the action disappears
    (the state loses `untilNewSession`). *Switch to Allow all again after the restart:* no floor, no word, no action.
  - *Chip states:* kept floor in Allow all = *Allow all · Sandboxed (until a new session)* + the action (FR-022); while restarting the agent shows
    the existing stopped/ready state of Restart session; after it, *Allow all* with no extra word. Claude Code: *Allow all* with no word
    (`sandbox` key absent). Codex: unchanged. `chipWord` is unchanged (it already returns that text); the button is added around it.
  - *Claude Code and Codex unaffected, and why:* Claude's floor lives in argv and is rebuilt at the next launch, which a mode change already
    forces (spec 012 FR-116); Codex applies its profile per message (FR-144). Neither ever sets `untilNewSession`, so neither sees the
    action; a test pins that no Claude or Codex state produces it.
- **FR-022c** `[IMPLEMENTED]` (outcome A; K16 cleared, `real:` T066 2026-10-28, Linux, CLI 1.0.98; test: `scripts/test-copilot-sandbox.ts` T072, `scripts/test-sandbox-floor.ts`; sim: `scripts/check-sandbox-floor.js`; the app's own switch not run on a real session; macOS and Windows not verified) **Clear the floor on the switch.** On a switch to Allow all the Copilot
  adapter sends `options.update({ sandboxConfig: { enabled: false }, sandboxConfigSource: 'session_disabled' })` (the exact payload T066 proved;
  no other field, never `allowBypass`), with the same 15 s limit as FR-004. The state follows the update: **resolved** → `null` (as a fresh
  Allow all session); **refused or no answer** → the floor is still assumed in force, the state keeps `untilNewSession: true` and FR-022
  is offered, with a toast (review on PR #833); an answer after the limit re-runs the current mode, and a narrowing fails closed until it comes. **Accepted (review on PR #833, round 2): that wait has no
  bound.** A lowering that never answers keeps Read-only and Ask first sends held; the held note says "End the session (or restart it) to start again with the
  sandbox.", and End session, Restart session or a sign-in refresh start a new session handle that gets the floor again and ignores the old answer. A switch back to Read-only or Ask first re-sends the full floor (FR-004), as today; a test pins both directions. Because the
  switch would now also lower the OS limit, the Allow all dialog for a Copilot session with a floor replaces FR-022e's sentence with "Copilot’s OS sandbox
  is also turned off for this session." (FR-022a(1): the confirmation must name it). If the probe fails, FR-022c is struck from this spec
  and the unused code is never written.

- **FR-022d** `[IMPLEMENTED]` (test: `scripts/test-copilot-sandbox.ts` T069 AC4) **A runtime refresh must not keep claiming a floor the resumed session does not have.**
  Read in code (`copilot.ts:452-461`, not run): `refreshAuth` resumes each live session with `resumeConfig()` (no `sandboxConfig`) and then calls
  `applySandbox(sid, live, live.broker.getMode(), client)`. For `allow` that returns `copilotSandboxState({ keptFloor: live.sandboxFloor })`, and
  `live.sandboxFloor` is still `true` from before the refresh, so the chip would keep saying *Allow all · Sandboxed (until a new session)* for a session the
  new runtime started without the floor. Fix at implement time: the refresh clears `live.sandboxFloor` before `applySandbox` (Read-only and Ask first
  re-send the floor as now). Result: after a refresh (and after a Durbar restart, where the live object is new and the flag is unset) an Allow all session
  shows no word and no restart action. The README line says that a Durbar restart or a sign-in refresh resumes Allow all without the sandbox.
- **FR-022e** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts` T067; sim: `scripts/check-sandbox-floor.js`) **The Allow all dialog tells the truth under B.** `changeModeInner` says "Edits, shell commands, web requests and tools will run
  without asking": true for asking, not for a kept floor, and exactly the confusion in #806. For a session whose state is `on` with a floor (Copilot,
  Read-only or Ask first, about to go to Allow all) the body adds, for that case only: "<App>'s OS sandbox stays on for shell commands until a new session;
  use Restart without the sandbox to lift it." (<App> from the adapter's display name.) Claude Code and Codex sessions, and a session with no floor,
  get today's text unchanged (driver asserts the sentence for the Copilot sim agent and its absence for Claude and Codex sim agents). If outcome A
  ships, FR-022c replaces this sentence with Q4's ("Copilot’s OS sandbox is also turned off for this session."). **Replaced 2026-10-28** (FR-022c built):
  the dialog now says Q4's sentence; FR-022e's is gone.
  (Closed 2026-10-28, review on PR #833: under FR-022c the sentence follows the neutral `heldFloor`, so it shows for `off` and `unknown` states that still
  hold a floor too; the old text follows.) `[KNOWN GAP, closed]` (review on 32220198) The sentence shows only for a state `on`. After a refused narrowing (state `off`) or a switch while an update is still
  in flight (state `unknown`), Copilot's `live.sandboxFloor` can still be true from an earlier update, so the floor is kept but this dialog does not say so
  (read: `copilot.ts` `applySandbox`; after the switch the state is built from `keptFloor`, so the chip and Restart without the sandbox still show it). No new field was added for this.

**As built (2026-10-27, T067-T071; simulator and fakes only).** The pure rule `canRestartWithoutSandbox`, the tooltip `restartTip` and the
Allow all sentence `allowAllNote` are in `src/renderer/sandboxtext.js` (no vendor name). FR-022e's "a floor this switch keeps" is read from
the normalized state the same way as FR-021b's chip word: a sandbox that is `on`, not managed and that also covers MCP servers (only Copilot's
does, FR-010); there is no other neutral field for it and no new one was added. The chip's segment is a sibling `<button id="sbxRestartBtn">`
right after the mode chip (a button cannot sit inside the chip's own button), with the chip word as its text; the mode menu item is under
the three modes and is left out of the office card's menu (Q3). The click goes through `DurbarScreens.restartSession` (`mcpRestartSessionFlow`)
with `h.reason: 'sandbox'`. Its dialog keeps the one line FR-022 asks for that names MCP servers ("Its MCP servers start again with your next
message."); the title, body, buttons and toast have no MCP wording. `refreshAuth` clears `live.sandboxFloor` before `applySandbox` (FR-022d).
The simulator's Restart session drops a kept floor (`untilNewSession`) and shows the mode's own state.

**Tests planned** (all with fakes; zero credits):

- `scripts/test-copilot-sandbox.ts`: (B) after a Read-only start and a switch to Allow all the state has `untilNewSession`; a resume of the
  same session id in Allow all records **no** `options.update` with `sandboxConfig` and reports `null`; the rest of the existing AC2 stays;
  a managed state does not offer the action (state flag test); (A, conditional) the switch sends exactly the T066 payload, a resolved fake
  gives `null`, a rejecting and a hanging fake keep `untilNewSession`, narrowing again sends the floor, and no payload ever has `allowBypass`.
- `scripts/test-sandbox-ops.ts` or a new small suite for the pure rule `canRestartWithoutSandbox(state, mode, caps)` (renderer-free, in
  `src/shared` or the renderer's pure module, adapter-neutral): true only for Allow all + `untilNewSession` + not managed + resume; false for every
  Claude/Codex state, every Read-only/Ask first state, `off`, `unknown`.
- `scripts/test-mcp-session.ts`: the op is unchanged for `reason` absent or `'mcp'`; with `'sandbox'` only the words differ (log, no-resume error), a bad `reason` is `'mcp'`; one channel only (source check on `ipc/agents.ts` and `preload.ts`).
- `scripts/test-copilot-sandbox.ts` (FR-022d): a `refreshAuth` on a session that holds a floor and is in Allow all ends with state `null` and no extra `options.update`; in Ask first it re-sends the floor.
- `scripts/check-sandbox-floor.js` (simulator driver, both sizes, `until()` for every assert): the Copilot sim agent #14 (Allow all, kept floor)
  shows the chip button and the menu item with the tooltip text; clicking opens the dialog (Cancel changes nothing) that lists, for a sim session with grants and remote control on, the grants, remote control, no-credits and next-message lines and no "MCP servers" restart wording in the title or toast; confirming calls the
  sim restart (which also clears the sim agent's kept floor, see the sim answer below), and the chip loses its word; Claude and Codex sim agents show neither; a busy agent's dialog says the turn is stopped; the Allow all dialog of the Copilot sim agent with a floor has the FR-022e sentence, those of Claude and Codex sim agents do not.
  The sim's `s.info.sandbox` after restart is `undefined` for Allow all (`src/renderer/sim.ts:2962` branch).
- **Mutants:** (1) offer the action with `managed: true` or in Ask first; (2) skip the `askDialog` (call the op on click); (3) call
  `ensureLive` or `adapter.start` directly instead of `mcpRestartSession` (a second path; the source-check test fails); (4) let the restart
  send a prompt or `approvePending`; (5) the refresh keeps `sandboxFloor` (FR-022d); the Allow all text omits its sentence for Copilot or adds it for Claude/Codex; the tooltip names a vendor literal; (6) (A) send `allowBypass: true`, or `enabled: false` on a switch to Ask first, or drop the re-send of the
  floor when narrowing; (7) make a refused update clear the state. Each must fail a named test.

**Docs planned** (written at implement time, T071): README *Safety model* / *Known limits* line (the Copilot floor, the chip words, "Restart without the
sandbox", what stays true for Claude Code and Codex, and, if A ships, the changed sentence); spec 018's mode-chip paragraph (cross reference to FR-022);
spec 003 FR-095 note if the menu item reaches `modesOnly` menus; `changelog.d/087-allowall-sandbox.md`; `npm run shots:docs -- --only <drivers>` for
the linked pictures that show the chip or the mode menu (`npm run shots:docs -- --list`), looked at before commit.

**Review questions answered (PR #809, Vikram's agent, at 5939ad3c).**
- *Is `capabilities.resume` exposed to the renderer?* Not on `AgentInfo`; the renderer gets `canRestartSession` only in the `agents:mcp` reply (`mcpsession.ts:152`). No new field: the
  action is gated by the state (only Copilot sets `untilNewSession`, and it has `resume: true`, `copilot.ts:191`), and main's op refuses an adapter without `resume` with a neutral error (FR-022).
- *Does `sim.ts` already clear `untilNewSession` on a resume in Allow all?* **No.** The sim's `agentMcpRestartSession` (`sim.ts:2849-2862`) clears grants, remote control and the MCP flags,
  not `s.info.sandbox`, and the branch at `sim.ts:2962` runs only on a mode switch (read, not run). T070 adds the clear (sets the Allow all state with no floor) and a sim flag so the driver can
  also make the sim restart fail (`simauth=expired` already does, FR-027).
- *Is "not verified off Linux" in the tooltip/README plan?* Yes (FR-022): macOS (`sandbox-exec`) and Windows are `[KNOWN GAP]` for the probe; the tooltip keeps "Requested; not verified on a real session." and
  names no platform as checked; the README line (T071) says the same.

**Open owner questions:** none left from this delta (Q1-Q5 above). The restart dialog's exact wording is the owner's to adjust in review.

### 2026-10-26: the chip stops saying plain "Sandboxed" for Copilot in Ask first (FR-021b, T065; Refs #755, v0.1.0 fix)

K15 showed that in Ask first Copilot's sandbox does not limit an approved command's writes to the session folder, yet the chip said
only *Sandboxed*, which reads as a promise. The tooltip and the card line already said otherwise, but a chip is what people read.
**FR-021b** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`; sim: `scripts/check-sandbox-floor.js`): a state with
`approvedMayLeave` that covers MCP servers (Copilot in Ask first, floor on) shows the chip word **Sandboxed (partial)** instead of
*Sandboxed*; the tooltip is unchanged and starts to be read as the explanation. Claude Code and Codex are unchanged (Codex's state
covers no MCP; its card line says the same thing in words), as are Read-only (tooltip says "may add one") and the other words
(*Sandbox: checking*, *Not sandboxed*, *(managed)*, *(until a new session)* keep precedence). No real run was made; this only makes
the words match what the 2026-10-25 run showed. `[KNOWN GAP]` K15 stays open (issue #755): the extra writable path itself.

### 2026-10-25: T060 real check on Linux (owner-approved, 4 prompts: 2 for T060, 2 more for K15)

Vikram's OK in the Telegram group, 2026-10-25 09:55 UTC ("Yes" to the two Linux checks after #733; recorded on PR #733). Run on
`main` at 60df2d7d (PR #733 merged) through Durbar's own adapters (`scripts/sandbox-floor-real.ts`: the same `start`/`send` and
launch path the app uses, sandbox block included, without the Electron window; argv and events recorded, home folder masked), in
a throw-away folder `/tmp/durbar-t060-<app>-XXXXXX`, removed afterwards with the session (Copilot) or its transcript (Claude).
Host: Ubuntu 24.04.5, kernel 7.0, `kernel.apparmor_restrict_unprivileged_userns=1`, and still `/usr/bin/bwrap` (not setuid) made
its namespaces (`bwrap --unshare-all ... true` ran; why this host allows it was not looked into); bubblewrap 0.9.0, socat 1.8.0.0,
Node 24.22. One prompt each: "Run this exact shell command in the current folder with
your shell tool: touch sandbox-probe.txt ...".

- **Claude Code 2.1.309, Read-only, model `haiku`** (`real:`). Read-only denies Bash outright, so the command went through the one
  Read-only path that runs a shell (US1): an accepted folder allow rule `Bash(touch:*)` (spec 061), passed as the composed
  `--settings` JSON next to Durbar's `sandbox` block, with `--setting-sources ""`, `--strict-mcp-config`, `--permission-mode
  dontAsk`. The chip went *Sandbox: checking* → *Sandboxed* at `system/init` (state `on`, bubblewrap). Durbar's own check did not
  answer (the rule passes the hook; no permission request). Bash ran `touch sandbox-probe.txt` and failed: `Exit code 1` /
  `touch: cannot touch 'sandbox-probe.txt': Read-only file system`. The file was absent afterwards. **The OS refused the write.**
  Usage: Claude's estimate $0.0078 (2 model calls, 72.6k input tokens of which 36.2k cache reads, 17 output tokens; cap $0.25).
  So `CLAUDE_SANDBOX_VERIFIED` is now `{ linux: ['read-only'] }` (T060 AC1, per platform **and mode**, review on PR #753 by Ruben's
  agent: a run in one mode proves nothing about the other, constitution VIII): on Linux the Read-only tooltip no longer ends with
  "Requested; not verified on a real session."; Ask first keeps it. Not run for Claude: the network refusal and Ask first's write
  outside the folder (SC-004's second half).
- **Copilot CLI 1.0.101 / SDK 1.0.22, Read-only, model `auto` (efficiency tier, resolved to a 1x model)** (`real:`).
  `getHostSupport()` answered supported and `options.update` with Durbar's `sandboxConfig` resolved: the chip reached *Sandboxed*
  (state `on`, bubblewrap, covers shell and MCP) before the send; no `session.warning` of type `sandbox` came. The model called
  `bash` with `touch sandbox-probe.txt`; **Durbar's Read-only broker denied it first** ("Agent Durbar is in read-only mode: this
  action was denied."), so the command never reached the sandbox. The file was absent. **The OS layer was not exercised**: Copilot
  has no folder allow rules, so no Read-only shell command reaches its sandbox (spec 087 gives no other path), and Copilot stays
  off the verified list. Usage: 0.161 AIU (2 model calls, 25.4k input tokens of which 12.6k cache reads, 148 output tokens).
  Not a sign that Copilot auto-approves sandboxed shell commands: the broker was asked and answered.
- **Settled:** K1 (Claude honours a `sandbox` block given by `--settings` with `--setting-sources ""`), K2 (`denyWrite` on the
  working folder makes it read-only on Linux), and, consistent with it but without a control run, the Linux half of K13's unwritten
  case (Claude's own write grant on its working folder versus a `denyWrite` on that same path: the deny held). **Still open:** K4 (the sandbox started, so no
  `failIfUnavailable` exit was seen), K8 (`options.update` was accepted and the state is `on`, but no shell command ran inside
  Copilot's sandbox, so its effect on a created session is not proven), and SC-004's Ask first half on Linux. A Copilot check
  that reaches its OS layer needs Ask first with an approved command that writes outside the folder (one more prompt, owner's OK):
  run below.
- **Copilot, Ask first, write outside the folder** (`real:` 2026-10-25 19:38 UTC, owner's OK Vikram 19:35 UTC for exactly one
  prompt, recorded on PR #753; same versions and host; `scripts/sandbox-floor-real.ts copilot <out> ask`, dry run first). Session
  folder `/tmp/durbar-t060-copilot-XXXXXX`; a second throw-away folder `/tmp/durbar-t060-outside-XXXXXX`, not a session root.
  The chip was *Sandboxed* (state `on`, bubblewrap, writes: folders) before the send. The model called `bash` with `touch
  /tmp/durbar-t060-outside-XXXXXX/copilot-probe.txt`; Durbar's broker asked (`shell`, "run touch …/copilot-probe.txt") and the
  script approved it as a person would. The command **exited 0 and the file existed afterwards: the OS did not refuse the write
  outside the session folder.** One vendor event of type `sandbox.decision` came; the script then recorded event types only, so
  its variant (`bypass_decided`, `access_recorded`, `enforcement_state`, …, `read:` `session-events.schema.json` of
  `@github/copilot-sdk-linux-x64` 1.0.22) is unknown, and why the write went through is **not known**: an approval that runs the
  command outside the sandbox (as Codex may, K6), a policy that does not limit writes to the folder, or a `sandboxConfig` that
  did not apply to the created session (K8) all fit. Usage: 0.077 AIU (2 model calls, 25.4k input tokens of which 20.4k cache
  reads, 50 output tokens). Copilot gets **no** verified entry. The script now also records the bounded enum fields of
  `sandbox.decision` (kind, outcome, control, enforcement point, state; never a resource or command) for the next run.
  `[KNOWN GAP]` K15: on Linux an approved Copilot command in Ask first wrote outside the session folder although the chip said
  *Sandboxed*. The first run could not say why; the run below does.
- **Copilot, Ask first, write outside the folder, with `sandbox.decision` recorded** (`real:` 2026-10-25 ~20:05 UTC, owner's OK
  Vikram 19:57 UTC for exactly one prompt, recorded on PR #753; same versions and host; `scripts/sandbox-floor-real.ts copilot <out>
  ask --spend` after the review fixes, dry run first). Same setup and outcome: chip *Sandboxed*, Durbar asked, the script approved the
  exact `run touch /tmp/durbar-t060-outside-XXXXXX/copilot-probe.txt`, exit 0, **file created**. The vendor's `sandbox.decision`
  events (bounded fields only): `policy_resolved` (outcome `resolved`, backend `bubblewrap`, `policySource: user_policy`,
  `allowBypass: false`, `allowOutbound: false`, `allowLocalNetwork: false`, `addCurrentWorkingDirectory: false`, git/gh auth and
  keychain off, **`readwritePathsCount: 2`**, `readonlyPathsCount: 13`, `deniedPathsCount: 16`), `spawn_completed` (`succeeded`,
  shell, bubblewrap) and `enforcement_state` (**`engaged`**, attestation `spawn_succeeded`). No `bypass_decided`, `access_denied`,
  `access_recorded` or permissive retry. Durbar's planned `sandboxConfig` for that folder has 1 read-write, 12 read-only and 16 denied
  paths (the script's dry run on the same host, posted masked on PR #753; the counts depend on the host's `PATH` and home folder, so
  only the read-write count, which is the session folder alone on every host, carries the conclusion). **Cause, as far as the bounded fields show:** the command ran **inside** an engaged bubblewrap sandbox
  built from Durbar's own policy (so K8 holds on Linux with Copilot CLI 1.0.101 / SDK 1.0.22: `options.update` applied to the created session, and the approval did not bypass the
  sandbox), and that effective policy has **one read-write rule Durbar did not send**; the write to a folder under `/tmp` went
  through it. Which path that extra rule names is not known (Copilot reports paths only with content capture on, which Durbar does
  not enable); a temp-folder grant fits what was seen but is not proven. Usage: 0.077 AIU (2 model calls, 25.4k input tokens of which
  20.4k cache reads, 49 output tokens).
- **K15 now:** of the three explanations, "the approval runs the command outside the sandbox" and "the `sandboxConfig` was not
  applied" are ruled out by the events above; "the effective policy allows more writes than Durbar sent" is what happened. So the
  Copilot floor **is** applied (Read-only's shell commands and MCP servers run in it), but in Ask first its writes are not limited
  to the session folders: at least one more place (probably the temp folder) is writable. FR-021a says so on the card and in the
  tooltip. The extra rule was seen in Ask first only; Copilot may add it in Read-only too (it would reach local MCP servers and any
  shell command a future rule lets through), so the Copilot Read-only tooltip says "writes: none asked; Copilot may add one" instead
  of a bare "none" (review on PR #753). `[KNOWN GAP]` K15 (narrowed, issue #755): the extra read-write path, whether it exists in
  Read-only, and whether Durbar can remove it (for example a `deniedPaths` entry for the temp folder); finding it needs a run with
  content capture or the vendor's docs.

### 2026-10-25: review round 8 on PR #733 (Ruben's agent, 6 items)

- `shortFolder` cuts by graphemes (`Intl.Segmenter`, code points without it), never half an emoji or a combining sequence; both cuts
  stop at a word boundary. The trailing space/dot rule applies to Windows-form paths only (a POSIX `/home/u/proj.` is a real folder).
- The forwarding to the window goes through one function, `toWindowEvent` (`src/main/sandboxops.ts`); a source check pins `main.ts`'s
  call to it. Main merged (#750, #631); every linked picture that shows the chip, menus or Settings retaken and looked at.

### 2026-10-25: review round 7 on PR #733 (Ruben's agent, 5 items)

- A shortened left-out folder is masked first (the app's `redact`), then cut at a word boundary. The `sandbox` event that main forwards to
  the window is cleaned too (`outwardSandboxEvent`: the state through `cleanSandboxState`, the note's text masked), not only the copy
  kept on `AgentInfo`. Non-string list entries make the state malformed.
- `\\srv` and `\\?\UNC\srv` (a server without a share) are dropped by `normalizeRoot` itself; a Windows-form path with a name ending in
  a space or a dot (`C:\ `, which Windows trims to `C:\`) is dropped rather than guessed.

### 2026-10-25: review round 6 on PR #733 (Ruben's agent, 4 items)

- The left-out folders are a bounded list field of `SandboxState` (`leftOut`, at most 10 entries "<folder> (credential folder | not
  usable)", each masked and cut by main; `leftOutMore` counts the rest), so the 200-character `reason` (now a short sentence) never
  hides one. The mode menu names them; the tooltip says some are left out.
- Windows extended-length and device forms: `\\?\UNC\srv\sh` is checked as the share `\\srv\sh` and `\\?\C:\` as the drive (both
  dropped as roots); any other `\\?\` or `\\.\` form is dropped.
- A test that an extra folder that is a link goes on as `--add-dir` in its resolved form.

### 2026-10-25: review round 5 on PR #733 (Ruben's agent, 1 item)

- **`--add-dir` is an allow-list under the floor.** Only the other folders the block holds (`splitFolders`, resolved paths) go on as
  Claude's `--add-dir`; every other folder, dropped for any reason (a filesystem root, a link to one, `..`, a quote or control
  character, a path that cannot be resolved, a credential folder), is named in the state with why (Copilot too). Before, a folder that
  `sandboxRoots` itself dropped (`/`) still went on as `--add-dir /`. A session whose OWN folder is unusable is refused (FR-015). Allow
  all (no floor) passes the folders as before. Tests with such a workspace for both adapters, and Read-only → Allow all.

### 2026-10-25: review round 4 on PR #733 (Ruben's agent, 4 items)

- **Every session folder, not only the main one.** The main folder dropped by the credential filter still refuses the session (round 3).
  Any **other** folder it drops is left out, not refused: refusing would block a whole workspace for one folder that a command must not
  reach anyway, while leaving it out keeps the floor whole. A left-out folder is never passed to Claude as `--add-dir` (that would add
  Claude's implicit write grant on the same path as a `denyWrite`: the undocumented K13 case), is never granted to Copilot, and the state's
  reason names it (the mode menu shows the names; the tooltip says some folders are left out). Two-folder tests for both adapters.
- The refusal text is per app: Claude Code "is a credential folder or sits inside one"; Copilot adds "or holds one" only without
  `denied_paths`. README *Known limits* names K14.

### 2026-10-25: review round 3 on PR #733 (Ruben's agent, 7 items)

- **A session whose own folder the credential filter drops is refused** (FR-015's rule, applied after the filter): a folder that is a
  credential folder or inside one (for Copilot without `denied_paths` also one that holds one, such as `~/.config`). Before, the session
  started, the chip said *Sandboxed* and every sandboxed command failed on its own folder: closed, but a false claim. Refusing is the
  honest choice because nothing useful can run there under the floor; the text contains "Read-only and Ask first need", so *Change
  mode…* is offered, and no *Continue* passes it (`CREDENTIAL_FOLDER_REFUSAL`, `src/adapters/sandboxRoots.ts`). Tested per adapter.
- K13 also names Claude's implicit write grant on its working folder against a `denyWrite` on the same path (undocumented; avoided by the
  refusal above); new `[KNOWN GAP]` K14: links are resolved per launch only (research R2).
- Tests for a credential folder in another case on macOS, the adapter's home folder (a linked `~/.ssh` denied at its target through the
  adapter), and main forgetting a note when the adapter reports a session stopped (End session, Remove, folder removal, Restart session);
  `folders:remove` also calls `forget`.

### 2026-10-25: review round 1 on PR #733 (Ruben's agent, 8 items)

- **Continue only answers an open note** (FR-007a): main accepts *Continue* only for a session with an open sandbox note it forwarded
  itself (`src/main/sandboxops.ts`, one-shot, closed by a new attempt), and the adapters check the same (Claude: the note's actions;
  Copilot: a held send that showed its note). A stray call never switches off a working floor. `test:` `scripts/test-sandbox-ops.ts`,
  the probe cases in `test-claude-sandbox.ts` and `test-copilot-sandbox.ts`.
- **A session folder that is the home folder or a parent of it** (allowed with a warning, spec 006 FR-016): Claude's block always denies
  the credential folders (`HOME_SECRETS`, `src/adapters/sandboxRoots.ts`: `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.gnupg`, `~/.netrc`,
  `~/.npmrc`, `~/.git-credentials`, `~/.docker`, `~/.kube`, `~/.azure`, `~/.config/gcloud`, `~/.claude`, `~/.copilot`, `~/.codex`) in
  `denyRead` and `denyWrite`; for reads the narrower rule wins (`read:` https://code.claude.com/docs/en/sandboxing.md, 2026-10-25: "When
  read rules overlap, the rule with the narrower path applies", and a deny "holds inside a wider allow"). Writes: the docs list
  `denyWrite` entries under "Denied within allowed" (research R2); `[KNOWN GAP]` K13 and K2: not run on a real session. Round 2: the docs
  give no rule for an allow and a deny on the **same** path, so a root that is a credential folder or inside one is never allowed (Claude
  `allowRead`, Copilot grants); a credential folder that is a link is denied at the link and at its real target (Claude follows a link on a
  denied path only on macOS, per its docs); a Copilot root that contains a credential folder (`~/.config`) is treated like the home folder;
  main forgets an ended or removed session's note.
  Copilot grants such a folder only where `denied_paths` lets it deny the same list inside it; without it the folder is left out (deny by
  default), so the floor is enforced either way. `broadFolderKind` (spec 006) decides "home or a parent of it" for roots and `PATH`.
- **`PATH` entries are resolved** (FR-004, FR-015): each entry and the home folder go through `realpath` before the home check; a link to
  the home folder (or to a parent of it) is dropped, and so is an entry that cannot be resolved.
- **Path syntax** (`read:` the same page): "`/tmp/build` is absolute and `~/.kube` is relative to your home directory", so Durbar's absolute
  roots and `~/` entries are in the documented form.
- **Outside Claude's sandbox** (`read:` the same page): hooks (a folder's accepted hooks too), local MCP servers, LSP servers and the
  status line; the tooltip (FR-010) and the README say so.
- **Tests** for a Continue with no note, an Allow all → Read-only relaunch, a remembered Continue under the policy, a stored Always on a
  fixable cause, a send right after a Copilot mode switch, the IPC operations and the Codex card line on the pending permission; each new
  suite fails when it stops before its last check. The policy reader is issue #734.

### 2026-10-25: built (T002-T050; T060-T062 open)

Built on branch `087-os-sandbox-build`, simulator and fakes only (zero credits). What the build settled that the text above left open:

- **Events and state.** Adapters emit a normalized `sandbox` event (`src/adapters/types.ts` `SandboxEvent`, checked by the event guard);
  main keeps the cleaned state on `AgentInfo.sandbox` (`cleanSandboxState`, `src/shared/sandbox.ts`: own known fields, reason masked, then
  cut to 200). A new capability `osSandbox` goes with `sandboxHost()` (all three) and `continueWithoutSandbox()` (Claude Code, Copilot).
- **The note (FR-007)** is the `sandbox` event's `notice` (text plus the offered actions), not an error status: the message is marked *Not
  sent*, the chat note has *Continue without the OS sandbox*, *Always continue on this computer* (Claude Code on `win32` only) and the
  existing *Change mode…* (`changeModeButton`, split out of `modeRefusalAction`). The confirmation is the shared `askDialog`. A refusal
  found before anything is spawned (the policy, or no usable root, FR-015) is thrown from `send`, so the existing send-failure note and
  `modeRefusalAction` show it; a refusal at a sandbox exit is a `notice` with `refused: true` and no actions.
- **Claude (FR-006, K4).** A sandbox exit is an exit before `init` with a stderr line that has the word "sandbox" and a failure word
  (`claudeSandboxExit`); anything else is the crash path and the state stays `unknown`. The SDK transport (K5) counts as unavailable.
  Host facts: `claude --version` through detection, `bwrap`/`socat` located with spec 012's candidate list (no shell), cached a minute.
  A *Continue* is remembered per session id for the adapter's life (FR-007b); a new session id or a restart tries again.
- **Copilot.** `getHostSupport()` once per runtime client; the floor is sent after create or resume (before `start` resolves, so before
  the first send) and at each mode switch; *Sandboxed* after `options.update` resolved (the tooltip still says not verified, K8). The
  home folder for FR-004 is `os.userInfo().homedir` (spec 076 FR-172), Windows and macOS compared case-insensitively.
  `getHostSupport()` and the update each have a 15 s limit: no answer counts as refused (the first send is held, fail closed); a host
  check that failed is not kept, so the next session asks again (a real `supported: false` answer is kept for the runtime's life). Protected
  paths are joined in the form of their root (CI on Windows, PR #733).
- **Managed (US4 AC2).** No real surface reports a managed floor (FR-008, K12), so only the simulator shows *Sandboxed (managed)*.
- **Policy (FR-019).** `requireOsSandboxFrom(layers)` is the rule; spec 076 has no reader yet, so the app passes no layer (`[KNOWN GAP]`; reading `policy.json` is issue #734).
- **Settings.** *Always continue* is stored as `sandboxAlwaysContinue` (app ids only) in the settings file and undone from the app's
  Settings card; IPC `agents:sandboxContinue`, `adapters:sandboxHosts`, `adapters:sandboxAlwaysOff` (all owner-only, `fromApp`).
- **Tooltips (spec 052 FR-168 limits).** The chip's own title stays short (static, 120); the sandbox segment carries the coverage tooltip
  (a data tooltip, at most 300: `.mode-sbx` in `ui-text-page.js`'s data list); the card's mode icon gets the word only; the mode menu note
  has the full text plus FR-004's PATH sentence.
- **Tests:** `scripts/test-sandbox-floor.ts`, `scripts/test-claude-sandbox.ts`, `scripts/test-copilot-sandbox.ts` (in `test:runtime`),
  driver `scripts/check-sandbox-floor.js` (in `scripts/ui-suite.js`, both sizes). The README's Safety model and Known limits say all of this.

### 2026-10-25: review round 3 on PR #728 (Ruben's agent, 2 items)

- FR-007c: *Always continue* only for a host that can never sandbox the app (Claude on native Windows), and it only skips the
  note; the pre-check and the attempt still run every session. FR-007d: the policy key ignores it. Within decision Q1.
- FR-007b: resets are specified and tested (new session, resume after a Durbar restart).

### 2026-10-25: owner decisions Q1-Q5

Vikram (owner), Telegram DM 07:03 UTC, "all as recommended" ([#728 comment](https://github.com/three-feathers/agent-durbar/pull/728#issuecomment-6394676289)): Q1 warn and the person chooses (FR-007,
FR-007a..c; fail closed only through FR-019; Codex fail closed); Q2 network off for sandboxed commands in Ask first (T063 dropped);
Q3 Codex keeps `durbar_ro` in Ask first; Q4 Claude's sandboxed reads denied the home folder except the session folders; Q5 the
chat header chip, the mode tooltip and Settings > Agent apps, no new word on the office card. T001 done.

### 2026-10-25: review round 2 on PR #728 (Ruben's agent, 6 items)

- No automatic relaunch without the sandbox: nothing is re-sent; *Continue without the OS sandbox* / *Change mode…* (FR-007,
  FR-007a..c; Q1 reworded: the person chooses); the relaunch keeps the mode, Durbar's checks and the same `--session-id` /
  `--resume`; "sandbox unavailable" remembered per session.
- "Survived the start" = Claude's `system`/`init` (`initSeen`); unclassified early exits go to the crash path (FR-006, US3 AC5, K4).
- `PATH` entries that equal or contain the home folder are dropped; `~/.ssh`, `~/.aws`, `~/.config/gh` denied where supported (FR-004).
- FR-021's sentence is its own field, never cut; reworded for file changes.
- Version source named: `detectClaude` / `parseVersion`, compatible with PR #698. Checklist lists K1-K12.

### 2026-10-25: review round 1 on PR #728 (Ruben's agent, 9 items)

- Claude is always launched with `failIfUnavailable: true`; *Sandboxed* only after the CLI confirmed it, `unknown` before, a
  visible relaunch as *Not sandboxed* otherwise; minimum Claude Code 2.1.219 (FR-003, FR-006, FR-007, FR-009; Q1 reworded, same
  recommendation).
- Copilot `allowDevToolAccess: false` (it grants writes), `PATH` folders as `readonlyPaths` instead, with the cost (FR-004, FR-001).
- Codex Ask first: approval cards and the tooltip say an approved command may run outside the sandbox (FR-021, US2 AC5).
- Tooltip says "Requested; not verified on a real session" until T060-T062 (FR-010, FR-020); FR-008 reads only `session.warning`.
- US1: MCP servers are covered for Copilot only. Vendor keys stay in `src/adapters/`; `SandboxState` next to `AgentInfo` in
  `src/shared/api.ts` (FR-003, FR-011). Copilot switch to Allow all keeps the floor until a new session (edge cases). Refusals
  reuse `modeRefusalAction` and `simsendfail=sandbox` (FR-007, US3 AC3). Tasks: ACs for every task, T020 AC1 reworded, real-check
  cost stated.
