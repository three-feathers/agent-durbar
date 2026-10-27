# Research: each agent app's OS sandbox (spec 087)

Desk research only (2026-10-25): vendor docs, the installed SDK's type declarations and Durbar's own source and specs.
**No agent session was run and no AI credits were spent.** Every vendor fact carries `read:` with its source; anything the
sources do not settle is a `[KNOWN GAP]`. Versions: `@github/copilot-sdk` 1.0.22 (pinned in `package.json`), Codex 0.163
(the version spec 012 was checked against), Claude Code CLI (the docs page as of 2026-10-25; Durbar pins no version).

## R1 What Durbar does today (`read:` Durbar source at `origin/main` 56faaa2b)

| App | Read-only | Ask first | Allow all | OS sandbox today |
| --- | --- | --- | --- | --- |
| Copilot (`src/adapters/copilot.ts`, broker `src/adapters/permissions.ts`) | broker approves reads inside the session roots, denies everything else | broker asks for everything except reads inside the roots | broker approves everything | **none**: `createSession` gets no sandbox setting; an approved shell command runs with the OS user's full rights |
| Claude Code (`src/adapters/claudeModes.ts`, `claudeArgs` in `src/adapters/claude.ts`) | `--permission-mode dontAsk`, read tools only, `PreToolUse` hook denies all else and outside reads | `--permission-mode default`, every tool through the `stdio` permission prompt | `bypassPermissions` | **none**: `--setting-sources ""`; `--settings <json>` is sent only for spec 061 folder setup, with no `sandbox` key |
| Codex (`src/adapters/codexModes.ts`, `src/adapters/codex.ts`) | `approvalPolicy: never` + permission profile `durbar_ro` (read `:minimal` + workspace roots, no write) | `on-request` + `durbar_ro` | `never` + `danger-full-access` | **yes**: `durbar_ro` is OS-enforced (Seatbelt / bubblewrap+seccomp); Read-only and Ask first **fail closed** where it cannot be enforced (spec 012 FR-087, FR-091, FR-138, FR-140, FR-162); on Windows they are always refused (no source for `elevatedSandbox`, spec 012 FR-091) |

So Codex already has the floor this spec asks for (in a stricter form: no writes at all in Ask first). The work is Copilot and
Claude Code, plus one honest *Sandboxed* display for all three.

Where Read-only already denies shell (Copilot, Claude), the OS sandbox still matters for: shell commands that an **accepted
folder allow rule** lets through Read-only (constitution III Amendment 1, spec 061), **local MCP servers** (child processes with
the user's full rights today), and any bug in Durbar's own checks. In Ask first it matters for every approved command.

## R2 Claude Code (`read:` https://code.claude.com/docs/en/sandboxing, 2026-10-25)

- **Scope:** Bash, PowerShell and Monitor commands and their children. **Not** sandboxed: Read, Edit, Write, WebFetch, WebSearch
  (they follow permission rules), hooks, local MCP servers, LSP servers, the status line, `apiKeyHelper`, `!` shell-mode commands,
  `excludedCommands`, and unsandboxed retries Claude asks for.
- **Mechanism:** macOS Seatbelt; Linux and WSL2 bubblewrap + a network namespace + `socat` relay to a local proxy (optional
  seccomp filter for Unix sockets, from `@anthropic-ai/sandbox-runtime`); WSL1 unsupported; **native Windows: none, commands run
  unsandboxed**.
- **Linux needs** `bubblewrap` and `socat`. Ubuntu 24.04+ AppArmor may block bubblewrap's user namespaces
  (`kernel.apparmor_restrict_unprivileged_userns=1`), the same cause as Codex's FR-140.
- **Defaults:** off (`sandbox.enabled: false`). Writes: the working directory, `$TMPDIR` and `--add-dir` folders; protected paths
  stay unwritable even there (`.claude` settings, skills/agents/commands/hooks, `.mcp.json`, shell startup files, `.gitconfig`,
  `.vscode`, `.idea`, `.git/hooks`, `.git/config`, most of `~/.claude`). Reads: the whole machine unless denied
  (`sandbox.filesystem.denyRead`/`allowRead`, or `permissions.blockReadsOutsideWorkingDirectories`). Network: only through the
  proxy; `allowedDomains` starts empty; an unlisted host **prompts** in `default`, is **refused in `dontAsk`**, allowed in
  `bypassPermissions`; `sandbox.network.strictAllowlist: true` (v2.1.219+) refuses instead of prompting.
- **Keys used by this spec:** `sandbox.enabled`, `sandbox.failIfUnavailable` (exit at start if the sandbox cannot run; default
  false = warn and run **unsandboxed**), `sandbox.allowUnsandboxedCommands` (`false` = no `dangerouslyDisableSandbox` retry),
  `sandbox.autoAllowBashIfSandboxed` (**default `true`: auto-approves sandboxed Bash**), `sandbox.excludedCommands`,
  `sandbox.filesystem.allowWrite`/`denyWrite`/`denyRead`/`allowRead`, `sandbox.network.allowedDomains`/`strictAllowlist`.
- K1 **settled on Linux** (`real:` T060, 2026-10-25, Claude Code 2.1.309; spec *Changes*): a `sandbox` block given by
  `--settings <json>` is honoured when `--setting-sources ""` is also given (a sandboxed Bash `touch` failed with "Read-only file
  system"). Not run on macOS (T061). Managed settings still apply in any case (spec 076 research).
- `read:` (same page, 2026-10-25, review of PR #733) path syntax: "`/tmp/build` is absolute and `~/.kube` is relative to your home
  directory"; reads: "When read rules overlap, the rule with the narrower path applies" (a deny "holds inside a wider allow"); "Other
  processes Claude Code starts: command hooks, local MCP servers, plugin monitors, LSP servers, and helper commands such as your status
  line command and `apiKeyHelper` run with your full access". Writes: see K13 below.
- `read:` (same page, 2026-10-25, review round 2 on PR #733): the `/sandbox` Config tab lists the sandbox's own write denials "under **Denied within allowed**, mixed in with your own `denyWrite` entries"; protected paths keep their protection: "If you add an `allowWrite` entry or an `Edit` allow rule that covers one of these paths, the protection still applies"; a write outside the allowed folders "Fails with `Operation not permitted` on macOS, or `Read-only file system` on Linux and WSL2"; "On macOS, when a denied path passes through a symlink ... the sandbox also denies the path's real location" (no Linux equivalent is stated). The docs do not say which rule wins when an allow and a deny name the **same** path; Durbar never sends that: a session folder that is a credential folder or inside one is left out of `allowRead` (and never granted to Copilot), and a credential folder that is a link is denied at its link and at its real target (`homeSecretPaths`). `[KNOWN GAP]` K13 (narrowed): that a `denyWrite` entry holds inside a writable folder is documented as above but not run on a real session. Not documented at all: which rule wins between Claude's own implicit write grant on its working folder and a `denyWrite` on that **same** path (T060, 2026-10-25, Linux, is consistent with the deny winning, see K2; no control run); Durbar does not rely on it, because a session whose own folder is a credential folder (or inside one) is refused before launch (review round 3 on PR #733). `[KNOWN GAP]` K14: links are resolved when a session launches (Claude Code at each launch; Copilot at start, at a mode switch and after a reconnect); a credential folder that becomes a link, or a link that is repointed, during a session is denied at its new target on Linux only from the next launch.
- K2 **settled on Linux** (`real:` T060, 2026-10-25): `denyWrite` on the working directory itself makes it read-only (`touch:
  cannot touch 'sandbox-probe.txt': Read-only file system`, file absent). On Linux this is consistent with the `denyWrite` winning over
  Claude's own write grant on its working folder (K13's unwritten case); no control run without the `denyWrite` was made. Not run on macOS (T061).
- `[KNOWN GAP]` K3: how a sandbox network prompt reaches a host that runs Claude with `--permission-prompt-tool stdio` (shape of
  the request; whether it is a normal `can_use_tool` with a `WebFetch(domain:…)`-like name).
- `[KNOWN GAP]` K4 (still open after T060: the sandbox started on the Linux host, so no such exit was seen): the exact text/exit code of `failIfUnavailable` at start (needed to show a plain reason, like Codex's
  `linuxSandboxHint`), and whether it also catches an AppArmor-blocked `bwrap`, a missing ripgrep or seccomp helper (the docs say
  it exits "if the sandbox can't run", including a missing dependency).
- Minimum version: the docs mark `strictAllowlist` as v2.1.219+; spec 087 uses that as the minimum for the whole block (an older
  CLI might ignore keys it does not know without an error). The version that introduced `failIfUnavailable` itself is not stated.
- The Agent SDK transport (spec 012 FR-113, not a dependency) would take the same settings through its options; `[KNOWN GAP]` K5:
  the option name, not checked against the SDK declarations (the SDK is not installed here).

## R3 Codex (`read:` https://learn.chatgpt.com/docs/sandboxing, https://learn.chatgpt.com/docs/agent-approvals-security, 2026-10-25; spec 012 research.md and FR-086..FR-162)

- **Modes:** `read-only`, `workspace-write`, `danger-full-access`; plus named permission profiles (`[permissions.<name>]`,
  `default_permissions`) that Durbar uses (`durbar_ro`).
- **Mechanism:** macOS Seatbelt; Linux and WSL2 bubblewrap + seccomp (first `bwrap` on `PATH`, else a bundled helper needing
  unprivileged user namespaces); Windows: MXC, with `elevated`/`unelevated` legacy fallbacks that need a setup step
  (`windowsSandbox/setupStart`). Landlock appears only as a test alias (`codex sandbox landlock`), not as the default enforcement.
- **workspace-write:** network **off** unless `[sandbox_workspace_write] network_access = true`; extra roots via
  `sandbox_workspace_write.writable_roots`; `.git`, `.agents`, `.codex`, `.aws` stay read-only inside writable roots.
- **Approvals:** `on-request` asks before crossing the sandbox (writes outside, network). "Where policy permits full sandbox
  escalation and it is approved, that execution can bypass the command proxy"; a narrow network grant is different from full
  escalation. `[KNOWN GAP]` K6: whether an approved escalation runs **fully unsandboxed** or with a widened sandbox (the docs do not
  say). Durbar Ask first today answers approvals for writes and commands, so an approved write may leave `durbar_ro`.
- **Unavailable:** Linux shows a startup warning when `bwrap` is missing or the namespace cannot be made; Durbar already turns
  this into a refusal (spec 012 FR-140) because `durbar_ro` is the only read limit Codex has.
- `[KNOWN GAP]` K7 (spec 012, kept): the Codex sandbox on Windows (elevated setup) and a full session on an ordinary Mac after
  FR-162.

## R4 GitHub Copilot (`read:` `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts` and `README.md` of SDK 1.0.22; `schemas/api.schema.json` of `@github/copilot-sdk-linux-x64` 1.0.22; https://docs.github.com/en/copilot/concepts/agents/copilot-cli/understanding-local-sandboxing; https://docs.github.com/en/copilot/how-tos/cloud-and-local-sandboxes/configuring-local-sandbox-settings; spec 076 research for managed `sandbox` keys; 2026-10-25)

- **Scope (docs):** shell commands and the built-in searches (`grep`, `glob` run ripgrep) run as sandboxed child processes, OS
  enforced; local MCP servers and LSP servers run inside it by default; **built-in file read/edit tools run inside the CLI process
  and check the same policy in software only** (no OS enforcement); remote MCP servers are only limited by the network policy.
- **Mechanism (SDK `SandboxHostSupport`):** "Seatbelt on macOS, Bubblewrap on Linux, or ProcessContainer on Windows". Linux needs
  `bwrap` 0.5.0+ and `slirp4netns` on `PATH` (docs; `slirp4netns` only for the `network`/`network_filtering` capabilities per the
  SDK). Windows needs Windows 11 25H2 with KB5124010+ or 26H1 with KB5124006+ and the BaseContainer tier (docs).
- **Policy:** deny by default; grants are read/write, read-only or denied; denied wins; the working directory is read/write
  unless `addCurrentWorkingDirectory: false`; `allowDevToolAccess` (default true) adds read grants for `PATH` and toolchain
  folders **and write grants** for scratch caches, the Unix gh CLI cache and Cargo's registry, git store and lock files (`read:`
  SDK `rpc.d.ts`, `SandboxConfig.allowDevToolAccess`; review of PR #728), so spec 087 sets it `false`; network `allowOutbound` (default on), `allowLocalNetwork` (default off), `allowedHosts`/`blockedHosts`.
- **SDK surface (all `@experimental`):** `client.rpc.sandbox.getHostSupport()` → `{ supported, reason?, capabilities[] }`
  (capability names `network`, `network_filtering`, `denied_paths`, `shell`, `filesystem_enumeration`);
  `sandbox.checkPlatformSupport`; `session.rpc.options.update({ sandboxConfig, sandboxConfigSource })`
  (`SessionUpdateOptionsParams`) and `SessionOpenOptions.sandboxConfig`. `SandboxConfig` = `{ enabled, userPolicy: { filesystem:
  { readwritePaths, readonlyPaths, deniedPaths }, network: { allowOutbound, allowLocalNetwork, allowedHosts, blockedHosts } },
  addCurrentWorkingDirectory, sandboxMcpServers, sandboxLspServers, allowBypass, auth: { git, gh }, allowDevToolAccess }`.
  `allowBypass` is "fail-closed … omitting it offers no bypass"; `auth.git`/`auth.gh` default false in the SDK (the CLI UI says
  on). `sandboxConfigSource: 'session_flag'` is "an explicit session-scoped choice"; managed policy can only raise the floor.
- **High-level `createSession` does not forward a sandbox field** in SDK 1.0.22 (`read:` `dist/client.js`, the `session.create`
  parameter list). So Durbar would set it with `session.rpc.options.update` right after create/resume and before the first send.
  `[KNOWN GAP]` K8: that `options.update` with `sandboxConfig` applies to shell commands of an already-created session (the type
  calls it "the genuinely-mutable subset"). T060 (`real:` 2026-10-25, Linux, CLI 1.0.101 / SDK 1.0.22) got only half: the update
  resolved and no `session.warning` came, but the one shell call was refused by Durbar's Read-only broker before it ran. The Ask
  first run (`real:` 2026-10-25 19:38 UTC, one prompt) then **contradicts or bypasses it**: an approved `touch` in a folder outside
  the session roots exited 0 and the file was created, with the state `on`; one `sandbox.decision` event came (variant not
  recorded). A second run with `sandbox.decision`'s bounded fields (`real:` 2026-10-25, spec *Changes*) **settles K8 on Linux with Copilot CLI 1.0.101 / SDK 1.0.22** (not run on macOS or Windows, or another version):
  `policy_resolved` from `user_policy` with Durbar's flags (`allowBypass: false`, network off) and `enforcement_state: engaged`, so
  the update applies to a created session; the write went through one read-write rule Durbar did not send (K15, narrowed; #755).
- **Clearing a running floor (K16, issue #806, `read:` SDK 1.0.22 `rpc.d.ts`, 2026-10-27; typings only, not run).** `options.update` "patches the genuinely-mutable subset";
  `sandboxConfig.enabled` is required, so `{ enabled: false }` is type-valid; no `null` form; `sandboxConfigSource` has `session_disabled` ("The user disabled the sandbox for the
  current session") and warns that "explicit below-floor changes remain policy conflicts unless a session opt-out is authorized"; `SandboxSessionChange` `disabled`/`restored` come
  from a slash-command result; `sandbox.disableForSession` needs a pending bypass request (`allowBypass`, never sent). No getter of the effective state (`getEnforcementStatus`
  gives managed `required`/`blocked` only). `[KNOWN GAP]` K16: whether the running floor is cleared by `enabled: false` / `session_disabled` and restored by `enabled: true`;
  T066 (needs the owner's OK) settles it.
- **Unavailable:** docs: the app "fails the shell with an unsupported-platform or unsupported-policy message. It does not run
  unsandboxed"; on Windows, denied paths that cannot be enforced make the command "fail with an explanation". Managed
  `sandbox.failIfUnavailable` keeps a server force-on so "the session fails loudly instead of quietly running unsandboxed"
  (SDK `rpc.js` doc comment). `SandboxConfigSource` has `unsupported_host` ("The client disabled the sandbox because the host
  cannot enforce it"). `[KNOWN GAP]` K9: what an SDK session with `enabled: true` from `session_flag` does on an unsupported host
  (fail the shell, or silently `unsupported_host`); Durbar therefore asks `getHostSupport()` itself first.
- `[KNOWN GAP]` K10: whether the user's own `~/.copilot/settings.json` `sandbox` block already applies to SDK sessions.
- `sandboxConfigSource` is only an input (`SessionUpdateOptionsParams`, `SessionOpenOptions`); no getter or event returns it. The
  one runtime signal named is `session.warning` with `warningType: 'sandbox'` (`SandboxHostCapabilityName` doc). `[KNOWN GAP]` K12:
  any other report of a lost sandbox (Copilot or Claude).

## R5 Summary per app and OS (what the floor can be)

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Claude Code | Seatbelt (built in) | bubblewrap + socat (packages; AppArmor on Ubuntu 24.04+) | **none** (WSL2 only) |
| Codex | Seatbelt (built in) | bubblewrap + seccomp (AppArmor on Ubuntu 24.04+) | MXC / elevated setup; Durbar refuses today |
| Copilot | Seatbelt | bubblewrap 0.5.0+ (+ slirp4netns for network rules) | ProcessContainer, Windows 11 25H2/26H1 with the named KBs |

None of the three sandboxes covers the app's own in-process file tools except Codex (whose sandbox applies "to spawned commands
and built-in file operations", docs; `[KNOWN GAP]` K11: `apply_patch` not named). Durbar's own checks stay the first line for
Claude's and Copilot's Read/Edit/Write tools; the OS sandbox is a floor under shell, searches and MCP servers.
