# Feature Specification: Worlds and character sets on demand

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Worlds and character sets as two flat lists of untrusted data packs (owner decisions, Vikram 2026-10-31; #932, #933): any set in any world, downloaded on demand with a plain internet notice from an extensible source, made in the app or by a prompt pack, and shared; one validator for all
note: spec, plan, tasks only; nothing built; first ship waits for spec 097 FR-179; monitor part and arrangements specified; Retro arcade plan (FR-250..FR-270)
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

It is not a delta of 097 or 098: it adds Durbar's first user-started downloads of content, a source model, a signature check and a zip reader; 097 is the renderer and 098 the repo-wide contract. Number **102**. Checked 2026-10-31 against `main` (up to 098), remote branches (`099-autopilot`, `100-mcp-context`, `101-logo-family`, the 097 branches) and open PRs (#923 = 099, #924 = 100, #930 = 101): nothing uses 102. Numbers here are this spec's own: FR-001..FR-214 (sparse by group), SC-001..SC-018, T001..T122 (sparse by phase).

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

- **D1 Packs are data and art only.** No script, HTML, CSS, SVG, font or URL in a pack, from any source, the project's included. Positions come from the 097 engine and motion from a fixed list named in the manifest; a pack at most selects one arrangement by id from a closed list in code (FR-226). This is what makes a third-party pack safe to draw at all.
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
10. `test:` **Given** a person's source whose `revoked` list holds the hash of a project world, another source's world or a person's own world, **Then** none of them changes; a hash of a world installed from that source removes it.
11. `test:` **Given** a catalogue with an unknown field such as `url`, `hosts` or `key`, **Then** the whole catalogue is refused and no new host is ever asked.
12. `test:` **Given** a person's source at `github.com`, **Then** the record's hosts are `github.com` and `release-assets.githubusercontent.com`, the notice names both, and a redirect to any other host is refused; **Given** any other host, **Then** the record holds that host alone.

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
  | Retro arcade (Retro game until 2026-11-01) | `retro` | A real world from today's Retro Pixel; day and night (FR-250..FR-252) | Retro pixel people | Ships, in the release that removes the Retro Pixel theme (OP-12) |
  | Photo office | `photo` | 097 | Office people | Ships |
  | Cave | `cave` | 097 | Prehistoric | Ships, after Paco's art approval and every gate |
  | Cheeky loft | `loft` | 097 | Cheeky | Ships, after Paco's art approval and every gate |
  | Barcelona beach | `barcelona-beach` | The owner's own idea, 2026-11-01 (FR-235) | Office people | Download |
  | Durbar hall | `durbar-hall` | The owner's direction, 2026-11-01 (FR-237) | Office people | Download |
  | User-made and shared | `u-…`, `s-…` | FR-130, FR-150, FR-161, FR-093 | Named by the pack, FR-202 | Own |

  **Pirate ship deck:** not discarded (Paco's approval pending); a row is pending, `[KNOWN GAP]`. The pack, download and validation requirements below hold for any world.

  | World | Wall | Floor | Desk | Fixture style | Light | Plants | Signature |
  |---|---|---|---|---|---|---|---|
  | Retro arcade | Pixel brick: cream by day, navy with neon tubes at night | Pixel diamond lattice: cream by day, dark carpet at night | Arcade cabinet, which is also the monitor (FR-257) | Arcade machines: prize counter, cartridge wall, service panel, pinball table, attract-mode cabinet, change machine, coin vault, ticket dispenser, repair bench | 5600 K day, 7200 K neon dusk, in dithered pixels (FR-268) | Plush prizes in the prize counter; no plant | A visible pixel grid over everything |
  | Durbar hall | Pale carved stone colonnade with cusped arches (FR-210), open to the view | Pale polished marble with a floral inlaid runner along the central aisle | Dark carved wood with gilt | Dark carved wood, brass, gilt | Warm daylight; the temperature goes on the card | None in the room | Flags with our golden mark, and the gold bead monitor |
  | Photo office | From its approved art; the card records it (T093) | Same | Same | Same | 4100 K | Same | Same |
  | Cave | From its art; the card records it, and Paco approves crew-world art (097 Q6) | Same | Same | Same | 2000 K, flame | Same | Same |
  | Cheeky loft | From its art; the card records it, and Paco approves crew-world art (097 Q6) | Same | Same | Same | 3500 K | Same | Same |

  The table has no arrangement, monitor or mood column: for these worlds the cards record them from their art (FR-016, T119).

  Views and postboxes (FR-012); every postbox stands on the floor or on a post from the floor (FR-019), and may share a colour with another world's:

  | World | View through a window | Postbox, described |
  |---|---|---|
  | Retro arcade | None: no window | Red ticket dispenser standing on the floor |
  | Durbar hall | A garden and distant domed buildings, none copied from a real place | Dark carved wood and brass on a plinth, standing in the aisle |
  | Photo office, Cave, Cheeky loft | As their art | As their art |

- **FR-012** **Each world has its own postbox, described, not copied.** It is the `post` fixture (098 FR-030), in a colour and plausible form that suit the world. No postal logo, horn, crown, royal cypher, company name, lettering, or a copy of a specific model. Shapes are this spec's description, and the owner's look decides.
- **FR-013** **Same fixtures everywhere.** Every world has the same set of fixtures (Library, Boss door, Bank and so on) with the same meaning, drawn in the world's fixture style and placed by its arrangement. Their words are the app's, unchanged per spec 036 FR-003 and 098 FR-043.
- **FR-014** **Every world looks substantially different from every other** (owner decisions, Vikram, 2026-10-31 and 2026-11-01). Between any two worlds with art in the project (every row of FR-011 but Flat), **all** of these differ: the arrangement of people on the floor, the monitor design, light temperature, mood, wall, floor and desk materials and colours, fixture style, plants, and one signature motif. They can be told apart at a glance at thumbnail size, by seating plan and screen shape as well as colour. **A new wall, floor and desk on the same layout is a re-skin, even when every material row differs**: 16 such mockups looked the same to the owner. The monitor part and the closed list of arrangements are FR-220 and FR-226: positions never come from a pack. **No two project worlds share an arrangement** (OP-13). **Fixture positions belong to the arrangement**: the same set of fixtures and the same meaning in every world, not the same boxes (FR-013), so fixtures may live in the room. **What stays the same**: the set of fixtures and their meaning, words, status lights and live screen text (098 FR-030, FR-033), and each lobby place's `realHeight`: one fixed real-world height per lobby place (a Boss door, a Bank counter), the same in every world, so people keep one scale against fixtures everywhere (097 FR-117). It is a constant in `worldpack.ts`, taken from the photo world; a pack cannot set it and a `realHeight` in `world.json` is refused. A motif obeys FR-010: it is never a flag, emblem or landmark.
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
- **FR-032** **Live screens and animation come from the app.** A pack gives `desk-screen.screenRect` (on its monitor picture when it has one, FR-220), `callAnchor` and light-slot shapes; app text goes in as `textContent` (097 FR-030, FR-031) and poses are the people's. The validator refuses a `screenRect` smaller than 097 FR-032 needs at the half-size desk, so a pack cannot make screens unreadable.
- **FR-033** **Motion is named, not supplied.** `rideStyle` is one of `doors`, `gate`, `drop`; light shapes come from 098's fixed list. No keyframe, duration or easing in a pack.
- **FR-034** **Flagged, not shipped as finished.** A pack with any uncovered moment is `unfinished`. Project catalogue: it cannot be `available` (`test:world-catalogue`). Non-project source: listed as *Unfinished: <n> parts missing* before download. Own world: may be saved, labelled wherever listed, with the missing moments named; missing parts draw the `photo` world's art (issue #933). `unfinished` is one word used everywhere, and a world's status never hides it.
- **FR-035** **The gate for `available` in the project's catalogue, and for a world to ship in the app.** All of: (a) spec 097 FR-179 is met: the Real office op rows and FR-180, FR-182 hold in `check-office-ops`, and T156..T159 are ticked in `specs/097-real-office/tasks.md` (`test:world-catalogue` reads the ticks). **T156..T159 and FR-179 land through #936, which must merge first**: T036 builds on them, and until they exist a task that cannot be found counts as not met, so `available` is refused; (b) `test:world-packs` passes and FR-030 is all `covered`; (c) the registry row is `shippable` under 098 FR-024; (d) `check:office` and the world matrix pass at 15 agents at both sizes; (e) provenance (FR-170); (f) the owner's check is recorded per world; (g) FR-016's checks pass and `distinct-check` is recorded (FR-017); (h) its default set is full and installed or available (FR-204, FR-206). Own worlds and the maker UI also wait for (a) before any release has them (097 FR-179 names user-made worlds).

#### Pack format

- **FR-040** **`world.json`** (at most 64 KB, `v: 1`): `formatVersion`, `id`, `name` (1-40 code points, plain text), `version` (integer, up to 9 digits), `defaultSet` (a built-in set's id, or a set from the same source; FR-202), `tokens` (070 types only), `lights` (shape per slot), `rideStyle`, `parts` (part name to anchors and, for downloaded packs, sha256 and bytes), optional `arrangement` (FR-226), optional `description` (at most 200 code points, plain text), optional `licence` (at most 40 code points). A field not listed is refused; 098 FR-031's refusal of position, size and layout values stands. Parsed with own-property readers. Packs set no words: tool and scene words are the app's.
- **FR-041** **Parts: the closed file list.** Fixed names under 098's blocks, plus one new block `room`:
  - `room`: `wall.webp` (repeating, at most 120 KB), `floor.webp` (at most 40 KB, 097 FR-062), `welcome.webp` (at most 150 KB), optional `window-1.webp`..`window-3.webp` (at most 60 KB each, opaque rectangles, drawn at band height, each with a minimum width);
  - `fixture`: `fx-library`, `fx-software`, `fx-terminal`, `fx-web`, `fx-boss`, `fx-coffee`, `fx-bank`, `fx-post`, `fx-tools`, `fx-kiosk` (`.webp`, at most 120 KB each);
  - `desk-screen`: `desk.webp` and `desk-half.webp` (097 FR-183: two sizes, at most 60 KB each); `monitor.webp` and `monitor-half.webp` (FR-220); optional `desk-back.webp` and `desk-back-half.webp` (FR-223); `glow.webp`, a strip, one cell per state, with `pixelArt` (FR-260);
  - `room` also: `focus.webp` (FR-227), only with `circle` or `facing-view`; `wall-night.webp`, `floor-night.webp`, `welcome-night.webp`, only with `lightSets` (FR-252);
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
  - **A download, from any source, is narrower:** stored entries only, each within its part cap (FR-041; FR-204 for a set's frames), and 10 MB in all (FR-081). The 20 MB and 128 MB limits and deflate are for uploads, which may hold PNG.
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
- **FR-064** **Owner-only IPC.** `world:list`, `world:catalogue`, `world:download(key)`, `world:cancel`, `world:remove(key)`, `world:sourceAdd`, `world:sourceRemove`, `world:sourceCheck`, `world:part(key, name)`, `world:upload` (main opens the picker), `world:saveTry`, `world:export`, `world:prompts`, `world:generate`, `world:regenerate`. All through `ipcHandle` and `fromApp`, keys and part names checked against main's lists, closed to the simulator guard list, the MCP tools and remote control. The window never sends a URL, host or path. Every channel that starts a request needs FR-072's token.
- **FR-065** **Pack text stays out of agents.** A world's name, description and licence are never passed to an agent app, prompt, MCP answer, chat channel or log (AGENTS.md *Untrusted content*).

#### Sources and the internet notice

- **FR-070** **Safe by default.** Nothing of this feature touches the network without a click on a notice that was just shown. Not at start, not on opening Settings, not for updates. The simulator never gets here (081 FR-020's guard).
- **FR-071** **Source record.** `{ id, label, baseUrl, hosts[], trust }`, in one list in main. `trust` is `pinned` (the project's catalogue in the app), `{ ed25519: <public key> }` with a signed catalogue fetched from `baseUrl`, or `first-seen` (a person's source without a key, FR-096). `label` is the project's or the organisation's words; a person's source has none, and is shown by its address (FR-095). `hosts[]` comes from the app (FR-073), a policy (FR-111) or main's derivation for a person's source (FR-093), and never from a catalogue.
- **FR-072** **The notice** (a tool-surface dialog, no art behind text). Before any request, in words: **"This connects to the internet."** Then the source label and the real host; for the project, "github.com, the Agent Durbar project's releases. The file itself comes from release-assets.githubusercontent.com, GitHub's download server."; the size; "That server sees your IP address, as with any download. Nothing about your agents or folders is sent."; buttons **Download (connects to the internet)** and **Not now**, with the safe one focused. The host is taken from the URL that will be requested, not from any label. It is shown every time, with no "don't ask again". A non-project source adds its status: "Set by your organization", or for a person's source "Added by you. The Agent Durbar project has not checked it." The same notice precedes a catalogue fetch. **One-use token:** when main composes a notice it issues a token bound to that action, world or source, URL, hosts and size, valid once and for 5 minutes on a monotonic clock. Every channel or step that starts a request needs it: `world:download` (an update is a download, FR-100), `world:sourceAdd`, `world:sourceCheck` and any catalogue fetch. With no token, or a stale, reused or other action's token, main makes no request, whatever the window sends.
- **FR-073** **The default source.** `project`: `https://github.com/three-feathers/agent-durbar/releases/download/<tag>/<file>`, hosts `github.com` and `release-assets.githubusercontent.com` (a 302 between them was seen on 2026-10-31, on a real asset of v0.1.4 `real:`). GitHub could change the second host; a refused host then fails plainly and an app update fixes the list. `[KNOWN GAP]` until checked per release.
- **FR-074** **Request shape.** `makeDownloadGet`: `credentials: 'omit'`, no cookies, no session partition with a sign-in, `FIXED_HEADERS`, `redirect: 'manual'`, at most 3 hops, `https:` only, each hop checked against `hosts` before it is asked for, system proxy and OS certificates (076 FR-155), 120 s total. No query string or other identifier is added. README's *Safety model* gets 081's style of table: contacted, when, sent. GitHub's public `download_count` will rise per download: the one thing a person's download leaves behind, stated there.
- **FR-075** **Progress and failure.** Bytes as text and a bar, Cancel works at any point and leaves nothing. Failures say which host and what to do: offline or blocked ("Could not connect to <host>. Check your connection, or your organisation may block it. Worlds you already have keep working."), not found, too large, hash mismatch ("The file did not match what Agent Durbar expected, so it was not used."). No automatic retry.
- **FR-076** **Offline.** Installed worlds need nothing from the network. Listing the project catalogue needs nothing. Non-project catalogues show their last fetched copy with its date, labelled; a world whose download fails leaves the current world unchanged.
- **FR-077** **Dialogs behave.** The notice, confirm and report use `askDialog` (`dialog.js`): `role="dialog"` with `aria-modal`, the focus trap, Escape never confirms, focus returns on close. A disabled *Coming* row says why in text. Download progress, completion, failure and the near-another-world warning reach a live region. The UI announces success only when main says it acted; a refused action gives main's reason.

#### Integrity

- **FR-080** **Project catalogue, pinned.** `worlds/catalogue.json` (copied into the app) lists per world `id`, `name`, `state`, `version`, `formatVersion`, `tag`, `file`, `bytes`, `sha256`, and a list `revoked` of pack hashes. No key, no secret and no signing service: the catalogue has the same trust as the app that carries it. Honest limit: builds are unsigned (constitution VIII), so this is no stronger than the installed app.
- **FR-081** **The hash comes first.** A download is held in memory, capped at the catalogue's `bytes` and never over FR-042's 10 MB; any other length fails. SHA-256 is compared before the bytes are parsed at all; only then the zip reader, then per-part hashes from `world.json`.
- **FR-082** **Non-project sources.** `<baseUrl>/catalogue.json` (at most 256 KiB), and for a source with a key `catalogue.json.sig` (detached Ed25519, Node `crypto`). The key is in the source record, set by whoever added the source. With a key, a bad or missing signature means nothing from that fetch is used; without a key there is no signature to check, and FR-096 applies. Pack hashes in a catalogue are always checked, keyed or not. A catalogue's `file` is one plain file name under `baseUrl` from a closed character set: no slash, query, fragment or scheme, so it cannot point elsewhere or tag a person with a unique link. A catalogue has at most 256 worlds and 1024 `revoked` hashes, deduplicated with a `Set`; own properties only, all or nothing, and a closed schema: a field not listed for a catalogue or world entry (such as `url`, `hosts` or `key`) refuses the whole catalogue. A signed catalogue has an integer `sequence`; a lower one than last seen is refused (rollback). `[KNOWN GAP]` freeze: a source that keeps serving an old catalogue is not detected. Key rotation means a new source record; a catalogue can never change its own key.
- **FR-083** **Revocation, scoped by source.** A catalogue's `revoked` list (a likeness report under 097 FR-068, a bad pack) acts only on worlds installed from that same catalogue: `s-<sourceId>--` worlds from that source's catalogue, and `p--` worlds only from the project's catalogue in the app. A person's own worlds (`u-`: uploaded, generated or imported) are never removed or flagged by any catalogue, whatever hash it lists, and a hash matching a world from elsewhere has no effect. A world it does reach is not drawn and is removed, with a note. `[KNOWN GAP]` for project packs this arrives only with an app update.
- **FR-084** **Published assets never change.** A new pack is a new version, file name and hash; an asset is never overwritten, so older apps keep working. Removal happens only for a revocation.
- **FR-085** **Reproducible.** `scripts/world-pack.js` builds `worlds/<id>/` into a stored zip with fixed order and timestamps. `test:world-catalogue` rebuilds it and compares it with the catalogue's hash, offline, so the catalogue provably matches the reviewed files. `worlds/` art is not in the app (`scripts/copy-assets.js` copies only the catalogue; `test:` on the file list). The world matrix reads `worlds/<id>/` from the checkout, with no network.
- **FR-086** **Publishing.** Packs go up as assets of a `worlds-<YYYY-MM-DD>` release, at any time: there is no daily rhythm and no need for new worlds every day (spec 021 FR-066). It is marked `latest=false`, so that the app's update and release pages keep pointing at `v*`. It does not trigger `release.yml` (tags `v*`). It has the owner's standing OK (OP-2). A check after upload compares the real asset's hash with the catalogue (0 AI credits; T043, `real:`).

#### What a third-party source can and cannot do

- **FR-090** **Can**: list worlds with names and sizes, and supply packs that pass the same validator, no exceptions (FR-050, FR-053). It learns the IP address, the time and the requested files, and it can offer pictures that are ugly or offensive: Durbar does not judge them.
- **FR-091** **Cannot**: run code; supply CSS, HTML, SVG, fonts or scripts; supply a position or invent a layout (it may only select one arrangement by id from the project's closed list in code, FR-226), change sizes, words, statuses or status colours; draw on tool surfaces; make the app fetch anything but the catalogue, signature and pack from its listed hosts; redirect elsewhere; name its worlds as built-ins or another source's (FR-060), or show itself as the project (FR-095); change a world already installed without the person accepting it (FR-096); change its key, add sources, or change a setting or policy; start a download; or reach an agent, a prompt or MCP (FR-065). It cannot read anything local: requests carry no cookie or credential.
- **FR-092** **URL rules**: `https:` only, no user, password, query or fragment in the URL, a host list of at most 4 names, loopback, link-local, multicast, unspecified, private and metadata addresses refused before each hop as 076's URL rules say (IP literals in every form, IPv4-mapped IPv6, `localhost`, `*.local`), and behind a proxy as 076 says; private ranges only for hosts in `network.trustedHosts`, which a person cannot set. `[KNOWN GAP]` DNS rebinding, as 076 says.
- **FR-093** **People can add a source** (owner decision), in **Add a source…** in the worlds dialog, as well as an organisation by policy (FR-111). An optional key field makes it `ed25519`; left empty it is `first-seen`. **Main derives its `hosts[]`**: the typed URL's host, plus one fixed redirect host from a named constant only where that forge needs one (today `github.com` adds `release-assets.githubusercontent.com`, FR-073), and never from a catalogue, so a source cannot widen where Durbar connects. `worlds.userSourceHosts` is checked on the typed host, and its named redirect host follows it. `[KNOWN GAP]` another forge that redirects downloads gets its host by a dated delta; until then it fails plainly, and a static HTTPS host works. At most 8 of a person's sources; each one has Remove, which asks whether to remove its worlds too. A project domain later is a change of the default record's hosts, not this path.
- **FR-094** **An explicit add, with a plain warning.** Main parses the address first and refuses by FR-092 before any connection. Then, before any request: **"This connects to the internet, to <every host of the record>. The Agent Durbar project has not checked this source or its worlds. Worlds from it can only show pictures; they cannot run code, but the source sees your IP address and can change what it offers."** Buttons **Add and connect to <host>** and **Not now**, the safe one focused. Nothing is typed-and-saved: without the click there is no record and no request. Main issues the one-use token as for FR-072.
- **FR-095** **The UI always shows a world's source.** Everywhere a world is listed or named, the World row, the dialog, Manage, each notice and the try bar: *Agent Durbar project*, *Set by your organization: <label>*, the full address of a person's source (`github.com/someone/worlds/releases/download/worlds-1`, because a host alone would make any GitHub repo read like ours), *Uploaded*, *Made with <app>*, or *Imported*. It comes from main's own record, never from a pack or catalogue. Hosts show in ASCII (`xn--…`). *Agent Durbar project* is only for bytes matching the app's pinned hash through FR-080.
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

- **FR-170** **Project art.** `worlds/<id>/ASSETS.md` per picture or source sheet: tool and version (Codex image generation, codex-cli version), date, maker, approver (Vikram), the exact prompt, how it was cut and re-encoded, licence (097 FR-063, FR-064), `owner-check` with name and date. The owner's approvals of world mockups so far cover direction only (FR-234 and FR-237 on #990); each picture's `owner-check` stays pending until he approves that picture. A sibling of `test:realoffice-assets` checks it (every file listed and every listed file present, the exclusion clause present). `worlds/<id>/` holds no generated originals.
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
- **FR-205** **Separate packs, only chosen ones load.** A set is its own pack: `set.json` (`formatVersion`, `id`, `name`, `level`, people and anchors; no free text beyond a sanitised `name`) and frames named `p<NN>-<pose>[-half].webp` from a closed list, at most 20 people, 10 MB (097 FR-062). A set's entry limit is its own constant: at most 600 files, 128 MB for an upload. Sets go through FR-050..FR-056, FR-060..FR-065, FR-070..FR-099 and FR-160..FR-163 with `kind: "set"` in a catalogue, separately downloadable and shareable. Project sets not shipped are committed under `sets/<id>/`, outside the app (OP-3, FR-213); `features.userWorlds` also covers user-made sets. No world fetches a set it does not draw, and no set fetches a world: `test:` request log in main, `sim:` on the window's fetches.
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
- **FR-213** **What ships, and what it costs** (owner decision, OP-10, OP-12). Flat, Photo office with Office people, Cave with Prehistoric, Cheeky loft with Cheeky; Retro arcade with Retro pixel people in the release that removes the Retro Pixel theme. Each enters only when it passes FR-035, so a world not approved adds nothing. Estimates, not measurements, from 097 FR-183's photo figure (about 8.7 MB, of which about 0.47 MB a person for 11 frames at two sizes) and FR-042's world caps:

  | Shipped | World | Set | Total |
  |---|---|---|---|
  | Photo office, Office people (15) | included | included | about 8.7 MB (097) |
  | Cave, Prehistoric (6) | up to about 2.5 MB | about 2.8 MB | about 5.3 MB |
  | Cheeky loft, Cheeky (13) | up to about 2.5 MB | about 6.1 MB | about 8.6 MB |
  | **Three real worlds** | | | **about 22.6 MB** |
  | Retro arcade, Retro pixel people (15) | up to about 2.5 MB | about 1.7 MB, assuming about 10 KB for a pixel frame at two sizes | about 4.2 MB; about 0.4 MB by the measurement of FR-253 |
  | **With Retro arcade** | | | **about 26.8 MB; about 23.0 MB by FR-253** |

  **Caps.** Every pack stays under 097's 10 MB per world with its default set, on these estimates. A cartoon frame may compress unlike a photo-style one (`[KNOWN GAP]`, not measured): Cheeky at 13 people has 73 KB per frame pair before it passes 10 MB. `test:crew-assets`' 2.5 MB holds today's heads only (1.9 MB now); full-pose sets are checked by their own test and do not go in that folder. **New: shipped art at most 30 MB in total** (`test:realoffice-assets`), since no app-wide budget existed. **Retro pixel people's cost**: as first estimated, 15 fictional people × 11 required frames with half sizes and about 30 image runs. The art now exists: 15 people x 17 frames, no half size, no new run (FR-253, FR-254), plus 097 FR-067, FR-068's checks. Sets that do not ship (Minimalist's frames, shared ones) download.
- **FR-214** **Pixel people stay in Flat** (decision of 2026-11-01). Flat stays one world and keeps getting character sets (owner, 2026-11-01). Removing the Retro Pixel theme must not take pixel people out of Flat, so Retro pixel people also become a Characters value in Flat, `pixel`, in spec 077's pattern (077 FR-064, FR-072), with heads by FR-203. It lands in the same release as the theme's removal (FR-213, OP-12; spec 035 FR-019, T089), and a person who picks it in Flat stays in Flat. `[KNOWN GAP]` T111's frames are not in the repo yet, so how close their heads come to today's `pixel` scene kit is not known; `test:crew-assets`' 2.5 MB is not yet checked with them.
- **FR-212** **Flat is not a registry world.** It has no moments in `docs/experience/world-moments.json`: its surfaces are the flat rendering. FR-014, FR-020 and FR-035 do not apply to it. The Retro arcade world does not change Flat's theme.

#### Relation to other specs

- **FR-190** **Changes to other specs** (written into each `## Changes` by T002 after #921, #925, #936 land, so this PR does not edit the same lines):
  - 097 FR-060: Flat, Photo office, Cave and Cheeky loft ship, and Retro arcade from its release (FR-213); other worlds do not. FR-115: its per-world 10 MB cap counts a shipped world with its default set; the path stands. FR-112's "offered worlds equal the registry's shippable worlds" holds for shipped worlds and the project's catalogue.
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

#### Monitor part, and layout by world (owner decisions, 2026-11-01; FR-220..FR-236)

Why, and what it replaces, is under *Changes*. Plan: [*Monitor and arrangements*](plan.md#monitor-and-arrangements-fr-220fr-236).

**The monitor**

- **FR-220** **The monitor is a part, like the desk.** `desk-screen` gains `monitor.webp` and `monitor-half.webp` (WebP with alpha, at most 30 KB each, at most 300 px tall). `screenRect` is then a fraction of the monitor picture, and the desk picture holds no screen. A laptop is a monitor. The engine still gives the box (`DeskBox.screen`, 097 FR-013); the picture stands in it, contained, on its bottom edge, and `glass` comes from `screenRect` inside the drawn picture. Today's CSS monitor (`ro-bezel`) stays as the fallback.
- **FR-221** **The same rules as `screenRect` today.** Screen text is real HTML set with `textContent`, on an opaque token surface the app draws over `screenRect`, so contrast is token against token (070 D4, FR-055) and never depends on the art; text is never under 10.5 px (097 FR-030..FR-033). The validator refuses: a `screenRect` outside 0..1 or smaller than 097 FR-032 needs at the half size (FR-032), a picture over its caps, and a monitor without a `screenRect`. **No text in art** (FR-010): a machine cannot prove it (User Story 2), so it is the owner's check in `ASSETS.md` for project worlds and a line in the report for an upload. What a pack draws inside `screenRect` is covered; a bezel can still carry lettering, `[KNOWN GAP]`.
- **FR-222** **Required for project worlds, optional otherwise.** `test:world-catalogue` needs a monitor for `available`, as one more gate under FR-035. A user-made pack without one gets the CSS monitor and a report line; `formatVersion` stays 1 (FR-043). With 4 agents or fewer a project world draws its own monitor at the bigger size inside its own arrangement (FR-230). `[KNOWN GAP]` FR-220's caps (30 KB, 300 px tall) are not checked against a big monitor. A shared non-project pack may still use the CSS monitor and `rows`.

**Easy stage: a world's own furniture**

- **FR-223** **Own furniture in the same desk slots.** `desk.webp` may be any furniture that keeps the anchors: a lounger with a low table instead of a desk. Sand is `floor.webp`, and the sky and sea are `wall.webp`. Optional `desk-back.webp` and `desk-back-half.webp` (at most 30 KB each) stand behind the person inside the slot's head room, for what rises above a desk, like an umbrella. The engine sizes and places all of them; a pack sets no position or size. No layout code changes for this stage.
- **FR-224** **People do not change.** Seated frames stay the seated frames (098 FR-030, FR-204), since any set works in any world: hands land on `surfaceY`. So furniture must suit someone sitting up: a beach chair, or a lounger with its back raised. No reclining pose in this spec. `plateRect` still takes the name plate (097 FR-016).
- **FR-225** **Same checks.** FR-035's gates, FR-016's distinctness and FR-208's matrix apply as they do to any desk.

**Medium stage: a small, closed set of arrangements**

- **FR-226** **A world names an arrangement, and nothing else about layout.** Optional `arrangement` in `world.json`: exactly `rows` (the default when absent), `circle`, `facing-view`, `aisles` or `flanking`, from one constant `ARRANGEMENTS` in `worldpack.ts`. Checked as a plain string against the list (`includes`, never an object lookup, so `__proto__` and `constructor` fail), at most 20 characters. Anything else refuses the pack, with a report line saying this world may need a newer Durbar. No parameters: no radius, seat count, order or offset. **Arrangements are engine code with tests; 098 FR-030's "positions come from the layout engine" holds**, and 098 FR-031 is amended for this one field only (098 FR-081). **The list grows, and no two project worlds share an arrangement** (owner, 2026-11-01, "substantially different"; OP-13, FR-016): Photo office `rows`, the baseline; Cave `circle`; Barcelona beach `facing-view`; Retro arcade `aisles` (FR-238); Durbar hall `flanking` (FR-237); Cheeky loft and Pirate ship deck when designed (FR-239). A shared non-project pack may select any of them; FR-016 does not reach it.
- **FR-227** **What each one is** (first build; the geometry is the engine's and can change by evidence).
  - **`rows`**: today's `realLayout`, 097 FR-011..FR-022, untouched.
  - **`circle`**: folder zones in an open ring round a `focus` picture: a left column, a top row, a right column, open towards the viewer, with zones still rectangles. Its centre may hold fixtures: the owner said the centre of a round setup can hold library and boss. It stays open towards the viewer in this first build, so most faces keep 097 FR-012's size; seats may use back views (FR-204).
  - **`facing-view`**: rows under a wide `focus` band holding the view. People sit in front of the view, and seats may use back views (FR-204), so they look at it.
  - **`aisles`**: staggered cabinet aisles, for the Retro arcade hall: geometry and limits in FR-256. `[KNOWN GAP]` not yet measured in the app.
  - **`flanking`**: desks in two blocks either side of a central aisle that holds the fixtures, the aisle running to an empty throne at the far end of the room; seats may use back views (FR-204, FR-237).
  - `focus.webp` (at most 120 KB, no text; the engine gives its box) is required with `circle` and `facing-view` and refused with the others. It is a still picture: 097 FR-178 allows no decorative endless animation, and a fire's flicker would be one. Its light is the existing `lamp` slot's `flame` shape, by state only (097 FR-181).
- **FR-228** **One seam, one result.** `realLayout` keeps its signature plus an arrangement id and returns the same `Layout` type, so `realoffice.js` draws an arrangement with no new branch beyond the `focus` picture. Fixture positions come from the arrangement too (FR-014). Pure, no DOM, no `#probe`. The arrangements live in `src/shared/realoffice-arrangements.ts`.
- **FR-229** **Each arrangement must pass, before any world can use it.** At **15 agents at 1440x900 and 1280x800**, chat closed and open: status cards readable, text at least 10.5 px (097 FR-012, FR-016); no overlap of rectangles or text; **keyboard order sensible**: Tab follows the model's sequence, and consecutive stops are neighbours on screen (for `circle`: up the left column, along the top, down the right); **the op-count budgets** (097 FR-178 rows, in `check-office-ops`) and FR-019's under 5 ms at 40 agents in 8 folders, fall-back attempt included; **reduced motion and Serious mode**: nothing new moves. A failing arrangement stays out of `ARRANGEMENTS`, with no exception per world. **Face floor** (owner, 2026-11-01): a desk face may go down to **24 px, only when a floor is that full (15 people)**, at both 1440x900 and 1280x800. With fewer people faces grow, and hover or keyboard focus always shows them big. No other bar moves: text stays at least 10.5 px. By the mockups' own driver (outside the repo; estimates, marked so until measured in the app), the smallest face at 15 is 33 and 33 px in Cave and 28 and 24 px in Durbar hall, which pass this floor, and 20 and 17 px on the beach, which does not (FR-235). `aisles` has no face measurement yet (FR-256, T201). `[KNOWN GAP]` this settles faces only: the same driver found plates overlapping fixtures in all three (7 in Cave, 8 in the hall, 3 on the beach), and narrowest screens of 53 to 68 px.
- **FR-230** **A project world keeps its arrangement** (owner, 2026-11-01). 15 on one floor is the bar for every arrangement, so a project world has no fall-back to `rows` at high counts, and a status change never moves a seat (097 FR-015). **With 4 agents or fewer** it keeps its own arrangement and screen shape, with bigger screens inside that arrangement; `rows` has no priority there. A shared non-project pack whose arrangement does not fit falls back to `rows` by a pure `arrangementFits(id, model, view, meta)`, on the count of agents only, returning only with two agents fewer than it left at; `Layout.arrangement` says which ran. A window too small for an arrangement falls back, and the All floors view stays rows. `[KNOWN GAP]` what a project world draws past 15 agents on one floor is not decided. Floors do not take the overflow today: they are the person's own (033 FR-005, FR-023), and nothing moves agents to another floor. Past 15, 097's rows scroll inside the floor (097 FR-012, spec 092 *Assumptions*), and no spec says this for another arrangement.
- **FR-231** **No cost to worlds using rows.** With `rows`, `realLayout` runs the code it runs today and nothing else: the arrangement file is loaded only when a world names another (097 FR-061's lazy pattern), `arrangementFits` is not called, no `focus` is fetched. Proof: `test:realoffice-layout` compares `rows` with today's output byte for byte over seeded models, and `check-office-ops` keeps its rows limits with no new allowance.
- **FR-232** **The saved order and the sequence** (#987, spec 033 FR-080..FR-086). An arrangement seats the model's sequence, so a saved room or desk order needs no code of its own, and it stays "sequencing only" (033 FR-081). `realLayout` re-sorts a zone's desks by status (097 FR-022), which is not what #987's Q2 proposes for flat. An arrangement calls the same sort, so whichever the owner decides holds everywhere. `DurbarReorder` works from cached rectangles of the items, so a ring should need no new drag code, though its `nearest` favours rows; `sim:` T175 checks it once 033 FR-086's attachment is built.
- **FR-233** **Flat is untouched** (`chooseLayout`, `#probe`, spec 001 FR-193..FR-203 on #984). Flat is not a world, has no `arrangement`, and has a different engine: a world's office is drawn by `realLayout`, which searches nothing in the DOM. Neither spec depends on the other. They share only the gate: a world using any arrangement still waits for 097 FR-179 (FR-035).
- **FR-234** **First test, the cave's circle.** `cave` names `circle` with the fire as `focus`. The owner's reactions to the Cave mockup approve the direction, not final art (FR-237). Cave art stays Paco's approval (097 Q6, OP-8).
- **FR-235** **First test, a Barcelona beach; a named world by the owner's own idea.** `barcelona-beach`: furniture of FR-223 (loungers, laptops as the monitor part, umbrellas, sand), arrangement `facing-view` with the sea as `focus`, by download. It cannot use `rows`, which Photo office holds. Of the three mockups the beach was the weakest to the owner; his look at final art decides. `[KNOWN GAP]` at 20 and 17 px (estimates) it misses FR-229's 24 px floor and is to be redesigned to reach it. **"No tourist cliches" (*Input*) is knowingly set aside for this one named world, because it is the owner's idea; it is not relaxed for any other world.** Every other part of FR-010 holds: no flag, emblem, logo, text, religious building, landmark (no recognisable tower, church or skyline), stereotype, caricature or arch. Its card (FR-016) goes through FR-014 like any other: wall sea and sky, floor sand, signature the umbrellas; the owner's look decides.
- **FR-236** **Out of scope:** free per-world placement, pack-supplied positions, new arrangements by a pack or the maker, reclining poses. A new arrangement is engine code, tests and a dated delta. The prompt pack and the maker (FR-130, FR-150) offer only the closed list and the same parts.
- **FR-237** **Durbar hall** (`durbar-hall`). Arrangement `flanking`, fixtures in the central aisle in a 3 by 3 grid, an empty throne at the far end. Each person has a flag with our golden mark, a period lamp on the desk and a gold bead monitor; seats may use back views (FR-204). Arches by FR-210. Office people; by download. **Approval:** the owner's reactions to the hall and Cave mockups in chat ("Love it", "Cave is perfect", "Vastly better") approve the direction, not final art; each picture's `ASSETS.md` stays pending. `[KNOWN GAP]`, for this world's build and the owner's look at final art: (a) the mockup's view holds domed buildings, against FR-010's no landmark and no religious building; (b) flags as the status signal: 098 FR-030's `light-slots` are `lamp`, `glow`, `call`, `fixture` and `ambient`, with shapes from a fixed list (`lamp`: lamp, flame, neon-strip; `call`: dot, flame, neon) that has no flag; (c) the mockup shows words at the throne: packs set no words (FR-040), so this row has none, and no spec gives the app such words. `[KNOWN GAP]` also: delivery and default set are read from the mockup's use, not stated by the owner; a front-facing seat shows the back of its monitor there, and FR-220 has no such part; its faces at 15 are 28 and 24 px by estimate, so 1280x800 sits on FR-229's floor with no margin, and its other FR-229 items are still open.
- **FR-238** **Retro arcade's arrangement** is `aisles`, an arcade hall (the owner approved the direction, 2026-11-01). FR-229's 24 px floor applies. Geometry: FR-256. `[KNOWN GAP]` measured only on the mockup.
- **FR-239** **Cheeky loft and Pirate ship deck** get an arrangement of their own when designed. `[KNOWN GAP]` each until then, so neither can be `available` or ship under FR-016. The Pirate ship deck's FR-011 row is pending too.

#### Retro arcade (owner decisions, 2026-11-01; FR-250..FR-270)

Why, and what it replaces, is under *Changes*. Plan: [*Retro arcade*](plan.md#retro-arcade-fr-250fr-270). Sizes marked *measured* were measured on 2026-11-01 from the mockup's code and the art cache, outside the repo and outside the app; nothing here is built.

**The world and its light**

- **FR-250** **Retro game becomes the Retro arcade.** Shown name **Retro arcade**, id `retro`, unchanged. An arcade hall: `aisles`, each person at their own cabinet, the CRT is the screen, the marquee carries the name. Default set Retro pixel people, 15 people, approved by the owner (8 earlier, 7 on 2026-11-01). It builds next after Photo office with animation (#979), before Cave, Durbar hall and Barcelona beach reach a release, and replaces the Retro Pixel theme in the same release (FR-213, OP-12, FR-266). **Quality over date:** it goes into the first daily release where it passes every check of FR-269, and no release before.
- **FR-251** **Day or night: one small choice under the entry.** Under the **Retro arcade** entry of the World row, and only while that entry is chosen, a two-value radio group **Light**: **Day** (default), **Night**. Day is the cream room the daily user knows; night is neon dusk. No automatic following of the system's appearance, by decision: a world's light is the person's pick and must not change while they work. Stored exactly like the World setting: the value `day` or `night` sits beside `world` wherever `world` is kept (on #991 `localStorage`, `durbar.worldLight`; with `world` it moves to `durbar-settings.json` when FR-201's main path lands), read in a `try`; anything else means `day`. Choosing another world keeps the value and hides the group, with no tab stop. It applies at once, with no animation and no new layout: `realLayout` does not take the light, so the result is the same object for both.
- **FR-252** **One world, two light sets; only what light changes is doubled.** It is one row in FR-011, one card (FR-268), one arrangement, so FR-014's "no two share" is not in play. **Doubled:** `wall`, `floor`, `welcome` as `wall-night.webp`, `floor-night.webp`, `welcome-night.webp` (each at its day part's cap, all three or none, added to FR-041's closed list), the token set (FR-263), and night rules in `world.css`. **Shared:** people, cabinets, fixtures, glow pictures, lift, bubble, slip, panel frame. `world.json` gains optional `lightSets: ["day", "night"]`, checked with `includes` against one constant, and `nightTokens` under FR-055's rules; `formatVersion` stays 1 (FR-043). Only the shown light's parts load (FR-205's request log). The prompt pack and the maker do not offer it (FR-236).
- **FR-253** **The cost, against the caps.** The cap is 10 MB for a world with its default set (097 FR-115), 4 MB for a project world pack (FR-042), 30 MB for all shipped art (FR-213).

  | Part | Size | Kind |
  |---|---|---|
  | Wall and floor, one light, whole room at the grid | 2.2 to 3.0 KB | measured, lossless WebP |
  | Second light, wall and floor | about 3 KB | measured |
  | `welcome` and `welcome-night` | about 40 KB together | estimate, not drawn |
  | Cabinets, 2 sizes x 4 colours | about 4 KB | measured on the mockup's slanted drawing; the level redraw is T200 |
  | Fixtures, 9 | 1.5 KB; about 3 KB if redrawn taller (Q6) | measured |
  | Glow, lift, bubble, slip, panel frame | about 20 KB | estimate, not drawn |
  | **World** | **about 0.07 MB** | |
  | Retro pixel people: 15 people x 17 frames = 255 frames | 0.30 MB | measured on the cache as it stood, two frames off the grid (T201) |
  | **World with its set** | **about 0.4 MB** | |

  **Worst case, every part at its cap:** a world of 2.5 MB plus 0.31 MB for the three night parts is 2.8 MB, under 4 MB; with FR-213's 1.7 MB for the set, 4.5 MB, under 10 MB. **All shipped art:** FR-213's 26.8 MB becomes about 23.0 MB as estimated here, 27.1 MB at worst, under 30 MB. Night costs about 3 KB of wall and floor plus its `welcome`, at most 0.31 MB. About 28 of FR-042's 40 files. `test:realoffice-assets` holds the caps; T208 replaces these numbers with the committed files' sizes.

**What ships**

- **FR-254** **Frames, not canvas code.** The mockup draws its pixel art in canvas code at load. What ships is **WebP frames, lossless, one file pixel per grid pixel**, drawn on screen at an exact integer scale with `image-rendering: pixelated`. The drawing code becomes a dev script, `scripts/build-arcade-pack.py`, in the pattern of #993's `build-cave-pack.py`; it is outside the app, not run in CI, and its output is committed and checked. Why:
  - **D1 and FR-121:** no code in a pack. A canvas world would be the only world with code. What stays outside the pictures is `world.css`, an in-app file as in #993, never a pack part: it does not travel with a download.
  - **Budgets:** the mockup rebuilds cabinets and glow per unit and encodes them to `data:` URLs on the main thread; 097 FR-178 allows no such work in a render, and a loop over each pixel of the backdrop would repeat on every resize.
  - **Checks:** FR-016's hashes, FR-019's floor line, FR-170's provenance and FR-052's type check all read files.
  - **Size:** the frames are smaller than anything else tried: all 24 poses of 15 people are 391 KB at the grid, against 1332 KB as 8x lossy WebP at quality 0.80, which also softens the grid, and 2803 KB as the 8x PNGs (*measured*). The whole backdrop is 3 KB because it is a few flat colours.
  - **Rejected:** animated WebP (FR-052), SVG (FR-052), canvas per frame (FR-261).
  - **`pixelArt`:** optional `pixelArt: true` in `world.json` and `set.json`. FR-183's half-size set does not apply to it: natural area is about a quarter of the shown area at scale 2, far inside the 4x row, so a `pixelArt` set has no `-half` files and `checkSet` accepts that. `monitor` and `monitor-half` are two different drawings, not two scales. FR-032's and FR-221's `screenRect` floor is checked at the shown size for a `pixelArt` pack, or a 56 px glass would be refused. **A non-project pack with `pixelArt` is refused in v1**, because FR-053's re-encode at 0.80 would blur it; `[KNOWN GAP]` a person cannot share a pixel world until that re-encode has a lossless path.
- **FR-255** **Integer scale, and screens that are not.** All art of the world and its default set shares one scale `g`, an integer in CSS px, returned by the engine. Rectangles are snapped to `g`, so a grid never tears between neighbours. At device pixel ratio 1 and 2, every grid pixel is an even square. At 1.25 and 1.5, common on Windows laptops, `g = 2` is 2.5 or 3 device px: at 2.5 neighbouring pixels differ by one. **Measure first (T204):** look at 1.25 and 1.5. If it reads badly, `g` is chosen so that `g x ratio` is whole, where the floor still fits. `[KNOWN GAP]` not looked at. Retro pixel people in another world (FR-200) are drawn at that world's size with the nearest pixel, which may be uneven: `[KNOWN GAP]`, a style choice of the person's.

**The hall**

- **FR-256** **`aisles`, geometry from the mockup.** Replaces FR-227's and FR-238's "concept". `realLayout` returns it through FR-228's one seam, with zones and desks as for any arrangement.
  - **9 to 15 people:** 5 columns, 3 rows, `g = 2`, cabinet about 146 x 164 px; rows stagger by 8 % of a column and bend down towards the middle. Screens face inwards: the two left columns face right, the two right columns face left, the middle column alternates. Each person stands on the screen side. Mirroring is a static `transform: scaleX(-1)` on the picture only, and no text is inside a mirrored element.
  - **5 to 8 people:** the mockup keeps the size of 15, so faces do not grow, against the owner's words. These counts take `g = 3` wherever T202's pure test finds it fits, at both sizes.
  - **1 to 4 people:** 2 columns with the big cabinet (FR-230): `g = 3` at 1440x900 and `g = 2` at 1280x800 in the mockup, CRT 231x156 and 184x124 px (*measured* on the mockup).
  - **Past 15 on one floor:** more rows at `g = 2`, and the floor scrolls inside itself as in 097 FR-012. This closes FR-230's gap for this world, pending Q9.
  - **Folder signs, the mockup's largest omission.** The mockup has no zones: it seats by index, with no name, path, counts, cost, **+** or room menu per folder. FR-018 and today's flat rooms have them, and they are daily use (FR-265). Seats go folder by folder in the model's sequence, a zone's first seat carries its sign, and the sign shares the plate line of its row. At 1280x800, 15 people leave about 12 px of height per row (*arithmetic*: 602 px under the band, 3 rows, cabinet 164 and plate 24), so a sign cannot have its own 22 px strip. **Measure first (T202):** if the sign does not fit in full, it shows name, counts, **+** and menu, and the path and cost go to its hover and focus, and the loss is named in FR-265.
  - **Order:** FR-022's status sort inside a zone and FR-232 hold. Keyboard order is the seat order, row by row (FR-229).
  - **Face floor:** FR-229's 24 px at 15, by its measure, crown to chin. `[KNOWN GAP]` no `faceBox` exists for this set: about 24 grid px on one person by eye, so about 48 px at `g = 2`; the eyes-to-chin part is about 26 px. T201 measures every person. People seen from behind have no face and do not count (FR-204).
- **FR-257** **The cabinet is the monitor; the CRT is the screen; the marquee carries the name.** The cabinet is the `monitor` part (FR-220), a strip of 4 colour variants with `cells: 4`. `marqueeRect` is added beside `screenRect` in `world.json`. The monitor and the marquee are real HTML over the picture.
  - **CRT:** FR-030, FR-031, FR-033 and FR-221 unchanged: masked, `textContent`, opaque token face, at least 10.5 px. At 15 the glass is about 112 x 64 px, under 097 FR-032's 150 x 60 bar threshold on width. `aisles` shows real lines there when 4 lines at 10.5 px and 15 characters fit, as the mockup does (116 x 68 px, *measured*): the owner saw the text, and bars would lose it. Written into 097 by T232. The zoom on hover and keyboard focus stays.
  - **Marquee:** the name, `textContent`, at least 12 px at 15, one line, cut with an ellipsis, `aria-hidden`.
  - **Plate:** stays. It holds the name, role, status and task in words (097 FR-016), so status is never colour alone, and it is the accessible name.
- **FR-258** **CRT text stands level; the slant goes.** The mockup slants glass, text and marquee with `skewY(6.3deg)`; the owner saw slightly wavy text. **Decision, for legibility:** text and glass are level. Glyphs at 10.5 px on a slope of 1 px per 9 px step mid-glyph, and no hinting removes that. A slanted glass is also outside `screenRect`, which is a straight rectangle (FR-032), and a skew field would be the first position-like value in a pack (FR-040). The cabinet is redrawn with a level front, a level glass and marquee, and depth from a side panel and a stepped top; the aisle still reads through stagger, bend, side panel and facing. Scanlines and the vignette sit under the text, not over it, because FR-221's contrast is token against token. The owner chose this on 2026-11-01, after seeing the side-by-side (T200, Q1).
- **FR-259** **People stand at their cabinet.** Seated frames are busts with a chair (FR-204): they cannot stand, and FR-224's "seated frames stay" holds for desks, not here. `AISLE_POSE` in `realoffice-arrangements.ts`, one table: working `type`, thinking `book`, error `knock` (view a, from behind, FR-191); waiting, limit `face-knock`; done `face-coffee`; idle `face-book`. `face-*` are front standing frames, a new optional group in FR-204, each falling back to its view-a pose, and the report says so, so any full set works and `full` does not need them. Asleep and any set without standing frames: the seated frame behind a low console and stool in the slot, which is `desk.webp` here. `[KNOWN GAP]` that console is not drawn. Hover and focus show the big screen for people seen from behind.
  - **Named mismatch, fixed by T224:** FR-204 lists front `book`, `coffee`, `tread`, `letter`, `knock`, but 097 FR-191..FR-193 on `main` replaced Office people's with view-a `book`, `type`, `knock`, `counter`, `letter`, `runA`, `runB`. The contract must follow `main`, or Office people are not `full`.
  - **Frames per person: 17.** Seated 6, view a 7, front 4. All 24 in the cache are 0.39 MB; view b is not shipped (FR-191).

**Status and motion**

- **FR-260** **Status: marquee flash, glow, bubble, a done flourish.** `lightFor` stays the only source of status (097 FR-041, `test:realoffice-layout`); this table is how the world draws it. Status colours are the app's (`--c-*`), the same as in every world.

  | State | Marquee | Glow on the floor | Bubble | Motion |
  |---|---|---|---|---|
  | working | lit, steady | faint | none | the person's stepped bob, no light moves (Q2) |
  | thinking | lit, steady | faint | three dots | one stepped strip of dots, 1 change a second |
  | waiting | **flashes** | strong | `?` | the shared beat |
  | limit | lit orange, steady | strong | as today's card | none |
  | error | **flashes** red | small, only inside its own slot (097 FR-042) | `!` | the shared beat |
  | done | lit green | faint | tick | **the flourish:** one coin rises and fades, 2 s, once |
  | idle | dim, a shade over the cabinet | very faint | `z z` | none |
  | asleep | off | none | `z z` | none (097 FR-120) |

  Waiting and error flash, as the world guide says only they may move; limit stays steady, as 097 FR-041 says. **This amends 097 FR-041 for this world only:** there, error has "no flashing". The owner's word was "marquee flash"; which states is Q3. The mockup's `+100` is dropped, pending Q4: a number on the floor reads like the app's cost and credits, and packs set no words (FR-040). Reduced motion and Serious mode: every flash is steady and visibly different from `lit`, no flourish, no bob, no dissolve. Forced colours: 097 FR-051. A flash is 1 change each 1.1 s, under 3 flashes a second, over a small area.
- **FR-261** **60 fps and idle CPU hold by construction, then by measurement.** 097 FR-180 and FR-181 unchanged and enforced by the same check on `world.css` (#993's `test:realoffice-assets`).
  - **`transform` and `opacity` only.** Nothing draws to a canvas in the app. The mockup's `filter` (dim, busy fixture, drop shadows) and `color-mix` animation are replaced by a shade element, a static outline picture and pre-tinted glow; the flash is `opacity` on one small element, with `steps()`.
  - **A shared beat for flashes.** All flashing marquees and glows use one phase, by setting each animation's start from `document.timeline`: 15 flashes cost **2 frames per 2.2 s**, not 15 times that. The world guide's "nobody moves in sync" is about people; a beat is what an arcade sign does.
  - **People in 4 phases.** A working person's bob is 2 changes a second at most (097 FR-181), in 4 fixed phases by seat, so 15 working people cost at most 8 frames a second.
  - **Arithmetic, not measured:** worst case, all 15 bobbing: 8 frames a second, each about 4 people of 12 000 px, is about 0.4 M px a second, under a third of one 1440x900 frame per second. **Chase lights:** none in the first build (Q2). A chase is an endless animation on a state that does not ask for attention, against FR-181 and the guide; and it would add 15 strips. If the owner wants it after seeing the numbers, it is stepped at 2 changes a second, on the shared beat, and T216 records its cost.
  - **Status update:** class and text writes only, within 097 FR-178's 10 attribute writes, no node added, CRT `contain: strict` so a text change recalculates at most 50 elements.
  - **`will-change`** only while animating (FR-180).
  - **Measured by T216:** `check-office-ops` asserts the op rows at 15 and 40; `check-perf --record` records idle CPU in 4 mixes (all working, all flashing, all idle, mixed), day and night, against ≤ 15 % software and ≤ 5 % real GPU. `[KNOWN GAP]` #979's own record for Photo office with motion is 33.5 % of a core in total on a real Mac (10.3 renderer, 23.2 GPU), so the ≤ 5 % row may fail for every world; it stays T162's to answer. This world must be no worse than Photo office in the same run.
- **FR-262** **The teleport is a pixel dissolve.** It replaces #979's poof and zoom in this world: same leave and arrive pair, same 150 + 150 ms, nobody crosses the floor. The person's picture fades through **static dither masks** (`repeating-conic-gradient` at `g`, no file) stacked over 3 stepped opacities, and the masks never change, so only `opacity` animates. It reuses the person element and a small pool, so a status update adds no node. **Measure first (T215):** masks may be expensive under a software compositor. If it costs more than a plain fade, the fallback is `steps(4)` opacity with a stepped scale. Reduced motion: none.

**The whole app**

- **FR-263** **Chat and Settings follow the world.**
  - **UI style (FR-031):** the world row names `ui: "retro"`. While the world is shown, `data-ui` is `retro`, so square corners, hard shadows, the yellow focus halo and the mono display font are today's code, and leaving restores the theme's. The style stays **only as what the arcade's own chrome needs**: rules that only Flat's rooms, desks and lobby use go in T230. **This amends 097 FR-130 and #1001's reading ("no world changes a font or a radius") for this one world, inside 035 FR-010's limits:** no size change, `test:theme`'s allow-list holds, 070 D2 holds.
  - **Fonts:** display text only, as 035 FR-010 says. The mockup also sets body text in mono, which is wider and would break 070 D2; it is not adopted (Q5).
  - **Tokens:** two complete sets in `WORLD_SETS.retro`. **Day is Retro Pixel's own token values, moved, not redrawn**, so the List view and Settings are what the daily user knows. Note: that page colour is navy with cream cards; the cream is the room's art. **Night** has a darker page and bar, and **keeps cream surfaces for cards, plates, Settings and chat**, because 038 FR-001 allows no small text on a dark surface. `worldContrast` and `test:theme-tokens` check both; `paintWorld` takes the light.
  - **Chat:** #1001's surface, tails and portrait. The header carries the name on a marquee, with `lampWords`. The desk-side column shows the cabinet and person (FR-259). The mockup shows the floor beside a 440 px chat; the app's chat is full-window (#1001), which this does not change (Q7).
  - **Settings:** tokens only (097 FR-113), opaque (FR-182). The Light group is FR-251's. The mockup's `Arcade` badge in the top bar is dropped: packs set no words.
- **FR-264** **Every moment.** All 26 registry moments get a cell for `retro`, the 9 of #994 by the plan's table, with `shippable` only under 098 FR-024. Same words and same buttons as the other worlds (FR-013).

**Replacing the theme**

- **FR-265** **What its daily user would miss** (Ruben uses Retro Pixel daily; owner, 2026-11-01). Each item is kept or named; the owner's decision that no old look is supported (FR-266) makes several of them named losses. `[KNOWN GAP]` this table comes from reading the theme's code and Flat.

  | Today, Flat with Retro Pixel | After | State |
  |---|---|---|
  | Palette, cream cards, navy page, status colours | Day tokens, same values, in the arcade only | **Kept in the arcade** |
  | Square corners, hard shadows, mono display font, uppercase names, focus halo, top bar | The `retro` UI style's rules the arcade's chrome needs | **Kept in the arcade** |
  | Every tool surface: Settings, palette, inbox, MCP, notes, List view | The same screens, same words | **Kept** |
  | Pixel people | Retro pixel people, 15, new art. `[KNOWN GAP]` how close their heads come to today's `pixel` kit is not looked at (FR-214) | **Kept, redrawn** |
  | Name, role, status, task, helpers per agent | Plate, 097 FR-016 | **Kept** |
  | Folder name, path, counts, cost, **+**, menu | Sign (FR-256); path and cost may move to hover at 15, measured by T202 | **Kept; may move** |
  | Latest output | Real lines on the CRT; zoom on hover or focus | **Kept** |
  | Lobby: who is where, boss, bank, post | Fixtures, visitors, slips (#994) | **Kept** |
  | Per-agent tokens and cost on the card | Chat header; `[KNOWN GAP]` not on the plate. 097 FR-016 has no such field, and T202 sees if it fits | **Moved, named** |
  | **Flat's whole layout:** rooms as coloured folder blocks, densities, Detail level, wrapping | The arcade replaces it, automatically (FR-266). Flat is one click away in Settings, in Flat's normal colours | **Named loss as the default** |
  | **Flat in retro colours** | Gone: Flat with Characters `pixel` uses Flat's normal colours | **Named loss** |
  | Pixel desks and CRTs in Flat, floppy rim, pixel plant, brick wall, `arcade` motion preset | Gone with the `pixel` kit; the arcade has its own art | **Named loss** |
  | Theme words: Arcade, Snack bar, Boss level, Coin bank, Mailbox, Cartridge Bay, Console, Modem | Gone: the app's words everywhere (FR-013, FR-040; the mockup shows them) | **Named loss** |
  | Flat's densities fit more than 15 on one floor | In the arcade, rows scroll inside the floor past 15 (FR-256); Flat one click away | **Named loss in the arcade** |
  | Picture weight: Flat loads no world pack | About 0.4 MB, loaded only in the arcade | **Small cost** |
  | A saved theme naming `ui: "retro"` or `scene: "pixel"` | That one value falls back to `clean` or `office` (035 FR-018's rule) | **Named loss** |

- **FR-266** **Migration is automatic, once, in the same PR** (owner, 2026-11-01: "Automatic, no need to support old and new when we have new world"). 035 FR-019 and FR-207's pattern: in main on read, written at once, a repeat changes nothing, no request. A stored theme `retro` becomes **World `retro`, Office layout Real office, Light Day, theme Clean Office**. **Characters:** the theme's default people (`theme`) become `pixel`; an explicit choice stays, under FR-202. **No prompt, no choice dialog and no notice in the app; the changelog says it.** Flat stays one click away in Settings. This is the one exception to SC-017. **Same PR:** a daily release may be cut between any two merges (FR-064), so opening the flag, `pixel` in Flat, the migration going live and the theme's removal, code and docs, are one PR (T230), and no user is ever between the two. Everything else lands before it behind `WORLD_FLAGS.retro` (#993's pattern).
- **FR-267** **Removing a theme does not remove coverage** (AGENTS.md: never reduce CI coverage). Retro is the one theme, besides Clean Office, that pull requests lay out (spec 008 FR-111: dark page, its own display font), and scripts name it as their second theme: `check-theme-geometry`, `check-parallel`, `check-crew retro` and about 20 others. Before it goes, a fixture user theme with a dark page takes those places, so the same number of layouts runs, and the arcade joins them (T226). `[KNOWN GAP]` whether a fixture theme can carry its own display font without the `retro` style is checked there; if not, the arcade's chrome is what covers that font, and the PR says so.

**The rest**

- **FR-268** **Card and words.** `worlds/retro/card.json` has one row with both lights: `light` 5600 K day, 7200 K night, each compared with every other world's (FR-016); a future world within 200 K of either fails. Mood, wall, floor, desk, fixture style, plants and motif are in FR-011's row. **"Arcade" in FR-010's exclusion clause is the arched walkway, not this hall:** FR-010, `worldprompts.ts` say "architectural arcade". This hall has no arch.
- **FR-269** **The gate, stated plainly.** FR-035 applies with no exception, and FR-124 lets everything land earlier with the flag closed.
  - **The build is not blocked** and can start on the base in the plan.
  - **The ship is blocked** by FR-035 (a): 097 FR-179 and T156..T159, which are not on `main`. **#936 must merge first** (it holds FR-179 and the tasks). Of the four tasks, on #950's branch (stacked on #941): T159 is ticked; T156 is built but not ticked and stands at 98 reads at 15 against a budget under 40; T157 is not built; T158 is in progress. On `main`, none of them exists. The owner's gate is spec 001's search and renders (#984, spec only, nothing built, with its own spike T167 first and a real Mac run T181, then spec 001 T182 ticks or moves 097 T156, T157). `test:world-catalogue` counts a missing task as not met.
  - **Also blocked by:** FR-035 (b) and T036: `test:world-packs`, `test:world-catalogue` and the validator (#955) are not on `main`; (c) all 26 moments, FR-264; (d) FR-229 for `aisles`, unmeasured; (e) provenance, T201; (f) the owner's look; (g) T093, T094, not built; (h) T111's set, full, T207. 097 FR-189: the real-GPU run T162 before a world ships as finished. 097 FR-179 also sits under Cave, Durbar hall and every other new world, so this is not particular to this world.
- **FR-270** **Other specs**, written into each by T232 once the PRs holding those lines land, as FR-190 does: 097 FR-032, FR-041, FR-130 and FR-012 (`aisles`), #1001's reconciling delta; 098 FR-030 (`face-*`, `marqueeRect`, `pixelArt`, `lightSets`), FR-031; 077 by T122; 008 FR-111 by T226. Spec 035 FR-019 and T089 are changed in this PR; spec 038 becomes `superseded` by spec 102.

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
- **SC-017** Every migrated setup draws what it drew before, except a stored Retro Pixel (FR-266), and migration makes no request.
- **SC-018** With one world and one set chosen, no other pack's files are read.
- **SC-019** Every arrangement in `ARRANGEMENTS` passes FR-229 at 15 agents at both sizes, chat closed and open, or stay out of `ARRANGEMENTS` and the owner hears why.
- **SC-020** `rows` is byte-identical to today over the seeded models, and its op rows and FR-019 time do not rise.
- **SC-021** The validator refuses every hostile `arrangement` and monitor fixture, and each planted mutation in T176 is caught.
- **SC-022** `aisles` passes FR-229 at 15 agents at both sizes, chat closed and open, with folder signs, measured in the app: every front face at least 24 px, larger at 8 than at 15, nothing overlapping, including visitors, bubbles and the coin; all 26 moments have a cell.
- **SC-023** Day and night give the same `Layout`; only the shown light's files load; both token sets pass at AA; the stored value survives a restart and a bad one means Day; the system's appearance changes nothing.
- **SC-024** With `retro`, 097 FR-178's op rows hold at 15 and 40 agents with no new allowance; nothing in the world's CSS animates other than `transform` and `opacity`; no canvas in the world's code path; all flashes share one phase; idle CPU is recorded in 4 mixes, and is no worse than Photo office on the same machine.
- **SC-025** The world with its set is under every cap by committed files, and every `pixelArt` picture is lossless.
- **SC-026** Each row of FR-265 is kept or named; a stored Retro Pixel moves once, with no prompt, dialog or notice, and a repeat changes nothing; pull requests lay out as many theme cases after the theme goes as before.
- **SC-027** No build has the world offered with the theme still there, or the theme gone with the world not offered.

## Assumptions and honest limits

- `[KNOWN GAP]` FR-016 cannot judge "substantially different": a card is a claim about a picture, and until T097 sets thresholds from real packs the thumbnail review (FR-017) decides; after that it still has the last word on looks. FR-018 compares only with what is on the machine.
- Sizes (about 2.5 MB a pack), the time to generate a world and the weekly matrix's growth are estimates, not measurements.
- `release-assets.githubusercontent.com` was seen in one redirect on 2026-10-31; nothing guarantees it stays.
- Nothing was run: no download, zip reader, validator or picture exists yet. The security design was read against the existing code and specs, with no real attack test.
- `[KNOWN GAP]` Windows and macOS file behaviours (long paths, a Unicode-normalising file system) are covered by pure tests of the name list until CI's real platforms run the store tests; on-device checks are as constitution VI says.
- `[KNOWN GAP]` Depends on drafts: 096 (pipeline), 097 P1 (#921), 097's budgets (#936), 098's checks. Their numbers are quoted from the branches on 2026-10-31.
- `[KNOWN GAP]` A local program with write access to `userData` can change a store; FR-062 catches accidents and pack edits, and a program that also rewrites `installed.json` is out of scope.
- `[KNOWN GAP]` Art: Cheeky, Prehistoric and My characters are heads-only until new frames exist; the Cave and Cheeky loft worlds cannot be `available` before them (FR-035 (h)). Retro pixel people exist in the art cache, not in the repo; the Retro arcade is a mockup (FR-250..FR-270).
- `[KNOWN GAP]` A `first-seen` source gives no proof of who made a world, only that it changed; a person who wants more pastes a key. The look-alike table is small and will miss some letters; the source beside the name is the real defence.
- `[KNOWN GAP]` The hash of a project pack is only as trustworthy as the unsigned app that holds it (FR-080).
- Licences: project art MIT (097 FR-064); third-party licences are shown as given and not verified.

## Open points for the owner

Agent decisions stand until the owner changes them.

- **OP-1 Trust for the project's source: agent decision.** Hashes pinned in the app (no key to guard, a new world arrives with an app release), rather than a signed catalogue fetched between releases (needs a signing key and a secret, which is a repo setting). The signature code exists anyway for other sources. The owner may change it.
- **OP-2 `worlds-*` releases: decided (owner, 2026-10-31).** Asset-only `worlds-*` releases have his standing OK, can happen at any time with no daily rhythm, and are not counted in rework rate (spec 021 FR-066). T004 brings the lines to `AGENTS.md` in its own PR, before the first such release (T043).
- **OP-3 Art in the repo: decided (owner, 2026-10-31).** Art is committed under `worlds/<id>/`, outside the app.
- **OP-4 Who can add a source: decided (owner, 2026-10-31).** People as well as organisations; people may also create and share worlds (FR-093..FR-099, FR-162, FR-163). An organisation may forbid it or limit it to a list (FR-110, FR-111).
- **OP-5 Policy before first ship: agent decision.** 076 has no reader, so FR-114's small slice is built in P3 and a forbidding policy works from the first release. The alternative was leaving it as a `[KNOWN GAP]`. The owner may change it.
- **OP-7 In-app or by hand: decided (owner, 2026-10-31).** In-app generation is first-class and the flat AI theme maker is retired for it. The hand-made package stays as the route when the connected app cannot generate images. Order of build: P6 needs spec 096's pipeline, P5 shares its validator; whichever is ready first lands.
- **OP-8 Windows in cave and loft: Paco's call.** Allowed by the decision on every world; optional until he decides for his crews' worlds (097 Q6). Photo first.
- **OP-9 People per world: decided (owner, 2026-10-31).** Two flat lists, any set in any world, a default per world (D4, FR-200..FR-212); this replaces shared people and the crew edge case.
- **OP-10 What ships: decided (owner, 2026-10-31).** Flat, Photo office, Cave and Cheeky loft ship, Cave and Loft after Paco's art approval and every gate (FR-213). This changes 097 FR-115's list through T002.
- **OP-11 Minimalist: decided (owner, 2026-10-31).** Full poses like every set; art is in progress (FR-206, T110).
- **OP-12 Retro Pixel theme: decided (owner, 2026-10-31).** It stays until the Retro arcade world ships, and that world ships in the app in the same release that removes the theme (FR-213, spec 035 FR-019).
- **OP-13 Arrangements against worlds: decided (owner, 2026-11-01, relayed).** The closed list of arrangements grows, and no two project worlds share one ("substantially different"). Photo office keeps `rows`, the baseline. FR-226 has the list and who holds what. FR-016 fails a shared arrangement.
- **Retro arcade questions** (2026-11-01; each has the recommended answer, which holds until he says otherwise):
  - **Q1 Slant. Decided (owner, 2026-11-01), after seeing the side-by-side (T200):** level glass and text, on a redrawn cabinet (FR-258).
  - **Q2 Chase lights. Held as told to the owner, 2026-11-01:** none; working is steady and the person moves (FR-261).
  - **Q3 Which states flash. Held as told to the owner, 2026-11-01:** only waiting and error; limit steady. Error's flash amends 097 FR-041's "no flashing" for this world only (FR-260).
  - **Q4 Words on the floor. Held as told to the owner, 2026-11-01:** no `+100`, a coin only. The theme's words go; the app's words everywhere (FR-013, FR-040, FR-265).
  - **Q5 Body font.** Recommended: mono for display text only, as Retro Pixel today (035 FR-010); not the mockup's all-mono, which would change sizes (070 D2).
  - **Q6 Fixture scale. Held as told to the owner, 2026-11-01:** bigger fixtures, about 60 to 66 grid px, in the band, no change to their count. In the mockup they are 34 to 48 against a person's 72, so a visitor hides them (at 1280x800, Web and half of Boss), against FR-014's one scale.
  - **Q7 Chat beside the floor.** The mockup shows the floor beside a 440 px chat; the app's chat is full-window (#1001). Recommended: follow #1001; a narrower chat is a separate change for every world.
  - **Q8 Flat in retro colours. Reversed the same day: they do not stay.** His first answer kept them; his later words, "Automatic, no need to support old and new when we have new world", read by his coordinating agent as ending that, with the owner told so he can overrule it. Flat with Characters `pixel` uses Flat's normal colours (FR-265).
  - **Q9 Past 15 on one floor.** Recommended: more rows at `g = 2`, scrolling inside the floor (FR-256), as 097 does for `rows`. No smaller scale: `g = 1` is a 12 px eyes-to-chin face.
  - **Q10 The migrated Characters value. Decided (relayed, 2026-11-01):** `pixel` only for someone on the theme's default people; an explicit choice stays (FR-266). Changes 035 FR-019's "with its default set".
  - **Q11 Who approves.** The art notes still say "Paco: pending" for Retro pixel people, and their first paragraph says drawn by code while rows say sheets and snapped. Recommended: the owner's approval of the 15 is the record, since this is no crew of Paco's (097 Q6); T201 corrects the notes.

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
- **Retro arcade (FR-250..FR-270)**: I spec, plan, tasks only; II no adapter change; III no new connection, in-app files only; IV 0 AI credits, no new image run; V 10.5 px, 15 agents at both sizes, flashes only for waiting and error and under 3 a second, status always in words; VI no OS path, device pixel ratios named (T204); VIII every number says measured, arithmetic or estimate.

- **A1 decided (owner, 2026-11-01: "ok to show back"):** back views are allowed for the arrangements that use them, and hover shows the big screen (FR-204, FR-227). Art is `[KNOWN GAP]` until drawn.
- **A2 decided (owner, 2026-11-01):** each world keeps its arrangement at 4 or fewer, with bigger screens inside it (FR-230).
- **A3 Barcelona beach: delivery.** *Recommended:* download, not in the app. `rows` is no longer open to it (FR-235).
- **A4 Cave's circle: Paco's call?** It is his world's art. *Recommended:* ask him when T166 has a simulator shot, before any image run.
- **A5 decided (owner, 2026-11-01):** neither relaxed to fewer agents nor dropped: faces may go down to 24 px at 15 people (FR-229). An arrangement under that floor is redesigned.

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

### 2026-11-01: a monitor per world, and layout by world in two stages (owner decisions; spec 021 FR-070)

Owner's decisions, Vikram, 2026-11-01, relayed by his coordinating agent. Spec, plan and tasks only, stacked on #937 so its review does not move. New FR-220..FR-236, SC-019..SC-021, T164..T178; 098 FR-081, FR-082 and T147, T148 (numbers checked against `main`, remote branches and open PRs). Changed to match: FR-010, FR-011, FR-014, FR-032, FR-040, FR-041. **Replaces** "same layout in every world": a world now picks a tested arrangement. Free placement stays out.

`[KNOWN GAP]` Nothing built. Whether `circle` and `facing-view` can fit 15 agents at 40 px faces is unknown: the floor loses the `focus` area, and 40 px is already 097 SC-002's bar for rows at 1280x800 (its mockup reached about 36 px). T165 tries it in a pure test before any art is made. The questions are in *Open points* (A1..A5).

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
- **Fixtures:** the owner said the centre of a round setup can hold library and boss, and approved the direction of the Cave ring (FR-170). FR-013, FR-014, FR-019, FR-022, T027 and the plan: fixture positions belong to the arrangement; same set and same meaning, not the same boxes.
- **FR-091, SC-016, D1 and the constitution check squared with that.** The project's arrangements are a closed list in code, and a pack only selects one by id; a shared pack still cannot invent a layout or supply a position. **"Packs are data" (D1) is not weakened**: a pack gains one string checked against a constant, runs no code and carries no geometry. What gets more code is the engine, tested per arrangement.
- **FR-172** stays as history; new worlds need the owner's new approval.

### 2026-11-01: five arrangements, no fall-back for project worlds, Durbar hall's row (owner decisions, relayed by his coordinating agent; spec 021 FR-072)

- **Replaces** FR-230's fall-back for project worlds and its priority for rows at 4 agents or fewer; FR-222's bezel on big screens; `rows` first for the beach (FR-235, T177).
- **New:** `aisles`, `flanking`; FR-237..FR-239; T179, T180. FR-041, FR-226..FR-229, SC-019 and 098 FR-082 follow. Numbers checked: FR-240 and up, T190 and up are on #999.
- `flanking` is named from the mockup: two desk blocks either side of a central aisle holding the fixtures. Durbar hall's row uses only what the mockup shows, plus the owner's points: flags with our golden mark, period lamp on the desk, gold bead monitor.
- `[KNOWN GAP]` no mockup proves 15 fits (FR-229). Pirate ship deck: a row is pending; none is invented here.

### 2026-11-01: back views (owner decision: "ok to show back")

FR-204 gains optional `backA`, `backB` for arrangements that use them, with hover or keyboard focus showing the big screen; FR-190 and T100 follow. Art is later work and a `[KNOWN GAP]` until drawn; crew art approval still applies per image.

### 2026-11-01: back views in the arrangements, and what the owner's reactions approve

FR-227, FR-236 and FR-237 follow FR-204's back views; A1 is closed; T181 is new. The reactions to the hall and Cave mockups approve the direction, not final art (FR-234, FR-237); the beach was the weakest (FR-235). The face floor at 15 stays FR-229's `[KNOWN GAP]` until the owner answers. FR-106 against FR-113 is not settled here.

### 2026-11-01: faces may go down to 24 px on a full floor (owner decision, relayed by his coordinating agent; spec 021 FR-073)

The owner answered A5: faces may go down to 24 px, only when a floor is that full (15 people), at both sizes. With fewer people faces grow, and hover always shows them big. Most users have far fewer than 15. **Replaces, for project worlds:** the 40 px bar at 15 agents (097 FR-012, SC-002, and FR-229's use of it, as the entries above state it) and the 31 px `check:office` floor on the 097 build branch. It also goes under 097 FR-012's 28 px minimum at 15 agents; T164 writes these into spec 097. **Lowers nothing else:** text stays at least 10.5 px.

Cave and Durbar hall pass the face floor by mock estimates, not measured in the app. The beach does not and is to be redesigned (FR-235). `aisles` has no measurement (FR-238).

### 2026-11-01: pixel people stay in Flat

Removing the Retro Pixel theme must not take pixel people out of Flat, so Retro pixel people also become a Characters value in Flat, in spec 077's pattern, in the same release as the theme's removal (FR-213, OP-12). Flat stays one world and keeps getting character sets (owner, 2026-11-01). New FR-214 and T122; spec 035 FR-019 and T089 point to them.

### 2026-11-01: Retro game becomes the Retro arcade: day and night, frames not code (owner decisions, relayed by his coordinating agent; spec 021 FR-074)

**The owner decided:** an arcade hall, `aisles`, each person at their own cabinet, CRT the screen, marquee the name; both day and night, night neon dusk, day the Retro Pixel theme's cream room; it builds next after Photo office with animation, before Cave, Durbar hall and Beach, and replaces the theme in the same release; 15 people approved, with a Characters value `pixel` in Flat (FR-214); a face floor of 24 px at 15, growing with fewer; status by marquee flash, glow, bubbles and a done flourish; the teleport a pixel dissolve; Chat and Settings follow the world; quality over date.

**His coordinating agent decided, and he may change:** the Light choice, default Day, stored like World, no following of the system, one world with two light sets, only what light changes doubled (FR-251, FR-252).

**The owner chose, after a side-by-side on the same day:** CRT text and glass level (FR-258, T200).

**This delta's author decided, for the owner's look:** frames rendered to lossless WebP at the real grid (FR-254); shared beat, no chase lights in the first build (FR-261); static dither masks for the dissolve (FR-262); the `retro` UI style's rules stay as this world's chrome needs them (FR-263).

**Replaces:** FR-011's Retro game rows; FR-227's and FR-238's "concept" (FR-256); FR-213's 4.2 MB estimate (FR-253); in spec 035 FR-019, "the `retro` UI style goes"; 035 FR-019's "with its default set" for the migrated Characters value (Q10).

**Open:** the questions are in *Open points*, Q1..Q11. **Numbers checked** 2026-11-01 against `main`, remote branches and open PRs: FR-240..FR-244 and T190..T194 are on #999; this delta takes FR-250..FR-270, SC-022..SC-027, T200..T232; spec 021 FR-074; the next entry adds 021 FR-075.

`[KNOWN GAP]` Nothing built. No art, mockup image or canvas code of the mockup is in this PR. Measured from a private copy of the mockup and from the art cache, in headless Chromium and PIL, with the art agent still at work in it: all sizes may move. Not run in the app; not looked at on a real GPU; not on macOS or Windows; not at device pixel ratio 1.25 or 1.5.

### 2026-11-01: automatic move to the arcade; no old look kept (owner decision, relayed by his coordinating agent; spec 021 FR-075)

The owner: "Automatic, no need to support old and new when we have new world". FR-266 moves a Retro Pixel user to the arcade on update, with no prompt, dialog or notice; the changelog says it. His coordinating agent reads those words as also ending Retro colours in Flat, which he had asked for earlier the same day, and has told him so he can overrule it. **Removed:** that rule and its task, which never landed. **Changed:** FR-263, FR-265, FR-266, FR-267, SC-017, SC-026, Q4, Q8, Q10, T226, T227, T230, spec 035 FR-019, T089. He held, as told to him: level glass, no chase lights, only waiting and error flashing, no `+100`, bigger fixtures. `[KNOWN GAP]` nothing built.

### 2026-11-01: Paco's review of #937

Security: FR-083 scopes revocation by source and never touches a person's own worlds; FR-071, FR-093..FR-095 define a person's source's hosts, never from a catalogue; FR-064 and FR-072 hold the one-use token for every action that starts a request (it was only in the plan and T038). Also: FR-081 and FR-051 narrow downloads to 10 MB and stored entries within part caps; FR-082's schema is closed; FR-205 covers FR-065 and limits `set.json`'s text; T115 has a test; FR-170 states one reading of the owner's approvals.

**`AGENTS.md` leaves this PR.** The trims and the three lines go to T004 and spec 021 T054, in their own PR, after spec 021 T053 so `deprecated` is a valid status when the rule names it. No spec's status becomes `deprecated` in this PR. Downloadable art against FR-240 is fixed on #999, where FR-240 lives.
