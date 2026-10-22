# An always-on session on a Linux VPS

Optional. It lets your coordinator session keep running (reviews, a chat channel, the simulator on a virtual display) when your laptop is closed. Costs: the VPS itself, and whatever your Claude account uses. Ask your human owner before you start one.

The example files are in [always-on-host/](always-on-host/). Replace every `<placeholder>`. They assume systemd user units (`systemctl --user`) and a checkout at `~/<workspace>/agent-durbar`.

## Rules

- **No public ports.** The display, the VNC server and noVNC listen on localhost or on a private network address only (for example a Tailscale address). Never bind them to `0.0.0.0` or open the firewall for them.
- **The chat bot token never goes into a script, a unit or a repo.** It lives in a file with mode 0600 outside any repo. The launcher reads it into an environment variable when it starts.
- **One poller per bot token.** If the bot already runs on another machine, switch it off there first. The launcher only enables the chat channel when an `enabled` flag file exists.
- **Every Electron run goes through `flock -o … timeout N xvfb-run -a …`.** The lock stops two runs from fighting over the display and the CPU; the timeout stops a hang. Example: `flock -o /tmp/durbar-electron.lock timeout 600 xvfb-run -a npm run check:office`.
- **Never `pkill`.** Find the PID of a process you started, or use a `[c]har` pattern with `pgrep`, and stop that one. `pkill -f` also matches the shell that runs it, and other people's sessions.
- **No real agent sessions or smoke tests** on the host (they spend credits). The simulator only.
- At most two heavy agents at a time on a 4-core machine.

## Pieces

| File | What it does |
| --- | --- |
| [durbar-session.example](always-on-host/durbar-session.example) | Launcher: starts Claude Code in the repo; reads the bot token from a 0600 file. |
| [durbar-sim.example](always-on-host/durbar-sim.example) | `start`, `stop`, `logs` for the simulator on the virtual display. |
| [xvfb.service.example](always-on-host/xvfb.service.example) | A virtual display `:99`, no TCP. |
| [x11vnc.service.example](always-on-host/x11vnc.service.example) | VNC of that display, localhost only. |
| [novnc.service.example](always-on-host/novnc.service.example) | noVNC in a browser, on the private network address only. |
| [durbar-sim.service.example](always-on-host/durbar-sim.service.example) | The simulator (`DURBAR_SIM=15`) on the display. |
| [durbar-tmux.service.example](always-on-host/durbar-tmux.service.example) | Keeps the coordinator session in a `tmux` session. |
| [config-sync.service.example](always-on-host/config-sync.service.example), [config-sync.timer.example](always-on-host/config-sync.timer.example) | Daily backup of your setup. |
| [sync.sh.example](always-on-host/sync.sh.example) | The backup script (allow-list plus secret scan). |

## Set up

1. Install `tmux`, `xvfb`, `x11vnc`, `novnc` (with `websockify`), Node, `git`, `gh`, Claude Code. Enable lingering so user units run without a login: `loginctl enable-linger <user>`.
2. Put the launchers in `~/bin/` (drop `.example`, `chmod +x`). Put the units in `~/.config/systemd/user/` (drop `.example`), then `systemctl --user daemon-reload` and `systemctl --user enable --now xvfb x11vnc novnc durbar-tmux`.
3. Chat bot token (only if you use a chat channel): create the file yourself, in your own terminal, so the token never goes through an agent or the chat:
   ```bash
   mkdir -p ~/.config/<channel-dir> && chmod 700 ~/.config/<channel-dir>
   umask 077 && read -rs TOKEN && printf '%s' "$TOKEN" > ~/.config/<channel-dir>/token; unset TOKEN
   touch ~/.config/<channel-dir>/enabled     # only when no other machine polls this bot
   ```
4. Reach noVNC only over your private network: `http://<private-address>:6080/vnc.html`. Check from outside the network that the port is closed.
5. `durbar-sim start` pulls `main`, builds, and starts the simulator on the display. Watch it in noVNC.

## Daily private backup of the config

Your setup (agent files, `CLAUDE.local.md`, launchers, units) is worth keeping with history. Rules:

- The backup repo is **private**. Check it before the first push.
- [sync.sh.example](always-on-host/sync.sh.example) copies a **fixed allow-list**, not a directory. Never add settings files, chat channel folders, sessions, history, transcripts, caches or token files.
- It scans everything for secret shapes and **refuses to commit** if it finds one. Keep the scan; extend it when you learn a new shape.
- Auto-memory notes may name people or contain chat content. Back them up only if you have read them, and never copy them into this repo.
- A systemd timer runs it once a day (see the `config-sync` examples). Check the log now and then: `journalctl --user -u config-sync`.
- The push uses your `gh` login through a credential helper; no token is written into the repo or its config.

## What does not belong here

Tokens, bot or chat IDs, emails, host names, IP addresses, private-network names, session data. If you are unsure, leave it out.
