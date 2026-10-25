# Feature Specification: The agent app's own OS sandbox as the safety floor under Read-only and Ask first

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: OS sandbox floor (issue #611): under Read-only and Ask first Durbar also turns on each agent app's own OS sandbox (Claude Code's bash sandbox, Copilot's local sandbox; Codex's read-limited profile already does it), so a command that slips past Durbar's checks still cannot write outside the folder or reach the network; Allow all keeps the app default; the chat header says Sandboxed or Not sandboxed, and why
status: Draft (2026-10-25): spec, plan, research and tasks; vendor facts from docs and the SDK's declarations only (no real session); Q1-Q5 open for the owner; nothing built
-->

**Feature Branch**: `087-os-sandbox-floor` (touches 003 permission modes, 012 Claude and Codex adapters, 002 Copilot adapter, 018 mode switch, 076 organization policy, 081 Settings > Agent apps, 010 simulator)

**Created**: 2026-10-25

**Status**: Draft (spec, plan, research and tasks; nothing built)

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

A person starts a Copilot or Claude Code agent in Read-only. Durbar denies writes and shell as before. In addition, any command
that does run (an accepted folder allow rule such as `Bash(npm test:*)`, a local MCP server) runs in the app's OS sandbox with no
write access and no network, so it cannot change files or send data out.

**Why this priority**: it is the default mode (constitution III) and the promise the product makes first.

**Independent Test**: with injected platform facts and fake adapters, the settings each adapter would send in Read-only are the
read-only floor (unit tests); on the simulator the chat header shows *Read-only · Sandboxed*.

**Acceptance Scenarios**:

1. **Given** Claude Code on macOS or on Linux with `bubblewrap` and `socat`, **When** a Read-only session starts, **Then** the
   `--settings` JSON has `sandbox.enabled: true`, `failIfUnavailable` per FR-007, `allowUnsandboxedCommands: false`,
   `autoAllowBashIfSandboxed: false`, the session roots in `denyWrite`, reads outside the roots denied and no allowed domain.
   *(test:)*
2. **Given** Copilot on a host whose `sandbox.getHostSupport()` says `supported: true`, **When** a Read-only session is created,
   **Then** Durbar sets `sandboxConfig` with `enabled: true`, `addCurrentWorkingDirectory: false`, the roots in `readonlyPaths`,
   `allowOutbound: false`, `allowLocalNetwork: false`, no `allowBypass`, `auth` off, before the first message is sent. *(test:)*
3. **Given** Codex, **When** Read-only starts, **Then** nothing changes from spec 012 (`durbar_ro`, fail closed). *(test: existing)*
4. **Given** any of the three in Read-only with the sandbox on, **When** the chat opens, **Then** the mode chip reads
   *Read-only · Sandboxed* and its tooltip names the mechanism and what it covers (FR-010). *(sim:)*

### User Story 2 - Ask first: approved commands stay inside the folder (Priority: P1)

In Ask first the person approves a shell command. It runs, but the OS lets it write only inside the session's folders (and the
app's temporary folder), never into protected files (`.git/hooks`, `.git/config`, shell startup files, the app's own settings),
and with network off (Q2).

**Why this priority**: today an approved command runs with the person's full rights; one careless *Approve* can touch anything.

**Independent Test**: unit tests on the mapping per app and per OS; simulator shows *Ask first · Sandboxed*.

**Acceptance Scenarios**:

1. **Given** Claude Code in Ask first with the sandbox available, **When** the session starts, **Then** writes are allowed only in
   the working directory, `--add-dir` folders and `$TMPDIR`, `autoAllowBashIfSandboxed` is `false` so every command still reaches
   Durbar's card, and `allowUnsandboxedCommands` is `false`. *(test:)*
2. **Given** Copilot in Ask first, **When** the session is created, **Then** the roots are `readwritePaths`, the protected paths are
   `deniedPaths` where the host reports the `denied_paths` capability, and network follows Q2. *(test:)*
3. **Given** Codex in Ask first, **Then** it keeps `durbar_ro` (every write asks; Q3). *(test: existing)*
4. **Given** any app in Ask first, **When** Durbar's card is answered *Approve*, **Then** the command runs inside the sandbox; Durbar
   never answers a vendor's "run outside the sandbox" request with yes (Claude `dangerouslyDisableSandbox`, Copilot bypass). *(test:)*

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
   first are refused with the reason, nothing is spawned, and no weaker mode is offered automatically. *(test:)*

### User Story 4 - Allow all and managed policy (Priority: P2)

Allow all keeps the app's default. When the vendor's managed policy forces a sandbox on, Durbar does not fight it and says
*Sandboxed (managed)* where the app reports it.

**Acceptance Scenarios**:

1. **Given** Allow all, **Then** Durbar sends no sandbox setting for Claude or Copilot and keeps `danger-full-access` for Codex. *(test:)*
2. **Given** Copilot reports a managed sandbox floor for the session, **Then** the chip says *Allow all · Sandboxed (managed)*. *(test:; real: open)*

### Edge Cases

- **Mode switch** (spec 018): the floor in force is the one shown. A switch to a wider mode does not widen the sandbox before the
  app applies it (Claude: at the next spawn; Copilot: `options.update`; Codex: FR-144 next message). A switch to a narrower mode
  narrows Durbar's checks at once, which deny anyway.
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

- **FR-001** The floor (what the OS lets a sandboxed process do) per Durbar mode, for every app that has a sandbox:

  | Mode | Writes | Reads | Network | Run outside the sandbox |
  | --- | --- | --- | --- | --- |
  | Read-only | none (the app's own temp folder only where the app needs it to run) | the session roots, system files and the app's own install (Q4) | off | never |
  | Ask first | the session roots and the app's temp folder; protected paths (FR-014) never | as Read-only | off (Q2) | never |
  | Allow all | app default or managed policy | app default | app default | app default |

- **FR-002** The floor is **under** Durbar's checks, never instead of them. Nothing in this spec approves a call that Durbar would
  deny or ask about today. In particular Claude Code's `autoAllowBashIfSandboxed` is always `false` (its default `true` would
  auto-approve sandboxed Bash; `read:` research R2), Claude's `allowUnsandboxedCommands` is `false`, and Copilot's `allowBypass` is
  never sent (fail closed, `read:` research R4).
- **FR-003** **Claude Code** (CLI transport, `--settings` JSON, spec 061's composer): Read-only and Ask first add a `sandbox` block:
  `enabled: true`, `failIfUnavailable` (FR-007), `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`,
  `excludedCommands: []`; `filesystem.denyRead: ["~/"]` and `filesystem.allowRead` = the roots (Q4); Read-only also
  `filesystem.denyWrite` = the roots (K2); `network.allowedDomains: []`, `network.strictAllowlist: true` (Q2). A folder's own
  `sandbox` settings (spec 061 folder setup) cannot widen this block: Durbar's values win for these keys. `[KNOWN GAP]` K1, K2, K4.
- **FR-004** **Copilot** (SDK 1.0.22): before the first send of a created or resumed session, Durbar calls
  `session.rpc.options.update({ sandboxConfig, sandboxConfigSource: 'session_flag' })` with `enabled: true`,
  `addCurrentWorkingDirectory: false`, `userPolicy.filesystem` (Read-only: roots in `readonlyPaths`; Ask first: roots in
  `readwritePaths`, protected paths in `deniedPaths` when the host reports `denied_paths`), `userPolicy.network`
  (`allowOutbound: false`, `allowLocalNetwork: false`), `sandboxMcpServers: true`, `sandboxLspServers: true`, `auth: { git: false,
  gh: false }`, `allowDevToolAccess: true` (read-only toolchain grants), no `allowBypass`. If the update is refused, the session is
  handled as *unavailable* (FR-007). `[KNOWN GAP]` K8, K9, K10.
- **FR-005** **Codex**: unchanged (spec 012 FR-086..FR-091, FR-138, FR-140, FR-162). Ask first keeps `durbar_ro` and does not move
  to `workspace-write`, because Codex runs writes inside writable roots without asking, which would break Ask first's "each request
  is left pending for the user" (constitution III; Q3). `[KNOWN GAP]` K6: whether an approved escalation runs unsandboxed.

**B. Detection and when there is none**

- **FR-006** Each adapter answers, before a Read-only or Ask first session starts, whether its sandbox can run, as a normalized
  `SandboxState` (FR-011), from a pure function with injected facts (constitution VI):
  - Copilot: `client.rpc.sandbox.getHostSupport()` (`supported`, `reason`, `capabilities`); a missing method (older runtime) or an
    error counts as unavailable with reason "this Copilot cannot report its sandbox".
  - Claude Code: `win32` → unavailable ("no OS sandbox on Windows; WSL2 only"); `linux` → `bwrap` and `socat` found on `PATH`
    (located like spec 012's detection, no shell) else unavailable with the package names; `darwin` → available; then the start
    itself (FR-007) is the final word.
  - Codex: the existing `codexReadEnforceable` plus the start result.
- **FR-007** **When the sandbox is unavailable** (proposal; **owner question Q1**): for Claude Code and Copilot, Read-only and Ask
  first **start anyway with Durbar's own checks**, are shown *Not sandboxed* with the reason (FR-009), and for Claude
  `failIfUnavailable` is `false` so the CLI does not exit. When an organization policy requires the sandbox (FR-019) they are
  **refused** instead (`failIfUnavailable: true` for Claude; no session for Copilot). Codex keeps failing closed (its sandbox is its
  only read limit). Never: a silent fallback, an automatic switch to another mode, or a retry with weaker settings.
- **FR-008** A sandbox that the app reports as lost during a session (Copilot `sandboxConfigSource: 'unsupported_host'`, a
  `session.warning` of type `sandbox`) turns the chip to *Not sandboxed* with the app's reason at once; the session is not ended.

**C. What the person sees**

- **FR-009** The chat header's mode chip (spec 018) shows the floor in words after the mode: *Read-only · Sandboxed*,
  *Ask first · Not sandboxed*, *Allow all · Sandboxed (managed)*. Allow all with no sandbox shows nothing extra (it is the app
  default the person chose). The office card does not get a new word (layout, constitution V); the card's mode icon tooltip carries
  the same text. Never colour alone; text at least 10.5px; the 15-agent layouts at 1440x900 and 1280x800 do not change (Q5).
- **FR-010** The tooltip and the mode menu say exactly what is covered: "Shell commands [and MCP servers] run in <mechanism>
  (writes: <none | this folder>, network: off). File reads and edits are checked by Durbar." with the mechanism's plain name
  (macOS sandbox, bubblewrap, Windows ProcessContainer, Codex sandbox). For Codex: "Commands and file changes run in the Codex
  sandbox". No claim of a coverage the research does not back.
- **FR-011** Adapters report a normalized `SandboxState` (no vendor type crosses into `src/shared` or the renderer, constitution II):
  `{ state: 'on' | 'off' | 'unknown', mechanism?: 'seatbelt' | 'bubblewrap' | 'processcontainer' | 'mxc' | 'vendor', managed?:
  boolean, covers: Array<'shell' | 'mcp' | 'files'>, reason?: string }` with `reason` masked by the existing redaction and clipped
  to 200 characters. An adapter without the field shows nothing (the UI degrades, constitution II).
- **FR-012** Settings > Agent apps (spec 081) shows one line per installed app: *OS sandbox: available (macOS sandbox)*, or
  *not available: <reason>* with the fix (Linux packages, the Ubuntu AppArmor note already in the README for Codex, the Windows
  build Copilot needs). The Organization page's FR-173 note (spec 076) points to this line.
- **FR-013** Mode switch (spec 018): the chip shows the floor in force, not the one asked for. Claude Code applies a new floor at the
  next spawn (the existing relaunch with `--resume` at the next message, spec 012 FR-116; until then the hook keeps the stricter of
  the launched and current mode, FR-115), Copilot through `options.update` at the switch, Codex as today (FR-144).

**D. Paths and safety**

- **FR-014** Protected paths for Ask first: `.git/hooks`, `.git/config` inside each root, plus what the app already protects
  (Claude's list, Codex's `.git`/`.codex`/`.agents`/`.aws`). Durbar adds them to Copilot's `deniedPaths` only where `denied_paths`
  is reported; where it is not, the tooltip does not claim them.
- **FR-015** Roots come only from the main process (the session's cwd and workspace folders, spec 006 FR-019), normalised like
  `codexWorkspaceRoots`; a filesystem root, a share root, a `..` or a control character drops that root; an empty list refuses
  Read-only and Ask first. No path from the renderer.
- **FR-016** No secret goes into a sandbox setting. Durbar never turns on the vendors' credential injection (Copilot `auth.git`,
  `auth.gh`, `credentials`; Claude `credentials` masking) in these modes, never logs the settings JSON with paths outside debug,
  and spawns with argv only (no shell, constitution III).

**E. Policy, simulator, tests, evidence**

- **FR-017** The simulator gives sim agents each state (on per mechanism, off with a reason, managed) so the chip and tooltip are
  checked with zero credits (constitution IV).
- **FR-018** Pure modules with unit tests: `claudeSandboxSettings(mode, roots, platform, require)`,
  `copilotSandboxConfig(mode, roots, hostSupport)`, `sandboxStateOf(...)` per adapter; every OS through injected platform values.
- **FR-019** Organization policy (spec 076): a new key `permissions.requireOsSandbox` (boolean, default `false`) makes FR-007
  refuse instead of warn. It can only narrow (spec 076's narrow-only rule); bad values count as `true` (fail closed). Owner confirms
  with Q1.
- **FR-020** Real checks are separate tasks (constitution IV): one tiny read-only prompt per app and OS within the owner's budget
  (macOS, Linux, Windows), recording that a sandboxed command cannot write outside the folder or reach the network. Until then each
  claim is `sim:`/`test:` only and the README says "not verified on a real session".

### Key Entities

- **SandboxState** (FR-011): normalized, per agent, from the adapter; shown, never saved.
- **Session roots** (FR-015): the folders the floor makes readable (and in Ask first writable).

## Success Criteria *(mandatory)*

- **SC-001** In unit tests, for every app × OS × mode combination (3 × 3 × 3), the settings Durbar would send match FR-001..FR-005,
  and no combination sends an auto-approve or bypass setting (FR-002).
- **SC-002** Every combination where the sandbox is unavailable gives a visible *Not sandboxed* with a reason, or a refusal when
  policy requires it; none starts silently unsandboxed.
- **SC-003** The 15-agent office at 1440x900 and 1280x800 is unchanged (`check:office`); the chip fits at both sizes.
- **SC-004** After the real-check tasks: on each OS where an app has a sandbox, a command in Read-only cannot create a file in the
  folder, and in Ask first cannot create one outside it, or the gap is recorded `[KNOWN GAP]`.

## Assumptions

- The vendor surfaces in research.md stay as read; Copilot's are `@experimental`, so the pinned SDK version is the contract
  (constitution II) and an upgrade re-checks them.
- Durbar's own checks stay as they are; this spec adds a floor and a display.
- The Agent SDK transport for Claude (spec 012 FR-113) gets the same block when it is used; not built here (K5).

## Questions (for the owner)

At most five; each has a recommended answer. Nothing is built until they are answered.

- **Q1 Sandbox unavailable: fail closed or warn?** *Recommended:* **warn and run** for Claude Code and Copilot in Read-only and Ask
  first (visible *Not sandboxed* with reason and fix), **fail closed** only when the organization policy key FR-019 says so; Codex
  stays fail closed. Why: native Windows has no Claude sandbox and most Windows builds lack Copilot's, so fail-closed by default
  would make Read-only unusable there although Durbar's checks still deny every write and shell call in it.
- **Q2 Network for sandboxed commands in Ask first: off or ask?** *Recommended:* **off** in the first build (Claude
  `strictAllowlist`, Copilot `allowOutbound: false`; Codex is already off). Asking per host needs Claude's network prompt to reach
  Durbar's card (K3), which is unverified; a follow-up can add it. Cost: `npm install`-style commands fail in Ask first and the
  error says so; Allow all remains the way to run them.
- **Q3 Codex Ask first: keep the read-only profile, or allow writes inside the folder?** *Recommended:* **keep `durbar_ro`**. A
  workspace-write profile would let Codex write inside the folder without asking, which Ask first promises never happens.
  Residual gap K6 (an approved escalation may run outside the sandbox) is recorded, not hidden.
- **Q4 Limit sandboxed reads to the session's folders for Claude Code too?** *Recommended:* **yes** (`denyRead: ["~/"]`,
  `allowRead` = roots): it matches Copilot's deny-by-default policy, Codex's profile and spec 003 FR-023, and keeps `~/.ssh` and
  `~/.aws` out of reach of a command. Cost: a tool that reads its config from the home folder (`~/.npmrc`, `~/.cargo`) may fail in
  Read-only and Ask first; the error is shown as is.
- **Q5 Where to show it?** *Recommended:* **the chat header chip and the card's mode tooltip**, plus Settings > Agent apps; no new
  word on the office card (keeps the 15-agent layout). Alternative: a small shield icon on the card with text in its tooltip.

## Changes

(none yet)
