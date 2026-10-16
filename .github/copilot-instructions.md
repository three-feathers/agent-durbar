# Copilot instructions for Agent Durbar

This repo is spec-driven with GitHub Spec Kit. The full rules for coding agents are in [AGENTS.md](../AGENTS.md); the project rules are in [.specify/memory/constitution.md](../.specify/memory/constitution.md). Summary:

- **Start with `/speckit.*`, not with code.** New behavior: `/speckit.specify`, `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.analyze`, then `/speckit.implement`, then `/speckit.converge`. Bug fix or change to something built: add a dated spec delta under `## Changes` in the owning `specs/NNN-name/spec.md` first. Do not edit `src/` before the spec, plan and tasks are committed.
- Ask when something is ambiguous (`/speckit.clarify`); do not guess requirements.
- Adapters are plug-ins behind `AgentAdapter`; no Copilot types in the renderer or `src/shared`.
- Safe by default: read-only permission mode by default; never store or log tokens, `.env`, Copilot config or session data; no shell with user-controlled strings.
- Never spend AI credits in tests: use the simulator (`DURBAR_SIM=15 npm start`) and `npm test`. Do not run `npm run smoke` or `scripts/capture-raw.ts` unless asked.
- UI: text at least 10.5px; 15 agents fit on 1440x900 and 1280x800 without overlap.
- Windows, macOS and Linux must all work; no POSIX-only assumptions.
- Be honest about limits: mark what you did not verify (`[KNOWN GAP]`, `read:`); never claim an untested platform or feature.
- Before finishing: `npm run typecheck && npm run build && npm test`, screenshots for UI changes, and fill in the pull request template.
