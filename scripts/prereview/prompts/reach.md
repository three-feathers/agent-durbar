Pass 1, reach and state.

Where does this change not reach? For each function, rule, flag or class the diff changes, find every caller and every other path that should have the same change, and read them. The paths that matter here: the flat office and Real office; office and List views; floors on and off; Simple and Expert; demo, simulator and real adapters (Copilot, Claude Code, Codex); keyboard and screen reader as well as mouse (name, role, focus, live region); reduced motion; Windows and macOS as well as Linux.

Then what state does it leave? Follow each new or changed piece of state through start, resume, close, error, empty, cancel and reopen. Look for state that outlives what made it, a cache the change has made stale, an order of events that was safe before and is not now, and something that used to work on the path this PR did not touch.

For each finding give the changed line, the line of the path it misses, and the sequence of steps that shows the failure. Use kind `reach` or `state`.
