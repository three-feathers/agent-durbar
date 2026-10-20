# Quickstart: check Continue in Durbar without credits (spec 056)

No real agent session, no `npm run smoke`, no `scripts/capture-raw.ts`. Simulator and unit tests only.

## Unit tests

```bash
npm run typecheck && npm run build && npm test
npm test -- chatcontext vscodechat modelswitch   # only the suites this feature touches
```

- `test:chatcontext` (new, `scripts/test-chatcontext.ts`): turns, cuts, placeholders, the default selection under the cap, explicit selections, the half-window check, redaction of planted tokens in the draft and in finalize, the storage left unchanged.
- `test:vscodechat`: the matched folder on `ChatFileRef` and `file` on edited-file tool blocks.
- `test:modelswitch`: `contextCostLine` for AIU, dollars, tokens, unverified and missing prices, Simple wording.

## Simulator (manual)

```bash
DURBAR_SIM=15 npm start
```

1. Open the `mcp-swiss` agent's chat, then **Previous** > VS Code chat history > **View** on "Explain the registry design".
2. Press **Continue in Durbar…**: check the app picker (ready apps only), Read-only preselected; press **Next: review the message**.
3. In the review box: the header, the warning that older turns were left out, the turn list, the estimate line (switch Simple/Expert from the command palette and look again).
4. Edit the text, press **Start new session**: a new sim agent opens in the same room; its first user message is the edited text, with the "Started from a copy…" note.
5. Repeat and press **Cancel** and **Escape** at each step: no new agent appears.

## Screenshots

```bash
npm run build && node scripts/shots-056-continue.js   # prints [056] PASS; writes docs/screenshots/056-continue-*.png at 1440x900 and 1280x800
npm run check:office                                   # 15 agents still fit at both sizes
```

## Not covered here (real checks, owner's go-ahead)

A real VS Code chat store on this machine (read only) and one tiny Read-only first message on one ready app: see task T070 in [tasks.md](tasks.md).
