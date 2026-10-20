# Research: Continue a VS Code chat in Durbar (spec 056)

**Date**: 2026-10-20. Everything below is `read:` (code and specs read on `main` at `1aa8b3c`); nothing was run on a real VS Code store or a real agent session.

## R1 Which option (A, B, C)

- **Decision:** A (new session with the chat as its first, reviewed message). B (summarise first) parked by the owner (Q8, 2026-10-20: not built for now, no budget). C rejected.
- **Rationale:** A needs no model call to prepare, no vendor format and no writes; it reuses the reader (spec 009) and the New session + first-message flow (spec 030 FR-036). The user sees exactly what is sent.
- **Alternatives considered:**
  - **B, summarise first:** shorter first message, but every use spends a model call, and the summary can drop details. Kept as Phase 3 (FR-018) using `generateText` (spec 040 FR-015), which Copilot, Claude and Codex already expose (`oneShot: true` in `src/adapters/copilot.ts:123`, `claude.ts:63`, `codex.ts:57`).
  - **C, synthesise a Copilot CLI session in `~/.copilot/session-state` and resume it:** rejected. The session-state format is undocumented and changes between Copilot CLI versions; a hand-made session could break the CLI or be silently misread; and writing into another tool's data breaks constitution III ("Agent Durbar never reads, stores ... session data" beyond what the vendor runtime does itself) and the issue's own rule. It would also only work for Copilot.

## R2 What already exists (reuse)

| Need | Existing code | Notes |
| --- | --- | --- |
| List and read VS Code chats by opaque key | `src/main/main.ts:386-455` (`vschat:list`, `vschat:read`, `vsChatRefs`), `src/adapters/vscodeChat.ts:489` `listChats`, `:538` `readChat`, `:426` `toTranscript` | Renderer never sends a path (spec 009 FR-006). Caps: 64 MB file, 300 messages, 20,000 chars per text, 1.5 M per transcript (`vscodeChat.ts:25-30`). |
| Blocks to build turns from | `VsChatBlock` (`vscodeChat.ts:267`): `user` (text, attachment names, ts), `assistant`, `tool` (label), `note` | Edited files are only a label `Edited <name>` (`vscodeChat.ts:375-382`); a structured `file` field is missing (task T003). The matched store's folder is known in `findChatStores` (`:95-131`) but not kept on `ChatFileRef` (`:472`); missing (T003). |
| The view and the Previous sessions rows | `src/renderer/app.js:3626-3645` (`prevListsHtml`), `:3708-3730` (`viewVs`, bar with *Continue in VS Code*) | Banner text "It cannot be continued here." at `:3639` and `:3714` changes (FR-001). |
| New session dialog | `src/renderer/app.js:3274` `newSession(a0,o)`; IPC `agents:newSession` `src/main/main.ts:591` | Already handles ready kinds (`kindChoices`, `notReadyToast` `app.js:2937`), cap units, models, effort, Allow-all confirm. Preselects the folder's mode (`app.js:3289`); this feature always preselects Read-only (FR-003; owner, Q5). |
| Reviewed first message | `app.js:3337-3363` (summary branch) and `:3366` `reviewHandoff` (editable box, Cancel / Start, Escape) ; `sendLive(first, newId)` after `bridge.newSession` | Spec 030 FR-036. The review box is extended (turn list, estimate) rather than copied. |
| Secrets | `src/shared/redact.ts` `redact()` (pure, env + key patterns) | Used today for the debug log and harness setup only (`src/main/harnesssetup.ts:198`). Here it runs in main on the draft and on the final text (FR-010). |
| Ready apps and Settings link | `src/renderer/modelswitch.js` `kindChoices`, `showsKindPicker`; `window.DurbarScreens.openSettings('harnesses')` (`app.js:2944`, spec 051 FR-008) | Settings page is called *Agent apps* in the UI. |
| Cost units | `capUnit` in `src/adapters/capabilities.ts:29` (`aiu` default, `usd` for Claude `claude.ts:57`); `estimateInputCredits` in `src/renderer/modelswitch.js:62` | `estimateInputCredits` returns nothing for unverified prices; every Copilot price is `unverified: true` (`src/adapters/copilotmodel.ts:33-44`). Claude and Codex report no prices. So no pre-send cost figure is trustworthy today (FR-014). |
| Simple mode | `body.simple` rules `src/renderer/styles.css:1098-1100`; spec 052 FR-031, FR-081 | VS Code chat history stays visible in Simple; token counts are hidden there. |
| Simulator | `src/renderer/sim.ts:1536-1556` canned `listVsChats`/`readVsChat` (agent `~/work/mcp-swiss`) | Needs canned `vschatDraft` / `vschatFinalize` (T014). |

## R3 Token estimate

- **Decision:** `ceil(characters / 4)`, labelled "estimate" everywhere; the same formula in main (authoritative, for the cap and the default selection) and in the renderer (live counter while typing; one line).
- **Rationale:** no tokenizer dependency (constitution: dependency-light), same for every app, cheap. Real tokenizers differ per vendor and model.
- **Alternatives:** a vendor tokenizer package per app (new dependencies, still model-specific); asking the runtime (not available without a model call for Claude and Codex).
- **Known weakness:** under-counts for CJK text and some code; mitigated by the label and by checking against half the model window (FR-008).

## R4 The cap and the default selection

- **Decision:** a fixed 30,000 estimated tokens in code, revisited after real use (owner, Q1; about 120,000 characters); newest turns first until the next one would pass the cap; a lone oversized turn is cut to fit; per-text cut at 8,000 characters; at most 20 tool lines per turn; at most 30 file names in the header.
- **Rationale:** 30k is the owner's suggestion, fits comfortably in the windows Durbar sees (Claude reports 1,000,000 for Sonnet 5.5, spec 030; Copilot and Codex models are typically 128k or more, not verified per model), and keeps the first message's cost bounded. Newest turns carry the current state of the work.
- **Alternatives:** first and last turns (keeps the goal, but splits the story; can be done by hand with the picker); a summary (option B).

## R5 Where the draft is built

- **Decision:** in the main process, in a pure module `src/shared/chatcontext.ts` (no Node imports, so the main process and `scripts/test-chatcontext.ts` share it), called by new IPC `vschat:draft`; a second IPC `vschat:finalize` redacts the edited text again.
- **Rationale:** the chat file is only read in main (constitution III: untrusted files parsed in main, opaque keys over IPC); `redact()` is a TS module the plain-script renderer cannot import; one implementation of trimming and selection.
- **Alternatives:** build in the renderer from `readVsChat`'s transcript (duplicates logic in a plain script, and the renderer would see unredacted text first).

## R6 The second redaction

- **Decision:** on Start, main redacts the final text; if it changed, it returns the masked text and the renderer shows it again; nothing is started or sent.
- **Rationale:** the owner asked for redaction before display **and** before sending; showing the change keeps "the user sees exactly what is sent". `redact()` may over-mask (it is tuned to be safe); the user sees that before sending.
- **Note:** the renderer could skip this call, but a compromised renderer can already send any text with `agents:send`; the check protects the honest path (a pasted token), not against a hostile renderer.

## R7 Option B later

- `generateText(prompt, opts)` (`src/adapters/types.ts:440`) runs one prompt with no tools and no saved session on all three apps (spec 040 FR-015). A summary prompt like `HANDOFF_PROMPT` and `cleanSummary` (`src/adapters/handoff.ts`) can be reused with the selected turns as input. Each use is a model call. **Parked** by the owner (Q8, 2026-10-20): not built for now, no budget.

## R8 Sign-in before the first message (review note on PR #347)

- **Decision:** use the sign-in state from spec 012 FR-156 in the options step and the FR-157 chat sign-in card after an auth refusal; keep the whole reviewed text in the flow's memory until the first message is accepted.
- **Rationale:** without it a *Not signed in* app would fail on the first message after the user spent time reviewing it. The FR-157 prompt memory (`src/renderer/signin.js:9`, `MAX_TEXT = 100000`) cuts longer prompts, and a draft near the 30,000-token cap (about 120,000 characters) can be longer, so relying on it alone could resend a cut text.
- **Alternatives:** lower the cap to fit 100,000 characters (changes the owner's Q1 answer); raise `MAX_TEXT` for everyone (more memory for every session, for one flow).

## R9 Owner answers (2026-10-20)

Q1 (a), Q2 (a), Q3 (a), Q4 (a), Q5 (a), Q6 (a), Q7 (a), Q8 parked, Q9 (a). The wording of each is in the spec's *Clarifications*.
