# Feature Specification: Worlds and character sets on demand

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Worlds and character sets as two flat lists of untrusted data packs (owner decisions, Vikram 2026-10-31; #932, #933): any set in any world, downloaded on demand with a plain internet notice from an extensible source, made in the app or by a prompt pack, and shared; one validator for all
note: spec, plan, tasks only; nothing built; art stays outside the repo until each world's own task; first ship waits for spec 097 FR-179
status: draft
-->

**Feature Branch**: `102-worlds` (spec); code branches `102-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: Draft (2026-10-31). Spec, plan and tasks only; nothing is built. OP-2, OP-3, OP-4, OP-7 and OP-9..OP-13 are decided by the owner (spec 021 FR-066, FR-067, FR-072). OP-1 and OP-5 are agent decisions the owner may change. OP-8 is Paco's.

**Input**: Owner requests and decisions (Vikram, 2026-10-31), recorded on issues #932 and #933 and restated in the coordinator's brief:
- **Two flat lists, no families** (owner's final decision, spec 021 FR-067; replaces "crews pick their world"): worlds and character sets are separate packs, any set works in any world, and each world names one default set (FR-200..FR-212). The list of worlds is in FR-011.
- The list of worlds is FR-011; the owner discarded the country and kingdom worlds on 2026-11-01 (*Changes*). No country's flag, no tourist cliches, and no arches outside FR-210 (FR-010). Each world has a postbox of its own, described rather than copied from real marks.
- **Every world looks substantially different from every other** (owner decisions, 2026-10-31 and 2026-11-01): a different arrangement of people on the floor, a different monitor design, different light and mood, not a re-skin of one layout. The same set of fixtures with the same meaning in every world, placed by its arrangement; packs do not reuse another world's fixture cutouts. Fixtures stand on the floor line rather than floating on a wall. For user-made worlds this is a warning, not a block.
- Windows only on wall that already exists: full band height, in fixed wall area, overlapping no fixture; fixtures keep their size and position; lobby visitors may stand in front of windows so they stay a good size.
- Worlds download on demand. The UI says plainly that it is connecting to the internet and from where. The source is extensible: default the project's GitHub repo; later a domain or an organisation's own location.
- People may add their own source in Settings, not only organisations, and may create and share worlds with others (owner decision, later the same day; it replaces "organisation only" in the first draft). A user-added source cannot be pinned by hash in the app, so FR-093..FR-099 spell out what it gets instead.
- User-made worlds: in-app generation is a first-class path (the flat AI theme maker is retired, spec 040 FR-031); where the connected app cannot generate images, instructions and a prompt pack, and people upload a package. An upload is untrusted input.
- Performance is a hard rule: a new world's first ship waits for spec 097 FR-179 (the Real office op rows, FR-180, FR-182, flat tasks T156..T159).
- Every world supplies the moments of spec 098's registry, live screens and animation, at 15 agents at 1440x900 and 1280x800; a pack missing some is flagged, not shipped as finished.
- No AI credits in checks. Real image runs stay on the owner's ChatGPT plan and get recorded provenance like the existing `ASSETS` files.

**Experience**: tool surfaces (the worlds dialog, the download notice, the maker dialog: tokens only, spec 098 FR-040) plus world moments filled by a pack from shared blocks (all 26 of the registry, FR-030). No new world moment.

## Why one spec, and a new one

Both issues need the same core: **a world pack that arrives from outside the app, is treated as hostile, and is validated, stored and drawn without code**. #932 brings it over the internet, #933 from a person's disk or an agent app. Two specs would either duplicate the validator or make one depend on the other's draft. So one spec, phased so the hand-made path and the download path can land apart (P3, P5, P6).

It is not a delta of 097 or 098: it adds Durbar's first user-started downloads of content, a source model, a signature check and a zip reader; 097 is the renderer and 098 the repo-wide contract. Number **102**. Checked 2026-10-31 against `main` (up to 098), remote branches (`099-autopilot`, `100-mcp-context`, `101-logo-family`, the 097 branches) and open PRs (#923 = 099, #924 = 100, #930 = 101): nothing uses 102. Numbers here are this spec's own: FR-001..FR-213 (sparse by group), SC-001..SC-018, T001..T121 (sparse by phase).

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
| Confirm dialog with focus trap and keyboard contract | `askDialog` (`src/renderer/dialog.js`, spec 003 FR-033) | built | The notice and confirms (FR-077) |
| Reading a network failure into words | `classifyFailure` (`src/shared/updatecheck.ts`), the `'network'` wording in `harnesses.js` | built | FR-075's failure classes |
| WebP chunks and an `ASSETS.md` table | `webpInfo`, `assetRows` (`scripts/test-crew-assets.ts`) | built | `test:world-packs`, FR-170's check |
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

- **D1 Packs are data and art only.** No script, HTML, CSS, SVG, font or URL in a pack, from any source, the project's included. Positions come from the 097 engine and motion from a fixed list named in the manifest; a pack at most selects one arrangement by id from a closed list in code (FR-226 on #990). This is what makes a third-party pack safe to draw at all.
- **D2 The project's catalogue ships inside the app.** Listing worlds needs no network; hashes of project packs are pinned in the app (FR-080), so the project needs no signing key and no secret, and GitHub serving wrong bytes cannot change a picture.
- **D3 Three kinds of trust.** The project: hashes pinned in the app. A source with a key (an organisation's, or a person's who pastes one): a signed catalogue, the public key in the source record and never in the catalogue (FR-082). A source a person adds without a key: nothing proves who made it, so Durbar says so, remembers what it saw and shows every change (FR-093..FR-099). All three end in the same hostile-pack validator, except the one difference FR-054 names for pinned project bytes.
- **D4 Worlds and sets are separate** (owner's final decision; replaces "shared people"). A world pack holds no people and names one default set (`defaultSet`, FR-040). Any set with the full pose contract (FR-204) works in any world. People stay separate from the place a world shows, so no ethnicity is tied to a place unless a person chooses it (issue #932).
- **D5 One format everywhere**: a zip whose file names are from a closed list (a hand-made folder goes through the same file-set rules). The path of a stored file is built by Durbar from the list, never from the archive (FR-050).
- **D6 Nothing connects by itself.** No background catalogue fetch, update check or download. Every connection follows a click on a notice that names the host (FR-070, FR-072).
- **D7 Art in the repo; what ships is few.** Downloadable sources under `worlds/<id>/` and `sets/<id>/` are committed and reviewed, built reproducibly into a zip, and left out of the app bundle (FR-085). Shipped worlds and their default sets live in the app (FR-213).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a world (Priority: P1)

In Settings, under the World row, I open **Get more worlds…** and see the worlds: finished ones with their size, the rest as *Coming*. I choose Barcelona beach. Before anything is sent the app tells me it is connecting to the internet, to which host, how much it will download and what that server sees. I click Download, it arrives, and I can use it, offline from then on.

**Why this priority**: it is the owner's delivery decision, and the rest of #932 depends on it.

**Independent Test**: fixture pack and a fake request layer; no network, no AI credits.

**Acceptance Scenarios**:
1. `test:` **Given** a new install, **When** the app starts in either mode and the dialog opens, **Then** no request of this feature is made (injected request layer: zero calls).
2. `sim:` **Given** the dialog, **When** I choose an available world, **Then** a notice names "connects to the internet", the source's name, the real host, the size and what the server sees, and the driver's wrapped bridge shows `world:download` not sent until I press Download. (The simulator never connects, so a request log there proves nothing; main's side is scenario 1's and T038's.)
3. `test:` **Given** a downloaded pack whose hash differs from the catalogue by one byte, **Then** nothing is stored, no temp file remains, and the world is not offered.
4. `test:` **Given** a redirect to a host not on the source's list, **Then** the next request is never made and the message names the refused host.
5. `test:` **Given** an installed world and a request layer that refuses and records everything, **When** main loads and serves every part, **Then** zero requests are made; `sim:` the same pack draws in full.
6. `real:` **Given** the first real `worlds-*` release, **Then** one download on Linux, macOS and Windows arrives from GitHub and passes the hash.

### User Story 2 - Worlds that never look alike (Priority: P1)

Each world is its own place: its own arrangement of people on the floor, its own monitor, its own light and mood, its own materials: no country's flag, landmark, religious building or caricature, and no arch outside FR-210. Two worlds are never mistaken for each other, even as thumbnails: a new wall, floor and desk on one seating plan is a re-skin, not a new world. Each has a postbox that fits it, and a view where it has a window. The set of fixtures and their meaning, words, status lights and live screen text are the same as in every other world.

**Independent Test**: `test:world-packs` on each pack, world matrix, the owner's look per world.

**Acceptance Scenarios**:
1. `test:` **Given** a catalogue entry `available`, **Then** its pack passes the block test, all 26 moments are covered, `ASSETS.md` has every picture with its prompt, the prompts carry the exclusion clause, and the owner's approval field is filled; any one missing fails `test:world-catalogue`.
2. `sim:` **Given** each available world and 15 agents at 1440x900 and 1280x800, chat closed and open, **Then** `check:office` passes (no overlap, no clipped text, no text under 10.5 px, no office scroll), live screens update, people animate, and reduced motion stops them.
3. `test:` **Given** a world with and without windows, **Then** every fixture and visitor rectangle is identical at both sizes.
4. `read:` **Given** each world's pictures, **Then** the owner has looked at them and recorded the check (`ASSETS.md`); a machine cannot judge a cliche.
5. `test:` **Given** two worlds' cards that name the same arrangement, monitor, mood, wall, floor, desk, fixture style, plants or motif, or light temperatures under 200 K apart, **Then** `test:world-catalogue` fails and names the pair and the item.
6. `sim:` **Given** a pack whose fixture picture repeats another world's, exactly or nearly, **Then** `check-world-distinct` fails and names both files.
7. `read:` **Given** the contact sheet of all worlds at thumbnail size, **Then** the reviewer can tell every world from every other at a glance, by seating plan and screen shape as well as colour, and records it (`distinct-check`) before the world becomes `available`.
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

### User Story 4 - Make a world in the app (Priority: P1)

Where a connected app can generate images, this is the way to make something new: the flat AI theme maker is retired for it (spec 040 FR-031). I describe a world and watch it fill block by block. I see the time and cost honestly first, can cancel, redo one part, try it, save it or discard it.

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

### User Story 7 - Add a source, and share a world (Priority: P2)

A friend or a community hosts worlds. I paste the address in Settings. Before anything connects, the app names the host, says the project has not checked it, and asks me. Its worlds always show where they came from. I can also make a world and send the file to someone, and their app treats that file like any other stranger's pack.

**Why this priority**: owner decision: worlds are something people make and share, not only something the project ships.

**Independent Test**: fixtures and an injected request layer; 0 AI credits; no network.

**Acceptance Scenarios**:
1. `sim:` **Given** Add a source, **When** I type an address, **Then** the warning names the host and says it was not checked, and the wrapped bridge shows no `world:sourceAdd` before I confirm.
2. `test:` **Given** `http:`, a user or query in the URL, `localhost`, `127.0.0.1`, `[::1]`, `[::ffff:127.0.0.1]`, decimal and hex IP forms, `10.0.0.1`, `169.254.169.254`, a name resolving to a private address, or a redirect to any of them, **Then** no request reaches it and the reason names the host.
3. `test:` **Given** a redirect to another host, **Then** the next request is never made and the reason names that host.
4. `test:` **Given** a body larger than declared, a false `Content-Length`, a declared size over the cap, or a server that sends one byte a second, **Then** reading stops at the cap or the time limit, and nothing is kept.
5. `test:` **Given** a source that later serves other bytes for a world, with or without a new version, **Then** the installed world is unchanged, the change is shown with old and new size and a warning if the version did not rise, and nothing is replaced until I accept and it has passed the validator again; a lower version is refused.
6. `test:` **Given** a world named `Photo office`, `PHOTO OFFICE`, `Photo offıce` or `Рhoto оffice` (other scripts), **Then** the list shows the name with its source and a warning that it resembles a project world; **Given** a host in another script, **Then** it is shown in its ASCII `xn--` form.
7. `test:` **Given** a shared pack claiming `id: "photo"`, a project source or origin, a project hash or our source URL in any field, **Then** the unknown fields are refused, main assigns its own key, and the world is labelled *Imported*. Only main's own pinned download can show *Agent Durbar project*.
8. `test:` **Given** a catalogue with a query, path or absolute URL as a file name, **Then** it is refused.
9. `test:` **Given** `features.userSources: false`, or a host not on `worlds.userSourceHosts`, **Then** the add is refused in main, whatever the window sends, and an installed world from it is not drawn.

### User Story 8 - Any characters in any world (Priority: P1)

I choose a world, and its people come with it. If I pick characters myself, they stay with me when I change world. My old setup looks the same after the update. Only what I chose is loaded.

**Independent Test**: fixture sets at each level; simulator; no credits.

**Acceptance Scenarios**:
1. `test:` **Given** each row of FR-207's table, **Then** the migrated pair draws what the old setting drew, a second run changes nothing, and no request is made.
2. `test:` **Given** every world, choice and level, **Then** `peopleFor` follows FR-202's order.
3. `sim:` **Given** the default in Photo office, **When** I switch to Cave, **Then** people become Prehistoric; **Given** an explicit Cheeky, **Then** Cheeky stays.
4. `sim:` **Given** a heads-only set picked, **When** I choose a picture world, **Then** the default draws, the row says Flat only, and returning to Flat restores the pick.
5. `test:` **Given** a set with one required frame missing, **Then** `checkSet` names that person and pose; with no full person it is `heads`; with no heads it is refused.
6. `sim:` **Given** Flat with any full set, **Then** heads draw at every density.
7. `test:` **Given** a chosen world and set, **Then** no other pack's file is read.

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
- **An explicit set that is heads-only, in a world with pictures**: the world draws its default set, the choice is kept, and the Characters row says "<set> is Flat only: it has no Real office poses" (FR-202).
- **A world's default set is not installed**: FR-202's order; a download never starts by itself.
- **A chosen set from a source later disallowed by policy**: as FR-113, the default draws and the choice is kept.

## Requirements *(mandatory)*

### Functional Requirements

#### Worlds offered

- **FR-001** **Three origins.** A world is `built-in` (097 FR-100), `downloaded` (from a source) or `own` (uploaded, generated or imported). Built-ins never need a network. The World row (097 FR-114) lists installed worlds of every origin; **Get more worlds…** opens the tool-surface dialog.
- **FR-002** **Available or coming.** A catalogue entry is `available` (has a file and passes the gate, FR-035) or `coming` (a name only, shown disabled as *Coming*). The picker never waits for all the art (issue #932). Every downloadable world in FR-011's list starts as `coming`.
- **FR-003** **Flat loads nothing.** With the Flat world chosen, no world file is read and no world pack is fetched (097 FR-061); only the chosen set's heads load. `check:office` holds as today except for what the removal deltas change (spec 035 FR-017, spec 017 FR-029).
- **FR-004** **No IPC or engine fork.** Downloaded and own worlds go through 097's one world seam; the renderer asks main for bytes by world key and part name, and never holds a path or URL.

#### The worlds

- **FR-010** **Art brief: every world is its own place** (owner decision, Vikram, 2026-11-01). A world differs from every other in the **arrangement of people on the floor**, the **monitor design**, and its **light and mood**, as Cave, Durbar hall and Barcelona beach differ. A new wall, floor and desk on one layout is a re-skin, not a new world, even when every material row differs (FR-014). Words, status lights and live screen text stay the app's. In every picture and prompt: **no country's flag, national emblem, logo, text, religious building or symbol, landmark, stereotype, national caricature, or arch, vault or arcade** (openings have straight heads), except the arches FR-210 allows. **The one allowance: invented flags carrying our golden logo mark** (the owner approved them in the Durbar hall). People are not drawn in the room art.
- **FR-011** **The worlds.** One flat list; each row names its default set. *Ships* means in the app, once it passes every gate of FR-035; *Download* means by FR-070. The art briefs are aligned with the art card of 2026-10-31 (a card the art agent keeps extending; the card and the owner's look may refine a row), and written so that every item differs in every pair (FR-014). Plant lists were trimmed against the card where two worlds shared a species. A light temperature is a target for the picture and a card field, not a measured value.

  | World | Id | From | Default set | Delivery |
  |---|---|---|---|---|
  | Flat | `flat` | Today's clean look, for people who want flat; no pictures, not in FR-014 | Minimalist (a saved theme's own figures while one is in use, FR-203) | Ships |
  | Retro game | `retro` | A real world from today's Retro Pixel | Retro pixel people | Ships, in the release that removes the Retro Pixel theme (OP-12) |
  | Photo office | `photo` | 097 | Office people | Ships |
  | Cave | `cave` | 097 | Prehistoric | Ships, after Paco's art approval and every gate |
  | Cheeky loft | `loft` | 097 | Cheeky | Ships, after Paco's art approval and every gate |
  | User-made and shared | `u-…`, `s-…` | FR-130, FR-150, FR-161, FR-093 | Named by the pack, FR-202 | Own |

  **No downloadable world has a row here yet.** Barcelona beach comes with the delta on #990 (FR-235 there). Durbar hall stays the owner's direction and the Pirate ship deck is not discarded (Paco's approval pending); neither has a row yet (`[KNOWN GAP]`). The pack, download and validation requirements below hold for any world.

  | World | Wall | Floor | Desk | Fixture style | Light | Plants | Signature |
  |---|---|---|---|---|---|---|---|
  | Retro game | Pixel-art indigo wall blocks | Pixel-art checked tiles | Blocky beige pixel desk with a chunky monitor | Pixel arcade cabinets | 7200 K, cool glow, in dithered pixels | One blocky pixel pot plant | A visible pixel grid over everything |
  | Photo office | From its approved art; the card records it (T093) | Same | Same | Same | 4100 K | Same | Same |
  | Cave | From its art; the card records it, and Paco approves crew-world art (097 Q6) | Same | Same | Same | 2000 K, flame | Same | Same |
  | Cheeky loft | From its art; the card records it, and Paco approves crew-world art (097 Q6) | Same | Same | Same | 3500 K | Same | Same |

  The table has no arrangement, monitor or mood column: for these worlds the cards record them from their art (FR-016, T119).

  Views and postboxes (FR-012); every postbox stands on the floor or on a post from the floor (FR-019), and may share a colour with another world's:

  | World | View through a window | Postbox, described |
  |---|---|---|
  | Retro game | Pixel skyline with no real building | Pixel-art mailbox on a post |
  | Photo office, Cave, Cheeky loft | As their art | As their art |

- **FR-012** **Each world has its own postbox, described, not copied.** It is the `post` fixture (098 FR-030), in a colour and plausible form that suit the world. No postal logo, horn, crown, royal cypher, company name, lettering, or a copy of a specific model. Shapes are this spec's description, and the owner's look decides.
- **FR-013** **Same fixtures everywhere.** Every world has the same set of fixtures (Library, Boss door, Bank and so on) with the same meaning, drawn in the world's fixture style and placed by its arrangement. Their words are the app's, unchanged per spec 036 FR-003 and 098 FR-043.
- **FR-014** **Every world looks substantially different from every other** (owner decisions, Vikram, 2026-10-31 and 2026-11-01). Between any two worlds with art in the project (every row of FR-011 but Flat), **all** of these differ: the arrangement of people on the floor, the monitor design, light temperature, mood, wall, floor and desk materials and colours, fixture style, plants, and one signature motif. They can be told apart at a glance at thumbnail size, by seating plan and screen shape as well as colour. **A new wall, floor and desk on the same layout is a re-skin, even when every material row differs**: 16 such mockups looked the same to the owner. The monitor part and the closed list of arrangements are the delta on #990 (FR-220, FR-226 there): positions never come from a pack. **No two project worlds share an arrangement** (OP-13). **Fixture positions belong to the arrangement**: the same set of fixtures and the same meaning in every world, not the same boxes (FR-013), so fixtures may live in the room. **What stays the same**: the set of fixtures and their meaning, words, status lights and live screen text (098 FR-030, FR-033), and each lobby place's `realHeight`: one fixed real-world height per lobby place (a Boss door, a Bank counter), the same in every world, so people keep one scale against fixtures everywhere (097 FR-117). It is a constant in `worldpack.ts`, taken from the photo world; a pack cannot set it and a `realHeight` in `world.json` is refused. A motif obeys FR-010: it is never a flag, emblem or landmark.
- **FR-015** **No reused cutouts.** A pack does not reuse another world's fixture cutouts, whether copied, recoloured or re-encoded: each world's fixtures are made for it (FR-132's sheet is per world).
- **FR-016** **Machine checks, as far as a machine can.** Each project world has `worlds/<id>/card.json` (not in the pack), naming the ten items of FR-014; built-ins have one too. `test:world-catalogue` fails on any pair with the same arrangement, monitor, mood, wall, floor, desk, fixture style, plants or motif (normalised text), or light temperatures under 200 K apart; a card cannot prove the picture matches it, which is why FR-017 exists. `scripts/check-world-distinct.js` (simulator, decodes in Electron, weekly and on the PR subset) compares each pair: exact file hash of each fixture, a perceptual hash of each fixture, and average colour of wall, floor and desk. An exact copy always fails. **No near-match threshold is set yet: until T097 sets them from real packs, near results are only reported, and the thumbnail review (FR-017) decides.** After T097 a near result fails; thresholds then move only by evidence (097 FR-190's rule).
- **FR-017** **Review step.** Before a world's first image run, its card is compared with all others and any overlap is fixed (a batch of pictures costs plan usage; a card costs nothing). Before `available`, `scripts/world-contact-sheet.js` makes one artifact (never committed, 098 FR-054's rule) with every world in the same simulator scene at about 320x200, and the reviewer records `distinct-check` (name, date, how many worlds compared) in the new world's `ASSETS.md`. A world whose seating plan and screen shapes match another's at that size is not a new world. A world that can be mistaken for another at that size goes back to art, and either world may be the one that changes.
- **FR-018** **User-made worlds: a warning, not a block.** For an upload, generated world, import or non-project pack, the encoder compares fixtures and colours with the built-ins and worlds on this machine, without network. If close, the report says "This looks very close to <world>; you can still save it." Save stays available. Only the report carries it: no state, no label after saving.
- **FR-019** **Fixtures stand on the floor.** Every fixture, the postbox included, stands on its floor line, wherever its arrangement places it; none floats on the wall or hangs without a visible support to the floor. Refused when the fixture's lowest opaque pixels are not on its `floorLine` within 2 px (FR-055). A wall-box look is drawn on a post or plinth. A person standing there keeps 097 FR-117.

#### Windows on existing wall

- **FR-020** **Allowed in every picture world, built-in ones too** (owner decision), through the new optional `room.windows` part (FR-041). A world is not required to have them; an existing world adds them only as an art change approved by its art owner (097 Q6 for crew worlds).
- **FR-021** **Only on fixed wall area; full band height; no overlap.** Windows go in the wall areas left between the fixture boxes of the layout (owner decision). A window's box is a straight-sided rectangle (in a world FR-210 allows arches, the picture may show an arch inside it), exactly as high as the lobby band and never over a fixture box: it does not intersect any fixture box by a pixel. The engine places windows after fixtures and never feeds them into layout. An area narrower than the picture's minimum width gets no window; a window that would cost space is left out.
- **FR-022** **Fixtures and people do not change.** Fixture sizes and positions, band height and desk layout are the same with and without windows (`test:realoffice-layout`, exact rectangles, both sizes, 1..15 agents, all 9 places plus 3 custom), and the same test checks each window's height equals the band's and that it intersects no fixture box. Fixture positions come from the world's arrangement (FR-014), and a window never moves them.
- **FR-023** **Visitors may stand in front.** Paint order is floor, wall, windows, fixtures, visitors, plates; a visitor keeps its 097 FR-117 scale and foot line, and 097 FR-025's crowding never shrinks a person because of a window. Plates and chips stay on opaque surfaces, so a window never puts text on a picture.
- **FR-024** **Calm.** A window is a still picture: no moving clouds or animated view, no animation budget used. Ambient dimming (097 FR-043) applies to it like the rest of the art.

#### Moments, screens and animation

- **FR-030** **Coverage is computed.** A shared pure function `momentCoverage(pack)` (`src/shared/worldmoments.ts`) gives, per registry moment, `covered` or the missing parts, from the blocks the moment names (098 FR-012) and the required parts of those blocks. `test:world-packs` keeps its moment-to-block map equal to `docs/experience/world-moments.json`, since the app does not read the registry (098 FR-010).
- **FR-031** **Required extras.** A moment needing more than its block list says names it in the map: `first-run` needs `room.welcome`, `floor-change` needs `lift.rideCover` and a `rideStyle`. `building-preview` stays optional (097 FR-105).
- **FR-032** **Live screens and animation come from the app.** A pack gives `desk-screen.screenRect`, `callAnchor` and light-slot shapes; app text goes in as `textContent` (097 FR-030, FR-031) and poses are the people's. The validator refuses a `screenRect` smaller than 097 FR-032 needs at the half-size desk, so a pack cannot make screens unreadable.
- **FR-033** **Motion is named, not supplied.** `rideStyle` is one of `doors`, `gate`, `drop`; light shapes come from 098's fixed list. No keyframe, duration or easing in a pack.
- **FR-034** **Flagged, not shipped as finished.** A pack with any uncovered moment is `unfinished`. Project catalogue: it cannot be `available` (`test:world-catalogue`). Non-project source: listed as *Unfinished: <n> parts missing* before download. Own world: may be saved, labelled wherever listed, with the missing moments named; missing parts draw the `photo` world's art (issue #933). `unfinished` is one word used everywhere, and a world's status never hides it.
- **FR-035** **The gate for `available` in the project's catalogue, and for a world to ship in the app.** All of: (a) spec 097 FR-179 is met: the Real office op rows and FR-180, FR-182 hold in `check-office-ops`, and T156..T159 are ticked in `specs/097-real-office/tasks.md` (`test:world-catalogue` reads the ticks). **T156..T159 and FR-179 land through #936, which must merge first**: T036 builds on them, and until they exist a task that cannot be found counts as not met, so `available` is refused; (b) `test:world-packs` passes and FR-030 is all `covered`; (c) the registry row is `shippable` under 098 FR-024; (d) `check:office` and the world matrix pass at 15 agents at both sizes; (e) provenance (FR-170); (f) the owner's check is recorded per world; (g) FR-016's checks pass and `distinct-check` is recorded (FR-017); (h) its default set is full and installed or available (FR-204, FR-206). Own worlds and the maker UI also wait for (a) before any release has them (097 FR-179 names user-made worlds).

#### Pack format

- **FR-040** **`world.json`** (at most 64 KB, `v: 1`): `formatVersion`, `id`, `name` (1-40 code points, plain text), `version` (integer, up to 9 digits), `defaultSet` (a built-in set's id, or a set from the same source; FR-202), `tokens` (070 types only), `lights` (shape per slot), `rideStyle`, `parts` (part name to anchors and, for downloaded packs, sha256 and bytes), optional `description` (at most 200 code points, plain text), optional `licence` (at most 40 code points). A field not listed is refused; 098 FR-031's refusal of position, size and layout values stands. Parsed with own-property readers. Packs set no words: tool and scene words are the app's.
- **FR-041** **Parts: the closed file list.** Fixed names under 098's blocks, plus one new block `room`:
  - `room`: `wall.webp` (repeating, at most 120 KB), `floor.webp` (at most 40 KB, 097 FR-062), `welcome.webp` (at most 150 KB), optional `window-1.webp`..`window-3.webp` (at most 60 KB each, opaque rectangles, drawn at band height, each with a minimum width);
  - `fixture`: `fx-library`, `fx-software`, `fx-terminal`, `fx-web`, `fx-boss`, `fx-coffee`, `fx-bank`, `fx-post`, `fx-tools`, `fx-kiosk` (`.webp`, at most 120 KB each);
  - `desk-screen`: `desk.webp` and `desk-half.webp` (097 FR-183: two sizes, at most 60 KB each);
  - `lift`, `speech-bubble`, `slip`, `panel-frame`: names and caps as 098 FR-030.
  - `person`: none; a set is its own pack (FR-205, D4). There is no door or board block (spec 017 FR-030).
- **FR-042** **Size.** Whole pack at most 10 MB (097 FR-115, a hard cap); by the part caps a world pack is at most about 2.5 MB (arithmetic, not measured); a project pack over 4 MB fails `test:world-catalogue`. At most 40 files. The zip adds no compression (WebP is stored). Every picture's natural size is capped so that the 097 FR-178 area row (at most 4x the shown device-pixel area) can hold: a fixture, a window and `wall.webp` at most 300 px tall, `welcome.webp` at most 1920x1200; `test:` per part.
- **FR-043** **Format version.** `formatVersion` 1 is this contract. Durbar refuses a higher one before download or reading parts, and keeps reading older ones; adding a block that a pack may omit does not raise it.

#### Validation: every pack, every source

- **FR-050** **One validator, four entrances.** Download, upload, generate and import all end in `src/shared/worldpack.ts` plus the encoder. `test:world-packs` uses the same functions (098 FR-032), so the repo's rule and the app's rule cannot differ. No stored path comes from a pack: Durbar writes `<store>/<key>/<name>` only for a `name` it found by exact match in its own list.
- **FR-051** **Zip reader** (`src/shared/worldzip.ts`, pure, from a Buffer, no dependency; D5). Refused, with a plain reason:
  - file over the cap, by `lstat` before reading (upload 64 MB, download FR-081);
  - a name not on the list, after no normalisation at all: `../`, `..\`, absolute paths, drive letters, `:` streams, backslashes, nested folders, a NUL, control characters, trailing dots or spaces, Windows reserved names, case or Unicode variants, duplicates; a single top-level folder is the one allowance for hand-made zips;
  - symlink or any non-regular file by its external attributes; encrypted entries; ZIP64; multi-disk; any method other than store and deflate;
  - central directory and local header disagreeing (name, sizes, method); entries that overlap; bytes before the first entry or after the end record (polyglots);
  - more than 96 raw entries, or more than FR-042's 40 kept parts (one named constant each); one image over 20 MB (096 FR-020), or over 128 MB in all, by declared size and enforced by `maxOutputLength` while inflating, so a zip bomb stops at the cap.
  - **What real tools add is allowed and ignored, by exact shape**: folder entries; `.DS_Store`, `Thumbs.db` and `__MACOSX/._<name>` where `<name>` passes the same name rules. They count toward the 96, and are never inflated, decoded or written. A streaming flag (local sizes 0, then a data descriptor, as macOS's archiver may write) is accepted when the central directory and descriptor agree. A person using their OS's own Compress command must not be refused. `[KNOWN GAP]` until samples from macOS Archive Utility, Windows Explorer and Linux `zip` are in the fixtures (T018).
- **FR-052** **Every file**: an allow-listed type by magic bytes, not by name: PNG or WebP (096 FR-021). JPEG, GIF, SVG, HTML, BMP, ICO, AVIF and anything else are refused; a `.webp` holding SVG or text fails the magic. Header dimensions are read before decoding: each side at most 4096 px and in the part's range; animated WebP (`ANMF`) and APNG (`acTL`) are refused.
- **FR-053** **Decode only in the sandbox.** Hostile bytes never reach the office window or main's decoder. Uploaded, generated and non-project packs go through the 096 FR-022 encoder window (no Node, no network, session cancelling every request, `default-src 'none'`), destroyed after each job; each file is re-encoded to WebP at 0.80, with metadata stripped, and main re-checks the output (096 FR-023, `webpcheck.ts`: size, dimensions, only `VP8X`, `VP8 `, `VP8L`, `ALPH` chunks, the part's byte cap). The reason is real: an image decoder bug in a normal window would be code execution with the app's bridge.
- **FR-054** **Project packs are decoded but not re-encoded.** Their bytes are reviewed and pinned (FR-080), and a second lossy pass would harm them; they are still decoded in the encoder window and pass main's output check. If the hash does not match they never get that far.
- **FR-055** **Anchors and tokens.** Anchors in 0..1 and sizes in 098's ranges; a shared floor line and top line (097 FR-023) are checked from each fixture's alpha by the encoder, within 2 px (FR-019). For hand-made packs anchors default from alpha (the 096 FR-025 method) and are shown for review, `[KNOWN GAP]` no anchor editor in v1. Tokens: `checkUserManifest`'s value rules (040 FR-006), no `url(`, no font name outside the app's list, `themeIssues` and `contrastFix`, reported as "colours adjusted for contrast"; status colour meanings fixed (070 FR-050). Text still unreadable after repair refuses the tokens, and the world uses the base theme's.
- **FR-056** **Report.** The validator returns a list of `{part, ok, reason, moments[]}` in plain words, with no value from the pack beyond its already-sanitised name. Reasons never include a path from outside the temp folder. Text from an agent app goes through 096 FR-032: mask, then cut (`redactMarkdown`, `maskHomePaths`), on every surface it reaches, tooltips and accessible names too.

#### Store and loading

- **FR-060** **Store.** `userData/worlds/<key>/`, with key `p--<id>` (project), `s-<sourceId>--<id>` (other source) or `u-<random>` (own, id from main). Never in a repo or inside the app. Temp is a dot folder, moved by rename once fully checked; leftovers are removed at start, and every removal `lstat`s first and never follows a link out of the store. Replacing a world is two renames (old to a dot folder, new into place, then delete the old), because Windows cannot rename over a folder; a crash between them is repaired at start, by keeping whichever is complete. A stored `installed.json` holds origin, source id, version, sha256 per part, size, date and state, never a description, prompt or path.
- **FR-061** **Caps.** At most 64 installed worlds and 500 MB together; a download or save over that is refused with a plain sentence and a button to **Manage**. **Manage** is the section of the worlds dialog listing every installed world, one row each: name, origin (*Built in*, source label, *Uploaded*, *Made with <app>*, *Imported*), version, size on disk, state in words, and the actions that apply: Update (FR-100), Remove (FR-101), Export (FR-160), Download again (FR-062). It reads from main with no network, shows the total against the caps, and has keyboard-reachable rows with accessible names. Built-ins show no size or actions.
- **FR-062** **Re-check at load.** Before bytes go to the window: regular file, no link, size within the cap, sha256 equal to `installed.json`. A mismatch, or an unreadable or malformed `installed.json`, marks the world *Damaged*, never trusted: not drawn, with Remove and, where a source has it, Download again. Reads are asynchronous and one world at a time, within the mode-switch budget (FR-120).
- **FR-063** **To the window.** Bytes go over a `world:part` channel and become `blob:` URLs as 096 FR-043 (CSP `img-src` gains only `blob:`, added by 096 or whichever comes first); they are revoked on a world change. `file:` and custom protocols are not used. Switching worlds drops the old pictures (097 FR-115).
- **FR-064** **Owner-only IPC.** `world:list`, `world:catalogue`, `world:download(key)`, `world:cancel`, `world:remove(key)`, `world:sourceAdd` (with main's token), `world:sourceRemove`, `world:sourceCheck`, `world:part(key, name)`, `world:upload` (main opens the picker), `world:saveTry`, `world:export`, `world:prompts`, `world:generate`, `world:regenerate`. All through `ipcHandle` and `fromApp`, keys and part names checked against main's lists, closed to the simulator guard list, the MCP tools and remote control. The window never sends a URL, host or path.
- **FR-065** **Pack text stays out of agents.** A world's name, description and licence are never passed to an agent app, prompt, MCP answer, chat channel or log (AGENTS.md *Untrusted content*).

#### Sources and the internet notice

- **FR-070** **Safe by default.** Nothing of this feature touches the network without a click on a notice that was just shown. Not at start, not on opening Settings, not for updates. The simulator never gets here (081 FR-020's guard).
- **FR-071** **Source record.** `{ id, label, baseUrl, hosts[], trust }`, in one list in main. `trust` is `pinned` (the project's catalogue in the app), `{ ed25519: <public key> }` with a signed catalogue fetched from `baseUrl`, or `first-seen` (a person's source without a key, FR-096). `label` is the project's or the organisation's words; a person's source has none, and is shown by its address (FR-095).
- **FR-072** **The notice** (a tool-surface dialog, no art behind text). Before any request, in words: **"This connects to the internet."** Then the source label and the real host; for the project, "github.com, the Agent Durbar project's releases. The file itself comes from release-assets.githubusercontent.com, GitHub's download server."; the size; "That server sees your IP address, as with any download. Nothing about your agents or folders is sent."; buttons **Download (connects to the internet)** and **Not now**, with the safe one focused. The host is taken from the URL that will be requested, not from any label. It is shown every time, with no "don't ask again". A non-project source adds its status: "Set by your organization", or for a person's source "Added by you. The Agent Durbar project has not checked it." The same notice precedes a catalogue fetch.
- **FR-073** **The default source.** `project`: `https://github.com/three-feathers/agent-durbar/releases/download/<tag>/<file>`, hosts `github.com` and `release-assets.githubusercontent.com` (a 302 between them was seen on 2026-10-31, on a real asset of v0.1.4 `real:`). GitHub could change the second host; a refused host then fails plainly and an app update fixes the list. `[KNOWN GAP]` until checked per release.
- **FR-074** **Request shape.** `makeDownloadGet`: `credentials: 'omit'`, no cookies, no session partition with a sign-in, `FIXED_HEADERS`, `redirect: 'manual'`, at most 3 hops, `https:` only, each hop checked against `hosts` before it is asked for, system proxy and OS certificates (076 FR-155), 120 s total. No query string or other identifier is added. README's *Safety model* gets 081's style of table: contacted, when, sent. GitHub's public `download_count` will rise per download: the one thing a person's download leaves behind, stated there.
- **FR-075** **Progress and failure.** Bytes as text and a bar, Cancel works at any point and leaves nothing. Failures say which host and what to do: offline or blocked ("Could not connect to <host>. Check your connection, or your organisation may block it. Worlds you already have keep working."), not found, too large, hash mismatch ("The file did not match what Agent Durbar expected, so it was not used."). No automatic retry.
- **FR-076** **Offline.** Installed worlds need nothing from the network. Listing the project catalogue needs nothing. Non-project catalogues show their last fetched copy with its date, labelled; a world whose download fails leaves the current world unchanged.
- **FR-077** **Dialogs behave.** The notice, confirm and report use `askDialog` (`dialog.js`): `role="dialog"` with `aria-modal`, the focus trap, Escape never confirms, focus returns on close. A disabled *Coming* row says why in text. Download progress, completion, failure and the near-another-world warning reach a live region. The UI announces success only when main says it acted; a refused action gives main's reason.

#### Integrity

- **FR-080** **Project catalogue, pinned.** `worlds/catalogue.json` (copied into the app) lists per world `id`, `name`, `state`, `version`, `formatVersion`, `tag`, `file`, `bytes`, `sha256`, and a list `revoked` of pack hashes. No key, no secret and no signing service: the catalogue has the same trust as the app that carries it. Honest limit: builds are unsigned (constitution VIII), so this is no stronger than the installed app.
- **FR-081** **The hash comes first.** A download is held in memory, capped at the catalogue's `bytes` and never over 12 MB; any other length fails. SHA-256 is compared before the bytes are parsed at all; only then the zip reader, then per-part hashes from `world.json`.
- **FR-082** **Non-project sources.** `<baseUrl>/catalogue.json` (at most 256 KiB), and for a source with a key `catalogue.json.sig` (detached Ed25519, Node `crypto`). The key is in the source record, set by whoever added the source. With a key, a bad or missing signature means nothing from that fetch is used; without a key there is no signature to check, and FR-096 applies. Pack hashes in a catalogue are always checked, keyed or not. A catalogue's `file` is one plain file name under `baseUrl` from a closed character set: no slash, query, fragment or scheme, so it cannot point elsewhere or tag a person with a unique link. A catalogue has at most 256 worlds and 1024 `revoked` hashes, deduplicated with a `Set`; own properties only, all or nothing. A signed catalogue has an integer `sequence`; a lower one than last seen is refused (rollback). `[KNOWN GAP]` freeze: a source that keeps serving an old catalogue is not detected. Key rotation means a new source record; a catalogue can never change its own key.
- **FR-083** **Revocation.** A pack whose hash is in the catalogue's `revoked` list (a likeness report under 097 FR-068, a bad pack) is not drawn and is removed, with a note. `[KNOWN GAP]` for project packs this arrives only with an app update.
- **FR-084** **Published assets never change.** A new pack is a new version, file name and hash; an asset is never overwritten, so older apps keep working. Removal happens only for a revocation.
- **FR-085** **Reproducible.** `scripts/world-pack.js` builds `worlds/<id>/` into a stored zip with fixed order and timestamps. `test:world-catalogue` rebuilds it and compares it with the catalogue's hash, offline, so the catalogue provably matches the reviewed files. `worlds/` art is not in the app (`scripts/copy-assets.js` copies only the catalogue; `test:` on the file list). The world matrix reads `worlds/<id>/` from the checkout, with no network.
- **FR-086** **Publishing.** Packs go up as assets of a `worlds-<YYYY-MM-DD>` release, at any time: there is no daily rhythm and no need for new worlds every day (spec 021 FR-066). It is marked `latest=false`, so that the app's update and release pages keep pointing at `v*`. It does not trigger `release.yml` (tags `v*`). It has the owner's standing OK (OP-2). A check after upload compares the real asset's hash with the catalogue (0 AI credits; T043, `real:`).

#### What a third-party source can and cannot do

- **FR-090** **Can**: list worlds with names and sizes, and supply packs that pass the same validator, no exceptions (FR-050, FR-053). It learns the IP address, the time and the requested files, and it can offer pictures that are ugly or offensive: Durbar does not judge them.
- **FR-091** **Cannot**: run code; supply CSS, HTML, SVG, fonts or scripts; supply a position or invent a layout (it may only select one arrangement by id from the project's closed list in code, FR-226 on #990), change sizes, words, statuses or status colours; draw on tool surfaces; make the app fetch anything but the catalogue, signature and pack from its listed hosts; redirect elsewhere; name its worlds as built-ins or another source's (FR-060), or show itself as the project (FR-095); change a world already installed without the person accepting it (FR-096); change its key, add sources, or change a setting or policy; start a download; or reach an agent, a prompt or MCP (FR-065). It cannot read anything local: requests carry no cookie or credential.
- **FR-092** **URL rules**: `https:` only, no user, password, query or fragment in the URL, a host list of at most 4 names, loopback, link-local, multicast, unspecified, private and metadata addresses refused before each hop as 076's URL rules say (IP literals in every form, IPv4-mapped IPv6, `localhost`, `*.local`), and behind a proxy as 076 says; private ranges only for hosts in `network.trustedHosts`, which a person cannot set. `[KNOWN GAP]` DNS rebinding, as 076 says.
- **FR-093** **People can add a source** (owner decision), in **Add a source…** in the worlds dialog, as well as an organisation by policy (FR-111). An optional key field makes it `ed25519`; left empty it is `first-seen`. At most 8 of a person's sources; each one has Remove, which asks whether to remove its worlds too. A project domain later is a change of the default record's hosts, not this path.
- **FR-094** **An explicit add, with a plain warning.** Main parses the address first and refuses by FR-092 before any connection. Then, before any request: **"This connects to the internet, to <host>. The Agent Durbar project has not checked this source or its worlds. Worlds from it can only show pictures; they cannot run code, but the source sees your IP address and can change what it offers."** Buttons **Add and connect to <host>** and **Not now**, the safe one focused. Nothing is typed-and-saved: without the click there is no record and no request. Main issues the one-use token as for FR-072.
- **FR-095** **The UI always shows a world's source.** Everywhere a world is listed or named, the World row, the dialog, Manage, each notice and the try bar: *Agent Durbar project*, *Set by your organization: <label>*, the full address of a person's source (`github.com/someone/worlds`, because a host alone would make any GitHub repo read like ours), *Uploaded*, *Made with <app>*, or *Imported*. It comes from main's own record, never from a pack or catalogue. Hosts show in ASCII (`xn--…`). *Agent Durbar project* is only for bytes matching the app's pinned hash through FR-080.
- **FR-096** **No silent change.** No background fetch and no auto-update from any source. **Check for new worlds** on a source follows a notice. For a `first-seen` source Durbar remembers each world's version and pack hash from its first download. A changed hash is shown as a change, with old and new size, *Update* needing a click, a fresh FR-072 notice, the full validator again, and the old version kept until that passes (FR-100). A changed hash with the same `version` gets the warning "This source changed this world without a new version." A lower `version` is refused. A world the source stops listing stays installed, labelled "No longer offered by <address>". `[KNOWN GAP]` a source can serve different people different files; nothing here detects that.
- **FR-097** **Look-alike names.** A world's name is compared, by case fold, NFKC, diacritics removed, a small table of confusable letters and spaces removed, with built-ins, the project's catalogue and other installed worlds. A match gets "This name looks like <world> from <its source>", and FR-095's source beside it; it is a warning, not a block, since the source is what tells them apart. A mixed-script name gets the same warning. Bidi and control characters are removed (*Edge Cases*).
- **FR-098** **A shared pack cannot claim to be ours.** `world.json` has no source, origin, author or signature field: any such field is refused as unknown (FR-040). Its `id` never becomes a key: main makes `u-<random>` for an import, and `s-<sourceId>--<id>` for a source. A shared file whose bytes equal a project pack is still *Imported*; the only way to get the project's label is the project's pinned download.
- **FR-099** **Slow, large and hostile answers.** Every request has a total limit (catalogue 30 s, pack 120 s) on a monotonic clock, so a slow server only times out, and a cap counted on bytes after Chromium's decoding (catalogue 256 KiB, pack FR-081), so `Content-Length`, gzip and chunking cannot exceed it. A declared size over the cap is refused before asking. No retry, and no more than one request at a time to one source. A source's text in errors is never shown, only the host and a fixed reason.

#### Updates and deletion

- **FR-100** **Updates are offered, never automatic.** A newer `version` in the catalogue, arriving with an app update or a source check started by the user (FR-096), shows *Update (<size>)* after a fresh FR-072 notice. The old version keeps working and is replaced by rename only when the new one has passed; a failed update changes nothing.
- **FR-101** **Removal.** Remove, with a confirm, on every installed world; in one step main drops the world from what the window reads and `durbar.world` falls back to `match`, then blobs are revoked and files deleted. A removed world's download can be repeated. Built-ins have no Remove.
- **FR-102** **Uninstall.** The store lives in `userData` and follows what the app does with it today; README says so.

#### Organisation policy

- **FR-110** **Keys, in 076's layers, narrow only.** `features.worldDownloads: false` and `features.userWorlds: false` (076 FR-158, FR-159: this spec adds them, in main and the window, hidden with *Turned off by your organization*). `features.userWorlds` covers upload, generate and import. `features.userSources: false` forbids a person's own sources.
- **FR-111** **`worlds.sources`** (machine layer only, as 076's `network`): a list of source records with `baseUrl`, `hosts`, `label` and `ed25519`. When set it replaces the default: the project is not contacted and its download list is hidden. An empty list means no downloads. **`worlds.userSourceHosts`** (machine layer): a person may add a source only on these hosts. Both are read in main, and refused whatever the window sends.
- **FR-112** **Fail closed.** A policy present but unreadable counts as every feature above off and no sources (076 FR-010..FR-012). So does a read error or timeout. `worldsPolicyFrom(layers)` is pure like `requireOsSandboxFrom`: a non-boolean counts as `false`, `true` in one layer never undoes `false` in another, and one invalid entry in `worlds.sources` makes the list empty, never a shorter list. When a feature turns off, a running download or generation stops and its try is dropped.
- **FR-113** **Installed worlds under a policy.** A world from a source that is not allowed, or an own or imported world under `features.userWorlds: false`, is not drawn or removed; it is listed as *Not allowed by your organization*, and the office draws `match` meanwhile. The stored choice is not rewritten, so it returns if the policy allows it again. Built-ins are unaffected.
- **FR-114** **A reader, small (OP-5).** 076 has no reader. So that "forbid" really works on the first ship, P3 builds the first slice: the machine folder only (076 FR-005's trust check), and only the keys of FR-110, FR-111 (with `features.userSources`). `[KNOWN GAP]` Group Policy and MDM sources (076 FR-176, FR-177, its own phases), the user layer, and the rest of 076.

#### Performance (hard rule)

- **FR-120** **Budgets.** A world of any origin meets every op row of 097 FR-178's Real office table at 15 and 40 agents; recorded rows go to `check-perf --record` for each `shippable` world (097 FR-187, T163). The 097 mode-switch rows hold for a downloaded world from disk: ≤ 300 ms first at 15 agents, recorded with a fixture pack (T031).
- **FR-121** **What a pack cannot do.** No CSS means no `mix-blend-mode`, `filter`, `backdrop-filter` or animation can arrive in a pack (097 FR-180, FR-182); any light is the shared pre-tinted gradient. Dialogs in a world get the opaque token surface. A `panel-frame` backdrop is already a baked picture.
- **FR-122** **Picture area.** The FR-042 part caps and two desk sizes are what the area row needs; `check-office-ops` runs per pack in the world matrix and refuses `available` above 4 (FR-035).
- **FR-123** **Validation off the office.** Validation and re-encoding run in the encoder window and asynchronously in main, so a running office shows no long task from them beyond the 097 rows; `sim:` long-task count during a fixture import.
- **FR-124** **Order.** No world of this spec reaches a release before 097 FR-179 is met (FR-035). Phases P1-P3 can merge earlier only with no available world and no maker visible.

#### User-made: the hand path (where the connected app cannot generate images)

- **FR-130** **Instructions in the app.** **Make your own world…** starts in-app generation (FR-150) when a ready adapter has `imageGen`. When none has, or on request, it shows the steps: get the prompts, make the images in any tool, put them in one zip, upload. Plain words; no knowledge of blocks needed.
- **FR-131** **Prompt pack.** **Save the prompts…** writes a folder (main opens the picker; overwrite refused) of `README.txt`, one text file per part with the exact prompt, the size, background and framing, and `world.template.json`. Generated from one source (`src/shared/worldprompts.ts`, a `<<<PLACE`/`PLACE>>>` slot for the person's idea) that is also used by the in-app path and the project's own art runs, so the three never drift. Every prompt carries the exclusion clause of FR-010 and "no real person". It costs nothing and uses no network.
- **FR-132** **Fewest pictures.** The prompts follow the mockup's method: one back-wall sheet cropped to the fixtures (with cut lines in the template), then floor, wall, desk, window, lift, welcome. Frames (`speech-bubble`, `slip`, `panel-frame`) may be left out by choice: they fall back to the photo world's frames, labelled (FR-034).
- **FR-133** **Upload.** **Upload a world…**: main's picker, zip or folder (`pickFolder` for folders, same file-set rules). Then FR-051, FR-052, FR-053, FR-055; the report (FR-056); a preview; **Try it** (try bar, 040 FR-021); **Save**, **Discard**. Nothing is stored before Save; Discard returns to the person's own stored World choice, `match` included, never to an effective value. Name given by the person, plain text.
- **FR-134** **Own worlds are user data.** Never synced, uploaded, committed or logged, and shared only by the person's own Export; labelled *Uploaded*, *Made with <app>*, or *Imported*.
- **FR-135** **What is not checked.** Durbar cannot judge what a picture shows. `[KNOWN GAP]` a person's own world can contain anything, including arches; FR-010 reaches it only through the prompts. An imported world says "Made by someone else; pictures are not checked for content."

#### User-made: in the app (first-class, OP-7)

- **FR-150** **Only where it exists.** Offered for ready adapters with `imageGen` (096 FR-003; today Codex with a ChatGPT sign-in, `docs/agent-apps.md`). `AgentAdapter` stays the only route: no vendor name in the renderer beyond the adapter's own display name (constitution II).
- **FR-151** **Honest before it starts.** Cost line (`oneShotCostLine`; "part of your ChatGPT plan's usage"), number of pictures, the estimate ("about a minute per picture", 096, not measured for this job), 096 FR-034's API-key refusal, and 096 FR-035's note about the copies Codex keeps. One click starts; Cancel stops at the next picture.
- **FR-152** **The description.** At most 300 code points, cleaned as 096 FR-011, in the guard wrapper as 096 FR-012 with the FR-010 clause; sent to the app once per picture (a world is many pictures; #933's "once" holds per picture) and **never stored or logged**. The manifest stores no description from it. Idea chips as 096 FR-013: places and moods, not countries' stereotypes.
- **FR-153** **A job, part by part.** Pictures one at a time, in main, each through FR-051's equivalents, `lstat` and FR-052, FR-053 (096 FR-020..FR-023; one temp folder per picture, removed). A failed part is marked and the job goes on. **Redo** one part. The try lives in main's memory or a dot folder until **Save** and goes on a new try, Discard, quit or 30 minutes (a monotonic clock).
- **FR-154** **Fake generator.** The simulator and tests use 096 FR-070's fake, extended to the parts here (drawn on a canvas, 0 credits). Real image generation is never part of CI.

#### Export

- **FR-160** **Export** writes a stored zip (the FR-085 writer) of the validated parts and a `world.json` with only FR-040's fields, no origin details, by main's picker, with no overwrite. Built-ins and non-own downloaded worlds cannot be exported in v1 (they are downloadable; a licence question otherwise).
- **FR-161** **Import is upload.** A shared or exported pack goes through FR-133 in full, however it arrived; there is no trusted path for "my own export" or a friend's. The report says "Made by someone else; the Agent Durbar project has not checked it."
- **FR-162** **People may share** (owner decision). Export states before writing that anyone who gets the file can see and pass on the pictures, and that the person is responsible for what they share. It shows the zip's SHA-256 as text to send separately; import shows the same value, so two people can compare them. Nothing is uploaded by Durbar: a person sends the file by their own means.
- **FR-163** **Hosting a source.** `docs/worlds-source.md` documents the catalogue and the file layout, and **Export as a source folder…** writes `catalogue.json` and the zip for any static HTTPS host. `scripts/world-sign.js` (outside the app, key generated and held by the person; Durbar never stores a private key) adds the optional signature.

#### Provenance

- **FR-170** **Project art.** `worlds/<id>/ASSETS.md` per picture or source sheet: tool and version (Codex image generation, codex-cli version), date, maker, approver (Vikram), the exact prompt, how it was cut and re-encoded, licence (097 FR-063, FR-064), `owner-check` with name and date. A sibling of `test:realoffice-assets` checks it (every file listed and every listed file present, the exclusion clause present). `worlds/<id>/` holds no generated originals.
- **FR-171** **Art pipeline.** Spec 098 FR-080's art-pipeline spec (Paco's side, not written) is followed when it exists; until then FR-170. A world with no crew of its own draws no crew art, so 097 Q6's approval per picture is not needed for it; a crew in another world is the same approved crew art, and new full-pose frames of a crew go through Paco per picture (FR-206).
- **FR-172** **Cost.** Real image runs are made only for project art by the owner's agent on his plan (issue #932: approved for these worlds, which were discarded on 2026-11-01; the line stays as history, and new worlds need the owner's new approval), in small batches, and are not part of any check. C2PA and other metadata are stripped, as 097 FR-069 says: `ASSETS.md` is the record.

#### Checks (0 AI credits, no network in `npm test`)

- **FR-180** **Tests.** `test:worldzip` (hostile zips), `test:worldpack` (manifest, parts, anchors, tokens, coverage), `test:worldstore` (temp, rename, caps, links, damage, revocation), `test:worldsource` (hops, hashes, signature, rollback, oversize, policy; an injected request layer, in the style of `test-officialinstall.ts`), `test:world-catalogue` (FR-035, FR-085, FR-170), `test:worldipc`. A synthetic fixture pack lives in `scripts/fixtures/worlds/`, drawn by script, with no generated art.
- **FR-181** **Drivers.** `check-worlds` (simulator; the dialog, notice, report, try bar and manage rows, at both sizes, every wait `until()`), `check:office` and `check-office-ops` with the fixture world at 15 and 40 agents. In the world matrix (098 FR-050..FR-052) each picture world is a world with its default set; the path filter gains `worlds/**`. Weekly run time grows with each world: `[KNOWN GAP]` not measured; shard per world if it passes the job's limit.
- **FR-182** **`real:` list** (never CI): a real release download on each OS (T043), proxy and organisation source (T053), real Codex generation (T062), the real-GPU run for a downloadable world (097 FR-189). The owner's look at each world is `read:` (FR-035 (f), FR-017).

#### Worlds and character sets: two flat lists

- **FR-200** **Two flat lists, no families.** Worlds are FR-011's list. Character sets: **Office people**, **Cheeky**, **Prehistoric**, **Minimalist**, **Retro pixel people** (new), **My characters** (096), and shared sets. Any set works in any world. Each world names one default set.
- **FR-201** **Settings.** A **World** row (Flat first, then the others; it replaces 097's mode button and the Office layout row) and a **Characters** row beginning **World's default (<set name>)**. On the default, people follow the world. An explicit pick sticks across worlds. `world` and `characters` are both in `durbar-settings.json`, through main (`settings:setCharacters`'s path), so policy is checked in one place; `characters: "default"` replaces today's `theme`. Radio groups, keyboard and screen-reader operable, tokens only.
- **FR-202** **One pure seam, `peopleFor(world, choice)`.** In order: an explicit choice, when installed, allowed and usable in this world (full, or any level in Flat); else the world's `defaultSet`; else Office people, which always ship. A world's `defaultSet` naming anything else than a built-in or a set of the same source falls to Office people. A choice that cannot draw is kept, and a one-line note says why. Unit tested over every value, world and level.
- **FR-203** **Flat takes any set by heads.** Today's crew kit draws heads: `working`, `waiting`, `resting` (077 FR-050). A full set gives them from its frames: `typeA`, `waveA`, `rest`, cropped by `faceBox`. Minimalist stays the `office` kit. While a saved theme or Retro Pixel is in use, Flat's default is that theme's own figures (077 FR-065), so its look does not change; its row reads "World's default (the theme's own)".
- **FR-204** **The interoperability contract: every set has the full pose set**, for each person, as in 098 FR-030's `person` block.
  - **Seated states, required**: `typeA`, `typeB`, `waveA`, `waveB`, `think`, `rest`.
  - **Standing activity views, required**: `book`, `coffee`, `tread`, `letter`, `knock`.
  - **Optional, with the only fallbacks**: `box`, `touch`, `tool`, `wait`, each to `letter` (097 FR-024).
  - **Back views, optional, for arrangements that use them** (owner, 2026-11-01: "ok to show back"): `backA`, `backB`, a seated person from behind, with `headTop`, `bodyH` and `floorLine` but no `faceBox`. Hover or keyboard focus shows the big screen as for any desk (097). A set without them draws its front seated frames in those seats, and the report says so, so `full` does not need them and any set still works in any world. `[KNOWN GAP]` no set has them until drawn; crew art approval still applies per image (FR-206, 097 Q6).
  - **Anchors, required**: `headTop`, `bodyH`, `hand`, `faceBox`; `floorLine` on standing frames; `realHeight`, default 1.70 m.
  - **Format**: 098's: WebP with alpha, at most 640 px tall and 80 KB, two sizes (097 FR-183), facing front. Feet on `floorLine` within 2 px by alpha.
  - **Minimum**: one person passes. Fewer than 15 repeats people at 15 agents, and the report says so. A required frame has no fallback.
- **FR-205** **Separate packs, only chosen ones load.** A set is its own pack: `set.json` (`formatVersion`, `id`, `name`, `level`, people and anchors) and frames named `p<NN>-<pose>[-half].webp` from a closed list, at most 20 people, 10 MB (097 FR-062). A set's entry limit is its own constant: at most 600 files, 128 MB for an upload. Sets go through FR-050..FR-056, FR-060..FR-064, FR-070..FR-099 and FR-160..FR-163 with `kind: "set"` in a catalogue, separately downloadable and shareable. Project sets not shipped are committed under `sets/<id>/`, outside the app (OP-3, FR-213); `features.userWorlds` also covers user-made sets. No world fetches a set it does not draw, and no set fetches a world: `test:` request log in main, `sim:` on the window's fetches.
- **FR-206** **The validator check.** `checkSet` in `worldpack.ts` gives each person `full` or the missing poses and anchors, and the set a `level`: **`full`** when at least one person is full (others are dropped, named in the report), **`heads`** when none is but it has the three heads. `test:world-packs` runs it on built-ins. A **heads-only set stays Flat only and says so**, in the row, the report and the note of FR-202. Today's levels, and the art each needs:

  | Set | Level today | To be full |
  |---|---|---|
  | Office people | Full by 097's art (#921; re-checked by the validator, T107) | Nothing |
  | Cheeky | Heads (3 poses, spec 077) | New frames, per picture by Paco (T108) |
  | Prehistoric | Heads (3 poses) | New frames, per picture by Paco (T109) |
  | Minimalist | Heads (the drawn `office` kit) | Full poses like every set; art in progress (T110, OP-11). Until then Flat only, and it says so. Flat keeps drawing the `office` kit |
  | Retro pixel people | Does not exist | New set (T111) |
  | My characters | Heads (096); per character | 096's Real office frames (T112) |
  | Shared | As its validator says | Up to its maker |

- **FR-207** **Migration, once** (the 077 FR-067 pattern: in main on read, written at once, a repeat changes nothing). It keeps each user's look, and it never downloads anything, closes or sends anything.

  | Today | Becomes |
  |---|---|
  | Flat office, Characters `theme` | World Flat, Characters default |
  | Flat office, Characters `minimalist`, `cheeky`, `prehistoric`, `mine` | World Flat, that set as an explicit pick (`minimalist` on Clean equals the default; stored as explicit so a later world keeps it, where FR-202 allows) |
  | Real office, Match, `prehistoric` | World Cave, default (owner's example); Cave not installed: World Photo office, default, and a one-line offer of Cave, since Photo is what they saw (097 FR-083) |
  | Real office, Match, `cheeky` | World Cheeky loft, default; same rule when absent |
  | Real office, Match, `theme` or `minimalist` | World Photo office, default |
  | Real office, Match, `mine` | World Photo office, `mine` explicit, where full; else the default with FR-202's note |
  | Real office, a named world, any Characters value | That world, default, since people always followed the world |
  | A bad stored value | Flat and default |

  Real office is not in a release yet, so its rows matter only for anyone on a build of #921. `durbar.officeview` and `durbar.world` (097, unreleased) are read once and removed; `durbar.doorsigns` is spec 017 FR-034's.
- **FR-208** **Interoperability check, not a full product.** Weekly in the world matrix: each world with its default, and each full set in two worlds, the narrowest and the tallest fixture sets (rotating); `check:office` at 15 agents at both sizes. Whether a set looks right in a world is not judged: style clashes are the person's choice. A set can break no layout because positions come from anchors and the engine.
- **FR-209** **A set's people.** Project sets follow 097 FR-067, FR-068 (fictional, likeness check) and FR-170. Shared sets are as FR-135: `[KNOWN GAP]` a likeness in an uploaded picture cannot be checked by Durbar, and import says "Made by someone else; not checked."
- **FR-210** **A world drawn from a historical court follows its history** (the owner's standing decision: "we follow kingdoms if it has arches, it gets arches"; narrowed 2026-11-01). Arches appear only in a world drawn from a historical court that used them; Durbar hall is one. All other worlds have none. Still in force there: no real palace copied, no real ruler or person, no country's flag or coat of arms, no religious building or symbol, no caricature. The removed court themes' art and words are not reused; tool and place words stay the app's (098 FR-043).
- **FR-211** **Retired AI theme maker, what replaces it.** The flat theme maker is retired (spec 040 FR-031) with P6's PR, so AI creation is never absent; before that it is frozen. Saved themes keep working.
- **FR-213** **What ships, and what it costs** (owner decision, OP-10, OP-12). Flat, Photo office with Office people, Cave with Prehistoric, Cheeky loft with Cheeky; Retro game with Retro pixel people in the release that removes the Retro Pixel theme. Each enters only when it passes FR-035, so a world not approved adds nothing. Estimates, not measurements, from 097 FR-183's photo figure (about 8.7 MB, of which about 0.47 MB a person for 11 frames at two sizes) and FR-042's world caps:

  | Shipped | World | Set | Total |
  |---|---|---|---|
  | Photo office, Office people (15) | included | included | about 8.7 MB (097) |
  | Cave, Prehistoric (6) | up to about 2.5 MB | about 2.8 MB | about 5.3 MB |
  | Cheeky loft, Cheeky (13) | up to about 2.5 MB | about 6.1 MB | about 8.6 MB |
  | **Three real worlds** | | | **about 22.6 MB** |
  | Retro game, Retro pixel people (15) | up to about 2.5 MB | about 1.7 MB, assuming about 10 KB for a pixel frame at two sizes | about 4.2 MB |
  | **With Retro game** | | | **about 26.8 MB** |

  **Caps.** Every pack stays under 097's 10 MB per world with its default set, on these estimates. A cartoon frame may compress unlike a photo-style one (`[KNOWN GAP]`, not measured): Cheeky at 13 people has 73 KB per frame pair before it passes 10 MB. `test:crew-assets`' 2.5 MB holds today's heads only (1.9 MB now); full-pose sets are checked by their own test and do not go in that folder. **New: shipped art at most 30 MB in total** (`test:realoffice-assets`), since no app-wide budget existed. **Retro pixel people's cost**: 15 fictional people × 11 required frames = 165 frames, each with a half size made by the encoder; about 30 image runs on the owner's ChatGPT plan if each person takes one seated and one standing sheet (an estimate; a run was about a minute, spec 096), plus 097 FR-067, FR-068's checks. Sets that do not ship (Minimalist's frames, shared ones) download.
- **FR-212** **Flat is not a registry world.** It has no moments in `docs/experience/world-moments.json`: its surfaces are the flat rendering. FR-014, FR-020 and FR-035 do not apply to it. The Retro game world does not change Flat's theme.

#### Relation to other specs

- **FR-190** **Changes to other specs** (written into each `## Changes` by T002 after #921, #925, #936 land, so this PR does not edit the same lines):
  - 097 FR-060: Flat, Photo office, Cave and Cheeky loft ship, and Retro game from its release (FR-213); other worlds do not. FR-115: its per-world 10 MB cap counts a shipped world with its default set; the path stands. FR-112's "offered worlds equal the registry's shippable worlds" holds for shipped worlds and the project's catalogue.
  - 098 FR-011, FR-030: new block `room` (office-floor, lobby, empty-office, first-run name it), `person` may be `shared`, and `fixture.realHeight` moves from the pack to one constant per place (FR-014); FR-031, FR-032 use the shared validator; `worlds[id].pack` may be `worlds/<id>`; FR-052's filter gains `worlds/**`. FR-040's world-CSS rule is untouched (a pack has no CSS).
  - 096 FR-022: the encoder job takes a list of targets. 077 FR-057 was already changed by 096.
  - 097, on the branch of #925 and on P1's: **FR-100** (crews no longer pick worlds; a cartoon crew may be drawn in the photo office; worlds name a default set; the world list is FR-011), **FR-114** (no *Match my characters*; the World and Characters rows are FR-201, stored as FR-201 says), **T100** (`realOfficeWorld(characters, worldPref)` becomes `peopleFor`, FR-202), **T102** (the Settings rows), **D3, FR-081, FR-083, FR-084** (`realOfficeSet`), **Q6** (crews with their own world becomes a default set), **FR-112** (offered worlds), **FR-001, FR-003, FR-004** and the *Doors you closed* edge case (no third Office layout button, no `durbar.doorsigns`, no "Switch to an open office?" question, no doors; spec 017 FR-029). These lines are not edited here, because #921 and #925 hold them.
  - 098 FR-011: `worlds[id].crews` becomes `defaultSet`; FR-030's `person` block moves to a set pack, with the same rules; FR-032 also checks sets; FR-033 "eight blocks" drops `person` and gains `room`.
  - 098 FR-030: the `person` block gains the optional back views of FR-204.
  - 096 FR-040 and FR-050: `mine` is a set with a level per character; Real office frames follow FR-204.
  - 077 FR-064, FR-065: `theme` becomes `default` (FR-201, FR-203).
  - 021: FR-066, FR-067, FR-068 record the decisions (in this PR).
  - 076 FR-091, FR-158: the three new features here; `allowThemeMaker` and `features.themeMaker` become no-ops (spec 040 FR-031);  a reader's first slice (FR-114).
  - 097 FR-023, FR-117 and 098 FR-030: fixtures stand on the floor line (FR-019); fixture positions belong to the arrangement (FR-014). #932's Mediterranean note is replaced by FR-014.
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

- **SC-001** Starting the app and opening every worlds screen makes no connection of this feature; each connection follows a notice naming its host (`test:` on main's injected request layer; a simulator log alone proves nothing).
- **SC-002** All hostile packages in the fixture set (at least 30) are refused with nothing left on disk and no write outside the temp folder.
- **SC-003** One changed byte in any pack, catalogue or signature is detected, and the pack is not used.
- **SC-004** Every available world shows all 26 moments, passes the 15-agent fit at 1440x900 and 1280x800, and meets the op rows of the Real office table.
- **SC-005** A window changes no fixture or visitor position by a single pixel.
- **SC-006** A person with no image-making app gets from "I want my own world" to a saved world using only what the app gives them; a first person's run is recorded (`real:`, one person, T060).
- **SC-007** The app's shipped world and set art stays at most 30 MB, and a downloadable world adds only its catalogue row, under 64 KB for the whole catalogue, however many exist.
- **SC-008** A project pack stays under 4 MB and every pack under 10 MB.
- **SC-009** Under a forbidding or unreadable policy, no download starts, in main, whatever the window sends.
- **SC-010** `npm test` and CI use 0 AI credits and no network for this feature.
- **SC-011** At thumbnail size a reviewer tells every project world from every other, each pair differs in all ten items of FR-014, and no fixture cutout is shared.
- **SC-012** Every fixture stands on the floor line within 2 px; every window is band height and overlaps no fixture box.
- **SC-013** A user-made world close to another gets a warning and can still be saved.
- **SC-014** Each adversarial case of US7 is refused or shown, in main, with nothing kept; no private, loopback or off-list host receives a request.
- **SC-015** Every listing of a world shows its source, and nothing from outside the app can show *Agent Durbar project*.
- **SC-016** Every full set draws in every world without changing that world's arrangement, at 15 agents at both sizes.
- **SC-017** Every migrated setup draws what it drew before, and migration makes no request.
- **SC-018** With one world and one set chosen, no other pack's files are read.

## Assumptions and honest limits

- `[KNOWN GAP]` FR-016 cannot judge "substantially different": a card is a claim about a picture, and until T097 sets thresholds from real packs the thumbnail review (FR-017) decides; after that it still has the last word on looks. FR-018 compares only with what is on the machine.
- Sizes (about 2.5 MB a pack), the time to generate a world and the weekly matrix's growth are estimates, not measurements.
- `release-assets.githubusercontent.com` was seen in one redirect on 2026-10-31; nothing guarantees it stays.
- Nothing was run: no download, zip reader, validator or picture exists yet. The security design was read against the existing code and specs, with no real attack test.
- `[KNOWN GAP]` Windows and macOS file behaviours (long paths, a Unicode-normalising file system) are covered by pure tests of the name list until CI's real platforms run the store tests; on-device checks are as constitution VI says.
- `[KNOWN GAP]` Depends on drafts: 096 (pipeline), 097 P1 (#921), 097's budgets (#936), 098's checks. Their numbers are quoted from the branches on 2026-10-31.
- `[KNOWN GAP]` A local program with write access to `userData` can change a store; FR-062 catches accidents and pack edits, and a program that also rewrites `installed.json` is out of scope.
- `[KNOWN GAP]` Art: Cheeky, Prehistoric and My characters are heads-only until new frames exist; the Cave and Cheeky loft worlds cannot be `available` before them (FR-035 (h)). Retro pixel people and the Retro game world are plans with no pictures.
- `[KNOWN GAP]` A `first-seen` source gives no proof of who made a world, only that it changed; a person who wants more pastes a key. The look-alike table is small and will miss some letters; the source beside the name is the real defence.
- `[KNOWN GAP]` The hash of a project pack is only as trustworthy as the unsigned app that holds it (FR-080).
- Licences: project art MIT (097 FR-064); third-party licences are shown as given and not verified.

## Open points for the owner

Agent decisions stand until the owner changes them.

- **OP-1 Trust for the project's source: agent decision.** Hashes pinned in the app (no key to guard, a new world arrives with an app release), rather than a signed catalogue fetched between releases (needs a signing key and a secret, which is a repo setting). The signature code exists anyway for other sources. The owner may change it.
- **OP-2 `worlds-*` releases: decided (owner, 2026-10-31).** Asset-only `worlds-*` releases have his standing OK, can happen at any time with no daily rhythm, and are not counted in rework rate (spec 021 FR-066). AGENTS.md carries the lines.
- **OP-3 Art in the repo: decided (owner, 2026-10-31).** Art is committed under `worlds/<id>/`, outside the app.
- **OP-4 Who can add a source: decided (owner, 2026-10-31).** People as well as organisations; people may also create and share worlds (FR-093..FR-099, FR-162, FR-163). An organisation may forbid it or limit it to a list (FR-110, FR-111).
- **OP-5 Policy before first ship: agent decision.** 076 has no reader, so FR-114's small slice is built in P3 and a forbidding policy works from the first release. The alternative was leaving it as a `[KNOWN GAP]`. The owner may change it.
- **OP-7 In-app or by hand: decided (owner, 2026-10-31).** In-app generation is first-class and the flat AI theme maker is retired for it. The hand-made package stays as the route when the connected app cannot generate images. Order of build: P6 needs spec 096's pipeline, P5 shares its validator; whichever is ready first lands.
- **OP-8 Windows in cave and loft: Paco's call.** Allowed by the decision on every world; optional until he decides for his crews' worlds (097 Q6). Photo first.
- **OP-9 People per world: decided (owner, 2026-10-31).** Two flat lists, any set in any world, a default per world (D4, FR-200..FR-212); this replaces shared people and the crew edge case.
- **OP-10 What ships: decided (owner, 2026-10-31).** Flat, Photo office, Cave and Cheeky loft ship, Cave and Loft after Paco's art approval and every gate (FR-213). This changes 097 FR-115's list through T002.
- **OP-11 Minimalist: decided (owner, 2026-10-31).** Full poses like every set; art is in progress (FR-206, T110).
- **OP-12 Retro Pixel theme: decided (owner, 2026-10-31).** It stays until the Retro game world ships, and that world ships in the app in the same release that removes the theme (FR-213, spec 035 FR-019).
- **OP-13 Arrangements against worlds: decided (owner, 2026-11-01, relayed).** The closed list of arrangements grows, and no two project worlds share one ("substantially different"). Photo office keeps `rows`, the baseline. The list and who holds what are on #990 (FR-226). FR-016 fails a shared arrangement.

## Constitution check

- **I Spec Kit**: this PR is spec, plan, tasks; no `src/` change.
- **II Adapters**: generation goes through `imageGen` only; no vendor types in the renderer or `src/shared`.
- **III Safe by default**: nothing connects unasked; packs are data; decoding in a sandbox; IPC decided in main; no secret, token or telemetry; no shell.
- **IV No AI credits**: fixtures and the fake generator; real runs are separate and named.
- **V Calm, legible UI**: tool surfaces by tokens, 10.5 px, 15 agents at both sizes, packs cannot supply a layout or motion. State never by colour alone: *Coming*, *Unfinished*, *Damaged*, *Not allowed* are words.
- **Releases** (Additional Constraints): a `worlds-*` release holds assets only and builds no app, so the tag-triggered draft rule for app builds is not touched (OP-2).
- **VI Parity**: `path`, closed name list, Windows names refused on every OS; Electron's network stack; real checks listed.
- **VII Quality gates**: six test scripts, drivers, world matrix; screenshots at both sizes in each UI PR.
- **VIII Honest limits**: listed above and tagged.

## Changes

### 2026-10-31: every world looks different (owner decision)

Replaces the earlier decision that places may share a Mediterranean feel. New FR-014..FR-019, SC-011..SC-013, a rewritten FR-011 and FR-021, FR-035 (g). Written before this spec's first PR, so no build is affected.

### 2026-10-31: analyze findings and checklist self-review, before review

Applied by decision: `realHeight` fixed per place (FR-014); #936 merges first (FR-035, T036); the thumbnail review decides until T097 sets thresholds (FR-016); Manage defined (FR-061). From `docs/review-checklist.md`: real zip tools' extras and streaming flag (FR-051, T018), Windows-safe replacement and link-safe removal (FR-060), fail-closed policy details (FR-112), the stored World choice kept (FR-113, FR-133), catalogue count caps (FR-082), masking of agent-app text (FR-056), dialog behaviour (FR-077), simulator-only assertions moved to main (US1, SC-001), evidence tags, and all options listed in the open points.

### 2026-10-31: people's own sources and sharing (owner decisions on OP-2, OP-3, OP-4)

OP-2 and OP-3 as recommended. OP-4 changed from organisation-only to people too, with sharing: US7, D3, FR-071, FR-082, FR-090..FR-099, FR-110..FR-114, FR-161..FR-163, SC-014, SC-015, T004, T065..T069. The character rules (D4, OP-9, the crew edge case) are not changed here.

### 2026-10-31: two flat lists, and the owner's final world list (spec 021 FR-067)

D4, OP-7, OP-9 and the crew edge case are replaced; FR-010, FR-011, FR-035 (h), FR-040 changed; FR-011 aligned with the art card; new US8, FR-200..FR-212, SC-016..SC-018, T100..T120. Removals are deltas in their own specs: 035 FR-017..FR-020 (built-in themes), 040 FR-031..FR-033 (AI theme maker), 017 FR-029..FR-035, 044 FR-127, 054 FR-065 (no doors).

### 2026-10-31: owner's answers on OP-10, OP-11, OP-12 (spec 021 FR-067)

Shipped worlds and their cost (FR-213, D7, SC-007); Minimalist to full poses; Retro game ships when the theme goes; `worlds-*` releases at any time. OP-1, OP-5 and OP-6 are marked as agent decisions.

### 2026-11-01: the country and kingdom worlds are discarded; a world differs in arrangement, monitor, light and mood (owner decision, Vikram; spec 021 FR-071)

The owner: the country and kingdom worlds all look the same and are discarded. Worlds must be substantially different, as Cave, Durbar hall and Barcelona beach are: different arrangement of people on the floor, different monitor design, different light and mood, not a re-skin of one layout with a different wall colour. **Discarded:** Spain, Greece, Mexico, Switzerland, USA, Australia, India, Italy, France, Germany, Britain, Calm office, and the Indian, European and Japanese kingdoms. **Not discarded:** what ships per FR-213 (Flat, Photo office, Cave, Cheeky loft, Retro game), and the Pirate ship deck (Paco's approval pending). Durbar hall, Cave's fire ring and Barcelona beach stay the direction; the spec work is on #990. This entry and FR-071 are the only places that still name what went; earlier entries below keep their words.

- **Changed:** FR-010 (no longer "the same layout": it requires the difference; "no flag" became no country's flag, with invented flags carrying our golden mark allowed, as the owner approved them in the Durbar hall), FR-011, FR-012, FR-013, FR-014 (layout left "what stays the same"), FR-016 and SC-011 (ten items, not seven), FR-017, FR-021, FR-171, FR-181, FR-182, FR-212, SC-008, D4, *Input*, US1, US2, US7, US8 (a kept world in each example; the spoofing cases spoof Photo office), plan and tasks to match. Spec 035 FR-017 and FR-020: spec 039 goes `deprecated`, since no kingdom world replaces it.
- **Removed:** the discarded rows of FR-011's three tables; FR-210, and with it the one exception to no arches, so no project world has arches; OP-6 (the first batch was two discarded worlds); the postbox colour sources under *Assumptions*; T080..T090, T114, T116..T118, which were only for discarded worlds. These numbers are not reused.
- **Kept:** every pack, download, source and validation requirement: they are about any world.
- **New:** OP-13. `[KNOWN GAP]` no downloadable world has a row on this branch until #990 lands, so FR-002's `coming` list and P4 are empty here; Durbar hall and the Pirate ship deck have no row at all.

### 2026-11-01: arrangements grow, fixtures belong to them, arches by historical court (owner decisions, relayed by his coordinating agent; spec 021 FR-072)

Replaces, in the entry above, the removal of FR-210, its "no project world has arches" and OP-13 as an open question.

- **OP-13 decided:** the closed list grows, no two project worlds share an arrangement ("substantially different"), and FR-016 fails a shared one. T093 and US2 follow.
- **Arches:** "we follow kingdoms if it has arches, it gets arches". FR-210 is back, narrowed to a world drawn from a historical court that used them, which includes Durbar hall; FR-010 and FR-021 follow. The discarded kingdom worlds stay discarded.
- **Fixtures:** the owner said the centre of a round setup can hold library and boss, and approved the Cave ring. FR-013, FR-014, FR-019, FR-022, T027 and the plan: fixture positions belong to the arrangement; same set and same meaning, not the same boxes.
- **FR-091, SC-016, D1 and the constitution check squared with that.** The project's arrangements are a closed list in code, and a pack only selects one by id; a shared pack still cannot invent a layout or supply a position. **"Packs are data" (D1) is not weakened**: a pack gains one string checked against a constant, runs no code and carries no geometry. What gets more code is the engine, tested per arrangement.
- **FR-172** stays as history; new worlds need the owner's new approval.

### 2026-11-01: back views (owner decision: "ok to show back")

FR-204 gains optional `backA`, `backB` for arrangements that use them, with hover or keyboard focus showing the big screen; FR-190 and T100 follow. Art is later work and a `[KNOWN GAP]` until drawn; crew art approval still applies per image.
