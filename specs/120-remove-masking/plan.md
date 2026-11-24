# Implementation Plan: Remove masking as app functionality (spec 120, proposal)

**Branch**: `120-remove-masking` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Proposal.** This plan applies only if the three owners choose option C in writing. Until then nothing in it is built.

## Summary

First make the five places that keep or send agent text carry none (stage 1: the activity log rows, main's stderr lines, the `DURBAR_LOG` debug log, the Durbar MCP read tools, the loop pace reason in `schedules.json`), proven by planted-marker tests, one per sink with its own mutant (unit tests for main-side sinks, a fake transport for adapter stderr, a window driver for the screen). The Undo copies wait for Q45. Only then delete the masks, outside in: the window (stage 2), main's shown text (stage 3), the shared library and its tests (stage 4), then docs and spec deltas (stage 5). Each stage is one PR; each keeps `npm test` green and the marker test passing.

## Technical context

- Masks: `src/shared/redact.ts` (3,681 lines), `src/renderer/safetext.js`, `src/main/mcpmask.ts`, `convmask.ts`, `activitymask.ts`; 156 call lines in 51 files (spec section 2.1).
- Sinks to change in stage 1: `src/main/main.ts` `logActivity` and the debug sink, `src/shared/activity.ts`, `src/main/activitystore.ts`, `src/main/ipcerror.ts` `failText`, `src/main/mcp/readtools.ts`, `src/main/mcpglobal.ts`, `src/shared/looppace.ts`, `src/main/schedules.ts`, `src/main/loopwiring.ts`; the adapters' exit handlers' debug lines (`claude.ts`, `codex.ts`).
- Kept helpers moved in stage 4: `cut`, `unhide`, `HIDDEN_CHARS`, `shQuote`, `shellWords`, `parseFlag`, `hasShellJoin`, `secretFlag`, `envVarName` to one small shared text module, imports updated.
- Tests: `scripts/run-tests.js`, `scripts/test-suites.txt`. The window simulator (`DURBAR_SIM`) never reaches main and the scheduler does not start under it, so main-side sinks are tested by unit tests on each store or function with an injected folder or captured console, the adapters' stderr by a fake transport, and the screen by one Electron driver; `DURBAR_SIM_MAIN` (`src/main/mcp/simmain.ts`) adds an end-to-end pass where it reaches (not checked).
- No new dependency, no network, no shell, no AI credits.

## Constitution check

| Principle | How the plan holds it |
|---|---|
| I Spec Kit | This PR is spec, plan, tasks only, as a proposal. Each stage PR ticks its tasks; specs 012, 041, 052, 084, 105 get dated deltas in stage 5. |
| II Adapters | Adapters only lose mask calls and their debug lines lose text; no Copilot types move. |
| **III Safe by default, no secrets** | **Option C changes how principle III is met and needs the amendment of spec section 4 (MINOR as proposed, 1.2.0 to 1.3.0; MAJOR if the owners read the rewording as a redefinition) before stage 1 merges.** Two sentences of principle III are already untrue today (saved state holds more than paths and choices; Durbar keeps MCP secret values encrypted and its own connection key); the amendment rewords them to what Durbar does. "No telemetry" stays; the amendment adds that the window shows agent output as sent and that Durbar puts no agent output into logs, saved state or anything that leaves the machine except by an explicit user action. Stage 1 makes that true in code and the planted-marker test keeps it true. Without the amendment, C would contradict how the principle has been read since spec 012, so no stage may start before it. |
| IV No AI credits | Simulator and unit tests only. |
| V Calm UI | Nothing new on screen; fewer `[redacted]` words. |
| VI Parity | No path or shell change; the marker test runs in `npm test` on all three OSes. |
| VII Quality gates | The marker tests are written first in stage 1; each sink has its own mutant that writes the marker into it and must fail at that sink's own assert. |
| VIII Honest limits | OS handling of stderr, screen sharing, the Undo copies (Q45) and what `DURBAR_SIM_MAIN` reaches are written as limits (spec section 6). The two published advisories are not about masking; their structural fixes and tests stay (FR-452). |

## Design decisions

- **D1 Structure, not text checks.** A sink that must not hold agent text gets fields that cannot hold it (kind, name, id, length, code), so no pattern list is needed and nothing has to be reviewed for shapes.
- **D2 The marker is invented at run time** (random body, no committed shape), so the test names no secret format and needs no list.
- **D3 Outside in.** Logs and saved state first (the part that makes removal safe), then window, then main, then the library: at every stage the remaining masks still cover whatever has not been changed yet.
- **D4 Old activity rows** lose their stored action text on first read after stage 1, so no old masked text stays.

## Complexity tracking

None.
