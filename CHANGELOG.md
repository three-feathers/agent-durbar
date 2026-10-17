# Changelog

Agent Durbar is an alpha. Builds are unsigned and have only been run by hand on Linux (see "Honest limits"). Each entry names the spec that describes the behavior and how it was checked.

## Unreleased (on `main`, after the alpha.2 tag)

- **Permission mode renamed *Allow all*** (was *Allow edits*), in the top bar, new-session dialog, mode chip and menu, confirmation, toasts and chat hint. Behavior is unchanged: it approves everything. Names are now Read-only / Ask first / Allow all. Spec 003 FR-028..FR-030, PR #15.
- **Usage totals (spec 011 FR-018..FR-023, PR #17).** An office total (header chip) and a per-folder total (room header and closed door plate) in AIU, summed from the runtime's usage events since the app opened. Not saved across restarts; ended sessions stay counted; shows "credits not reported" instead of 0 when the runtime sends no figure. `npm run test:usagetotals`.
- **Windows paths in session-grant scopes** are unit-tested (spec 003 FR-031/FR-032, PR #16). Known gap: Windows grant keys are not yet compared case-insensitively (task T028).
- **Docs and process:** README, CHANGELOG and spec statuses brought in line with `main`; AGENTS.md has a "Keep docs in sync" rule; the PR template has a "Docs updated" box; a non-blocking check warns when `src/` changes without a docs change (spec 025).
- **Screenshots of the mode menu, confirmation and right-click menu** (`docs/screenshots/m7-mode-switch.png`, `m7-mode-confirm.png`, `m7-mode-context.png`) were regenerated on the simulator and now say *Allow all*; the driver is `scripts/shots-mode.js` (spec 025 FR-005, T006).

## v0.1.0-alpha.2 (draft pre-release, 2026-10-16)

Everything since [v0.1.0-alpha.1](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.1) (milestones 6 to 10 plus ownership). Spec: [023](specs/023-release-alpha2/spec.md). Built and tested on the simulator and unit tests; the real Copilot runtime was used only for small research captures (about 0.17 AIU) and free checks. **No AI credits were spent for the release itself.**

### Read this first

- **New app id: `io.github.three-feathers.agentdurbar`** (was `io.github.vikramgorla.agentdurbar`; spec 008 FR-019). The old test install is a **separate app**: it does not share settings, saved folders or tool counts with this one, and installing alpha.2 does not replace it. Remove the old one yourself if you do not want both.
- **Still unsigned and not notarized.** macOS: right-click (Control-click) the app, choose **Open**, or `xattr -dr com.apple.quarantine "/Applications/Agent Durbar.app"`. Windows: SmartScreen "More info", then "Run anyway". Linux: `chmod +x` the AppImage.
- No auto-update. Download newer releases by hand.

### What's new

- **MCP servers (specs 019, 020).** The **Copilot CLI's own list** (`~/.copilot/mcp-config.json` plus the built-in GitHub server) is read live and is the primary, global source in Settings and in the Tools view, with call counts and the exact command or URL (no env or header values). Nothing to import. Extra servers that only this app passes to a session are stored **per folder or workspace** (room-header MCP button) with a trust prompt that shows the exact command; secrets stay encrypted with the OS store. Servers from the CLI list get no trust prompt (decided by Vikram, 2026-10-16). The old app-level list and its Import buttons are gone.
- **Tool usage (specs 019, 020).** The Tools view has **This session** and **All time**. All time is kept on disk (`durbar-tool-usage.json` in the app's userData folder) and survives restarts: per tool, per MCP server, per agent. Only tool names, server names, agent labels and counts are stored; never arguments, output, prompts or paths. A second tab shows models and the context window used per agent. **Reset all-time counts** clears it.
- **Credit caps (spec 011).** Optional AI-credit cap per session (runtime minimum 30), set in the new-session dialog or from the chat header chip, with a global default in Settings. Cards and the chat header show used/cap; it is a **soft** cap (one response can overshoot). When reached: **Limit reached**, then Add credits / Remove cap / Stop here. `[UNVERIFIED]` against a real exhausted cap (it costs real money); covered by fixtures and the simulator.
- **Permissions (specs 003, 018).** Change an agent's mode (Read-only, Ask first, Allow all) any time. The saved mode of each folder is **restored exactly** after a restart, *Allow all* included, with a visible *restored* note until you change it; switching to Allow all still asks for confirmation. (The alpha.2 build itself still labels the last mode *Allow edits*; it was renamed *Allow all* on `main` right after, see Unreleased.) *Approve for this session* grants never survive a restart. Shell grants cover the **exact command** unless you explicitly choose "any arguments" (never for shells, interpreters, `sudo`, pipes or redirects). **Reads outside the folder** are asked (Ask) or denied (Read-only).
- **Three Feathers About (spec 008 FR-018).** The app names **Three Feathers** as owner and credits vikramgorla, fjcabello and rubenlupi (GitHub handles) in the OS About panel and Settings > About, `LICENSE` and the installer metadata.
- **Chat and office (specs 005 to 007, 015 to 017).** Full-screen chat with a slim agent strip, previous sessions per folder (resume, plus read-only VS Code chat history), new session per folder, model and reasoning-effort pickers, a Thinking timeline, nested sub-agent blocks, safe Markdown in chat, collapsible room doors, a layout that fits 15 agents at 1440x900 and 1280x800.
- **Safer packaging.** `DURBAR_*` developer hooks are ignored in packaged builds unless `DURBAR_DEV=1`. The Copilot SDK is pinned exactly (1.0.22).

### Honest limits

- **Unsigned, not notarized** (signing is spec 014, a draft that needs the maintainer's approval to buy certificates).
- **Untested on real Macs and Windows PCs.** CI builds the macOS and Windows packages and runs unit tests on all three OSes, but no one has launched them on real hardware. The macOS/Windows About panel and installer metadata were not looked at. Only Linux was run by hand.
- Needs a GitHub Copilot login (`copilot login`); usage bills against your own plan. Independent project, not affiliated with GitHub or Microsoft.
- Known gaps are listed per spec (`[KNOWN GAP]`) and under "Known limits" in the README.

## v0.1.0-alpha.1 (draft, never published)

First packaged build (milestone 5): office view, Copilot adapter, permission modes, attachments, unsigned dmg/zip, nsis/portable and AppImage through a draft pre-release. The draft stays in the repository's Releases list for the maintainer; it is not published.
