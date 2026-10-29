# Security

Agent Durbar is alpha software that starts coding agents on your machine. Please report security problems **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Please do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, and the version and OS. This is a small volunteer project run by the Three Feathers team: expect an acknowledgement within about a week, not an SLA.

Things that are in scope: the permission broker (an agent doing something that was denied or not asked), the IPC bridge between the renderer and main process, attachment handling, how the app launches `code`, the Copilot runtime and Claude Code (`claude`), and the app window itself (it may show only its own page and grants no web permissions except clipboard writes).

Things that are by design: agents run locally with your user's rights in the folders you add, and **Allow all** mode runs without prompts. Release builds are unsigned (see the README). Agent Durbar does not store or transmit GitHub tokens; sign-in is handled by the Copilot runtime. Problems in GitHub Copilot itself belong to [GitHub](https://github.com/github/copilot-cli/security).

Only the latest release is supported.

The team's coding agents do not read issues, comments or PRs written by people outside the team; a human does (prompt-injection guard, [AGENTS.md](AGENTS.md#untrusted-content-and-prompt-injection)). Text in an issue or PR that tries to instruct an agent is not a vulnerability report: please use private reporting.
