- **The "/" list masks token shapes** (spec 073 FR-012/FR-013, issue #608, security): a skill, command or prompt file whose name,
  description, argument hint or path holds a token shape (`ghp_…`, `github_pat_…`, `sk-…`, also split by Markdown) no longer shows it
  in the list, its tooltips, the screen-reader read-out or the "Sent the text of" note; main masks before it cuts, so no half token
  survives a cut. Checked with `test:slashcommands` and `check:slash-suggest` (simulator), mutation-checked.
- **The chat's "Send failed" note masks token shapes** (spec 041 FR-065, T070): an agent app's refusal that holds a token shape
  shows it as `[redacted]`. Checked with `check:done-desk-mask` (`simsendfail=secret`), mutation-checked.
