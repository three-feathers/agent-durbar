# Implementation Plan: Create a folder from + Folder

**Branch**: spec on `093-create-folder`; code on `093-pN-slug` branches, one per phase | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

## Summary

**+ Folder** gets a choice: add an existing folder (unchanged), or create one by cloning a repository, running `git init`, or making an empty folder. Main picks the parent with the system dialog (remembering the last one in `settings.json`), checks the name and URL, claims the folder with a non-recursive `mkdir`, runs git through a new narrow entry point of the one git runner (`src/main/gitstatus.ts`), streams masked progress, supports Cancel, removes the folder on any failure, and adds the result through `addMany` in the top bar's mode, like *Add existing* (Read-only by default).

## Technical Context

**Language/Version**: TypeScript (main, shared), plain-script JavaScript (renderer). No new dependency.
**Storage**: `settings.json` gets `newFolderParent` (a path). No change to `folders.json` beyond what `addMany` already writes.
**Processes**: `git` from `PATH`, `spawn` with an argv array, no shell. No other new process (Windows Cancel uses the existing `killChildTree`, which runs System32 `taskkill`).
**Testing**: Node unit tests (validators, argv/env builder, op with fakes, IPC wiring on a stand-in `electron`), a real-git test (skipped with a note when git is absent, failing under `CI` like `test:gitstatus`), a simulator driver with screenshots. 0 AI credits, no network.
**Target Platform**: Windows, macOS, Linux.
**Constraints**: constitution III (no shell, validated IPC, no stored secret), VI (paths with `path`, Windows names and path length), V (dialog text, keyboard), VIII (known gaps in README).

## Constitution Check

- **I (spec first)**: this spec, plan and tasks are committed before any `src/` change; each phase PR changes `specs/093-create-folder/`.
- **II (adapters)**: nothing agent-specific; the folder is added through `addMany`, which picks the adapter as today.
- **III (safe, no secrets)**: argv only, `--` before URL and target, an allow-list of URL forms, transports limited by two layers that each stop every transport git ships (`GIT_ALLOW_PROTOCOL=https:ssh`, which also stops remote helpers with any name, and `-c protocol.<x>.allow=never` for each other built-in transport; spec R1, `real:` checked against a user config that allows `file`/`ext` and rewrites URLs), no prompts, credentials never seen or stored (the user's helper answers git directly), URL passwords refused, output masked, inputs validated in main, the window never passes a path (token); the mode follows the top bar like *Add existing* (owner Q2 = b), default Read-only, with the same *Allow all* confirmation, which for a clone also names the host (owner Q6 = a). The one new write to the user's disk is the folder the user named, in the place they picked.
- **IV (no credits)**: no agent session; tests use local sources only.
- **V (calm UI)**: `askDialog` and the existing dialog classes; a live region for progress.
- **VI (platforms)**: Windows device names and the 200-character limit refused everywhere they matter; `killChildTree` handles Windows and POSIX; removal retries for Windows locks; real-git tests run on Windows CI.
- **VII (gates)**: new pure modules with tests; the git runner's change is covered by the real-git test with planted markers like spec 063.
- **VIII (honest limits)**: no network clone in CI, macOS not in PR CI, credential-helper windows not checked by a person, crash mid-clone leaves the folder, network drives and `safe.directory`, `core.longpaths` not set.

## Code paths reused (do not add parallel versions)

| Need | Reuse | Where |
| --- | --- | --- |
| The choice, URL and name fields | `askDialog` (buttons, `lines`, `input.error`, `input.hint`, `size:'m'`) | `src/renderer/dialog.js` |
| Adding the result | `addMany(paths, mode, opts)` and `sessionOpts` parsing (move `sessionOpts` to a shared helper used by both channels) | `src/main/main.ts:436`, `src/main/ipc/agents.ts:65-69` |
| Window-side options (floor, kind, model, effort) | `addVia`'s option building, split into `addOptions()` used by both | `src/renderer/app.js` (`addVia`) |
| Running git | `gitEnv`, `git` from `PATH`, the config-read pattern, the source test that no other file starts git | `src/main/gitstatus.ts`, `scripts/test-gitstatus.ts` |
| Ending the child and its tree | `killChildTree` | `src/adapters/detect.ts` |
| Progress throttle, last lines, Cancel | the setup runner's pattern (`onStream`, 250 ms gap, `lastLines`, `MAX_OUT`) and its dialog's `.hs-log` style | `src/main/harnesssetup.ts`, `src/renderer/harnesses.js` |
| Masking | `maskSecretUrl`, `redact`, `maskHomePaths` | `src/shared/redact.ts` |
| Name rules | `WINDOWS_RESERVED_NAME` (moved to `src/shared/newfolder.ts` and re-exported from `profilefiles.ts`, so there is one constant), `CONTROL_RE`, `HIDDEN_RE` | `src/main/profilefiles.ts:38`, `src/shared/names.ts` |
| Remembered parent | `SettingsStore` + `parseSettings` | `src/main/settings.ts`, `src/shared/credits.ts` |
| IPC guard and owner-only check | `ipcHandle`, `fromApp`; `test-ipcchannels.ts` static list | `src/main/ipcguard.ts` |
| Simulator | the bridge's `addFolder` fake as the model for the new fakes | `src/renderer/sim.ts:2676` |

## Design

### Modules

- `src/shared/newfolder.ts` (pure, no Node): `checkNewFolderName(name)` (the same rules on every OS; phase 1 dropped the platform parameter, spec *Changes*), `parseNewFolderParent(value)`, `checkCloneUrl(url)` (returns `{ ok, form: 'https'|'ssh'|'scp', host } | { ok: false, error }`), `suggestedName(url)`, `NEW_FOLDER_LIMITS` (100 name chars, 2048 URL chars, 200 Windows path chars), `WINDOWS_RESERVED_NAME`, `gitFailureText(stderrTail)` (FR-071 mapping), `parseCloneProgress(line)`.
- `src/main/gitstatus.ts` (the one runner) gets the create entry point:
  - `gitCreateCall(req, { hooksDir, userSshCommand, protocols = ['https','ssh'] })` → `{ argv, env }` (pure; the test seam of FR-095 is the `protocols` parameter);
  - `runGitCreate(req, cwd, deps)` → a handle `{ done: Promise<{ code, signal, stderrTail }>, cancel() }`, using `spawn` read from `child_process` at call time and `killChildTree`;
  - `readUserSshCommand(deps)` (returns the user's value, or `undefined` when unset): one fixed `git config --get core.sshCommand` in the private hooks folder, `GIT_CEILING_DIRECTORIES` set to its parent.
  - The existing read-only runner, `GIT_READ_ONLY` and `GIT_SAFE_CONFIG` are unchanged.
- `src/main/newfolderop.ts` (Electron-free, deps injected: `fs`, `runGitCreate`, `addMany`, `settings`, clock; `nodeNewFolderDeps` builds the real ones for the app and the real-git test): `pickParent`, `check`, `create` (phase 1); `cancel`, `quit` (phase 2). Owns the token, the one-at-a-time lock, the claim, cleanup with retries, the progress throttle and the error mapping.
- `src/main/ipc/newfolder.ts`: registers the four channels (thin; `fromApp(e)`; the dialog call), wired from `main.ts` with `toRenderer` for the progress event.
- `src/renderer/newfolder.js` (UMD like `places.js`): the flow (choice → URL → picker → name → create/progress), using `askDialog` and a small progress dialog built with the existing `.dlg-ov`/`.dlg`/`.hs-log` classes.

### Clone sequence (main)

1. Check token (FR-005), kind, name (FR-010), URL (FR-020..FR-023), Windows length (FR-013), lock (FR-042).
2. `mkdir(target)` non-recursive (FR-012).
3. `mkdtemp` the private hooks folder; `readUserSshCommand`.
4. `runGitCreate` with `cwd = target`; progress events (FR-040).
5. On exit 0: remove the hooks folder; `addMany([target], validMode(mode), opts)`; save `newFolderParent`; answer the `AddResult` plus `{ name, submodules? }`.
6. On non-zero exit, a spawn error, cancel, or an add failure: wait for `close`, `fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })`, remove the hooks folder, answer `{ ok: false, error }` (masked; FR-070, FR-071) or `{ cancelled: true }`.

### Why not a temporary sibling and a rename

See spec D3: POSIX `rename` replaces an empty folder created at the final name in the meantime, and Windows renames of fresh trees fail under antivirus and indexer locks. The non-recursive `mkdir` claim is atomic, and git accepts an empty existing folder.

### Why `BatchMode` is added to OpenSSH only

`GIT_SSH_COMMAND` beats `core.sshCommand`, so always setting it to plain `ssh` would replace a user's own ssh setup (1Password agent, a custom key, plink). So: no `core.sshCommand` → `ssh -o BatchMode=yes`; a `core.sshCommand` whose program is `ssh`/`ssh.exe` → the user's own value plus ` -o BatchMode=yes` (D11; Git for Windows' "external OpenSSH" choice); anything else → unchanged. The program name is taken from the first word of the value (a quoted path allowed) with `path.win32`/`path.posix` basename; a value that cannot be read that way is left unchanged. Without `BatchMode`, a user command could still try to prompt; FR-034 removes the terminal (`detached`, stdin closed) FR-044 shows a "still waiting" line after 30 s without output, and the user can Cancel. Windows: `ssh` in `GIT_SSH_COMMAND` is run by Git for Windows' own shell and finds its bundled ssh (`read:`, not checked by a person).

## Testing

All without network or credits. Real-git tests follow `test:gitstatus`: skipped with a note when `git` is absent, failing when absent under `CI`; run with `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME` pointing to a temporary folder and `HTTP(S)_PROXY` removed, `NO_PROXY=*`.

1. **Validators** (`scripts/test-newfolder.ts`, `test:newfolder`): adversarial corpus. URLs refused (at least 40): `file:///x`, `FILE:///x`, `file:x`, `ext::sh -c x`, `fd::17`, `git://h/x`, `http://h/x`, `ftp://h/x`, `/abs/x`, `./x`, `../x`, `~/x`, `C:\x`, `C:/x`, `\\srv\share\x`, `-uhelp`, `--upload-pack=x`, `https://-h/x`, `ssh://-oProxyCommand=x/y`, `git@-oProxyCommand=x:y`, `-x@h:y`, `u@h:-x`, `https://h/x y`, tab, newline, NUL, `https://u:p@h/x`, `ssh://u:p@h/x`, `u:p@h:x`, `https://h`, `https://h/`, `https://h:0/x`, `https://h:70000/x`, `https://h/x#f`, `https://h/x?q`, `https://h\x`, `h:x` (no user), `u@h:` (no path), `u@[::1:x`, `https://exämple.com/x`, `https://h/x::y`, a 2049-character URL, encoded user parts (`https://u%3Ap@h/x`, `ssh://u%3Ap@h/x`, `u%3Ap@h:x`, `https://u%40x@h/x`, `https://%75@h/x`, `https://u%3ap@h/x` lower case), an empty string, a non-string. `%` in the **path** stays allowed (`https://h/a%20b.git`, pinned as accepted). Accepted: `https://github.com/o/r.git`, `HTTPS://github.com/o/r`, `https://u@h:8443/a/b.git`, `ssh://git@h/o/r.git`, `ssh://git@h:2222/o/r`, `git@github.com:o/r.git`, `git@h:/srv/r.git`, `u@[2001:db8::1]:r.git`, `https://192.0.2.1/r.git`. Names refused (at least 30): empty, `.`, `..`, `a/b`, `a\b`, `CON`, `con.txt`, `Nul`, `COM1`, `LPT9.x`, `COM¹`, `a.`, `a `, `-a`, `.git`, `.GIT`, `a:b`, `a*b`, `a?b`, `a|b`, `a"b`, `a<b`, `a>b`, a control char, a zero-width space, a bidi override, 101 characters, a token shape (`ghp_` + 36). Suggested names from URLs.
2. **Argv and env** (`test-gitstatus.ts`, new section): `gitCreateCall` for clone and init: exact argv (the `-c` list before the subcommand, `--` before the URL, `.` last); env has no `GIT_*` of the base, has `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https:ssh`, `GIT_SSH_COMMAND` as D11 says for the three cases (none, plain `ssh`/`"C:\\Program Files\\OpenSSH\\ssh.exe"`, `plink`); no `credential.helper=`; default protocols are `https`,`ssh`, and the `protocol.<x>.allow=never` list is every built-in transport minus the allowed ones (so the seam's `file` drops `file` from that list, and nothing else); `transfer.bundleURI=false`; init's never list covers every transport. The env keeps `GIT_SSL_CAINFO`/`GIT_SSL_CAPATH` from the base only when absolute, and drops `GIT_SSL_NO_VERIFY`, `GIT_PROXY_COMMAND`, `GIT_SSH`, `GIT_CONFIG_GLOBAL`; `HTTPS_PROXY` and `SSH_AUTH_SOCK` pass. Spawn options pinned through a fake `spawn` (`shell:false`, `windowsHide`, `detached` on POSIX only, stdin ignored). The source test that nothing else starts git is extended to `spawn`.
3. **Real git** (`scripts/test-newfolder-git.ts`, `test:newfoldergit`):
   - clone from a local bare repository with the seam (`protocols: ['file']`): files and `.git` present, `remote.origin.url` is the given URL, `core.hooksPath` not in the new config;
   - a global `core.hooksPath` (in the test `HOME`) with `post-checkout` and `reference-transaction` hooks writing markers: no marker after the clone (D5);
   - the parent is itself a repository whose `.git/config` plants `core.fsmonitor`, `core.hooksPath`, `core.sshCommand` writing markers: none fire (D4);
   - a submodule in the source: not cloned;
   - the **production** call (default protocols) against `file://<bare>`: git refuses ("transport 'file' not allowed") and the op leaves no folder; same for `ext::` built past the validator;
   - **each protocol layer alone** (R1): the test `HOME`'s global config sets `protocol.file.allow=always`, `protocol.ext.allow=always`, `url."file://<bare>".insteadOf https://example.invalid/r.git` and `url."ext::sh -c <write a marker>".insteadOf https://example.invalid/e.git`. The production call for both `https://example.invalid/…` URLs (accepted by the validator; no network: the rewrite happens before any connection) must fail with "transport … not allowed", leave no folder and no marker: (i) as built, (ii) with `GIT_ALLOW_PROTOCOL` removed from the env (the `-c` nevers alone), (iii) with the `-c protocol.<x>.allow=never` entries removed (the env alone). A `foo::` helper rewrite with `protocol.foo.allow=always` is refused in (i) and (iii) (the env is the only layer for helper names; the test says so);
   - **cleanup does not follow links** (POSIX; R2): the source repository contains `out -> <a folder outside the parent>` and `f -> <a file outside>`; the clone is made to fail after checkout (a test hook in the seam's run, or a cancel after checkout) and the op removes the folder: the outside folder and file still exist with their content;
   - init: `.git` present, no remote, no hook marker;
   - failure cleanup: `https://127.0.0.1:<closed port>/x.git` → error, no folder;
   - cancel: a local TCP listener that accepts and never answers, `https://127.0.0.1:<port>/r.git` → `cancel()` → the child has exited, the folder is gone (`until()`, 10 s);
   - ssh (POSIX only, `[KNOWN GAP]` on Windows): a stub `ssh` first on `PATH` records its argv and exits 255: `BatchMode=yes` present, no folder left; with `core.sshCommand=ssh` in the test `HOME`, the stub still gets `BatchMode=yes` (D11); with `core.sshCommand=<stub named plink>`, it gets no `BatchMode`;
   - the 30 s waiting line (FR-044) with an injected clock in the op test, not with real time;
   - git missing: `PATH` without git → the FR-062 message, no folder.
4. **Op** (`scripts/test-newfolderop.ts`): with fakes: token one-use and expiry, one at a time, `mkdir` error mapping (`EEXIST`, `EACCES`, `EPERM`, `EROFS`, `ENOENT`, `ENOSPC`), Windows 200-character rule with `path.win32`, removal retries then the "remove it by hand" message, the hooks folder always removed, `addMany` called with the window's mode through `validMode` (an unknown value becomes Read-only) and never on failure, `newFolderParent` saved only on success, progress throttle and masking (`https://u:secret@h` never in an event), quit during a clone.
5. **IPC wiring** (stand-in `electron`, like `test-orgwiring.ts`): each channel refuses a call that is not `fromApp`; a refused URL or name never reaches `mkdir` or `spawn`; the handler's call has protocols `https`,`ssh` only; `test-ipcchannels.ts` owner-only list updated.
6. **Settings**: `parseSettings` keeps a valid `newFolderParent` and drops relative paths, control characters, over 4096 characters, non-strings.
7. **Simulator driver** `scripts/shots-093.js` (waits with `until()`): the chooser (buttons, focus on *Add existing*), a refused URL with its message, the name dialog, fake progress with Cancel, the new room in the top bar's mode (also Allow all after its confirmation); Ctrl+O still opens the picker fake directly; File > New Folder… and the palette entries open the flow; screenshots at 1440x900 and 1280x800; text at least 10.5 px; Escape closes each step; under `DURBAR_SIM` main refuses the four channels (`simRefusedChannels` stays empty in a plain run because the window uses the fake).

### Mutants to plant (each must fail a test)

- `checkCloneUrl` accepts `file:` (or drop the scheme allow-list); accepts a leading `-`; drops the whitespace check; accepts `::`; accepts a password; accepts `%` in the user part (the encoded-password corpus must fail it).
- `checkNewFolderName` drops the separator, `..`, reserved-name, trailing-dot or `.git` rule.
- `gitCreateCall`: `--` removed; `-c` list moved after the subcommand; `core.hooksPath` dropped; default protocols include `file`; `GIT_ALLOW_PROTOCOL` set to empty or dropped (killed by layer test (ii) and the `foo::` case); the per-transport `protocol.<x>.allow=never` entries dropped (killed by layer test (iii)); `transfer.bundleURI=false` dropped; `GIT_SSL_NO_VERIFY` or `GIT_PROXY_COMMAND` passed through; `BatchMode` not appended to a plain-ssh `core.sshCommand`, or appended to plink; `GIT_TERMINAL_PROMPT` dropped; `GIT_SSH_COMMAND` set even when `core.sshCommand` exists; `credential.helper=` added.
- Spawn: `shell: true`; `detached` dropped on POSIX.
- Window: the clone's *Allow all* confirmation without the host sentence, or with the user part of the URL in it.
- Cleanup: resolve the target (`realpath`) before `rm`, or follow links while removing (killed by the link test).
- Entry points: Ctrl+O, File > Add Folder… or the palette's *Add folder* open the choice instead of the picker (Q1 = a); the *Allow all* confirmation skipped for the create flow.
- Op: `mkdir` with `recursive: true`; no removal on failure; removal before `close`; `addMany` with a fixed mode instead of the window's (`'read-only'` or `'allow'`), or without `validMode`; `newFolderParent` saved on failure; the lock removed; progress lines not masked; token reusable.
- IPC: `fromApp` check removed; the handler passes the window's path or protocols through.

## Phases (each one PR; each leaves the app working)

0. **Spec** (this PR): spec, plan, tasks, index block, cross-references in specs 006 and 063.
1. **Phase 1, empty folder and new repository** (US3, FR-001..FR-013 incl. FR-001a, FR-030..FR-035 for init, FR-050..FR-052, FR-060..FR-062, FR-070, FR-080..FR-082, FR-090 for this part). Q1 and Q2 answered 2026-10-27. Validators for names, the runner's `init` entry, the op, IPC, the choice and name dialogs, the parent picker and remembered parent, the simulator fakes, tests, README, changelog fragment, screenshots.
2. **Phase 2, clone** (US1, US2, US4; FR-020..FR-023, FR-031..FR-037 for clone, FR-040..FR-044, FR-071, FR-095; review items R1-R6). Q3 and Q4 answered 2026-10-27; Q5 is the agent default (filters on). URL validator, clone argv/env, progress, cancel, quit, real-git tests incl. the seam, the URL and progress dialogs, README *Safety model*, changelog, screenshots.
3. **Phase 3, real check and converge**: one hand check per OS that is available (https with the user's credential helper, ssh with an agent, a cancel), recorded as `real:`, no AI credits; `/speckit-converge`; known gaps carried to the README.

## Risks to check in review

- Argument injection through the URL or name (leading `-`, `--upload-pack`, `ext::`, ssh host options); the validator **and** git's own protocol limits must each stop it; the two git layers must each stop the built-in transports even against a user config that allows them (R1).
- A prompt that hangs (ssh passphrase, unknown host, https password): BatchMode, `GIT_TERMINAL_PROMPT=0`, no terminal, and Cancel.
- Removing something that is not ours: only the folder `mkdir` created in this run; never the parent; never follow a link (no `realpath`; tested, R2); Windows junctions untested.
- Windows: `taskkill` tree kill, `EBUSY` on removal, device names, path length; ssh in `GIT_SSH_COMMAND`.
- Masking: a password-like value in git's output (from a user's `insteadOf` rewrite) must not reach the window or the log.
- The spec 063 promise "every git call goes through the one runner" must stay true (source test).

## Complexity Tracking

| Addition | Why | Simpler option rejected because |
| --- | --- | --- |
| A second entry point in the git runner (spawn, streaming, no time limit) | clone is long, needs progress and Cancel | the read-only `execFile` runner has a 4 s limit, buffers output and refuses transports by design; widening it would weaken spec 063 |
| A parent token in main | the window never passes a path | passing the picked path back would let a compromised page name any folder |
