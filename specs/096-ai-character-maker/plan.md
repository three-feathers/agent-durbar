# Implementation Plan: AI character maker with animated characters (spec 096)

**Branch**: `096-ai-character-maker` (spec) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

Codex gets a new adapter capability, `imageGen`. It makes one 2x2 sheet (working, waiting, resting, blink) from a fixed style preset, a fixed layout block and the user's description inside a guard wrapper.
- **Main** reads the one expected file, checks its header bytes, and has a sandboxed hidden encoder window decode, slice, key out, resize and encode it to four 352x352 WebP frames. Main checks the frames again, holds them as a *try*, and saves them to `userData/characters/<id>/` on Save.
- **The renderer** reuses the theme maker's dialog parts, adds **My characters** as a Characters value, and registers the generated ids with `crew.js`, so the existing pick, crops, fallback and checks work unchanged.
- **Motion** is route (1): cross-fade, discrete bob, blink frame, typing cue, existing glow. It is paused by reduced motion, Serious mode, the Motion setting, a hidden window and idleness.

## Technical Context

- **Language**: TypeScript in main, adapters and shared code; plain JS in the renderer (no bundler), as today.
- **Dependencies**: **none new**.
  - Decode and encode use Chromium in a sandboxed window: `createImageBitmap`, `OffscreenCanvas.convertToBlob({type:'image/webp'})`.
  - The header checks are pure TS.
  - Considered and not chosen: `sharp` (native, a supply-chain and packaging cost on 3 OSes), a WASM WebP encoder (a new dependency to review), and Electron `nativeImage` (it decodes untrusted bytes in the privileged main process and cannot write WebP).
- **Storage**: `userData/characters/` (pictures and `character.json`); `durbar-settings.json` gains `characterPins` and `characterMotion`; the renderer keeps `durbar.crew.mine` in `localStorage`.
- **Testing**: Node unit tests (`tsconfig.scripts.json`), the fake Codex app-server, the simulator drivers (`until()` waits), and the 15-agent layout checks at 1440x900 and 1280x800.
- **Platforms**: Windows, macOS and Linux. Paths use `path.join`; the temp folder comes from `fs.mkdtemp(os.tmpdir())`.
- **Constraints**:
  - a frame is at most 40 KB and a character at most 160 KB;
  - a generation times out after 5 minutes and the encoder after 20 s;
  - at most 24 characters;
  - text is at least 10.5px;
  - motion adds at most 3 points of renderer CPU (recorded, not gated).

## Architecture

```
renderer (screens.js: maker dialog, manage rows; app.js: crew wiring, motion)
   │ preload: characterGenerate / Cancel / Save / List / Frames / Rename / Delete / Export / Pin / Ideas
   ▼
main  src/main/ipc/characters.ts ──► AdapterRouter.instance('codex').generateImage(prompt, {outName, timeoutMs, signal})
   │          │                                   │  (src/adapters/codex.ts: probe child, thread/start workspace-write in temp)
   │          │                                   ▼
   │          │                         <temp>/sheet.png  (lstat, regular file, ≤ 20 MB)
   │          ▼
   │   src/shared/imagecheck.ts (magic, header dimensions)
   │          ▼
   │   src/main/charencoder.ts ──► hidden sandboxed BrowserWindow (about:blank + fixed charencoder.html, .js; no preload Node)
   │          ◄── 4 x WebP bytes + face points
   │   src/shared/webpcheck.ts (RIFF/WEBP, 352x352, ≤ 40 KB, chunk allow-list, strip)
   │          ▼
   │   try held in memory (tryId) ──Save──► src/main/charstore.ts → userData/characters/<id>/
   ▼
renderer: blob: URLs from character:frames bytes → DurbarCrew.registerOwn(list) → crew kit <image href>
```

- **Main decides.** The renderer sends only the description, an adapter id, a tryId, a main-issued character id, a name, or a folder key it got from main. Main makes every id (`crypto.randomBytes`). No renderer string becomes a path.
- **Codex route.**
  - Route A, `codex app-server` (P1): mirrors `generateText`. A `probe` child, then `thread/start {cwd: temp, ephemeral: true, approvalPolicy: 'never', sandbox: 'workspace-write'}`, then `turn/start` with the prompt. It waits for `turn/completed` or the timeout; cancel closes the child.
  - Route B, `codex exec` (only if P1 fails): `[file, ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'workspace-write', '-C', temp, prompt]]` through the adapter's spawn function. Its stdout is read only for an error line.
  - Both use `codexSpawnPath` and `codexProfileArgs` for the install-folder rules (FR-138, FR-162). Main never reads `~/.codex`.

## Probes (real, on the owner's ChatGPT plan; only on his go; each says what it costs)

| # | Question | How | Cost |
|---|---|---|---|
| P1 | Does an app-server thread (`sandbox: 'workspace-write'`) get the image tool, and which `item/*` notification reports it (type, saved path)? | read `codex app-server generate-json-schema` first (free, no model call), then 1 real turn | 1 image |
| P2 | Do the user's MCP servers load in that child, and can they be turned off for it (`-c mcp_servers={}` or a profile)? | read the config docs and `codextoml.ts`; observe in P1 | 0 |
| P3 | Is "transparent background" honoured (PNG with alpha)? | P1's picture | 0 extra |
| P4 | Does a 2x2 sheet keep one person across 4 panels with clean gutters? Repeat 3 times with different descriptions | 3 turns; the owner looks at them | 3 images |
| P5 | Can a turn take a reference image (`input` item `localImage`) and keep the face (fallback of D2)? | 1 turn with P4's top-left panel | 1 image |
| P6 | Can `account/read` tell a ChatGPT login from an API key (FR-034)? Also: does a set `OPENAI_API_KEY` in the child's environment (kept by `codexChildEnv`) change which login Codex bills? | read the schema; spec 051 already calls `account/read` | 0 |
| P7 | Does Codex still write a copy under `~/.codex/generated_images/` with `--ephemeral` (route B) or an `ephemeral: true` thread (route A)? (FR-035) | list the folder's file names (not contents) before and after P1 | 0 extra |
| P8 | Does `workspace-write` without `network_access` block a shell command's network while the image call still works? (FR-002) | in P1's turn family, one extra turn asking for a network command, exit status only | 1 turn, no image |

Results go to `docs/agent-apps.md` (Codex) and this spec's `## Changes`, with `real:` evidence. Total: about 5 images (P7 and P8 add none) and 10 minutes of the owner's plan.

## Code paths reused (spec 021 FR-031; do not add parallel versions)

| Need | Reuse | Change |
|---|---|---|
| Short-lived Codex child, temp folder, cleanup | `CodexAdapter.probe`, `generateText`'s mkdtemp/rm pattern, `spawnChild`, `codexSpawnPath` | a new method `generateImage` next to `generateText` |
| Capability flag and contract test | `capabilities.ts` `oneShot`, contract C2 in `test:runtime` | add `imageGen` and C2-style pair |
| Dialog, idea chips, harness select, cost line, busy toast, error and retry dialog | `aiTheme()` in `screens.js` (`dialog`, `ideaHtml`/`pick`, `oneShotCostLine`, `X.toast`) | factor the chips and the harness picker into small helpers that both makers call; `oneShotCostLine` gains an `image` variant |
| Ideas | `pickIdeas` in `src/shared/themegen.ts` | move to a tiny shared helper or import; `CHARACTER_IDEAS` list |
| Pick, keep, prune, load | `crew.js` `pickCharacter`, `assignCrew`, `pruneCrew`, `loadCrew`, `storeKey`, `idsFor` | `registerOwn(list)` adds ids, face points and URLs; `idsFor('mine')`; nothing forked |
| Crops, seats, fallback | `viewBox`, `faceBox`, `FACE_CROP`, `CREW_BAD`, `crewPreload`, `crewRefreshAvatars` | `facePoint` looks up registered faces |
| Characters setting | `src/shared/characters.ts`, `theme.js` list, `settings:setCharacters`, `#chList` | append `mine`; kit `crew` |
| WebP chunk check | `scripts/test-crew-assets.ts` chunk reader | move to `src/shared/webpcheck.ts`, used by the test and main |
| Error masking | `redactMarkdown`, `maskHomePaths` (as history replay) | none |
| Folder key | `folderKeyOf`, `normaliseFolderKey` (`src/shared/usagedoc.ts`) | none |
| Usage line | Codex `account/rateLimits/read` (spec 051/068) | show the plan's window in the maker when it answers |
| Folder pick for export | `pickFolder` in `src/main/ipc/themes.ts` with `DURBAR_PICK` | lift to a shared helper |
| IPC guard | `ipcHandle`, `fromApp`, `test-ipcchannels.ts` | register the new channels as owner-only |
| Motion pause | `REDUCED`, `reducedMotion()`, `SERIOUS`, existing `@media (prefers-reduced-motion)` blocks | one `motionAllowed()` and a `body.motion-paused` class |
| Glow | spec 077 FR-053 halo, FR-062 glow | none |

## Data flow of one try

1. The renderer calls `character:generate(desc, 'codex')`.
2. Main validates the description (FR-011) and builds the prompt (`chargen.ts`).
3. Main calls `generateImage(prompt, {outName: 'sheet.png', timeoutMs: 300000, signal})`. The **adapter** makes `temp = mkdtemp('durbar-img-')` in the OS temp folder and returns `<temp>/sheet.png`; if it throws or is cancelled, the adapter removes `temp` itself.
4. Main checks the returned path (`sheet.png` directly in a real `durbar-img-*` folder of the OS temp folder; otherwise it refuses and removes nothing), then the file: `lstat`, regular file, at most 20 MB. It reads the bytes, **removes `temp`**, then runs `imagecheck` (magic, header width and height).
5. `encodeSheet(bytes, header)`: a new hidden window gets the bytes over a `MessagePort`, then sends back `{frames[4], face[4]}` or a refusal code. The window is destroyed. No text from the window is kept: `parseEncoderReply` takes these fields only, and main's `notes` is empty.
6. `parseEncoderReply` strips and checks each frame (`webpcheck`).
7. The try is held under a new `tryId`.
8. The reply to the window is `{ok, tryId, frames, face, notes, tookMs}`. The renderer shows the frames through `blob:` URLs.
9. On Save, `charstore.save(try, name)` writes the files to `<userData>/characters/.tmp-<rand>/`, renames the folder to `<id>/` and returns `{id, name}`.

## Risks and how the plan answers them

- **R1 Prompt injection into the image tool or Codex.**
  - The description is data inside a fixed wrapper, and the rules come before and after it.
  - The sandbox can write only the empty temp folder; approvals are `never` (any escalation is refused); there are no MCP servers (P2).
  - Main reads only the expected file name.
  - Unit tests feed hostile descriptions to the prompt builder; fake-app-server modes write extra files and links.
- **R2 Malicious or broken image bytes.**
  - The header checks are pure TS. Decoding happens only in a sandboxed renderer with no Node and no network, which is destroyed per job.
  - The output is re-checked and re-encoded, so metadata cannot survive.
  - Test fixtures: a polyglot PNG+ZIP, a huge `IHDR`, a truncated file, a WebP with EXIF and XMP chunks, a text file named `.png`.
- **R3 Showing user pictures within the CSP.**
  - The choice is `blob:` in `img-src` (FR-043). Blob URLs can only be made by our own script (`script-src 'self'`), and the markup stays small.
  - The alternative, `data:` URLs (already allowed), costs about 54 KB per desk string, and 15 desks x re-renders make the scene cache heavy.
  - The phase-3 PR measures both on the simulator (`check:office` time, heap) and keeps `data:` if the difference is small, so the CSP stays unchanged.
- **R4 Blur from animation** (agent note, spec 077 FR-051). The bob is a discrete `y` attribute, a repaint with no compositor layer. The typing keys use `fill-opacity`. The cross-fade uses `opacity` only for 250 ms. `check:crew` measures sharpness after it.
- **R5 CPU with 15 desks.**
  - One shared blink timer; the discrete bob repaints 3 times per 4.2 s per desk; only working and waiting desks move.
  - Motion pauses when hidden or idle (`svg.pauseAnimations()` on every office SVG, and a CSS class for keyframes).
  - The CPU delta is recorded by `check-charmotion`.
- **R6 Image tool unreliability** (sheets, transparency). D2 has fallbacks; probes P3-P5 decide which one ships, and a failed sheet asks to try again.
- **R7 Plan usage surprise.** Every try says "one picture from your ChatGPT plan's limits" before it starts. Try again asks the same. There is no automatic retry pass: unlike the theme maker, a second image is never made without a click.
- **R8 API-key login spends money** (P6). Fails safe (FR-034): until P6 every try asks a confirmation, after P6 an API-key login is refused; the README states it.
- **R9 Codex keeps its own copies** of each picture (FR-035, P7): a `[KNOWN GAP]`, no cleanup by Durbar; the dialog help and README say where.
- **R10 Codex environment** (FR-002, P2, P8): `codexChildEnv` unchanged, real `CODEX_HOME`, MCP off and network off to be proven by probes; `generateImage` is not enabled until P2 passes.
- **R11 Built-in crew motion**: Paco answered Q1b yes (2026-10-31); v1 animates My characters and the built-in crews, no blink for crews without eyes-closed frames (FR-062).

## Phases (one PR each; the spec PR is phase 0)

0. Spec, plan and tasks (this PR).
1. **Probes** P1-P8, owner's go given 2026-10-31 for P1-P6 (P7, P8 ride the same run), with results recorded (`docs/agent-apps.md`, spec `## Changes`). No `src/` change.
2. **Pure core**: `chargen.ts`, `charstyle.ts`, `imagecheck.ts`, `webpcheck.ts` (moved from the test), plus tests.
3. **Adapter and main**: `imageGen` capability, `CodexAdapter.generateImage`, fake app-server modes, `charencoder`, `charstore`, IPC, preload and types, pins, simulator fake.
4. **Window**: the maker dialog (shared helpers with the theme maker), My characters in the Characters setting, `registerOwn`, `blob:` URLs, manage rows; CSP decision R3; screenshots.
5. **Motion**: cross-fade, bob, blink, typing cue, pause rules, Motion setting, `check-charmotion`.
6. **Close-out**: README (features, *Safety model* line on Codex image generation, limits), the spec 077 `## Changes` line (FR-061), converge, a real run (SC-006) on the owner's go.

## Testing

- Unit tests: `test:chargen`, `test:imagecheck`, `test:charstore`, `test:charipc`, `test:runtime` (Codex `generateImage` on the fake and contract C2 `imageGen`), `test:crew` (registerOwn, `mine`, pins), and `test:characters` (the list has `mine`, `theme.js` and `characters.ts` equal). All are added to the `npm test` list.
- Drivers on the simulator:
  - `check-charmaker` (dialog, preview, save, manage, refusal, no adapter);
  - `check:crew` and `check:office` with `OFFICE_CHARACTERS=mine` at 1440x900 and 1280x800 and 15 agents (spec 077 FR-014 zones, faces, idle full colour);
  - `check-charmotion` (motion on, paused per FR-060, boxes over 8 sampled times per cycle, CPU recorded);
  - `shots:docs` gets the new pictures (`DOC_SHOTS`).
- Source tests:
  - no `nativeImage` decoding on the character path;
  - no description in a log call;
  - no `shell: true` or string `exec`;
  - the encoder window has `sandbox: true`, no preload with Node, and a session that cancels requests.
- `real:` P1-P8 and SC-006, only on the owner's go.

## Constitution Check

Passes. See spec.md *Constitution check*. No violations to track.
