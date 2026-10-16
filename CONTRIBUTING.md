# Contributing

Thanks for looking. This is an early alpha; small, focused pull requests are easiest to review. For anything bigger than a fix, open an issue first.

## Setup

```bash
npm ci
npm run build
npm test            # permission broker, attachment rules, VS Code launcher; no Copilot, no credits
DURBAR_SIM=15 npm start   # 15 simulated agents, no sessions, no AI credits
```

Node 20.19+ or 22.12+ is required. `npm start` with real sessions needs a GitHub Copilot login (`copilot login`) and spends your AI credits; prefer the simulator (`DURBAR_SIM`) and the tests while developing.

## Guidelines

- Keep it TypeScript (`src/main`, `src/adapters`, `src/shared`) and dependency-light; the renderer is plain HTML/CSS/JS.
- Anything that spawns a process must not use a shell with user-controlled strings.
- Never commit tokens, `.env` files, Copilot config or session data, or personal paths. Do not add code that stores credentials; sign-in belongs to the Copilot runtime.
- Add or update a test in `scripts/` when you change the permission broker, attachments or launcher logic.
- Run `npm run typecheck && npm test` before opening a PR; CI runs the same.

## Releases (maintainer)

Pushing a tag `v*` (for example `v0.1.0-alpha.1`) runs `.github/workflows/release.yml`, which builds unsigned macOS, Windows and Linux packages and attaches them to a **draft** pre-release. Review the draft, then publish it by hand. Builds are not signed or notarized and there is no auto-update.

## License

By contributing you agree that your contribution is licensed under the MIT license of this project.
