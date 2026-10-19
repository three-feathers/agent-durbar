# Checklist: live verification (spec 013 FR-001)

Run 2026-10-19 on Linux, in the real app driven by script (`DURBAR_DRIVER`, real Copilot session, the account's only model `auto`).
Approval (FR-002): the owner's standing instruction in the session of 2026-10-18: "consider that we have claude installed here and we can test it with claude and it is ok to spend tokens - no need to wait for me or someone to approve if you have tested things and they are good". Budget set by the agent: at most 12 prompts, about 3 AIU.

| # | Check | Expected | Prompts | Closes |
|---|---|---|---|---|
| C1 | Stop mid-turn (US1.1) | turn ends within a few seconds; agent idle with the note; next message works in the same session | 2 | 005 FR-013, 002 interrupt |
| C2 | Second message while a turn runs (US1.4) | record what happens (queued, steered, error) | 1 | 005 FR-012, T021 |
| C3 | End, then resume from Previous sessions (US1.2) | the conversation continues with context (recalls a word) | 2 | 006 FR-009 |
| C4 | Lazily restored folder (US1.3) | after a restart nothing starts until the first message; then the session starts and answers | 1 | 006 lazy start |
| C5 | Thinking (US2.1) | thinking streams and collapses, or the "no reasoning" note shows | (in C1-C4) | 005 |
| C6 | Sub-agent (US2.2) | helper tiles appear and finish; events recorded | 1 | 002 FR-013 |
| C7 | Usage event (US2.3) | `nanoAiu` present, AIU = nanoAiu / 1e9 | (in C1-C6) | 011 |
| C8 | Several models, effort (US3.1) | | 0 | not possible: the account offers only `auto` (007, recorded) |
| C9 | Tiny cap (US3.2) | | 0 | not possible cheaply: the minimum cap is 30 AIU (011, recorded) |
| C10 | VS Code visibility, packaged app on macOS/Windows (US4) | | 0 | not possible on this box: no VS Code, Linux only (009, 008, recorded) |
