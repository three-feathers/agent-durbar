# Feature Specification: Create a folder from + Folder (clone, new repository, empty)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Create a folder from + Folder (issue #805): clone a repository (https or ssh), a new local repository (git init) or an empty folder, in a parent chosen with the system picker; enters at Read-only
status: Draft 2026-10-27: spec, plan and tasks written; owner decisions of issue #805 recorded; questions Q1-Q5 open; nothing built
-->

**Feature Branch**: `093-create-folder` (spec); code branches `093-pN-slug`, one per phase

**Created**: 2026-10-27

**Status**: Draft. Nothing is built. Questions Q1-Q5 (end of this file) are open for the owner.

**Input**: Issue #805 (Paco, 2026-10-27): "+ Folder can also create a new folder: clone a repo (https/ssh), new local git repo (git init), or an empty folder". The issue's *Owner decisions*, *Existing capability to reuse* and *Security* sections are binding and are recorded under *Clarifications*.

## Why a new spec and not a delta

**+ Folder** belongs to spec 006 (FR-001: add folders through native dialogs), and the git runner belongs to spec 063 (FR-008). This feature adds a new thing: Durbar **writes** to the disk (a new folder), **runs a writing git command** (`clone`, `init`) that **talks to the network** with the user's own credentials, and has its own IPC channels, security model, progress and cancel UI. A delta would bury that in 006's 170+ requirements. So it is a new spec, number **093** (next free: `specs/` on `origin/main` ends at 092; no remote branch `093-*`; the open PRs are #804 `081-e2e-installer-http` and #710 `054-codex-mobile-research`; checked 2026-10-27). Specs 006 and 063 get a short cross-reference under their `## Changes`.

## Context: what exists today

- **+ Folder**: `src/renderer/index.html:26` (`#addFolder`), `app.js` `$('addFolder').onclick=()=>addVia(bridge.addFolder)` and `addVia(fn)` (top-bar mode, floor, model, effort, kind; the *Allow all* confirmation; toasts; `addLiveAgent`). Ctrl+O (`app.js`, key handler), the palette entry *Add folder*, the welcome screen's add button and File > Add Folder… (`src/main/main.ts:997`, spec 052 FR-164) all press that same button.
- **Main**: `agents:addFolder` in `src/main/ipc/agents.ts:71-74` opens `dialog.showOpenDialog({ title: 'Add folder', properties: ['openDirectory','multiSelections'] })` and calls `addMany(paths, validMode(mode), sessionOpts(opts))` (`src/main/main.ts:436`), which calls `addWorkspace` for each path (persists to the folder store, `src/main/folders.ts`), warns about broad folders (spec 006 FR-016) and leads to spec 061's *This folder brings its own agent setup* listing.
- **Git runner**: `src/main/gitstatus.ts` (spec 063 FR-008, #719). `nodeGitExec` = `makeGitExec(execFileGitRun(execFile))`: `execFile('git', argv, { shell: false, windowsHide: true, timeout: 4 s, maxBuffer: 512 KB })`, only `status`/`diff`/`rev-parse`/`rev-list` (`GIT_READ_ONLY`), caller options allow-listed, `GIT_SAFE_CONFIG` (fsmonitor off, **every transport off**, `credential.helper=` empty), `gitEnv()` (drops every `GIT_*` and `SSH_ASKPASS`, adds `GIT_SAFE_ENV`: `GIT_ALLOW_PROTOCOL=''`, `GIT_TERMINAL_PROMPT=0`, ...), filter drivers read and switched off (`FILTER_LIST`, `filterDrivers`, `filterOverrides`). It cannot clone or init today: both subcommands are refused, the transports are off, and the 4 s limit and buffered output do not fit a long clone.
- **Process tree kill**: `killChildTree` in `src/adapters/detect.ts` (`taskkill /pid N /t /f` from System32 on Windows; SIGTERM to the process group, SIGKILL after 3 s on POSIX, guarded against a reused pid). Used by the agent-app setup runner (`src/main/harnesssetup.ts`, spawned `detached` on POSIX), which also has the progress pattern this feature reuses: last lines, redacted, at most one event per 250 ms (`harness:progress`), a Cancel (`harness:cancel`).
- **Masking**: `maskSecretUrl` (`src/shared/redact.ts`: masks `scheme://userinfo@`, secret query values, then `redact()`), `redact`, `maskHomePaths`.
- **Names**: `WINDOWS_RESERVED_NAME` (`src/main/profilefiles.ts:38`), `CONTROL_RE` and `HIDDEN_RE` (`src/shared/names.ts`).
- **Dialogs**: `askDialog` (`src/renderer/dialog.js`: title, body, lines, one input with `error`/`hint`/`submitOnEnter`, buttons, `size`); the setup runner's progress dialog with a live log (`src/renderer/harnesses.js` `runDialog`, `.hs-log`).
- **Settings in main**: `SettingsStore` (`src/main/settings.ts`, `settings.json` in userData, tolerant read, atomic write; parsed by `parseSettings` in `src/shared/credits.ts`).
- **IPC guard**: `ipcHandle`/`ipcOn` (`src/main/ipcguard.ts`: only the app's own page in the main frame; under `DURBAR_SIM` every channel not on `SIM_OPEN_CHANNELS` is refused); the simulator also seals `child_process` (`sealChildProcess`, `src/main/simguard.ts`). The simulator's bridge (`src/renderer/sim.ts`, a plain script without imports) fakes `addFolder` in the window.
- **Missing**: no way to create a folder, no writing git command, no URL validator for git remotes, no remembered parent folder.

## Clarifications

### Owner decisions, issue #805 (Paco, 2026-10-27)

- "New repository" means a **local `git init` only**. No remote repository is created and no account is used.
- **Location**: the parent folder is chosen **each time with the system picker**. The app **remembers the last parent** and offers it next time.
- **Clone**: any `https://` or ssh URL (`git@host:path` or `ssh://`). The app uses the user's own git and credentials and **never stores a token**.
- **Reuse** (binding): `+ Folder` and `agents:addFolder` (`src/main/ipc/agents.ts:72`); the spec 063 git runner (#719 hardening), **no second way to spawn git**; the renderer's `askDialog` for the choice and the name and URL fields.
- **Security** (binding): no shell, an argument array, `--` before the URL and target; only `https://`, `ssh://` and scp-style `user@host:path`; refuse `file://`, `ext::`, `fd::`, local paths and a leading `-`; pass `-c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always`; never run hooks from the cloned repository during the clone (`core.hooksPath` set to an empty dir, no `--recurse-submodules`); `GIT_TERMINAL_PROMPT=0`; show git's error without credentials, using the existing masking; the folder name is a single segment, no `..`, no separators, not existing; the new folder enters at Read-only.
- **Acceptance** (binding): CI covers clone, init and empty on the three OSes with a local bare repository as the clone source, so tests use no network; refused input creates nothing; a failed clone leaves no half folder; a long clone shows progress and can be cancelled.

### Design choices that follow (analyst, 2026-10-27; no new product decision)

- **D1, the window never passes a path.** The parent is picked by main's own system dialog and kept in main behind a one-use token; the window gets the parent's text for display only. Same idea as spec 063 (*the window never passes a path*).
- **D2, the last parent lives in main** (`settings.json`), not in `localStorage`: main uses it as the picker's start folder and must check it (absolute, exists, a directory) before use.
- **D3, claim the final name, clone into it, remove it on failure** (not a temporary sibling renamed at the end). `fs.mkdir` without `recursive` is an atomic claim: it fails with `EEXIST` when the name exists, case-insensitively where the file system is (Windows, macOS default). `git clone` accepts an existing empty folder. A rename at the end would add two failure modes: on POSIX `rename()` silently replaces an **empty** folder another program created at the final name in the meantime; on Windows a rename of a fresh tree often fails with `EPERM`/`EBUSY` while antivirus or the search indexer holds a file. The cost: during the clone the folder exists under its final name (it is not in the office until it succeeds), and a crash or power loss mid-clone leaves it behind (`[KNOWN GAP]`, FR-052).
- **D4, git runs with the new folder as its working folder and `.` as the target**, so no absolute path is in the argv and a name can never be read as an option. `git clone` and `git init` do not look for an enclosing repository's config (`real:` git 2.43, Linux, 2026-10-27: a parent repository's own `core.hooksPath` and `core.fsmonitor`, planted with marker commands, did not run during a clone into a child folder).
- **D5, the remote cannot bring hooks**: hooks are not part of what a clone transfers. The hooks that **can** run during a clone are the user's own: the global `core.hooksPath` or the template folder (`init.templateDir`). `real:` git 2.43, Linux, 2026-10-27: a global `core.hooksPath` ran `reference-transaction` 4 times and `post-checkout` once during one `git clone`; with `-c core.hooksPath=<empty folder>` none ran. A `-c` given **before** the subcommand is not written into the new repository's config (`real:` same run), so the user's own hooks apply again to later commits, as they would after a clone in a terminal.
- **D6, ssh never waits for a typed answer.** `ssh -o BatchMode=yes` (through `GIT_SSH_COMMAND`) unless the user's own git config sets `core.sshCommand`, which is then used unchanged. With an ssh agent (or a key without a passphrase) the clone works; a key that needs a typed passphrase and no agent, or an unknown host key, fails at once with a clear message instead of waiting. On POSIX the child is also started `detached` (its own session, no controlling terminal) with stdin closed, so a user `core.sshCommand` cannot prompt in the terminal Durbar was started from.
- **D7, https uses the user's own credential helper.** Unlike the status runner, the clone does **not** blank `credential.helper`: the user's helper (Git Credential Manager, osxkeychain, libsecret, a cache) answers as in a terminal clone. Durbar never sees, stores or logs what it returns. `GIT_ASKPASS` and `SSH_ASKPASS` from Durbar's environment are dropped (as `gitEnv` does today) and `GIT_TERMINAL_PROMPT=0`: with no helper, a private repository fails with "authentication failed" rather than waiting.
- **D8, `transfer.credentialsInUrl=die`**: a git that knows it (2.37+) refuses a URL with a password itself (`real:` git 2.43: `fatal: URL 'https://u:<redacted>@...' uses plaintext credentials`). It backs up FR-023; an older git ignores the setting.
- **D9, the test seam is a parameter, not a switch.** The protocol list is a parameter of the pure argv builder, whose default is `https` and `ssh`. The IPC handler never passes it; the real-git test calls the builder with `file` to clone from a local bare repository. There is no environment variable, setting or IPC argument that turns `file://` on in the app (plan, *Testing*).
- **D10, Windows path length**: a target path longer than 200 characters is refused on Windows with a clear message (`.git\objects\pack\pack-<40 hex>.idx` and the repository's own files must still fit 260 characters). `core.longpaths` is not set (`[KNOWN GAP]`, FR-013).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clone a repository into a new folder (Priority: P1)

Lena wants to work on a project she has on GitHub. She presses **+ Folder**, picks **Clone a repository…**, pastes `git@github.com:lena/shop.git`, picks `~/code` in the system picker (it opened there because she used it last time), keeps the suggested name `shop` and presses **Clone**. A progress dialog shows "Receiving objects 45%". When it ends, the room *shop* appears in the office in Read-only.

**Why this priority**: it is the main ask of the issue and the one with all the risk (network, credentials, a writing git command).

**Independent Test**: real-git test clones a local bare repository (test seam, FR-095) into a temporary parent; the folder has the files and a `.git`; the IPC wiring test shows the handler builds the same argv with `https`/`ssh` only. Simulator driver: the dialogs, progress and the new room.

**Acceptance Scenarios**:

1. **Given** I press **+ Folder**, **Then** a dialog offers *Add existing folder…*, *Clone a repository…*, *New repository…* and *Empty folder…* (and Cancel).
2. **Given** I choose *Clone a repository…* and enter an accepted URL, **When** I confirm, **Then** the system picker opens at the last parent I used (or the system default the first time), and after I pick a folder a name dialog shows the parent, the masked URL and a name derived from the URL (`shop` from `.../shop.git`).
3. **Given** I confirm the name, **Then** a progress dialog shows git's progress (phase and percent), the elapsed time and a **Cancel** button; on success it closes, the folder is added like *Add existing* (same floor, kind, model choice; spec 061's listing of the folder's own agent setup when it has one) in **Read-only**, and a toast says "Cloned into <name>".
4. **Given** git needs a password and no credential helper or agent can give it, **Then** the clone fails within seconds with a plain message ("Sign-in failed: Durbar uses your own git credentials and cannot ask for a password. Set up a credential helper or an ssh agent, then try again."), and no folder is left.
5. **Given** the next time I create a folder, **Then** the picker opens at the parent I used last.

### User Story 2 - Refused input creates nothing (Priority: P1)

Lena pastes `file:///etc`, `ext::sh -c touch x`, `-uhelp`, `C:\repos\x` or `https://lena:hunter2@host/x.git`. Each time the URL dialog stays open with a clear reason and nothing is created or run. She types `CON`, `a/b`, `..`, `shop.` or the name of a folder that exists: the name dialog stays open with the reason.

**Why this priority**: constitution III; the issue's Security section.

**Independent Test**: unit tests of the URL and name validators with an adversarial corpus; wiring test: a refused input never calls spawn or mkdir.

**Acceptance Scenarios**:

1. **Given** a URL that is not `https://…`, `ssh://…` or `user@host:path` (FR-020), **Then** the dialog shows "Use an https:// or ssh address (for example git@github.com:owner/repo.git)." and no process starts.
2. **Given** a URL with a password in it, **Then** it is refused with "Remove the password from the address. Durbar uses your own git credentials." (Q3).
3. **Given** a refused name (FR-010), **Then** the reason names the rule ("A single folder name, without / or \\", "That name is reserved on Windows", "A folder or file named shop already exists there"), the typed text is kept, and nothing is created.
4. **Given** the parent became read-only or was removed after I picked it, **Then** I get "You cannot create a folder there: <reason>. Choose another place." and the name dialog offers *Change place…*.

### User Story 3 - New local repository or empty folder (Priority: P1)

Omar starts a new project. **+ Folder** → **New repository…** → picks `~/code` → types `notes-app` → **Create**. The folder exists with an empty git repository (`git init`, nothing on any server), and its room appears in Read-only. **Empty folder…** does the same without git.

**Why this priority**: simple, no network, and the first usable phase.

**Independent Test**: real-git test of init; unit test of the empty path; both on Windows, macOS and Linux CI (macOS on `main`/nightly, FR-106 of spec 008).

**Acceptance Scenarios**:

1. **Given** *New repository…*, **Then** the folder has a `.git` made by `git init` with the user's own default branch and template, and no remote.
2. **Given** git is not installed, **When** I choose *New repository…* or *Clone…*, **Then** I get "Git was not found. Install Git and try again; Empty folder works without it." and no folder is left; **Empty folder…** still works.
3. **Given** *Empty folder…*, **Then** an empty folder is created and added; no process is started.

### User Story 4 - Cancel a long clone (Priority: P2)

A clone of a large repository runs for minutes. Lena presses **Cancel**. The git process and what it started (git-remote-https, ssh, index-pack) end, the half folder is removed, and the dialog says "Cancelled. Nothing was kept."

**Independent Test**: real-git test against a local TCP server that accepts and never answers (`https://127.0.0.1:<port>/r.git`): cancel ends the child and the folder is gone; driver checks with `until()`.

**Acceptance Scenarios**:

1. **Given** a clone is running, **When** I press Cancel (or Escape), **Then** only the git process Durbar started, and its own children, are ended (no other process), and the folder is removed after the process has exited.
2. **Given** Windows keeps a file busy for a moment after the kill, **Then** removal is retried for a few seconds; if it still fails, the message names the folder to remove by hand and the folder is not added.
3. **Given** I quit Durbar during a clone, **Then** the clone is ended and its folder removed before the app exits (best effort, FR-043).

### Edge Cases

- **Parent not writable / read-only file system** (`EACCES`, `EPERM`, `EROFS` on `mkdir`): plain message, *Change place…*; nothing created.
- **Disk full** (`ENOSPC` from `mkdir` or from git: "No space left on device"): the clone fails, the folder is removed (removal may itself be partial on a full disk: the message then names the folder).
- **Name exists**, also with another case on a case-insensitive file system, also as a file: `EEXIST` from `mkdir`, "already exists there".
- **Two creates at once** (a second **+ Folder** while a clone runs): main refuses the second with "A folder is still being created."; the chooser says so.
- **The parent was removed or renamed** between the pick and the create: `ENOENT`, "That place no longer exists. Choose another place."
- **The remembered parent no longer exists or is not a folder**: the picker opens at the system default; nothing is shown as an error.
- **Symlinked parent** (or a junction on Windows): allowed; the new folder's path is saved as picked (not resolved), as *Add existing* does.
- **Network drive / UNC share** (`\\server\share`, an SMB or NFS mount): allowed. The clone may be slow. Git may then refuse to read the repository ("dubious ownership", `safe.directory`) when the share reports another owner, so spec 063's folder status may show nothing for it (`[KNOWN GAP]`, not tested).
- **Very long path on Windows**: refused above 200 characters (D10); a repository whose own files are too deep fails with git's "Filename too long", and the folder is removed.
- **A repository with submodules**: cloned without them (FR-032); the toast says "Submodules were not cloned" when `.gitmodules` exists.
- **A repository with Git LFS files**: see Q5.
- **An empty remote repository**: git warns "You appear to have cloned an empty repository"; that is a success.
- **The URL redirects** (https 301 to another host): git follows it under its own rules; a redirect to a protocol not allowed fails (`GIT_ALLOW_PROTOCOL` also limits redirects; `read:` git docs, not tested).
- **The user's git config rewrites the URL** (`url.<base>.insteadOf`): the rewritten URL is still limited to https/ssh by the protocol settings (the user's own config; not tested).
- **Unknown ssh host** (first contact): fails with "The ssh host key of <host> is not known yet. Connect once with ssh in a terminal, then try again." (Q4).
- **Old git** without `transfer.credentialsInUrl` (before 2.37): the setting is ignored; FR-023 still refuses passwords.
- **Windows Git Credential Manager** shows its own sign-in window: that is the user's helper and is allowed (D7); the clone waits for it, and Cancel still works. Not verified by a person.
- **Simulator** (`DURBAR_SIM`): the new channels are not open (refused by `ipcguard`); the simulator's bridge fakes the flow in the window and starts no process.

## Requirements *(mandatory)*

### Functional Requirements

**Choice and flow**

- **FR-001**: **+ Folder** MUST open a choice dialog (`askDialog`) titled "Add a folder" with the buttons *Add existing folder…* (primary, focused first, so Enter keeps today's behaviour), *Clone a repository…*, *New repository…*, *Empty folder…* and *Cancel*, and one short line per create option ("Clone: copy a repository from GitHub or another git server", "New repository: an empty folder with git, on this computer only", "Empty folder: no git"). Which other entry points (Ctrl+O, File > Add Folder…, the palette, the welcome screen) show it is Q1.
- **FR-002**: *Add existing folder…* MUST be exactly today's path (`agents:addFolder`, `addVia`), unchanged.
- **FR-003**: The create flow MUST be, in order: (clone only) the URL dialog → the system picker for the parent → the name dialog → the create. Cancel or Escape at any step ends the flow with nothing created. The name dialog shows the parent's path, the masked URL (clone), "It starts in Read-only." and the buttons *Cancel*, *Change place…* (back to the picker) and the primary *Clone* / *Create*.
- **FR-004**: The parent MUST be picked with main's system dialog (`dialog.showOpenDialog`, `openDirectory`, `createDirectory` on macOS) **every time**, starting at the remembered parent when it still is a folder (FR-006).
- **FR-005**: The window MUST NOT pass a path. `folders:createPickParent` returns a one-use **token** and the parent's text for display; main keeps `{token, path, time}`, one at a time, valid 10 minutes; `folders:create` refuses an unknown, used or expired token ("Choose the place again.").
- **FR-006**: After a **successful** create, main MUST save the parent in `settings.json` (`newFolderParent`: an absolute path, at most 4096 characters, no control characters; anything else is dropped on read). It is a path, never a token (constitution III); `SettingsStore`'s header comment is updated to say so.

**Folder name**

- **FR-010**: The name MUST be checked in main (`checkNewFolderName`, pure, `src/shared/newfolder.ts`) before anything is created: a string of 1 to 100 characters after the window trims spaces at both ends; a single path segment: no `/` or `\`; not `.` or `..`; no control or hidden characters (`CONTROL_RE`, `HIDDEN_RE`); none of `<>:"|?*` (refused on every OS, so a folder made on Linux also works on Windows, constitution VI); not a Windows device name with or without an extension, any case (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, and `COM¹²³`/`LPT¹²³`; one shared constant with `WINDOWS_RESERVED_NAME`); no trailing dot or space; no leading `-`; not `.git` (any case); nothing `redact()` would change (a token is not a folder name). Each rule has its own message.
- **FR-011**: For a clone, the suggested name MUST be the URL's last path segment without a trailing `.git` and `/`, kept only when it passes FR-010 (else the field starts empty).
- **FR-012**: The name MUST be claimed with a non-recursive `mkdir` of `<parent>/<name>` (D3). `EEXIST` is "already exists there"; `EACCES`/`EPERM`/`EROFS` "You cannot create a folder there"; `ENOENT` "That place no longer exists"; `ENOSPC` "The disk is full". Nothing else is created before the claim succeeds.
- **FR-013**: On Windows, a target path (`path.win32.join(parent, name)`) longer than 200 characters MUST be refused before the claim ("This path is too long for Windows. Choose a shorter place or name."). `[KNOWN GAP]`: `core.longpaths` is not set.

**Clone URL**

- **FR-020**: A clone URL MUST match one of exactly three forms (`checkCloneUrl`, pure, `src/shared/newfolder.ts`), ASCII only, at most 2048 characters, no whitespace or control character anywhere:
  - `https://[user@]host[:port]/path`
  - `ssh://[user@]host[:port]/path`
  - `user@host:path` (scp style; the user part is required, so `C:\x` or `host:path` without a user are never read as one)
  where the scheme is matched case-insensitively; `host` is a DNS name (labels of letters, digits and `-`, not starting or ending with `-`), an IPv4 address or a bracketed IPv6 address; `user` is letters, digits, `.`, `_`, `-`, `~`, `%`, `+` and does not start with `-`; the port is 1-65535; the path is not empty, does not start with `-`, and uses only RFC 3986 path characters (no `\`, `?` or `#`).
- **FR-021**: Everything else MUST be refused, explicitly including: `file:`, `git://`, `http://`, `ftp(s)://`, any `<transport>::<address>` (`ext::`, `fd::`), any `::` outside brackets, absolute and relative local paths (`/x`, `./x`, `~/x`, `C:\x`, `C:/x`, `\\server\share`), a leading `-` anywhere it could become an option (whole URL, user, host, path), and non-ASCII (an internationalised host must be written in its `xn--` form).
- **FR-022**: The URL MUST be checked in main by `folders:createCheck` (early feedback in the URL dialog) **and** again in `folders:create` (authoritative); the window keeps no copy of the rules.
- **FR-023**: A URL with a password (`user:pass@`, in any of the forms) MUST be refused (Q3, recommended), so git never writes it into the new repository's `.git/config`. A user name alone is accepted.

**Running git** (one runner, spec 063 FR-008 extended)

- **FR-030**: `clone` and `init` MUST run through `src/main/gitstatus.ts` (the one git runner), in a **separate, narrow entry point** (`runGitCreate`), not by adding them to `GIT_READ_ONLY`. Callers pass a typed request (`{ kind: 'clone', url } | { kind: 'init' }` and the target folder), never argv; the module builds the argv. No other file in `src/` starts `git` (a source test keeps it so).
- **FR-031**: The argv MUST be exactly: `git --no-pager <-c settings of FR-032> clone --progress --no-recurse-submodules -- <url> .` with the working folder set to the new folder, or `git --no-pager <-c settings> init --quiet` with the working folder set to the new folder. `--` comes before the URL and the target (`.`).
- **FR-032**: Settings passed with `-c` before the subcommand (so none of them is written into the new repository, D5): `core.hooksPath=<a private empty folder made with mkdtemp for this run and removed after it>`, `core.fsmonitor=false`, `core.useBuiltinFSMonitor=false`, `submodule.recurse=false`; for a clone also `protocol.allow=never`, `protocol.https.allow=always`, `protocol.ssh.allow=always`, `transfer.credentialsInUrl=die`; for init `protocol.allow=never` only (no transport is needed).
- **FR-033**: The environment MUST be `gitEnv(process.env)` (every `GIT_*` and `SSH_ASKPASS` of Durbar dropped) plus `GIT_TERMINAL_PROMPT=0` and `GIT_ALLOW_PROTOCOL=https:ssh` for a clone (empty for init); plus `GIT_SSH_COMMAND=ssh -o BatchMode=yes` for a clone unless the user's own git config sets `core.sshCommand` (D6; one fixed `git config --get core.sshCommand` read built by the same module, run in the private empty folder of FR-032 with `GIT_CEILING_DIRECTORIES` set to its parent, so only the system and global config are read). `credential.helper` is **not** blanked (D7). A user who relies on `GIT_SSH_COMMAND` in their environment must put it in `core.sshCommand` (README).
- **FR-034**: The child MUST be started with `spawn` (read from `child_process` at call time, so the simulator's seal applies), `shell: false`, `windowsHide: true`, `stdio: ['ignore', 'pipe', 'pipe']`, `detached` on POSIX (own process group and session: no terminal to prompt in, and the group is what Cancel ends), `git` found on `PATH` as the status runner does.
- **FR-035**: The spec, README and code comments MUST say what is real about hooks (D5): a remote cannot deliver hooks; the empty `core.hooksPath` stops the user's own global or template hooks during the clone; after the clone the user's hooks apply as usual.
- **FR-036**: The user's own filter drivers (Git LFS, git-crypt) during the clone: Q5 (recommended: left on, like a terminal clone).
- **FR-037**: The clone has **no overall time limit** (large repositories); the user cancels (FR-041). A refusal or sign-in failure ends by itself because nothing can prompt (FR-033, FR-034).

**Progress and cancel**

- **FR-040**: While a clone runs, main MUST send `folders:createProgress` at most every 250 ms: `{ phase, percent?, lines, elapsedMs }`, where `lines` are the last 6 lines of git's stderr (split at `\r` and `\n`), each masked (FR-070), and `phase`/`percent` are read from git's progress lines ("Receiving objects: 45% (…)", "Resolving deltas", "Updating files"). The window's progress dialog shows them in a live region (reusing the setup runner's `.hs-log` style) with **Cancel**.
- **FR-041**: Cancel (`folders:createCancel`, also Escape in the dialog) MUST end the running child with `killChildTree` (the child Durbar spawned and its own descendants; no other process), then, after the child's `close` event, remove the folder (FR-050) and answer `{ ok: false, cancelled: true }`.
- **FR-042**: Only one create runs at a time; a second `folders:create` while one runs MUST be refused at once.
- **FR-043**: On app quit during a clone, main MUST end the child and remove the folder before exit, with a bounded wait (5 s); if it cannot, the folder is left (`[KNOWN GAP]`).

**Nothing half-made**

- **FR-050**: When a clone or init fails, is cancelled or its add fails, main MUST remove the folder it claimed (`fs.rm` recursive, with retries for Windows `EBUSY`/`EPERM`, about 5 s), and only that folder (it created it in FR-012). If the removal fails, the message names the folder so the user can remove it.
- **FR-051**: The private hooks folder of FR-032 MUST be removed after every run.
- **FR-052**: `[KNOWN GAP]`: a crash or power loss during a clone leaves the folder under its final name; nothing cleans it at the next start.

**Adding the folder**

- **FR-060**: On success main MUST add the folder through `addMany([target], 'read-only', opts)` (`src/main/main.ts:436`), the same path as *Add existing*, with the window's floor, agent kind, model and effort (the same `sessionOpts` parsing as `agents:addFolder`); so spec 061's listing, the folder store and the broad-folder warning apply unchanged.
- **FR-061**: The folder MUST start in **Read-only**, whatever the top bar's mode (Q2, recommended); main does not take a mode from the window for this channel.
- **FR-062**: When `git` is not found (`ENOENT` on spawn), the message MUST be "Git was not found. Install Git and try again; Empty folder works without it." and the folder is removed. *Empty folder…* never starts a process.

**Errors**

- **FR-070**: Every text from git shown to the user or written to the debug log MUST pass through `maskSecretUrl` (credentials in `scheme://user:pass@`, secret query values, then `redact()`) and `maskHomePaths`, and be cut to 300 characters per line.
- **FR-071**: Common failures MUST get a plain message first, with git's masked last line under it: sign-in failed (`Authentication failed`, `could not read Username`, `Permission denied (publickey)`), unknown ssh host key (`Host key verification failed`), not found (`Repository not found`, `does not appear to be a git repository`), network (`Could not resolve host`, `Connection refused`, `timed out`), no space, path too long, refused protocol (`transport '…' not allowed`).

**IPC and the window**

- **FR-080**: New channels, registered with `ipcHandle` in `src/main/ipc/newfolder.ts` and each also checking `fromApp(e)` (added to `test-ipcchannels.ts`'s owner-only list): `folders:createPickParent()`, `folders:createCheck(req)`, `folders:create(req, opts)`, `folders:createCancel()`; event `folders:createProgress`. Every argument is checked in main: `kind` one of `clone`/`init`/`empty`, strings by type and length, unknown keys ignored, `opts` through the same parsing as `agents:addFolder`.
- **FR-081**: The preload and `DurbarApi` (`src/shared/api.ts`) get `createPickParent`, `createCheck`, `createFolder`, `createCancel`, `onCreateProgress`. None of the channels is on `SIM_OPEN_CHANNELS`; the simulator's bridge (`src/renderer/sim.ts`) fakes them in the window with canned refusals, fake progress and a fake new room, and starts nothing.
- **FR-082**: The dialogs MUST meet constitution V: text at least 10.5 px; keyboard only (Tab, Enter, Escape); the progress has a live region and the result is announced; state is never colour only.

**Docs**

- **FR-090**: README (feature list, *Safety model*: what clone runs and with whose credentials, the hooks note, ssh BatchMode, the `GIT_SSH_COMMAND` note, known limits), spec 006 and 063 cross-references, a `changelog.d/` fragment per phase, screenshots of the chooser, a refused URL, the progress and the new room at 1440x900 and 1280x800 (`npm run shots:docs` for linked pictures that change).

**Testing seam**

- **FR-095**: The argv and env builder MUST take the allowed protocols as a parameter whose default is `['https','ssh']`; the IPC handler and `runGitCreate`'s public entry never pass it. Only tests call the builder with `['file']` to clone a local bare repository. No environment variable, setting, command-line flag or IPC field can allow `file` in the app.

### Key Entities

- **Create request** (window → main): `{ kind: 'clone' | 'init' | 'empty', token, name, url? }` and the session options of `agents:addFolder` (no mode).
- **Parent pick** (main only): `{ token, path, at }`, one at a time, one use, 10 minutes.
- **Create progress** (main → window): `{ phase, percent?, lines, elapsedMs }`, masked.
- **Last parent** (`settings.json`): `newFolderParent`, an absolute path.

## Success Criteria *(mandatory)*

- **SC-001**: An empty folder or a new repository is created and in the office in 3 dialogs (choice, picker, name); a clone in 4 (plus the URL).
- **SC-002**: Every refused URL and name in the adversarial corpus (at least 40 URLs and 30 names, plan *Testing*) is refused by the validator, and the wiring test shows no `mkdir` and no spawn for any of them.
- **SC-003**: In the real-git tests on Linux and Windows CI (macOS on `main` and nightly), a failed clone, a cancelled clone and a refused protocol leave **no folder** in the parent, every time.
- **SC-004**: After Cancel, the child has exited and the folder is gone within 10 s (driver `until()`, not a fixed sleep).
- **SC-005**: No test needs the network or an account: the clone source is a local bare repository (seam), the hang source a local TCP listener on 127.0.0.1, and ssh a stub on `PATH`.
- **SC-006**: Every planted mutant of plan *Mutants* fails at least one test.

## Assumptions

- The user has git installed for clone and new repository (Git for Windows on Windows); Durbar does not bundle git.
- git 2.37 or newer for `transfer.credentialsInUrl`; older git still works with FR-023 as the guard. git 2.12 or newer for `GIT_ALLOW_PROTOCOL` (as spec 063).
- Durbar never creates anything on a server and never uses an account (owner decision).
- `[KNOWN GAP]`: no real clone over the network runs in CI or was run by the analyst; https sign-in through each OS's credential helper and ssh with an agent are to be checked by hand once (a task records it, `real:`), at no AI-credit cost.
- `[KNOWN GAP]`: not verified on macOS before merge (PR CI runs the spec 008 FR-106 stub); checked on `main` and nightly.

## Open questions for the owner

Listed with a recommended answer; nothing in phase 2 that depends on Q3-Q5 is built before they are answered. Q1 and Q2 block phase 1.

- **Q1 (entry points)**: which ways of adding a folder show the new choice?
  - (a) **Recommended**: the **+ Folder** button and the welcome screen's add button show the choice; **Ctrl+O**, **File > Add Folder…** and the palette's *Add folder* keep opening the system picker at once (no extra step for the common case); new palette entries *Clone a repository*, *New repository*, *New empty folder* and a **File > New Folder…** menu item open the create flow.
  - (b) Every entry point shows the choice (one more Enter for *Add existing*).
- **Q2 (mode)**: the issue says "enters at the default permission mode (read-only), like any added folder", but an added folder takes the top bar's mode today.
  - (a) **Recommended**: always Read-only, whatever the top bar says (the folder holds code fetched from elsewhere).
  - (b) The top bar's mode, like *Add existing* (with the *Allow all* confirmation).
- **Q3 (password in the URL)**: (a) **Recommended**: refuse it (git would save it in `.git/config`, which breaks "never stores a token"); (b) accept it and only mask it in messages.
- **Q4 (unknown ssh host key)**: (a) **Recommended**: fail with a message that says to connect once with ssh in a terminal (the user's own ssh trust rules stay as they are); (b) accept a new host key on first use (`StrictHostKeyChecking=accept-new`), easier but trusts whatever answers the first time.
- **Q5 (Git LFS and other filter drivers during the clone)**: (a) **Recommended**: leave the user's own filter drivers on, as a terminal clone does (LFS files download; the new repository's `.git/config` is written by git, not by the remote, so spec 063's reason for switching them off does not apply; only fsmonitor and hooks are switched off); (b) switch them all off and set `GIT_LFS_SKIP_SMUDGE=1` (LFS files arrive as small pointer files and the user runs `git lfs pull` later).
