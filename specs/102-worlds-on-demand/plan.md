# Implementation Plan: Worlds on demand (spec 102)

**Branch**: `102-worlds` (spec) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

A world pack becomes a validated, code-free data file that can arrive from outside the app. One validator (`src/shared/worldpack.ts`, `worldzip.ts`) sits behind four entrances: download (project source with hashes pinned in the app; an organisation's or person's source, signed or first-seen), upload, generation and import. Main owns network, disk and decisions; a sandboxed encoder window decodes hostile pictures; the renderer gets bytes by key and part name, through the 097 world seam. Worlds and character sets are two flat lists of separate packs; project art is under `worlds/<id>/` and sets under `sets/<id>/`, outside the app except the shipped worlds and their sets (FR-213). They wait for the 097 FR-179 gate.

## Technical Context

- **Language**: TypeScript in `src/main`, `src/shared`; plain JS in the renderer; plain Node for scripts.
- **Dependencies**: none new. Node `crypto` (SHA-256, Ed25519), `zlib` (`inflateRawSync` with `maxOutputLength`); Electron `net.request` through `netget.ts`.
- **Storage**: `userData/worlds/<key>/`; `worlds/catalogue.json` and `worlds/<id>/` in the repo; `durbar.world` in `localStorage` (097 FR-114).
- **Testing**: Node tests with fixtures and an injected request layer; simulator drivers through `ui-suite.js`; world matrix (098).
- **Performance**: 097 FR-178's rows (op rows asserted, times recorded). Hash re-check of a few MB at load is async.
- **Constraints**: no network in `npm test`; no AI credits; 10 MB a pack; three OSes (a closed list of names means Windows rules are tested on every OS).
- **Scale**: a handful of project worlds, at most 64 installed and 500 MB; about 15 source pictures per world (estimate).

## Constitution check

Passes; see the spec's section. No Complexity Tracking row. New surface to watch: first user-started content download (III), handled by D1, D2, D6.

## Research decisions

Facts below were read in the repo or checked on 2026-10-31; the web sources are named in the spec.

| # | Question | Decision | Why | Alternatives rejected |
|---|---|---|---|---|
| R1 | Archive or file by file? | One zip per pack over HTTPS | One hash, one progress bar, atomic; the reader must exist for uploads anyway | Per-file from `raw.githubusercontent.com` at a commit: no redirect and no zip on that path, but about 30 requests and more ways to half fail. Kept as the fallback if OP-2 is refused |
| R2 | Zip library or own reader? | Own small reader and stored-only writer | Constitution: dependency-light; the needed subset is tiny and strict, so anything odd is refused rather than handled | A package adds supply-chain surface and accepts more than we want |
| R3 | How does the renderer get bytes? | `blob:` from IPC (096 FR-043) | Already specified, CSP change minimal, revocable | Custom protocol or `file:`: a wider door, a new CSP word; `data:`: markup weight at many desks (096 R3) |
| R4 | Where does the decoder run? | Encoder window (096 FR-022) for every entrance | Image decoders have had remote-code bugs; this window has no bridge of value and no network | `sharp` or native: a new native dependency; decoding in the office window: the bug would have the app's bridge |
| R5 | Sign the project's catalogue? | No: pinned hashes in the app (OP-1) | No secret to guard; daily releases give a new world within a day | Signed online catalogue: a key, a secret, rollback handling for the main path |
| R6 | Signature for others? | Ed25519, detached, Node `crypto`, sequence number | Small keys people can paste into a policy; no CA | X.509/CMS: heavy; minisign format: a parser for little gain. 076 FR-178's `signing.publicKeys` is the same idea: when built, source records may name a key from it |
| R7 | How many pictures for a world? | One back-wall sheet cut to fixtures, plus parts | The mockup did this, and it keeps fixtures in one light and style | One image per fixture: about 18 images and mismatched looks |
| R8 | How do we enforce FR-179 in a test? | `test:world-catalogue` reads the T156..T159 ticks | Cheap and impossible to forget; 098 style (tests, not rule text) | A rule in text only |
| R9 | Anchors in hand-made packs | Computed from alpha, shown in the report | People cannot be asked for fractions | An anchor editor: later, `[KNOWN GAP]` |
| R12 | A person's source, with no key? | `first-seen`: remember, show every change, full validator | A hash cannot be pinned for an address the app has never seen; requiring a key would stop most sharing | Refuse without a key (too strict for the owner's decision); trust the host (no) |
| R11 | Can "substantially different" be tested? | Partly: card, hashes, colours, and a person's look at thumbnails | A machine can prove a copy and a same-material claim, not a look | Only a person: slow, no record; only thresholds: passes two worlds that merely look alike |
| R10 | People in a world | Separate set packs, one default per world | Owner's decision; a world pack stays near 2.5 MB, and sets are shareable alone | People per world, or families of world and crew: rejected by the owner |

## Architecture

```
 renderer (Settings > World, dialogs: tool surface, tokens only)
   | world:* IPC (ipcHandle, fromApp; keys and part names only; never a URL or path)
 main
   worlds/store.ts       userData/worlds, temp then rename, installed.json, caps, re-check at load
   worlds/sources.ts     source list, catalogue (pinned or signed), policy view
   worlds/download.ts    notice token -> makeDownloadGet -> per-hop host check -> hash
   worlds/job.ts         upload, generate, try lifecycle; one job at a time
   worlds/policy.ts      FR-114's small reader -> worldsPolicyFrom(layers)
   encoder window        096 FR-022 (no Node, no network); decode, re-encode, alpha anchors
 shared (pure, no I/O; also used by scripts)
   worldzip.ts           read and write the strict subset
   worldpack.ts          closed part list, manifest, caps, anchors, tokens via themes.ts/themegen.ts
   worldmoments.ts       moment-to-parts map, momentCoverage()
   worldprompts.ts       prompts per part (exclusion clause), wrapper for a description
   worldsource.ts        hop rules, Ed25519 verify inputs, catalogue parser, worldsPolicyFrom
 repo
   worlds/catalogue.json  copied into the app; worlds/<id>/ {world.json, parts, card.json, ASSETS.md} not copied
   scripts/world-pack.js  reproducible zip
```

**The notice is enforced in main.** `world:download` takes a one-use token that main issued when it composed the notice (key, URL, size, host), valid for 5 minutes on a monotonic clock. No token means no request, so the renderer alone cannot start a silent download.

**Download flow**: list -> notice token -> click -> `makeDownloadGet` per hop with host check -> length and SHA-256 -> zip -> `worldpack` -> encoder -> part hashes -> temp folder -> rename -> `installed.json` -> world offered.

**Windows in the engine.** `realLayout` (097) gives fixtures by the world's arrangement; a new pure step `placeWindows(fixtures, band, picks)` returns band-height rects in the wall areas between fixture boxes and is called after them, never feeding back. A test compares every rect with and without it and checks height and no intersection.

**Telling worlds apart.** Three layers, cheapest first: `card.json` per world, compared before any image run (`test:world-catalogue`); picture checks in `check-world-distinct.js` (exact hash, perceptual hash of fixtures, average colour of wall, floor, desk), which decode in Electron because Node has no WebP decoder; the thumbnail contact sheet read by a person, which decides. In the app the same picture comparison only warns (FR-018), in the encoder window.

**A source's label comes only from main.** Main stores origin and source when it stores a world, and sends the words the UI shows. Nothing in a pack or catalogue reaches that field, so a pack cannot claim to be ours by construction, not by a filter.

**Registry.** `docs/experience/world-moments.json` gets one row per downloadable world (`pack: worlds/<id>`, `crews: []`, `shippable: false`), and every moment gets a cell (098 FR-011). Own worlds never enter the registry; for them `momentCoverage` is the check.

**World matrix.** The driver mounts a pack from `worlds/<id>` by a dev hook in the simulator (same `world:part` shape), with no network.

## Code paths reused (spec 021 FR-031)

The spec's *Context* table is the list. Changes to reused code:

| Reused | Change |
|---|---|
| `makeDownloadGet` | error wording as an option; contract unchanged for the installer |
| `pickFolder` (`ipc/themes.ts`) | lifted to a shared helper; add a file picker with `DURBAR_PICK` |
| `UserThemeStore` pattern | not subclassed; `worlds/store.ts` copies its temp-rename approach, and `SAFE_FILE`'s idea becomes the closed list |
| `aiTheme()` parts | chips, harness select, cost line factored as 096's plan says; the try bar reused as is |
| Encoder window (096) | job takes `[{ part, width, height, quality, keepAlpha, measureAlpha }]` |
| `contrastFix`, `themeIssues`, `checkUserManifest` | called on a pack's tokens; `contrastFix` in the renderer as today, `themeIssues` in main |
| `requireOsSandboxFrom` pattern | new `worldsPolicyFrom`; the reader slice can later serve `updatePolicy()` and `requireOsSandbox()` |
| `test:realoffice-assets` | a sibling for `worlds/<id>/ASSETS.md` |
| `check-office-ops`, `check:office`, `world-matrix.js` | a world id or fixture pack parameter |

## Phases (one PR each)

- **P0** this spec.
- **P1 Format and validator** (no UI, no network): `worldzip`, `worldpack`, `worldmoments`, `worldprompts`, fixtures. Depends on 098's block test or builds that piece.
- **P2 Store, seam, windows**: `worlds/store.ts`, `world:list`, `world:part`, World row, fixture world in the simulator, `placeWindows`. Depends on #921.
- **P3 Download**: catalogue, sources, notice, policy slice, dialog. All downloadable worlds `coming`.
- **P4 Picture worlds**: one PR per world or small batch (art, `ASSETS.md`, registry row), `coming` to `available` only through the gate (FR-035). Needs #936 built.
- **P5 Hand path** (when the app cannot generate images): prompt pack, upload, report, try, save, export.
- **P6 In-app** (first-class): needs 096's pipeline and probes; retires the theme maker in the same PR.
- **P8 Character sets**: format, `peopleFor`, rows, migration, store; art per set. Replaces 097's seams through T002.
- **P7 Other sources and sharing**: signature, sequence, policy `worlds.sources`, a person's **Add a source…**, remembered hashes, source labels, look-alikes, sharing. Split if large; the adversarial set lands with the first source.

P1 to P3 may merge before the gate with nothing visible as available; P4 to P6 reach a release only after it. P5 and P6 land as ready (OP-7). Removals are their own PRs (spec 035, 040, 017); spec 040's maker removal goes with P6 so AI creation is never absent.

## Risks

- **#936 first**: FR-179 and T156..T159 exist only on that branch. T036 and every `available` row wait for it to merge; the test treats a missing task as not met.
- **Spec 096 not built**: P5 needs the encoder, `imagecheck.ts` and `webpcheck.ts`. P5 builds them to 096's words and 096 then reuses them.
- **Daily releases carry the catalogue**: a mis-typed hash breaks one world for one day; `test:world-catalogue` and T043's check catch it first.
- **Hand-made quality**: anchors from alpha may misplace a visitor; the report and Try it show it; 097 FR-117's check runs on the try (`[KNOWN GAP]` for odd art).
- **Weekly matrix growth** with each picture world; shard per world.
- **Art backlog**: crews to full poses, Retro pixel people and each new world are much art; each gate in FR-035 keeps them from shipping half done, and `coming` keeps the list honest.
- **Repo growth** from art (OP-3); about 2.5 MB per world version, and redos count.
- **App size**: about 22.6 MB of shipped art, then about 26.8 MB with Retro game (estimates, FR-213); the 30 MB budget test stops growth.

## Monitor and arrangements (FR-220..FR-236)

**Reuse (spec 021 FR-031).** `realLayout`, `FX_POSE`, the `Layout`, `ZoneBox` and `DeskBox` types (`src/shared/realoffice-layout.ts`, #921); `test:realoffice-layout`; `check-office-ops`, `check:office`, `world-matrix.js`; `worldpack.ts` and `test:worldpack` (FR-050, one validator); `ro-bezel` as the monitor's fallback; FR-061's lazy load in 097; `DurbarReorder` and the model's order (#987).

**Looked at and not reused: `chooseLayout` and the room-by-room search (#984).** The brief named them, but they are the flat office's: DOM probes, densities, wrapping rooms. A world's office never runs them (097 keeps its own pure engine, "a Real office start, with no search"). An arrangement in that code would add a DOM search to a path that has none. FR-233 records this; no interplay beyond the shared gate.

```text
world.json  arrangement: "circle"
   -> worldpack.ts          id in ARRANGEMENTS, focus.webp present
   -> realoffice.js         rows? call as today. Otherwise load realoffice-arrangements once
   -> realLayout(model, view, meta, signs, arrangement)
        rows                exactly today's path
        other, project      that layout, at every count up to 15
        other, shared pack  arrangementFits -> fit: that layout; no fit: rows, Layout.arrangement = "rows"
   -> realoffice.js         same drawing, plus focus at Layout.focus when present
```

- **`circle`:** split the floor round a centre `focus` rectangle, pack zones into left, top, right bands with the existing row maths per band, `u` the largest that fits, by bisection like FR-011. Bounded search: FR-019's 5 ms, fall-back attempt included.
- **`facing-view`:** rows on a floor shortened by the `focus` band; the least code, since it calls the row path.
- **`flanking`:** two desk blocks either side of a central aisle; fixtures in the aisle. **`aisles`:** staggered angled aisles, geometry open until the owner approves the mockup.
- **Few agents:** each arrangement grows its screens inside itself at 4 or fewer (FR-230), so 097 FR-020's one shared row applies to `rows` only.
- **Monitor in the engine:** `meta` gains an optional `monitor: {w, h, screenRect}`. Absent: today's `screen` and `glass`, byte for byte. A rows world with a monitor picture does pay for its picture: inside the part caps and the 097 FR-178 area row, and the same for every world; "no cost" (FR-231) is about the arrangement code.

**Risks.**

| Risk | Answer |
|---|---|
| 15 agents do not fit with a `focus` area | T165 first, pure and free; stop and ask (A5) |
| A project world has no fall-back, and the mockups measured under 40 px at 15 | FR-229's `[KNOWN GAP]`; T165 first, and the numbers go to the owner |
| A lounger looks wrong with an upright seated frame | FR-224; art brief; the owner's look. No new poses |
| Screens on small laptops | Same `screenRect` floor; bars under 150x60 (097 FR-032) |
| Hostile `arrangement` | FR-226, fixtures in `test:worldpack` |
| Conflict with 097's engine on open PRs | Build after #921 and #974; 097's text through T164 |
| Fire as endless animation | Still picture; FR-227 |

**Order:** after 102 P1 (validator) and #921. T165 and T166 can run first as they are pure and on the simulator.

## Done when

Tasks ticked, `/speckit.converge` run, SC-001..SC-018 read, README *Safety model* lists the new connection, and `real:` rows recorded or left as `[KNOWN GAP]`.
