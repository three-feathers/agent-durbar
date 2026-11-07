# Build cost: what the agents spend to build this app

A reference for contributors (spec 008 FR-181; owner request 2026-11-07): how many tokens the team's agents use per model and what they would cost at API list price. Each daily release can carry the table.

**It is an API list-price estimate, not billing.** Claude Code computes `claude_code.cost.usage` from list prices; a subscription is not charged per token, and a discount or cache rule can differ. Treat the dollars as a size, not an invoice.

**Numbers start on the day you switch it on.** Nothing earlier is known, and a machine that never runs the receiver is missing from the table. The report says the first day with data.

![Cumulative build cost by model over releases (API list-price estimate, not billing)](build-cost.svg)

(The picture and the README's *Build cost so far* block are generated: section 4.)

## 1. Point Claude Code at the receiver

Add the `env` block to your Claude Code settings (`~/.claude/settings.json`, or the git-ignored `.claude/settings.local.json`):

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta"
  }
}
```

Metrics only: do not add a logs or traces exporter. The receiver adds **delta** sums only, which is why the env block asks for delta explicitly; a cumulative sum is dropped (it cannot be told from a repeat without the session id, which is never kept), counted in the usage file and printed by `usage:day` as *Dropped data points*, so a wrong setting shows as a count and not as a silent zero. Claude Code exports every 60 s (`OTEL_METRIC_EXPORT_INTERVAL`), so the last minute of a session that exits may be missing. When the receiver is not running, Claude Code just fails to export; nothing else changes.

## 2. Run the receiver

```
DURBAR_USAGE_MACHINE=linux node scripts/usage-receiver.js            # or: npm run usage:receiver
```

- `DURBAR_USAGE_MACHINE` is **required**: a short label you choose (`linux`, `mac`, `paco-mac`; 1-24 letters, digits, `_`, `-`). The host name is never used.
- `--port <n>` or `DURBAR_USAGE_PORT` (default 4318; then change the endpoint above to match), `--dir <folder>` or `DURBAR_USAGE_DIR` (default `<home folder>/.durbar-usage`, from `os.homedir()`).
- It listens on `127.0.0.1` only and writes `<dir>/usage-<machine>.json`. Stop it any time; the next start continues from the file. It needs Node only, no `npm ci`. A lock file `usage-<machine>.lock` (the process id only, owner-only) next to the usage file stops a second receiver on the same folder and label from starting (it would overwrite the first one's sums). It is removed on a normal stop and on SIGTERM, SIGINT and SIGHUP. A lock left by a process that is gone, or written before the last boot, is taken over atomically (a temporary lock is renamed over it and read back; two receivers replacing the same stale lock at the same moment may both believe they hold it for a moment; the receiver checks the lock is still its own before every write, and the loser writes nothing, answers 503, prints `usage-receiver: lock lost to pid N, exiting` on stderr and exits with code 1, so a service manager restarts it and the restart refuses loudly). A lock that is not a process id, or whose live process is another user's, is never replaced: **if a receiver refuses to start and you know none runs (for example the old process id now belongs to something else), delete the `.lock` file by hand.** The receiver cannot tell that a live process with that id is not a receiver. Different labels or folders run side by side.
- As a background process: `nohup env DURBAR_USAGE_MACHINE=linux node scripts/usage-receiver.js > /dev/null 2>&1 &` (macOS and Linux), or `Start-Process node -ArgumentList 'scripts\usage-receiver.js' -WindowStyle Hidden` after `$env:DURBAR_USAGE_MACHINE='win'` (PowerShell).

Start-at-login examples (text only, not tested by this repo; replace the paths):

```ini
# Linux: ~/.config/systemd/user/durbar-usage.service, then: systemctl --user enable --now durbar-usage
[Unit]
Description=Agent Durbar build-cost receiver
[Service]
Environment=DURBAR_USAGE_MACHINE=linux
ExecStart=/usr/bin/node /path/to/agent-durbar/scripts/usage-receiver.js
Restart=on-failure
[Install]
WantedBy=default.target
```

```xml
<!-- macOS: ~/Library/LaunchAgents/app.durbar.usage.plist, then: launchctl load ~/Library/LaunchAgents/app.durbar.usage.plist -->
<plist version="1.0"><dict>
  <key>Label</key><string>app.durbar.usage</string>
  <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>/path/to/agent-durbar/scripts/usage-receiver.js</string></array>
  <key>EnvironmentVariables</key><dict><key>DURBAR_USAGE_MACHINE</key><string>mac</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
```

```
:: Windows (Task Scheduler, at log on): program node.exe, argument "C:\path\to\agent-durbar\scripts\usage-receiver.js";
:: set the label first in the task's environment or in a one-line .cmd: set DURBAR_USAGE_MACHINE=win
```

## 3. Print the report

```
npm run usage:day -- --date 2026-11-07
npm run usage:day -- --date 2026-11-07 --files linux.json,mac.json
```

The table has one row per machine and model (input, output, cache read, cache write tokens and the list-price USD), then the day total, the total since tracking began, the day's cost by main, subagent and auxiliary source, and the machines read. Without `--files` it reads every `usage-*.json` of the folder; copy another machine's file there (or name it with `--files`) and it is added. Two files with one machine label are refused (they would count twice). The date is a UTC day; the default is today.

**Tools that send no telemetry** (the Copilot CLI, Codex, a teammate's setup): write a file by hand with the same shape and its own label and pass it with `--files`:

```json
{ "version": 1, "machine": "paco-codex", "days": { "2026-11-07": { "models": { "gpt-5": { "input": 120000, "output": 8000, "cacheRead": 0, "cacheCreation": 0, "costUsd": 1.4 } } } } }
```

Paste the printed table into the release notes next to the clip (`changelog.d/README.md`, release steps).

## 4. README block, badge and chart at every release

`npm run usage:readme -- --release vX.Y.Z [--date YYYY-MM-DD] [--files a.json,b.json]` (pure text, no network) adds up `docs/build-cost-baseline.json` (what was spent before the receivers ran: `since`, `through`, per-model and per-machine dollars, and a note on what is not counted) and every usage-file day after the baseline's `through` day, then:
- rewrites the README block between `<!-- build-cost:begin ... -->` and `<!-- build-cost:end -->` (it fails, changing nothing, when either marker is missing, doubled or out of order);
- adds the release's row (date, version, cumulative dollars per model and per machine) to `docs/build-cost-history.json` (the same version replaces its row);
- regenerates `docs/build-cost-badge.svg` and `docs/build-cost.svg` (local plain SVG, no external service, a few KB; the chart stacks the models over release dates).
`--check` prints the block and writes nothing. It runs in the doc-only fold PR after each release (`changelog.d/README.md`). The baseline is keyed by the model ids the telemetry sends (`claude-opus-5-5`), so a baseline and a usage file for one model are one row; `MODEL_NAMES` in `scripts/usage-lib.js` is the one place that maps ids to the display names shown in the README, the badge and the chart (an id not listed shows as itself). When a machine's usage starts, raise nothing by hand: its files are summed from the day after the baseline's `through`.

## What is kept, and what is not

- Only sums per UTC day, model and token type (and per main, subagent, auxiliary source) are written. The receiver parses the whole JSON body, and **keeps only** three attributes of a data point (`type`, `model`, `query_source`); it checks an attribute's key before it looks at its value. **Emails, user, account and organization ids, session ids and agent names are never kept, written or printed** (`test:usage` plants fake ones and checks the file and the report).
- The receiver reads no Claude Code file (nothing under `~/.claude`), starts no process, makes no outgoing connection and has no dependency. It accepts `POST /v1/metrics` with `application/json` from a loopback `Host` only, at most 1 MiB (also after gunzip), a strict JSON parse; anything else is refused and changes nothing. The file is written through a temporary file (created with `wx`) and a rename, readable by you only (on POSIX; the folder is created 0700, and the default `.durbar-usage` folder is tightened to it).
- Bounded: a data point must be dated between two days ago and five minutes ahead (an exporter reports "now"; anything else is dropped and counted), so at most four days open per request and only as time passes (and at most 1,500 days in a file); at most 50 distinct models per day (the rest are added to `other-model`), a data point above 10^12 tokens or US$1,000,000 is refused, and a write that would take the file past 5 MiB is refused with 507 and loses nothing already stored.
- A model name that is not a plain id is counted as `other-model`; the usage files hold no prompt, path or file content.
- **The numbers are not authenticated.** Loopback only keeps other computers and web pages out; any process of any user on this machine can POST made-up usage to `127.0.0.1:4318`, and it ends up in the README number. The report is an estimate from Claude Code's own telemetry on the machines of people we trust, not an audit; whoever publishes a release reads the table before it goes into the README.
- Cumulative sums are dropped, as above; the count is printed in the report.
- Not verified: the SIGTERM test of the real receiver is skipped on Windows (POSIX signals do not apply there; the lock is then only removed on a normal exit, and a stale one is replaced by the process-id check); a macOS or Windows run (the code uses `os.homedir()`, `path.join` and no shell; the Linux run is the one tested), and the exact attribute names against a live Claude Code on every version (they follow the docs: https://code.claude.com/docs/en/monitoring-usage.md).
