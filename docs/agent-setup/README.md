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
| [weekly-test-audit.service](weekly-test-audit.service), [weekly-test-audit.timer](weekly-test-audit.timer) | The weekly test audit (below): systemd user units for `scripts/weekly-test-audit.sh`. |

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

Spec 021 FR-058. Every Friday at 06:30 Madrid time a systemd **user** timer runs `scripts/weekly-test-audit.sh --file` on the owner's VPS. It makes a fresh detached worktree of `origin/main` in a temp folder, runs `npm ci` and one `tsc` there (no Electron, no `npm test`), and asks Claude Code, read-only, to audit the tests: tests that cannot fail, exact duplicates, fixed sleeps before asserts, wall-clock limits. Claude checks findings with one mutation at a time through `scripts/weekly-test-audit-mutate.ts` and answers in strict JSON. The script validates that answer and files **at most 5 new issues** itself, skipping any finding already filed (open or closed). The prompt is `scripts/weekly-test-audit.prompt.md`.

**Cost:** one Claude Code session a week on the owner's plan (Sonnet by default, `--model` to change), stopped after 45 minutes (`--timeout <seconds>`). Ask your human owner before you enable it.

**What Claude can and cannot do:** it runs with `--strict-mcp-config --setting-sources ""` and `--restricted`, only Read, Grep, Glob and Bash for the mutation helper are allowed, and web tools, edits, `gh`, `git`, `curl` and `wget` are denied, with no permission prompts. It gets no GitHub token: the token variables are removed from its environment, and the script reads the token only after Claude has finished, to file the issues. The validator and the helper run from a copy outside the worktree, so Claude cannot change them. One limit: a mutation run executes repository test code with one change in it, as your user, so keep the token file readable by your user only and run this only on reviewed `main`.

**Install** (Linux, systemd; the units are templates):

1. Create the token yourself, in your own browser and terminal, never through an agent or a chat: a GitHub **fine-grained** token for `three-feathers/agent-durbar` only, with **Issues: Read and write** and nothing else, with an expiry date. Store it:
   ```bash
   mkdir -p ~/.config/durbar-weekly-audit && chmod 700 ~/.config/durbar-weekly-audit
   ( umask 077; read -rs TOKEN && printf '%s' "$TOKEN" > ~/.config/durbar-weekly-audit/gh-token )
   ```
   The script refuses a token file that is a link or readable by group or others (mode 0600).
2. Dry-run it by hand from your checkout. It files nothing; it prints the issues it would file and, when `DURBAR_AUDIT_GH_TOKEN_FILE` is set, which ones are duplicates. A dry run still spends one Claude session:
   ```bash
   DURBAR_AUDIT_GH_TOKEN_FILE=~/.config/durbar-weekly-audit/gh-token scripts/weekly-test-audit.sh
   ```
3. Copy `weekly-test-audit.service` and `weekly-test-audit.timer` to `~/.config/systemd/user/`, replace `<workspace>`, fix `PATH` so it finds `claude`, `node`, `git` and `gh`, then:
   ```bash
   systemd-analyze --user verify ~/.config/systemd/user/weekly-test-audit.service
   systemctl --user daemon-reload && systemctl --user enable --now weekly-test-audit.timer
   systemctl --user list-timers weekly-test-audit.timer
   ```
   User units run without a login only with lingering on (`loginctl enable-linger <user>`). Drop any sandbox line your distro refuses.
4. Logs: `journalctl --user -u weekly-test-audit` and `~/.local/state/durbar-weekly-audit/audit-*.log` (kept 90 days). Each run lists the findings, what it filed, what it skipped as a duplicate or over the cap, and what it rejected.

**Stop it:** `systemctl --user disable --now weekly-test-audit.timer` (and delete the token on GitHub if you will not run it again). A run in progress ends with `systemctl --user stop weekly-test-audit.service`.

Every issue it files has the labels Claude chose from the taxonomy (one type, an `area:*`, a `spec:NNN`), a hidden `<!-- weekly-audit:<fingerprint> -->` marker for the duplicate check, and ends with "Filed by the weekly test audit (spec 021 FR-058)". Close a wrong one with a reason; it will not be filed again under the same fingerprint.
