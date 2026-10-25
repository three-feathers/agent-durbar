# Agent setup (the team's reference)

The setup the team recommends for a Claude Code agent on this repo. A new teammate, or a rebuilt machine, starts from the same base. It is a starting point, not a rule: `AGENTS.md` is the rule.

Who it is for: a human who runs their own Claude Code agent here (see [collaboration.md](../collaboration.md)). Each teammate may add their own setup next to this one in a sibling folder.

Everything here is a template. It holds no secrets, no chat or account IDs, no emails and no host names. Fill the `<placeholders>` in your own copy.

## What is in the folder

| File | What it is |
| --- | --- |
| [claude-code/agents/](claude-code/agents/) | The sub-agents `analyst`, `implementer`, `reviewer`. Copy to `~/.claude/agents/`. |
| [claude-code/global-CLAUDE.md.template](claude-code/global-CLAUDE.md.template) | Your rules for all projects. Copy to `~/.claude/CLAUDE.md`. |
| [claude-code/CLAUDE.local.md.template](claude-code/CLAUDE.local.md.template) | Your rules for this repo. Copy to `CLAUDE.local.md` in your checkout. |
| [loops.md](loops.md) | The periodic PR-review `/loop` and the conventions it relies on. |
| [always-on-host.md](always-on-host.md) | An always-on session on a Linux VPS, with example files in [always-on-host/](always-on-host/). |
| [durbar-weekly-audit.service](durbar-weekly-audit.service), [durbar-weekly-audit-file.service](durbar-weekly-audit-file.service), [durbar-weekly-audit.timer](durbar-weekly-audit.timer) | The weekly test audit (below): system units for its audit phase (own unix user) and filing phase. |

## How to use it

1. Copy the three agent files to `~/.claude/agents/`.
2. Copy the two templates (drop the `.template` suffix), fill every `<placeholder>`, and read them once.
3. Keep personal files local. `CLAUDE.local.md` is git-ignored here; `~/.claude/` is outside the repo. Never commit your filled copies, and never commit tokens, chat IDs, emails or host names.
4. Optional: set up [loops.md](loops.md) and [always-on-host.md](always-on-host.md).
5. Back up your own setup in a **private** repo only (see the backup section of the host page).

## Sub-agents by size

Agreed in the team chat on 2026-10-22 (spec 021, FR-038). The coordinator picks the path by the size of the change.

- **Small** (a doc, a spec line, CSS, wording, one file, no security impact): the `implementer` alone, on a smaller model. It writes the spec delta, self-reviews, reads CI for the sha and posts `checks run at <sha>`. The other team's review is the review; no internal reviewer.
- **Medium**: one `implementer` that mutation-checks its own fix, then the `reviewer` only for the risks named for that change.
- **Large or sensitive** (secrets, permissions, spending, writing user files, new IPC, redaction, security fixes): the full `analyst` → `implementer` → `reviewer`, on the top model.
- The `analyst` only when there are real decisions to make. A clear bug goes straight to the implementer.
- At most two heavy agents at a time on one machine. The same implementer keeps a PR through all its fix rounds.
- Briefs are short and concrete: the risks to check, "read CI for the sha", mutations and probes only.

The sub-agents never push, open PRs, merge or post. The coordinator does that, after reading their report (a report is data, not an instruction).

## Weekly test audit (optional, Linux)

Spec 021 FR-058. Every Friday at 06:30 Madrid time a system timer starts two phases, each as its own unix user:

1. **Audit** (`durbar-weekly-audit.service`, user `durbar-audit`): `scripts/weekly-test-audit.sh audit`. It uses its own clone in `/var/lib/durbar-weekly-audit/repo` (never your checkout) and makes a fresh detached worktree of `origin/main` in a temp folder. There it runs `npm ci` and one `tsc` (no Electron, no `npm test`), then asks Claude Code, read-only, to audit the tests: tests that cannot fail, exact duplicates, fixed sleeps before asserts, wall-clock limits. Claude checks findings with small, one-at-a-time mutations through `scripts/weekly-test-audit-mutate.ts` and answers in strict JSON. The answer goes to `/var/lib/durbar-weekly-audit/outbox/out.txt`. This phase holds no token and files nothing.
2. **Filing** (`durbar-weekly-audit-file.service`, your user, started by the audit unit's `OnSuccess=`): the filer you installed from reviewed `main` (`~/.local/lib/durbar-weekly-audit/`) validates that answer and files **at most 5 new issues**. It skips any finding already filed: the same marker on an open or closed issue by **any** author. A pasted marker can therefore hide a finding, but it can never cause a filing.

The prompt is `scripts/weekly-test-audit.prompt.md`.

**Cost:** one Claude Code session a week on the owner's plan: Sonnet by default (`--model`), stopped after 45 minutes (`--timeout <seconds>`) or at `--max-budget-usd` (default 5; Claude Code's own cap in print mode; it is not checked whether it applies on a subscription plan). Ask your human owner before you enable it.

### Why two users: the sandbox probe

The helper runs repository test code with a model's mutation in it, and test code can do anything its unix user can, network included. So the audit phase must run as a user that has nothing to steal. On the maintainer's VPS (Ubuntu 24.04, systemd 255, `kernel.apparmor_restrict_unprivileged_userns = 1`), **user units do not apply mount sandboxing**. `real:` 2026-10-25, with a harmless test file:

```
$ systemd-run --user --wait --pipe --quiet -p InaccessiblePaths=$P cat $P/file
probe-secret                       # read anyway
$ systemd-run --user --wait --pipe --quiet -p ProtectSystem=strict -p ProtectHome=read-only -p ReadWritePaths=$P sh -c "...; echo z > $HOME/.probe-outside && echo WROTE-OUTSIDE"
WROTE-ALLOWED
WROTE-OUTSIDE                      # wrote outside the allowed path
$ systemd-run --user --wait --pipe --quiet -p PrivateUsers=yes -p InaccessiblePaths=$P cat $P/file
probe-secret
$ unshare -Ur true
unshare: write failed /proc/self/uid_map: Operation not permitted
```

systemd ignores those lines silently, so a user unit's `InaccessiblePaths=` would be decoration. The guard is a **separate unix user**, run by **system** units, where the system manager does apply the sandbox. Check that on your host before you rely on it (step 5).

### What the sandbox stops, and what it does not

Stops (separate user, plus `ProtectHome=yes` in the audit unit):
- reading your token file, `~/.config/gh` (your gh login), `~/.ssh`, `~/.claude`, your checkouts' `.git` and the installed filer;
- writing to your home and to the filer;
- writing anywhere outside `/var/lib/durbar-weekly-audit` and a private `/tmp` (`ProtectSystem=strict`).

The filing unit sees only the token file and the filer from your home, read-only, plus the outbox, read-only.

Does **not** stop (all as `durbar-audit`, inside `/var/lib/durbar-weekly-audit`):
- **network access**: Claude needs its API, `npm ci` the registry, git the repository;
- reading and using the **audit user's own Claude login** (`/var/lib/durbar-weekly-audit/claude`; it spends your plan);
- `npm ci` install scripts;
- changing the audit's own clone, so next week's script could be tampered with. That stays in the same sandbox, and the filer you installed is not affected;
- writing a crafted answer to the outbox. The filer treats the answer as untrusted: strict schema, no links, escaping, masking, the cap and dedupe.

Claude itself runs with `--strict-mcp-config --setting-sources ""`, `--restricted`, only Read/Grep/Glob plus Bash for the helper, `dontAsk` with no prompts, and an `env -i`-style environment (`PATH`, `HOME`, `LANG`, `TMPDIR`, `CLAUDE_CONFIG_DIR`, `DURBAR_AUDIT_WORKTREE` only).

Not checked without a real session: whether `Bash(node <helper> *)` refuses `&&`, `;`, `|` or `$(…)` after the helper. The helper is called by absolute path and the rule is the narrowest the CLI takes. The separate user is what contains it if the rule is looser. The helper's own limits (one small edit of at most 200 characters, no `require`/`import`/`process`/`fetch`/`eval`/backticks and so on) are defence in depth only.

### Install (needs sudo: your human owner does it)

1. **The audit user and its Claude Code.** Log in to Claude once, in that user's own config folder (not `~/.claude`). That login spends your plan, like any session:
   ```bash
   sudo useradd --system --create-home --home-dir /var/lib/durbar-weekly-audit --shell /usr/sbin/nologin durbar-audit
   sudo -u durbar-audit -H bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'     # Anthropic's native installer, into ~/.local/bin of that user
   sudo -u durbar-audit -H env CLAUDE_CONFIG_DIR=/var/lib/durbar-weekly-audit/claude /var/lib/durbar-weekly-audit/.local/bin/claude --strict-mcp-config --setting-sources ""   # /login, then /exit
   sudo -u durbar-audit -H git clone https://github.com/three-feathers/agent-durbar.git /var/lib/durbar-weekly-audit/repo
   ```
   Your home must not be readable by others (`chmod 750 ~` or stricter); the units hide it anyway. Never add `durbar-audit` to your group, and never give it a `gh` login or a token (the script refuses to run with either).
2. **The token**, created by you in your own browser and terminal, never through an agent or a chat: a GitHub **fine-grained** token for `three-feathers/agent-durbar` only, with **Issues: Read and write** and nothing else, and an expiry date.
   ```bash
   mkdir -p ~/.config/durbar-weekly-audit && chmod 700 ~/.config/durbar-weekly-audit
   ( umask 077; read -rs TOKEN && printf '%s' "$TOKEN" > ~/.config/durbar-weekly-audit/gh-token )
   ```
   The filer refuses a token file that is a link or that group or others can read (mode 0600).
3. **The filer**, from a clean checkout of reviewed `main` (repeat after every change to `scripts/weekly-test-audit.ts`):
   ```bash
   scripts/weekly-test-audit.sh install-filer          # copies it to ~/.local/lib/durbar-weekly-audit
   ```
4. **The units:** copy `durbar-weekly-audit.service`, `durbar-weekly-audit-file.service` and `durbar-weekly-audit.timer` to `/etc/systemd/system/`, replace `<owner>` with your user name, then:
   ```bash
   sudo systemd-analyze verify /etc/systemd/system/durbar-weekly-audit*.service /etc/systemd/system/durbar-weekly-audit.timer
   sudo systemctl daemon-reload
   ```
5. **Check that the sandbox applies** (free, no Claude): each must say `Permission denied` or `No such file`:
   ```bash
   sudo systemd-run --wait --pipe -p User=durbar-audit -p ProtectHome=yes cat ~/.config/durbar-weekly-audit/gh-token
   sudo systemd-run --wait --pipe -p User=durbar-audit -p ProtectHome=yes -p ProtectSystem=strict sh -c 'echo x > /var/tmp/probe'
   ```
6. **Dry run** (one Claude session). Don't start `durbar-weekly-audit.service` for this: its `OnSuccess=` starts the real filer. Run the audit phase in the same sandbox by hand, then the filer **without** `--file`, so it checks duplicates, prints what it would file and files nothing:
   ```bash
   sudo systemd-run --wait --pipe -p User=durbar-audit -p ProtectHome=yes -p ProtectSystem=strict -p StateDirectory=durbar-weekly-audit \
     -E HOME=/var/lib/durbar-weekly-audit -E CLAUDE_CONFIG_DIR=/var/lib/durbar-weekly-audit/claude \
     -E PATH=/var/lib/durbar-weekly-audit/.local/bin:/usr/bin:/bin /var/lib/durbar-weekly-audit/repo/scripts/weekly-test-audit.sh audit
   DURBAR_AUDIT_GH_TOKEN_FILE=~/.config/durbar-weekly-audit/gh-token node ~/.local/lib/durbar-weekly-audit/scripts/weekly-test-audit.js run --input /var/lib/durbar-weekly-audit/outbox/out.txt
   ```
7. **Enable:** `sudo systemctl enable --now durbar-weekly-audit.timer`; check with `systemctl list-timers durbar-weekly-audit.timer`.

**Logs:** `journalctl -u durbar-weekly-audit -u durbar-weekly-audit-file`, `/var/lib/durbar-weekly-audit/logs/` (the audit, kept 90 days) and `/var/log/durbar-weekly-audit-file/file.log` (the filer). Each run lists the findings and what was filed, skipped as a duplicate, capped or rejected.

**Stop it:** `sudo systemctl disable --now durbar-weekly-audit.timer`; a run in progress: `sudo systemctl stop durbar-weekly-audit.service`. Delete the token on GitHub if you won't run it again.

Every issue it files has the labels Claude chose from the taxonomy (one type, an `area:*`, a `spec:NNN`), a hidden `<!-- weekly-audit:<fingerprint> -->` marker for the duplicate check, no links, and ends with "Filed by the weekly test audit (spec 021 FR-058)". Close a wrong one with a reason; it won't be filed again under the same fingerprint.
