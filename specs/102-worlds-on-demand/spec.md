# Feature Specification: Worlds on demand (country worlds and user-made worlds)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Real office worlds as untrusted data packs (owner request, Vikram 2026-10-31; #932, #933): eleven places downloaded on demand with a plain internet notice and an extensible source, and worlds people make themselves (in the app or by a prompt pack and upload); one pack format and one validator for both
note: spec, plan, tasks only; nothing built; art stays outside the repo until each world's own task; first ship waits for spec 097 FR-179
status: draft
-->

**Feature Branch**: `102-worlds` (spec); code branches `102-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: Draft (2026-10-31). Spec, plan and tasks only; nothing is built. Open points for the owner are in *Open points*; each has a recommendation, and the spec is written to that recommendation until the owner says otherwise.

**Input**: Owner requests and decisions (Vikram, 2026-10-31), recorded on issues #932 and #933 and restated in the coordinator's brief:
- Places: Spain, Mexico, Switzerland, USA, Australia, India, Italy, France, Germany, Britain, Greece (Santorini-style blue and white). No flags, no tourist cliches, no arches anywhere. Each place has a local postbox, described rather than copied from real marks.
- **Every world looks substantially different from every other** (owner decision, later the same day; it replaces the earlier decision on #932 that places may share a Mediterranean feel). Same layout and fixture boxes; packs do not reuse another world's fixture cutouts. Fixtures stand on the floor line rather than floating on a wall. For user-made worlds this is a warning, not a block.
- Windows only on wall that already exists: full band height, in fixed wall area, overlapping no fixture; fixtures keep their size and position; lobby visitors may stand in front of windows so they stay a good size.
- Worlds download on demand. The UI says plainly that it is connecting to the internet and from where. The source is extensible: default the project's GitHub repo; later a domain or an organisation's own location.
- User-made worlds: with the connected agent app if it can generate images; if not, instructions and a prompt pack, and people upload a package. An upload is untrusted input.
- Performance is a hard rule: a new world's first ship waits for spec 097 FR-179 (the Real office op rows, FR-180, FR-182, flat tasks T156..T159).
- Every world supplies the moments of spec 098's registry, live screens and animation, at 15 agents at 1440x900 and 1280x800; a pack missing some is flagged, not shipped as finished.
- No AI credits in checks. Real image runs stay on the owner's ChatGPT plan and get recorded provenance like the existing `ASSETS` files.

**Experience**: tool surfaces (the worlds dialog, the download notice, the maker dialog: tokens only, spec 098 FR-040) plus world moments filled by a pack from shared blocks (all 26 of the registry, FR-030). No new world moment.

## Why one spec for both issues, and a new one

Both issues need the same core: **a world pack that arrives from outside the app, is treated as hostile, and is validated, stored and drawn without code**. #932 brings it over the internet, #933 from a person's disk or an agent app. Two specs would either duplicate the validator or make one depend on the other's draft. So one spec, phased so the hand-made path and the download path can land apart (P3, P5, P6).

It is not a delta of 097 or 098: it adds Durbar's first user-started downloads of content, a source model, a signature check and a zip reader; 097 is the renderer and 098 the repo-wide contract. Number **102**. Checked 2026-10-31 against `main` (up to 098), remote branches (`099-autopilot`, `100-mcp-context`, `101-logo-family`, the 097 branches) and open PRs (#923 = 099, #924 = 100, #930 = 101): nothing uses 102. Numbers here are this spec's own: FR-001..FR-199 (sparse by group), SC-001..SC-013, T001..T096 (sparse by phase).

**One rule in, one rule out** (spec 021 FR-063): no `AGENTS.md` line. The checkable rules get scripts (`test:worldpack`, `test:worldzip`, `test:world-catalogue`, FR-180).

## Context: what exists today (FR-031 check)

Each row was read in the sources or specs on 2026-10-31. **Built** code is reused as it is; **draft** means the other spec has not built it yet, so whichever PR comes first builds it to that spec.

| Need | Existing capability | State | How it is used |
|---|---|---|---|
| Durbar's own HTTP, no redirect followed, cap while reading, no cookies | `makeDownloadGet`, `electronRequestFactory`, `FIXED_HEADERS` (`src/main/netget.ts`, spec 060, 081) | built | The download itself; only its error words become a parameter |
| Which hop may be asked for next | `downloadScript`'s per-hop host check (spec 060), `lookupAllowed` (081) | built | Same pattern with the source's host list |
| Plain list of what a request contacts and sends | 081 FR-017's table | built | Same table style in the README and the notice |
| Folder-pick import and export, flat, no links, temp then rename, dot folders ignored | `UserThemeStore` (`src/main/themes.ts`), `pickFolder` with `DURBAR_PICK` (`src/main/ipc/themes.ts`) | built | The store's pattern; the picker lifted (096 plans the same lift) |
| Token validation and contrast | `checkUserManifest` (`src/shared/themes.ts`), `themeIssues`, `CONTRAST_PAIRS` (`src/shared/themegen.ts`), `contrastFix` (`src/renderer/theme.js`), 040 FR-006 | built | A pack's tokens pass the same checks; non-built-in packs get the same repair |
| Maker dialog: idea chips, harness select, cost line, busy toast, Try it, Save, Try again, Discard | `aiTheme()`, `oneShotCostLine`, `pickIdeas` (`screens.js`, `themegen.ts`, spec 040 FR-014..FR-021) | built | The maker's dialog |
| Hostile JSON readers | `ownValue`, `isPlainObject`, `ownStrings` (`src/shared/orgpolicy.ts`) | built | `world.json`, catalogues, policy keys |
| IPC owner-only guard | `ipcHandle`, `fromApp`, `SIM_OPEN_CHANNELS` (`simguard.ts`) | built | New `world:*` channels |
| Policy seam with no reader yet | `updatePolicy()`, `requireOsSandboxFrom(layers)` (`updatepolicy.ts`, `sandboxpolicy.ts`), 076 FR-005, FR-010..FR-014, FR-158, FR-159, `network.trustedHosts` | seam built, reader not | Same shape; see FR-110, OP-5 |
| SSRF rules for an admin-named URL | 076's URL rules (`https:` only, hop re-check, private ranges refused unless `network.trustedHosts`) | draft | Applied to non-project sources; first builder here |
| `imageGen`, encoder window, `imagecheck.ts`, `webpcheck.ts`, blob display, fake generator, API-key refusal | spec 096 FR-001, FR-020..FR-023, FR-034, FR-035, FR-043, FR-070 | draft, not in `src/` | The image pipeline; 102 generalises the encoder job from "4 panels at 352x352" to a list of targets |
| Block contract, `world.json`, `test:world-packs`, registry, world matrix | spec 098 FR-030..FR-033, FR-010, FR-050..FR-052 (registry file committed; checks not built) | draft | The validator's rules come from here, one implementation shared by the test and main |
| World setting, lazy pack | 097 FR-100, FR-114, FR-115, FR-061 | draft | The World row gains downloaded and own worlds |
| Budgets | 097 FR-178..FR-190 (#936, open) | draft | FR-120 |
| Provenance | `ASSETS.md`, `test:crew-assets`, 077 FR-054, 097 FR-063, FR-067, FR-068, `test:realoffice-assets` | built for crews | `worlds/<id>/ASSETS.md`, same fields |

No download, zip or signature code for content exists today. Theme import explicitly has "no network, no zip". Runtime dependencies stay as they are (`@github/copilot-sdk`, `dompurify`, `marked`): Node's `crypto` and `zlib` do the hash, signature and inflate.

## Decisions taken by this spec (the owners may change any)

- **D1 Packs are data and art only.** No script, HTML, CSS, SVG, font or URL in a pack, from any source, the project's included. Positions come from the 097 engine and motion from a fixed list named in the manifest. This is what makes a third-party pack safe to draw at all.
- **D2 The project's catalogue ships inside the app.** Listing worlds needs no network; hashes of project packs are pinned in the app (FR-080), so the project needs no signing key and no secret, and GitHub serving wrong bytes cannot change a picture.
- **D3 Non-project sources sign their catalogue** with Ed25519; the public key travels with the source record, not with the catalogue (FR-082).
- **D4 Shared people.** Country worlds draw the Office people that ship with the app, so no ethnicity is tied to a country (issue #932), and a pack holds no person frames. That also keeps a pack near 2-3 MB instead of 10 (FR-042).
- **D5 One format everywhere**: a zip whose file names are from a closed list (a hand-made folder goes through the same file-set rules). The path of a stored file is built by Durbar from the list, never from the archive (FR-050).
- **D6 Nothing connects by itself.** No background catalogue fetch, update check or download. Every connection follows a click on a notice that names the host (FR-070, FR-072).
- **D7 Art in the repo, not in the app.** Sources under `worlds/<id>/` are committed and reviewed, built reproducibly into a zip, and left out of the app bundle (FR-085, OP-3).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a place's world (Priority: P1)

In Settings, under the World row of Real office, I open **Get more worlds…** and see the places: finished ones with their size, the rest as *Coming*. I choose Spain. Before anything is sent the app tells me it is connecting to the internet, to which host, how much it will download and what that server sees. I click Download, it arrives, and I can use it, offline from then on.

**Why this priority**: it is the owner's delivery decision, and the rest of #932 depends on it.

**Independent Test**: fixture pack and a fake request layer; no network, no AI credits.

**Acceptance Scenarios**:
1. `test:` **Given** a new install, **When** the app starts in either mode and the dialog opens, **Then** no request of this feature is made (injected request layer: zero calls).
2. `sim:` **Given** the dialog, **When** I choose an available world, **Then** a notice names "connects to the internet", the source's name, the real host, the size and what the server sees, and no request is made until I press Download.
3. `test:` **Given** a downloaded pack whose hash differs from the catalogue by one byte, **Then** nothing is stored, no temp file remains, and the world is not offered.
4. `test:` **Given** a redirect to a host not on the source's list, **Then** the next request is never made and the message names the refused host.
5. `sim:` **Given** an installed world and no network, **Then** it draws in full and nothing tries to connect.
6. `real:` **Given** the first real `worlds-*` release, **Then** one download on Linux, macOS and Windows arrives from GitHub and passes the hash.

### User Story 2 - Places that look like real offices (Priority: P1)

Each place is a contemporary office with its own materials, light and views: no flag, landmark, religious building, caricature or arch. Two worlds are never mistaken for each other, even as thumbnails. Each has a window view, and a postbox that fits the place. The layout, fixture boxes, words, lights and screens are the same as every other world.

**Independent Test**: `test:world-packs` on each pack, world matrix, the owner's look per world.

**Acceptance Scenarios**:
1. `test:` **Given** a catalogue entry `available`, **Then** its pack passes the block test, all 26 moments are covered, `ASSETS.md` has every picture with its prompt, the prompts carry the exclusion clause, and the owner's approval field is filled; any one missing fails `test:world-catalogue`.
2. `sim:` **Given** each available world and 15 agents at 1440x900 and 1280x800, chat closed and open, **Then** `check:office` passes (no overlap, no clipped text, no text under 10.5 px, no office scroll), live screens update, people animate, and reduced motion stops them.
3. `test:` **Given** a world with and without windows, **Then** every fixture and visitor rectangle is identical at both sizes.
4. `read:` **Given** each world's pictures, **Then** the owner has looked at them and recorded the check (`ASSETS.md`); a machine cannot judge a cliche.
5. `test:` **Given** two worlds' cards that name the same wall, floor, desk, fixture style, plants or motif, or light temperatures under 200 K apart, **Then** `test:world-catalogue` fails and names the pair and the item.
6. `sim:` **Given** a pack whose fixture picture repeats another world's, exactly or nearly, **Then** `check-world-distinct` fails and names both files.
7. `read:` **Given** the contact sheet of all worlds at thumbnail size, **Then** the reviewer can tell every world from every other at a glance, and records it (`distinct-check`) before the world becomes `available`.
8. `test:` **Given** any fixture of any pack, **Then** its lowest opaque pixels lie on the floor line within 2 px, and a fixture hanging on the wall is refused.

### User Story 3 - Upload a world I made by hand (Priority: P2)

No app of mine can make images. The app gives me the exact prompts and a package layout. I make the pictures in any tool, zip them, upload the zip, see what passed and what failed, try it on, and save it. Anything missing is named and the world is flagged as unfinished.

**Independent Test**: hostile fixture packages, simulator dialog; no credits.

**Acceptance Scenarios**:
1. `test:` **Given** each package of the hostile list (FR-051, FR-052), **Then** it is refused with a plain reason, nothing is written outside the temp folder, and the temp folder is gone.
2. `sim:` **Given** a good package missing `lift` and `welcome`, **Then** the report names the moments affected, saving is allowed, those parts show the photo world's art, and the world is labelled *Unfinished* wherever it is listed.
3. `test:` **Given** a good PNG with EXIF GPS data and a trailing payload, **Then** the stored WebP has neither.
4. `sim:` **Given** a user world, **When** the office is in flat mode, **Then** none of its files are requested.
5. `sim:` **Given** a package whose fixtures or colours are very close to a world on this machine, **Then** the report warns and names that world, and Save still works.

### User Story 4 - Make a world in the app (Priority: P3)

Where a connected app can generate images, I describe a world and watch it fill block by block. I see the time and cost honestly first, can cancel, redo one part, try it, save it or discard it.

**Independent Test**: spec 096's fake generator; the real run is separate.

**Acceptance Scenarios**:
1. `sim:` **Given** no ready adapter with `imageGen`, **Then** the dialog offers only the hand path, with the reason.
2. `sim:` **Given** the simulator's fake generator, **Then** the job runs to a preview, one part can be redone and the rest kept, and Discard leaves nothing on disk.
3. `test:` **Given** a generated file that is a symlink, a text file, oversized or a second file, **Then** that part fails and the job goes on (096 FR-020..FR-023).
4. `test:` **Given** an API-key login or an unknown login, **Then** generation is refused or asked for as 096 FR-034 says.
5. `real:` **Given** the owner's ChatGPT plan, **Then** one small world is made inside Durbar; time per part is recorded in this spec (T062, cost stays with the owner's plan, run only on his OK).

### User Story 5 - An organisation decides (Priority: P2)

IT can forbid downloads, forbid user-made worlds, or point the app at its own location. A forbidden source is hidden and says who decided; a broken policy fails closed.

**Acceptance Scenarios**:
1. `test:` **Given** `features.worldDownloads: false`, **Then** no download starts in main even if the window asks, the control is gone, and *Turned off by your organization* shows.
2. `test:` **Given** a present but unreadable policy, **Then** downloads and non-project sources are off.
3. `test:` **Given** `worlds.sources` listing one location, **Then** only that location is used, the project's default is not contacted, and the user cannot add one.
4. `real:` **Given** a real proxy and an organisation's own location, **Then** a download works through the OS proxy and certificate store (T053; `[KNOWN GAP]` until someone has one).

### User Story 6 - Keep my worlds tidy and share one (Priority: P3)

I see each world's size, source and version; I can update, remove and export. Export gives a zip that goes through the same checks on another machine.

**Acceptance Scenarios**:
1. `sim:` **Given** a newer version in the catalogue, **Then** *Update (2.5 MB)* appears, nothing downloads until I click, and the old version keeps working until the new one is fully checked.
2. `sim:` **Given** I remove the world in use, **Then** the World setting falls back to *Match my characters* and the files are gone.
3. `test:` **Given** an exported world, **When** imported again, **Then** it passes and is labelled *Imported*; the export holds no description, prompt, path or user name.

### Edge Cases

- **Disk full or a crash during a download or save**: only the temp dot folder holds anything; it is removed at the next start (the `UserThemeStore` pattern).
- **Two downloads**: one at a time; a second click says one is running.
- **Airplane mode, a captive portal or a proxy block**: "Could not connect to github.com…"; a captive portal's HTML fails the hash; the size cap stops a large answer.
- **The file is gone from the source**: "No longer available at <host>." The catalogue row stays until the next app update.
- **A pack made for a newer app** (`formatVersion` higher): refused before download: "Needs a newer Agent Durbar."
- **A chosen world's folder was deleted by hand**: `match`, one toast; no retry and no network.
- **A pack with the id of a built-in**: cannot clash: keys are namespaced by source (FR-060).
- **Hostile names and text**: a name with markup is shown as text; control characters and bidi overrides are removed; never placed in a shell, a URL, an agent's prompt or an MCP answer.
- **A picture that passes the checks but fails to decode in the office**: 097 FR-065's fallback (plate only, initials disc), and the world is marked damaged.
- **Forced colours, Serious mode, reduced motion**: as 097; a pack cannot change them.
- **Custom lobby places**: the pack's kiosk fixture carries the icon and name (097 D5).
- **A very wide app window**: the wall repeats; more picture windows may appear, but only in fixed wall areas (FR-021).
- **Characters set to a crew with a country world chosen**: the World setting wins, the country world draws the Office people (D4), and 097 FR-083's note says why. Crew art is never placed in a country world.

## Requirements *(mandatory)*

### Functional Requirements

#### Worlds offered

- **FR-001** **Three origins.** A world is `built-in` (097 FR-100), `downloaded` (from a source) or `own` (uploaded, generated or imported). Built-ins never need a network. The World row (097 FR-114) lists installed worlds of every origin; **Get more worlds…** opens the tool-surface dialog.
- **FR-002** **Available or coming.** A catalogue entry is `available` (has a file and passes the gate, FR-035) or `coming` (a name only, shown disabled as *Coming*). The picker never waits for all the art (issue #932). All eleven places start as `coming`.
- **FR-003** **Flat is untouched.** With flat chosen, no world file is read and the office is pixel-identical (`check:office` unchanged; 097 FR-061).
- **FR-004** **No IPC or engine fork.** Downloaded and own worlds go through 097's one world seam; the renderer asks main for bytes by world key and part name, and never holds a path or URL.

#### The places

- **FR-010** **Art brief, shared rules.** Each place is a real contemporary office: local materials, light and a view; the same layout, words, lights and screens. In every picture and prompt: **no flag, national emblem, logo, text, religious building or symbol, landmark, stereotype, national caricature, or arch, vault or arcade of any kind** (openings have straight heads). People are not drawn in the room art.
- **FR-011** **The eleven places.** A starting brief for the prompts, written so that every item differs in every pair (FR-014); the owner's look decides, and a card of the places may refine it. Light temperature is in the brief and the card, as a target for the picture, not a measured value.

  | Id | Walls | Floor | Desk | Fixture style | Light | Plants | Signature motif |
  |---|---|---|---|---|---|---|---|
  | `spain` | Warm ochre lime plaster | Calm sand-coloured honed stone (the sample's floor toned down, owner decision) | Pale oak on black trestles | Rounded plaster fronts with tile facing | 3000 K, low warm sun | Orange tree in a clay pot | A band of geometric glazed tile along the wall |
  | `mexico` | Rust-pink painted plaster | Dark volcanic stone | Dark solid timber slab | Heavy blocks of stone and timber | 3600 K, strong with hard shadow | Large-leaf tropical planting | One large flat plane of a second saturated colour |
  | `switzerland` | Pale spruce panels | Light grey fair-faced concrete | White laminate with spruce edge | Precise white and spruce cabinetry | 5000 K, clear and cool | Dwarf pine in a concrete pot | Fine horizontal spruce battens |
  | `usa` | Charcoal-blue painted steel and glass | Wide maple boards | Walnut top on grey steel | Black steel and glass lockers | 4000 K, neutral wide daylight | Fiddle-leaf fig | Exposed round ducts and riveted beams |
  | `australia` | Pale grey-green corrugated metal | Red-brown hardwood boards | Recycled red hardwood | Hardwood with galvanised metal | 5600 K, very bright | Eucalypt and native grasses | A curved corrugated-metal panel |
  | `india` | Sage-green lime plaster; **a modern office, never a court** (the owner rejected those themes) | Polished dark green-grey stone | Teak with a cane panel | Teak and cane | 3200 K, warm under tree shade | Banana plant | A cast-concrete geometric sun screen |
  | `italy` | Deep terracotta-red polished plaster | Speckled cream terrazzo | Walnut with brass trim | Slim walnut and brass | 3400 K, warm and rich | Olive tree | Thin brass inlay lines |
  | `france` | Pale grey-blue painted panels | Oak herringbone | Pale oak with a zinc top | Zinc and painted panel | 4400 K, soft | Clipped box in pots | Simple square wall-panel mouldings |
  | `germany` | Board-marked mid-grey concrete | Anthracite rubber | Black linoleum on tubular steel | Tubular steel and glass cabinets | 4700 K, even | Snake plant in steel planters | A single yellow steel rail |
  | `britain` | Red-brown brick | Dark worn oak boards | Oak with a dark-green metal base | Dark-green painted timber and brass | 3800 K, soft grey daylight with warm lamps | Ferns | A round cast-iron column |
  | `greece` | White plaster with blue-painted woodwork and rounded plaster edges: **Santorini-style blue and white without a dome, church, arch or vault** | Whitewashed stone slabs | White-painted timber | Blue-painted timber with white edges | 6000 K, hard bright sea light | Bougainvillea | Blue-painted louvred shutters |

  Views and postboxes (FR-012); every postbox stands on the floor or on a post from the floor (FR-019), and may share a colour with another place's:

  | Id | View through a window | Postbox, described |
  |---|---|---|
  | `spain` | Pale street of plastered buildings, a tree | Yellow, free-standing, rounded top, one slot |
  | `mexico` | Courtyard planting, strong shadow | Red, short hooded box on a post |
  | `switzerland` | Generic green slopes and distant peaks, no named mountain | Yellow, flat box on a slim post |
  | `usa` | Generic mid-rise street, no skyline landmark | Blue, four short legs, curved top, pull-down flap |
  | `australia` | Eucalypts, wide sky | Red, upright street box, a smaller yellow one beside it |
  | `india` | Green shade, modern low building | Red, round pillar with a small hood |
  | `italy` | Plain courtyard, pale buildings | Red, slim box on a pedestal |
  | `france` | Generic pale stone street, no landmark | Yellow, small rounded box on a post |
  | `germany` | Generic modern street, trees | Yellow box with a rounded top, on a post |
  | `britain` | Generic brick street, no landmark | Red, round cylinder pillar, no crown or cypher |
  | `greece` | Calm sea and pale sky | Yellow, small box on a white-painted post |

- **FR-012** **Each place has its own postbox, described, not copied.** It is the `post` fixture (098 FR-030), in the local colour and a plausible form. No postal logo, horn, crown, royal cypher, company name, lettering, or a copy of a specific model. Spain's sample decision applies to all. Colours come from the public sources under *Assumptions*; shapes are this spec's description, not facts about each country, and the owner's look decides.
- **FR-013** **Same lobby everywhere.** The other fixtures (Library, Boss door, Bank and so on) keep their meaning and are drawn in the place's fixture style. Their words are the app's, unchanged per spec 036 FR-003 and 098 FR-043.
- **FR-014** **Every world looks substantially different from every other** (owner decision; it replaces "places may share a Mediterranean feel"). Between any two worlds with art in the project, the 11 places and the built-ins alike, **all** of these differ: wall, floor and desk materials and colours, fixture style, light temperature, plants, and one signature motif. They can be told apart at a glance at thumbnail size. **What stays the same**: layout, fixture boxes, words, lights and screens (098 FR-030, FR-033). A motif obeys FR-010: it is never a flag, emblem or landmark.
- **FR-015** **No reused cutouts.** A pack does not reuse another world's fixture cutouts, whether copied, recoloured or re-encoded: each world's fixtures are made for it (FR-132's sheet is per world).
- **FR-016** **Machine checks, as far as a machine can.** Each project world has `worlds/<id>/card.json` (not in the pack), naming the seven items of FR-014; built-ins have one too. `test:world-catalogue` fails on any pair with the same wall, floor, desk, fixture style, plants or motif (normalised text), or light temperatures under 200 K apart; a card cannot prove the picture matches it, which is why FR-017 exists. `scripts/check-world-distinct.js` (simulator, decodes in Electron, weekly and on the PR subset) compares each pair: exact file hash and a perceptual hash of each fixture (fail when near), and average colour of wall, floor and desk (fail when near). The first thresholds are set from the first real packs and move only by evidence (097 FR-190's rule).
- **FR-017** **Review step.** Before a world's first image run, its card is compared with all others and any overlap is fixed (a batch of pictures costs plan usage; a card costs nothing). Before `available`, `scripts/world-contact-sheet.js` makes one artifact (never committed, 098 FR-054's rule) with every world in the same simulator scene at about 320x200, and the reviewer records `distinct-check` (name, date, how many worlds compared) in the new world's `ASSETS.md`. A world that can be mistaken for another at that size goes back to art, and either world may be the one that changes.
- **FR-018** **User-made worlds: a warning, not a block.** For an upload, generated world, import or non-project pack, the encoder compares fixtures and colours with the built-ins and worlds on this machine, without network. If close, the report says "This looks very close to <world>; you can still save it." Save stays available. Only the report carries it: no state, no label after saving.
- **FR-019** **Fixtures stand on the floor.** Every fixture, the postbox included, stands on the band's floor line; none floats on the wall or hangs without a visible support to the floor. Refused when the fixture's lowest opaque pixels are not on its `floorLine` within 2 px (FR-055). A wall-box look is drawn on a post or plinth. A person standing there keeps 097 FR-117.

#### Windows on existing wall

- **FR-020** **Allowed in every world, built-in ones too** (owner decision), through the new optional `room.windows` part (FR-041). A world is not required to have them; an existing world adds them only as an art change approved by its art owner (097 Q6 for crew worlds).
- **FR-021** **Only on fixed wall area; full band height; no overlap.** Windows go in the wall areas left between the fixture boxes of the layout (owner decision). A window is a straight-sided rectangle, exactly as high as the lobby band and never over a fixture box: it does not intersect any fixture box by a pixel. The engine places windows after fixtures and never feeds them into layout. An area narrower than the picture's minimum width gets no window; a window that would cost space is left out.
- **FR-022** **Fixtures and people do not change.** Fixture sizes and positions, band height and desk layout are the same with and without windows (`test:realoffice-layout`, exact rectangles, both sizes, 1..15 agents, all 9 places plus 3 custom), and the same test checks each window's height equals the band's and that it intersects no fixture box. Fixture boxes are the same in every world.
- **FR-023** **Visitors may stand in front.** Paint order is floor, wall, windows, fixtures, visitors, plates; a visitor keeps its 097 FR-117 scale and foot line, and 097 FR-025's crowding never shrinks a person because of a window. Plates and chips stay on opaque surfaces, so a window never puts text on a picture.
- **FR-024** **Calm.** A window is a still picture: no moving clouds or animated view, no animation budget used. Ambient dimming (097 FR-043) applies to it like the rest of the art.

#### Moments, screens and animation

- **FR-030** **Coverage is computed.** A shared pure function `momentCoverage(pack)` (`src/shared/worldmoments.ts`) gives, per registry moment, `covered` or the missing parts, from the blocks the moment names (098 FR-012) and the required parts of those blocks. `test:world-packs` keeps its moment-to-block map equal to `docs/experience/world-moments.json`, since the app does not read the registry (098 FR-010).
- **FR-031** **Required extras.** A moment needing more than its block list says names it in the map: `first-run` needs `room.welcome`, `floor-change` needs `lift.rideCover` and a `rideStyle`. `building-preview` stays optional (097 FR-105).
- **FR-032** **Live screens and animation come from the app.** A pack gives `desk-screen.screenRect`, `callAnchor` and light-slot shapes; app text goes in as `textContent` (097 FR-030, FR-031) and poses are the people's. The validator refuses a `screenRect` smaller than 097 FR-032 needs at the half-size desk, so a pack cannot make screens unreadable.
- **FR-033** **Motion is named, not supplied.** `rideStyle` is one of `doors`, `gate`, `drop`; light shapes come from 098's fixed list. No keyframe, duration or easing in a pack.
- **FR-034** **Flagged, not shipped as finished.** A pack with any uncovered moment is `unfinished`. Project catalogue: it cannot be `available` (`test:world-catalogue`). Non-project source: listed as *Unfinished: <n> parts missing* before download. Own world: may be saved, labelled wherever listed, with the missing moments named; missing parts draw the `photo` world's art (issue #933). `unfinished` is one word used everywhere, and a world's status never hides it.
- **FR-035** **The gate for `available` in the project's catalogue.** All of: (a) spec 097 FR-179 is met: the Real office op rows and FR-180, FR-182 hold in `check-office-ops`, and T156..T159 are ticked in `specs/097-real-office/tasks.md` (`test:world-catalogue` reads the ticks); (b) `test:world-packs` passes and FR-030 is all `covered`; (c) the registry row is `shippable` under 098 FR-024; (d) `check:office` and the world matrix pass at 15 agents at both sizes; (e) provenance (FR-170); (f) the owner's check is recorded per world; (g) FR-016's checks pass and `distinct-check` is recorded (FR-017). Own worlds and the maker UI also wait for (a) before any release has them (097 FR-179 names user-made worlds).

#### Pack format

- **FR-040** **`world.json`** (at most 64 KB, `v: 1`): `formatVersion`, `id`, `name` (1-40 code points, plain text), `version` (integer, up to 9 digits), `people: "office"`, `tokens` (070 types only), `lights` (shape per slot), `rideStyle`, `parts` (part name to anchors and, for downloaded packs, sha256 and bytes), optional `description` (at most 200 code points, plain text), optional `licence` (at most 40 code points). A field not listed is refused; 098 FR-031's refusal of position, size and layout values stands. Parsed with own-property readers. Packs set no words: tool and scene words are the app's.
- **FR-041** **Parts: the closed file list.** Fixed names under 098's blocks, plus one new block `room`:
  - `room`: `wall.webp` (repeating, at most 120 KB), `floor.webp` (at most 40 KB, 097 FR-062), `welcome.webp` (at most 150 KB), optional `window-1.webp`..`window-3.webp` (at most 60 KB each, opaque rectangles, drawn at band height, each with a minimum width);
  - `fixture`: `fx-library`, `fx-software`, `fx-terminal`, `fx-web`, `fx-boss`, `fx-coffee`, `fx-bank`, `fx-post`, `fx-tools`, `fx-kiosk` (`.webp`, at most 120 KB each);
  - `desk-screen`: `desk.webp` and `desk-half.webp` (097 FR-183: two sizes, at most 60 KB each);
  - `lift`, `speech-bubble`, `slip`, `panel-frame`: names and caps as 098 FR-030.
  - `person`: none (`people: "office"`, D4).
- **FR-042** **Size.** Whole pack at most 10 MB (097 FR-115, a hard cap); by the part caps a shared-people pack is at most about 2.5 MB (arithmetic, not measured); a project pack over 4 MB fails `test:world-catalogue`. At most 40 files. The zip adds no compression (WebP is stored). Every picture's natural size is capped so that the 097 FR-178 area row (at most 4x the shown device-pixel area) can hold: a fixture, a window and `wall.webp` at most 300 px tall, `welcome.webp` at most 1920x1200; `test:` per part.
- **FR-043** **Format version.** `formatVersion` 1 is this contract. Durbar refuses a higher one before download or reading parts, and keeps reading older ones; adding a block that a pack may omit does not raise it.

#### Validation: every pack, every source

- **FR-050** **One validator, four entrances.** Download, upload, generate and import all end in `src/shared/worldpack.ts` plus the encoder. `test:world-packs` uses the same functions (098 FR-032), so the repo's rule and the app's rule cannot differ. No stored path comes from a pack: Durbar writes `<store>/<key>/<name>` only for a `name` it found by exact match in its own list.
- **FR-051** **Zip reader** (`src/shared/worldzip.ts`, pure, from a Buffer, no dependency; D5). Refused, with a plain reason:
  - file over the cap, by `lstat` before reading (upload 64 MB, download FR-081);
  - a name not on the list, after no normalisation at all: `../`, `..\`, absolute paths, drive letters, `:` streams, backslashes, nested folders, a NUL, control characters, trailing dots or spaces, Windows reserved names, case or Unicode variants, duplicates; a single top-level folder is the one allowance for hand-made zips;
  - symlink or any non-regular file by its external attributes; encrypted entries; ZIP64; multi-disk; any method other than store and deflate;
  - central directory and local header disagreeing (name, sizes, method); entries that overlap; bytes before the first entry or after the end record (polyglots);
  - more than 96 entries; one image over 20 MB (096 FR-020), or over 128 MB in all, by declared size and enforced by `maxOutputLength` while inflating, so a zip bomb stops at the cap.
- **FR-052** **Every file**: an allow-listed type by magic bytes, not by name: PNG or WebP (096 FR-021). JPEG, GIF, SVG, HTML, BMP, ICO, AVIF and anything else are refused; a `.webp` holding SVG or text fails the magic. Header dimensions are read before decoding: each side at most 4096 px and in the part's range; animated WebP (`ANMF`) and APNG (`acTL`) are refused.
- **FR-053** **Decode only in the sandbox.** Hostile bytes never reach the office window or main's decoder. Uploaded, generated and non-project packs go through the 096 FR-022 encoder window (no Node, no network, session cancelling every request, `default-src 'none'`), destroyed after each job; each file is re-encoded to WebP at 0.80, with metadata stripped, and main re-checks the output (096 FR-023, `webpcheck.ts`: size, dimensions, only `VP8X`, `VP8 `, `VP8L`, `ALPH` chunks, the part's byte cap). The reason is real: an image decoder bug in a normal window would be code execution with the app's bridge.
- **FR-054** **Project packs are decoded but not re-encoded.** Their bytes are reviewed and pinned (FR-080), and a second lossy pass would harm them; they are still decoded in the encoder window and pass main's output check. If the hash does not match they never get that far.
- **FR-055** **Anchors and tokens.** Anchors in 0..1 and sizes in 098's ranges; a shared floor line and top line (097 FR-023) are checked from each fixture's alpha by the encoder, within 2 px (FR-019). For hand-made packs anchors default from alpha (the 096 FR-025 method) and are shown for review, `[KNOWN GAP]` no anchor editor in v1. Tokens: `checkUserManifest`'s value rules (040 FR-006), no `url(`, no font name outside the app's list, `themeIssues` and `contrastFix`, reported as "colours adjusted for contrast"; status colour meanings fixed (070 FR-050). Text still unreadable after repair refuses the tokens, and the world uses the base theme's.
- **FR-056** **Report.** The validator returns a list of `{part, ok, reason, moments[]}` in plain words, with no value from the pack beyond its already-sanitised name. Reasons are capped and never include a path from outside the temp folder.

#### Store and loading

- **FR-060** **Store.** `userData/worlds/<key>/`, with key `p--<id>` (project), `s-<sourceId>--<id>` (other source) or `u-<random>` (own, id from main). Never in a repo or inside the app. Temp is a dot folder, moved by rename once fully checked; leftovers are removed at start. A stored `installed.json` holds origin, source id, version, sha256 per part, size, date and state, never a description, prompt or path.
- **FR-061** **Caps.** At most 64 installed worlds and 500 MB together; a download or save over that is refused with a plain sentence and a link to Manage.
- **FR-062** **Re-check at load.** Before bytes go to the window: regular file, no link, size within the cap, sha256 equal to `installed.json`. A mismatch marks the world *Damaged*: not drawn, with Remove and, where a source has it, Download again. Reads are asynchronous and one world at a time, within the mode-switch budget (FR-120).
- **FR-063** **To the window.** Bytes go over a `world:part` channel and become `blob:` URLs as 096 FR-043 (CSP `img-src` gains only `blob:`, added by 096 or whichever comes first); they are revoked on a world change. `file:` and custom protocols are not used. Switching worlds drops the old pictures (097 FR-115).
- **FR-064** **Owner-only IPC.** `world:list`, `world:catalogue`, `world:download(key)`, `world:cancel`, `world:remove(key)`, `world:part(key, name)`, `world:upload` (main opens the picker), `world:saveTry`, `world:export`, `world:prompts`, `world:generate`, `world:regenerate`. All through `ipcHandle` and `fromApp`, keys and part names checked against main's lists, closed to the simulator guard list, the MCP tools and remote control. The window never sends a URL, host or path.
- **FR-065** **Pack text stays out of agents.** A world's name, description and licence are never passed to an agent app, prompt, MCP answer, chat channel or log (AGENTS.md *Untrusted content*).

#### Sources and the internet notice

- **FR-070** **Safe by default.** Nothing of this feature touches the network without a click on a notice that was just shown. Not at start, not on opening Settings, not for updates. The simulator never gets here (081 FR-020's guard).
- **FR-071** **Source record.** `{ id, label, baseUrl, hosts[], trust }`, in one list in main. `trust` is `pinned` (the project's catalogue in the app) or `{ ed25519: <public key> }` with a catalogue fetched from `baseUrl`.
- **FR-072** **The notice** (a tool-surface dialog, no art behind text). Before any request, in words: **"This connects to the internet."** Then the source label and the real host; for the project, "github.com, the Agent Durbar project's releases. The file itself comes from release-assets.githubusercontent.com, GitHub's download server."; the size; "That server sees your IP address, as with any download. Nothing about your agents or folders is sent."; buttons **Download (connects to the internet)** and **Not now**, with the safe one focused. The host is taken from the URL that will be requested, not from any label. It is shown every time, with no "don't ask again". A non-project source adds its status: "Set by your organization" or "Not checked by the Agent Durbar project". The same notice precedes a catalogue fetch.
- **FR-073** **The default source.** `project`: `https://github.com/three-feathers/agent-durbar/releases/download/<tag>/<file>`, hosts `github.com` and `release-assets.githubusercontent.com` (a 302 between them was seen on 2026-10-31, on a real asset of v0.1.4 `real:`). GitHub could change the second host; a refused host then fails plainly and an app update fixes the list. `[KNOWN GAP]` until checked per release.
- **FR-074** **Request shape.** `makeDownloadGet`: `credentials: 'omit'`, no cookies, no session partition with a sign-in, `FIXED_HEADERS`, `redirect: 'manual'`, at most 3 hops, `https:` only, each hop checked against `hosts` before it is asked for, system proxy and OS certificates (076 FR-155), 120 s total. No query string or other identifier is added. README's *Safety model* gets 081's style of table: contacted, when, sent. GitHub's public `download_count` will rise per download: the one thing a person's download leaves behind, stated there.
- **FR-075** **Progress and failure.** Bytes as text and a bar, Cancel works at any point and leaves nothing. Failures say which host and what to do: offline or blocked ("Could not connect to <host>. Check your connection, or your organisation may block it. Worlds you already have keep working."), not found, too large, hash mismatch ("The file did not match what Agent Durbar expected, so it was not used."). No automatic retry.
- **FR-076** **Offline.** Installed worlds need nothing from the network. Listing the project catalogue needs nothing. Non-project catalogues show their last verified copy with its date, labelled; a world whose download fails leaves the current world unchanged.

#### Integrity

- **FR-080** **Project catalogue, pinned.** `worlds/catalogue.json` (copied into the app) lists per world `id`, `name`, `state`, `version`, `formatVersion`, `tag`, `file`, `bytes`, `sha256`, and a list `revoked` of pack hashes. No key, no secret and no signing service: the catalogue has the same trust as the app that carries it. Honest limit: builds are unsigned (constitution VIII), so this is no stronger than the installed app.
- **FR-081** **The hash comes first.** A download is held in memory, capped at the catalogue's `bytes` and never over 12 MB; any other length fails. SHA-256 is compared before the bytes are parsed at all; only then the zip reader, then per-part hashes from `world.json`.
- **FR-082** **Non-project sources.** `<baseUrl>/catalogue.json` (at most 256 KiB) and `catalogue.json.sig` (detached Ed25519, Node `crypto`). The key is in the source record, set by whoever added the source. A bad or missing signature means nothing from that fetch is used. Each catalogue has an integer `sequence`; a lower one than last seen is refused (rollback). `[KNOWN GAP]` freeze: a source that keeps serving an old catalogue is not detected. Key rotation means a new source record; a catalogue can never change its own key.
- **FR-083** **Revocation.** A pack whose hash is in the catalogue's `revoked` list (a likeness report under 097 FR-068, a bad pack) is not drawn and is removed, with a note. `[KNOWN GAP]` for project packs this arrives only with an app update.
- **FR-084** **Published assets never change.** A new pack is a new version, file name and hash; an asset is never overwritten, so older apps keep working. Removal happens only for a revocation.
- **FR-085** **Reproducible.** `scripts/world-pack.js` builds `worlds/<id>/` into a stored zip with fixed order and timestamps. `test:world-catalogue` rebuilds it and compares it with the catalogue's hash, offline, so the catalogue provably matches the reviewed files. `worlds/` art is not in the app (`scripts/copy-assets.js` copies only the catalogue; `test:` on the file list). The world matrix reads `worlds/<id>/` from the checkout, with no network.
- **FR-086** **Publishing.** Packs go up as assets of a `worlds-<YYYY-MM-DD>` release by a human-run or owner-approved step, marked `latest=false`, so that the app's update and release pages keep pointing at `v*`. It does not trigger `release.yml` (tags `v*`). This needs the owner's OK (OP-2). A check after upload compares the real asset's hash with the catalogue (0 AI credits; T043, `real:`).

#### What a third-party source can and cannot do

- **FR-090** **Can**: list worlds with names and sizes, and supply packs that pass the same validator. It learns the IP address and the requested files.
- **FR-091** **Cannot**: run code; supply CSS, HTML, SVG, fonts or scripts; change layout, sizes, words, statuses or status colours; draw on tool surfaces; make the app fetch anything but the catalogue, signature and pack from its listed hosts; redirect elsewhere; name its worlds as built-ins or another source's (FR-060); change its key, add sources, or change a setting or policy; start a download; or reach an agent, a prompt or MCP (FR-065). It cannot read anything local: requests carry no cookie or credential.
- **FR-092** **URL rules**: `https:` only, no user or password in the URL, a host list of at most 4 names, private and metadata ranges refused as 076's URL rules say, except hosts in `network.trustedHosts`. `[KNOWN GAP]` DNS rebinding, as 076 says.
- **FR-093** **Who can add one (OP-4).** v1: only the organisation's policy (FR-111). The record, the signature code and its tests are in place, so a user-facing **Add a source** (paste a URL and key, warned as not checked by the project) is a small later step, and so is a project domain, which is a change of the default record's hosts.

#### Updates and deletion

- **FR-100** **Updates are offered, never automatic.** A newer `version` in the catalogue, arriving with an app update or a verified non-project fetch started by the user, shows *Update (<size>)* after a fresh FR-072 notice. The old version keeps working and is replaced by rename only when the new one has passed; a failed update changes nothing.
- **FR-101** **Removal.** Remove, with a confirm, on every installed world; files deleted, `installed.json` gone, 097's `durbar.world` falls back to `match`. A removed world's download can be repeated. Built-ins have no Remove.
- **FR-102** **Uninstall.** The store lives in `userData` and follows what the app does with it today; README says so.

#### Organisation policy

- **FR-110** **Keys, in 076's layers, narrow only.** `features.worldDownloads: false` and `features.userWorlds: false` (076 FR-158, FR-159: this spec adds them, in main and the window, hidden with *Turned off by your organization*). `features.userWorlds` covers upload, generate and import.
- **FR-111** **`worlds.sources`** (machine layer only, as 076's `network`): a list of source records with `baseUrl`, `hosts`, `label` and `ed25519`. When set it replaces the default: the project is not contacted and its download list is hidden. An empty list means no downloads.
- **FR-112** **Fail closed.** A policy present but unreadable counts as both features off and no sources (076 FR-010..FR-012). `worldsPolicyFrom(layers)` is pure like `requireOsSandboxFrom`, and a non-boolean counts as `false` for the feature.
- **FR-113** **Installed worlds under a policy.** A world from a source that is not allowed, or an own world under `features.userWorlds: false`, is not drawn or removed; it is listed as *Not allowed by your organization*, and the setting falls back to `match`. Built-ins are unaffected.
- **FR-114** **A reader, small (OP-5).** 076 has no reader. So that "forbid" really works on the first ship, P3 builds the first slice: the machine folder only (076 FR-005's trust check), and only the keys of FR-110, FR-111. `[KNOWN GAP]` Group Policy and MDM sources (076 FR-176, FR-177, its own phases), the user layer, and the rest of 076.

#### Performance (hard rule)

- **FR-120** **Budgets.** A world of any origin meets every op row of 097 FR-178's Real office table at 15 and 40 agents; recorded rows go to `check-perf --record` for each `shippable` world (097 FR-187, T163). The 097 mode-switch rows hold for a downloaded world from disk: ≤ 300 ms first at 15 agents, recorded with a fixture pack (T031).
- **FR-121** **What a pack cannot do.** No CSS means no `mix-blend-mode`, `filter`, `backdrop-filter` or animation can arrive in a pack (097 FR-180, FR-182); any light is the shared pre-tinted gradient. Dialogs in a world get the opaque token surface. A `panel-frame` backdrop is already a baked picture.
- **FR-122** **Picture area.** The FR-042 part caps and two desk sizes are what the area row needs; `check-office-ops` runs per pack in the world matrix and refuses `available` above 4 (FR-035).
- **FR-123** **Validation off the office.** Validation and re-encoding run in the encoder window and asynchronously in main, so a running office shows no long task from them beyond the 097 rows; `sim:` long-task count during a fixture import.
- **FR-124** **Order.** No world of this spec reaches a release before 097 FR-179 is met (FR-035). Phases P1-P3 can merge earlier only with no available world and no maker visible.

#### User-made: the hand path

- **FR-130** **Instructions in the app.** **Make your own world…** shows, when no ready adapter has `imageGen` (or on request), the steps: get the prompts, make the images in any tool, put them in one zip, upload. Plain words; no knowledge of blocks needed.
- **FR-131** **Prompt pack.** **Save the prompts…** writes a folder (main opens the picker; overwrite refused) of `README.txt`, one text file per part with the exact prompt, the size, background and framing, and `world.template.json`. Generated from one source (`src/shared/worldprompts.ts`, a `<<<PLACE`/`PLACE>>>` slot for the person's idea) that is also used by the in-app path and the project's own art runs, so the three never drift. Every prompt carries the exclusion clause of FR-010 and "no real person". It costs nothing and uses no network.
- **FR-132** **Fewest pictures.** The prompts follow the mockup's method: one back-wall sheet cropped to the fixtures (with cut lines in the template), then floor, wall, desk, window, lift, welcome. Frames (`speech-bubble`, `slip`, `panel-frame`) may be left out by choice: they fall back to the photo world's frames, labelled (FR-034).
- **FR-133** **Upload.** **Upload a world…**: main's picker, zip or folder (`pickFolder` for folders, same file-set rules). Then FR-051, FR-052, FR-053, FR-055; the report (FR-056); a preview; **Try it** (try bar, 040 FR-021); **Save**, **Discard**. Nothing is stored before Save. Name given by the person, plain text.
- **FR-134** **Own worlds are user data.** Never synced, uploaded, committed or logged; labelled *Uploaded*, *Made with <app>*, or *Imported*.
- **FR-135** **What is not checked.** Durbar cannot judge what a picture shows. `[KNOWN GAP]` a person's own world can contain anything, including arches; FR-010 reaches it only through the prompts. An imported world says "Made by someone else; pictures are not checked for content."

#### User-made: in the app

- **FR-150** **Only where it exists.** Offered for ready adapters with `imageGen` (096 FR-003; today Codex with a ChatGPT sign-in, `docs/agent-apps.md`). `AgentAdapter` stays the only route: no vendor name in the renderer beyond the adapter's own display name (constitution II).
- **FR-151** **Honest before it starts.** Cost line (`oneShotCostLine`; "part of your ChatGPT plan's usage"), number of pictures, the estimate ("about a minute per picture", 096, not measured for this job), 096 FR-034's API-key refusal, and 096 FR-035's note about the copies Codex keeps. One click starts; Cancel stops at the next picture.
- **FR-152** **The description.** At most 300 code points, cleaned as 096 FR-011, in the guard wrapper as 096 FR-012 with the FR-010 clause; sent to the app once per picture (a world is many pictures; #933's "once" holds per picture) and **never stored or logged**. The manifest stores no description from it. Idea chips as 096 FR-013: places and moods, not countries' stereotypes.
- **FR-153** **A job, part by part.** Pictures one at a time, in main, each through FR-051's equivalents, `lstat` and FR-052, FR-053 (096 FR-020..FR-023; one temp folder per picture, removed). A failed part is marked and the job goes on. **Redo** one part. The try lives in main's memory or a dot folder until **Save** and goes on a new try, Discard, quit or 30 minutes.
- **FR-154** **Fake generator.** The simulator and tests use 096 FR-070's fake, extended to the parts here (drawn on a canvas, 0 credits). Real image generation is never part of CI.

#### Export

- **FR-160** **Export** writes a stored zip (the FR-085 writer) of the validated parts and a `world.json` with only FR-040's fields, no origin details, by main's picker, with no overwrite. Built-ins and non-own downloaded worlds cannot be exported in v1 (they are downloadable; a licence question otherwise).
- **FR-161** **Import is upload.** An exported pack goes through FR-133 in full; there is no trusted path for "my own export".

#### Provenance

- **FR-170** **Project art.** `worlds/<id>/ASSETS.md` per picture or source sheet: tool and version (Codex image generation, codex-cli version), date, maker, approver (Vikram), the exact prompt, how it was cut and re-encoded, licence (097 FR-063, FR-064), `owner-check` with name and date. A sibling of `test:realoffice-assets` checks it (every file listed and every listed file present, the exclusion clause present). `worlds/<id>/` holds no generated originals.
- **FR-171** **Art pipeline.** Spec 098 FR-080's art-pipeline spec (Paco's side, not written) is followed when it exists; until then FR-170. Country worlds use no crew art, so 097 Q6's approval per picture is not needed; photo-world people are the owner's approved set.
- **FR-172** **Cost.** Real image runs are made only for project art by the owner's agent on his plan (issue #932: approved for these worlds), in small batches, and are not part of any check. C2PA and other metadata are stripped, as 097 FR-069 says: `ASSETS.md` is the record.

#### Checks (0 AI credits, no network in `npm test`)

- **FR-180** **Tests.** `test:worldzip` (hostile zips), `test:worldpack` (manifest, parts, anchors, tokens, coverage), `test:worldstore` (temp, rename, caps, links, damage, revocation), `test:worldsource` (hops, hashes, signature, rollback, oversize, policy; an injected request layer, in the style of `test-officialinstall.ts`), `test:world-catalogue` (FR-035, FR-085, FR-170), `test:worldipc`. A synthetic fixture pack lives in `scripts/fixtures/worlds/`, drawn by script, with no generated art.
- **FR-181** **Drivers.** `check-worlds` (simulator; the dialog, notice, report, try bar and manage rows, at both sizes, every wait `until()`), `check:office` and `check-office-ops` with the fixture world at 15 and 40 agents. In the world matrix (098 FR-050..FR-052) each country is a world; the path filter gains `worlds/**`. Weekly run time grows with 11 more worlds: `[KNOWN GAP]` not measured; shard per world if it passes the job's limit.
- **FR-182** **`real:` list** (never CI): a real release download on each OS (T043), proxy and organisation source (T053), real Codex generation (T062), the real-GPU run for a country world (097 FR-189), the owner's look at each world.

#### Relation to other specs

- **FR-190** **Changes to other specs** (written into each `## Changes` by T002 after #921, #925, #936 land, so this PR does not edit the same lines):
  - 097 FR-060: built-in worlds ship; other worlds do not. FR-112's "offered worlds equal the registry's shippable worlds" holds for built-ins and the project's catalogue. FR-114's value gains `p--<id>`, `s-…`, `u-…`. FR-100: a world may use `people: "office"`.
  - 098 FR-011, FR-030: new block `room` (office-floor, lobby, empty-office, first-run name it), and `person` may be `shared`; FR-031, FR-032 use the shared validator; `worlds[id].pack` may be `worlds/<id>`; FR-052's filter gains `worlds/**`. FR-040's world-CSS rule is untouched (a pack has no CSS).
  - 096 FR-022: the encoder job takes a list of targets. 077 FR-057 was already changed by 096.
  - 076 FR-158: the two new features; a reader's first slice (FR-114).
  - 097 FR-023, FR-117 and 098 FR-030: fixtures stand on the floor line (FR-019); fixture boxes are the same in every world. #932's Mediterranean note is replaced by FR-014.
  - 101 (#930, open): a pack supplies no icon; the top bar follows the pack's tokens, and a world with no icon of its own uses the base icon.

### Key Entities

- **World pack**: `world.json` plus parts from the closed list. Data and art only.
- **Installed world**: key, origin, version, state (`ok`, `unfinished`, `damaged`, `not-allowed`), hashes, size.
- **Source**: id, label, base URL, hosts, trust (`pinned` or Ed25519 key).
- **Catalogue**: per source, the worlds on offer, `revoked`, `sequence` (non-project).
- **Try**: an unsaved upload or generation, in main, with its report.
- **Prompt pack**: the text files a person generates pictures from.
- **Provenance record**: per picture, for project art.

## Success Criteria *(mandatory)*

- **SC-001** Starting the app and opening every worlds screen makes no connection of this feature; each connection follows a notice naming its host (`test:`, `sim:` request log).
- **SC-002** All hostile packages in the fixture set (at least 30) are refused with nothing left on disk and no write outside the temp folder.
- **SC-003** One changed byte in any pack, catalogue or signature is detected, and the pack is not used.
- **SC-004** Every available world shows all 26 moments, passes the 15-agent fit at 1440x900 and 1280x800, and meets the op rows of the Real office table.
- **SC-005** A window changes no fixture or visitor position by a single pixel.
- **SC-006** A person with no image-making app gets from "I want my own world" to a saved world using only what the app gives them; a first person's run is recorded (`real:`, one person, T060).
- **SC-007** The app grows by the catalogue only, under 64 KB, however many worlds exist.
- **SC-008** A country pack stays under 4 MB and every pack under 10 MB.
- **SC-009** Under a forbidding or unreadable policy, no download starts, in main, whatever the window sends.
- **SC-010** `npm test` and CI use 0 AI credits and no network for this feature.
- **SC-011** At thumbnail size a reviewer tells every project world from every other, each pair differs in all seven items of FR-014, and no fixture cutout is shared.
- **SC-012** Every fixture stands on the floor line within 2 px; every window is band height and overlaps no fixture box.
- **SC-013** A user-made world close to another gets a warning and can still be saved.

## Assumptions and honest limits

- **Colours of postboxes** come from the colour list of Wikipedia's *Post box* article, read 2026-10-31 (https://en.wikipedia.org/wiki/Post_box), as data: yellow for Spain, Switzerland, France, Germany, Greece; red for Mexico, Australia (plus yellow for Express Post), India, Italy, UK; blue for the USA. Swiss Post's own history page supports yellow (https://site.post.ch/en/about-us/company/history-of-swiss-post/1932-the-ptt-brand). One design blog says Italy's boxes are yellow (https://www.underconsideration.com/speakup/archives/002728.html), against Wikipedia's red; Mexico has one source only. **No source gave country-by-country shapes**, so FR-011's shapes are this spec's own descriptions for a picture, to be settled by the owner's look.
- `[KNOWN GAP]` FR-016 cannot judge "substantially different": a card is a claim about a picture and the thresholds are not set yet; the thumbnail review (FR-017) decides. FR-018 compares only with what is on the machine.
- Sizes (about 2.5 MB a pack), the time to generate a world and the weekly matrix's growth are estimates, not measurements.
- `release-assets.githubusercontent.com` was seen in one redirect on 2026-10-31; nothing guarantees it stays.
- Nothing was run: no download, zip reader, validator or picture exists yet. The security design was read against the existing code and specs, with no real attack test.
- `[KNOWN GAP]` Windows and macOS file behaviours (long paths, a Unicode-normalising file system) are covered by pure tests of the name list until CI's real platforms run the store tests; on-device checks are as constitution VI says.
- `[KNOWN GAP]` Depends on drafts: 096 (pipeline), 097 P1 (#921), 097's budgets (#936), 098's checks. Their numbers are quoted from the branches on 2026-10-31.
- `[KNOWN GAP]` A local program with write access to `userData` can change a store; FR-062 catches accidents and pack edits, and a program that also rewrites `installed.json` is out of scope.
- `[KNOWN GAP]` The hash of a project pack is only as trustworthy as the unsigned app that holds it (FR-080).
- Licences: project art MIT (097 FR-064); third-party licences are shown as given and not verified.

## Open points for the owner

Each has a recommendation; the spec follows it until told otherwise.

- **OP-1 Trust for the project's source.** Hashes pinned in the app (no key to guard, a new world arrives with a daily release) or a signed catalogue fetched between releases (needs a signing key and a secret, which is a repo setting). **Recommendation: pinned**; the signature code exists anyway for other sources.
- **OP-2 `worlds-*` releases.** AGENTS.md asks approval for a non-daily release, and its rework rate counts published releases. **Recommendation: a standing OK for asset-only `worlds-*` releases (`latest=false`, no build), and count them out of rework rate**; the second needs one line in AGENTS.md's triage section with the owner's yes.
- **OP-3 Art in the repo.** About 2.5 MB per world version under `worlds/<id>/` (reviewable, CI can test it, reproducible hash), against art only in releases (the repo stays smaller, CI needs a download). **Recommendation: in the repo.**
- **OP-4 Who can add a source.** Organisation policy only in v1, or a user-facing *Add a source* too. **Recommendation: organisation only now**; the code path is ready, and a project domain is a one-line change later.
- **OP-5 Policy before first ship.** 076 has no reader, so "a corporate policy that forbids it" would be only a `[KNOWN GAP]`. **Recommendation: build FR-114's small slice in P3**, so a forbidding policy works from the first release; the rest of 076 stays its own work.
- **OP-6 First batch of places.** **Recommendation: Spain (a sample exists), Greece, then one per owner's look**, in small batches on your ChatGPT plan; all eleven are shown as *Coming* from the start. Each world is about 15 pictures by FR-132 (estimate).
- **OP-7 Order of the two paths.** **Recommendation: hand path (P5) before in-app (P6)**: it has no dependency on spec 096's build and probes, and it hardens the validator on hostile input first.
- **OP-8 Windows in cave and loft.** Allowed by the decision on every world. **Recommendation: optional there; Paco decides for his crews' worlds** (097 Q6); photo first.
- **OP-9 Shared people, always?** D4 follows #932. A later choice of per-world people would raise a pack to about 10 MB and bring likeness checks per pack. **Recommendation: keep shared; user-made people stay with spec 096's My characters.**

## Constitution check

- **I Spec Kit**: this PR is spec, plan, tasks; no `src/` change.
- **II Adapters**: generation goes through `imageGen` only; no vendor types in the renderer or `src/shared`.
- **III Safe by default**: nothing connects unasked; packs are data; decoding in a sandbox; IPC decided in main; no secret, token or telemetry; no shell.
- **IV No AI credits**: fixtures and the fake generator; real runs are separate and named.
- **V Calm, legible UI**: tool surfaces by tokens, 10.5 px, 15 agents at both sizes, packs cannot change layout or motion. State never by colour alone: *Coming*, *Unfinished*, *Damaged*, *Not allowed* are words.
- **Releases** (Additional Constraints): a `worlds-*` release holds assets only and builds no app, so the tag-triggered draft rule for app builds is not touched (OP-2).
- **VI Parity**: `path`, closed name list, Windows names refused on every OS; Electron's network stack; real checks listed.
- **VII Quality gates**: six test scripts, drivers, world matrix; screenshots at both sizes in each UI PR.
- **VIII Honest limits**: listed above and tagged.

## Changes

### 2026-10-31: every world looks different (owner decision)

Replaces the earlier decision that places may share a Mediterranean feel. New FR-014..FR-019, SC-011..SC-013, a rewritten FR-011 and FR-021, FR-035 (g). Written before this spec's first PR, so no build is affected.
