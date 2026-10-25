# Feature Specification: The agent app's own OS sandbox as the safety floor under Read-only and Ask first

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: OS sandbox floor (issue #611): under Read-only and Ask first Durbar also turns on each agent app's own OS sandbox (Claude Code's bash sandbox, Copilot's local sandbox; Codex's read-limited profile already does it), so a command that slips past Durbar's checks still cannot write outside the folder or reach the network; Allow all keeps the app default; the chat header says Sandboxed or Not sandboxed, and why
status: Built 2026-10-25 (simulator and fakes only): Claude Code and Copilot floors, Codex state and card line, the chip, tooltips, the sandbox note with Continue / Always / Change mode…, Settings > Agent apps line, the policy rule; not verified on a real session (T060-T062 open, about 5 prompts); the policy key is not reachable until spec 076 has a reader
-->

**Feature Branch**: `087-os-sandbox-floor` (touches 003 permission modes, 012 Claude and Codex adapters, 002 Copilot adapter, 018 mode switch, 076 organization policy, 081 Settings > Agent apps, 010 simulator)

**Created**: 2026-10-25

**Status**: Built (2026-10-25) on the simulator and with fakes; not verified on a real session (T060-T062 open). See *Changes*.

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
  clear it is unverified, K8) and the chip reads *Allow all · Sandboxed (until a new session)*; a new session in Allow all starts
  with the app default.
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
  if it ever does, Durbar's block replaces it). Minimum Claude Code version: **2.1.219** (the newest key this block relies on,
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
  - Claude Code: a version below 2.1.219 or unreadable → unavailable ("this Claude Code is too old for Durbar's sandbox
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
- **FR-020** `[KNOWN GAP]` T060-T062 open (no real session run) Real checks are separate tasks (constitution IV): one tiny read-only prompt per app and OS within the owner's budget
  (macOS, Linux, Windows), recording that a sandboxed command cannot write outside the folder or reach the network. Until then each
  claim is `sim:`/`test:` only, and both the tooltip (FR-010) and the README say "not verified on a real session".
- **FR-021** `[IMPLEMENTED]` (test: `scripts/test-sandbox-floor.ts`; sim: `scripts/check-sandbox-floor.js` whole line at both sizes) **Codex approval cards in Ask first** say what approval may mean, in a line of its own that is never cut (a separate
  normalized field on the permission, `sandboxNote`, not appended to the one-line `summary` that already carries file names and the
  undo note): `commandExecution` "If you approve, Codex may run this outside its sandbox."; `fileChange` "If you approve, Codex
  writes this outside its read-only sandbox." (filled in `codexPermission`, `src/adapters/codexModes.ts`),
  and the Codex `SandboxState` has `approvedMayLeave: true` so the chip tooltip says it too. Removed only when a real check (or the
  vendor docs) shows an approved escalation stays sandboxed (K6). Read-only is unaffected (every approval is declined).

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
