# Implementation Plan: Remove masking as app functionality (spec 120, proposal)

**Branch**: `120-remove-masking` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Proposal.** This plan applies only if the three owners choose option C in writing. Until then nothing in it is built.

## Summary

First make every place that keeps or sends agent text carry none (stage 1: the activity log row, main's stderr lines, the `DURBAR_LOG` debug log, the Durbar MCP read tools), proven by a planted-marker test in the simulator. Only then delete the masks, outside in: the window (stage 2), main's shown text (stage 3), the shared library and its tests (stage 4), then docs and spec deltas (stage 5). Each stage is one PR; each keeps `npm test` green and the marker test passing.

## Technical context

- Masks: `src/shared/redact.ts` (3,681 lines), `src/renderer/safetext.js`, `src/main/mcpmask.ts`, `convmask.ts`, `activitymask.ts`; 156 call lines in 51 files (spec section 2.1).
- Sinks to change in stage 1: `src/main/main.ts` `logActivity` and the debug sink, `src/shared/activity.ts`, `src/main/activitystore.ts`, `src/main/ipcerror.ts` `failText`, `src/main/mcp/readtools.ts`, `src/main/mcpglobal.ts`.
- Kept helpers moved in stage 4: `cut`, `unhide`, `HIDDEN_CHARS`, `shQuote`, `shellWords`, `parseFlag`, `hasShellJoin`, `secretFlag`, `envVarName` to one small shared text module, imports updated.
- Tests: `scripts/run-tests.js`, `scripts/test-suites.txt`; the marker test runs the simulator in Node where it can (main-side stores with an injected folder) and one Electron driver for the window side (`el.sh` on the team's box).
- No new dependency, no network, no shell, no AI credits.

## Constitution check

| Principle | How the plan holds it |
|---|---|
| I Spec Kit | This PR is spec, plan, tasks only, as a proposal. Each stage PR ticks its tasks; specs 012, 041, 052, 084, 105 get dated deltas in stage 5. |
| II Adapters | Adapters only lose mask calls and their debug lines lose text; no Copilot types move. |
| **III Safe by default, no secrets** | **Option C changes how principle III is met and needs the amendment of spec section 4 (MINOR, 1.2.0 to 1.3.0) before stage 1 merges.** The principle's words ("never reads, stores, logs or transmits tokens or credentials", "No telemetry") stay; the amendment adds that the window shows agent output as sent and that Durbar puts no agent output into logs, saved state or anything that leaves the machine except by an explicit user action. Stage 1 makes that true in code and the planted-marker test keeps it true. Without the amendment, C would contradict how the principle has been read since spec 012, so no stage may start before it. |
| IV No AI credits | Simulator and unit tests only. |
| V Calm UI | Nothing new on screen; fewer `[redacted]` words. |
| VI Parity | No path or shell change; the marker test runs in `npm test` on all three OSes. |
| VII Quality gates | The marker test is written first in stage 1 and must fail on today's `DURBAR_LOG` debug log run without its mask (a planted mutant), then pass after the change. |
| VIII Honest limits | The advisories' fixes, OS handling of stderr and screen sharing are written as limits (spec section 6). |

## Design decisions

- **D1 Structure, not text checks.** A sink that must not hold agent text gets fields that cannot hold it (kind, name, id, length, code), so no pattern list is needed and nothing has to be reviewed for shapes.
- **D2 The marker is invented at run time** (random body, no committed shape), so the test names no secret format and needs no list.
- **D3 Outside in.** Logs and saved state first (the part that makes removal safe), then window, then main, then the library: at every stage the remaining masks still cover whatever has not been changed yet.
- **D4 Old activity rows** lose their stored action text on first read after stage 1, so no old masked text stays.

## Complexity tracking

None.
