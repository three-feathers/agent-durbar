# Tasks: 102 Worlds on demand

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-018). Node tests and the simulator only; 0 AI credits; no network in `npm test`. Each new rule gets a planted mutation that a test catches, listed in its PR (`docs/review-checklist.md`). Driver waits use `until()`, never a fixed sleep; no wall-clock assertion. `real:` tasks are separate and named.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` part. `[P]` = can run in parallel. A phase = one PR, except P4 (one PR per world or small batch). Numbers taken: spec 102, FR-001..FR-213 (sparse by group), SC-001..SC-018, T001..T121 (sparse by phase).

**Order**: P0 -> P1 -> P2 and P8 -> P3 -> P5 and P6 as ready (OP-7), P4 -> P7. Removals are separate PRs under specs 035 (T083..T088), 040 (T039..T042) and 017 (T020..T027), each after spec 021 T053. **Nothing visible as available, and no maker, reaches a release before spec 097 FR-179 is met** (FR-035, FR-124): T156..T159 of spec 097 and its op rows.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, checklist and specs-index block (`specs/102-worlds-on-demand/`). Test: `npm run specs:check`, `npm run rules:check`.
- [ ] T002 After #921, #925 and #936 land, write FR-190's lines into the `## Changes` of specs 076, 077, 096, 097 and 098, naming 097 FR-060, FR-100, FR-112, FR-114, FR-115, T100, T102, D3, FR-001..FR-004, FR-081, FR-083, FR-084, Q6; add block `room` and `defaultSet` to the registry and its test. Test: `npm run specs:check`, `test:surfaces` [FR-190].
- [x] T004 AGENTS.md's *Needs approval* and *Rework rate* lines name `worlds-*` releases, per spec 021 FR-066, with the owner's direct OK on the text (an agent's relay does not authorise a rule-file change). Test: `npm run rules:check`; `read:` [FR-086].
- [ ] T003 Paco's answer on OP-8, and any owner change to the agent decisions OP-1, OP-5, OP-6, written into the spec. Test: `read:` [Open points].

## Phase 1: Format and validator (PR P1), no UI, no network

- [x] T010 [P] Strict zip reader and stored-only writer (`src/shared/worldzip.ts`). Test: `test:worldzip`: traversal, absolute, drive letter, `:` stream, backslash, NUL, reserved names, case and Unicode duplicates, symlink attribute, encryption, ZIP64, method, header mismatch, overlap, polyglot prefix and suffix, entry count, bomb stopped by `maxOutputLength`; the writer's output is byte-identical on two runs [FR-051, FR-085].
- [x] T011 [P] Closed part list, manifest reader and caps (`src/shared/worldpack.ts`). Test: `test:worldpack`: every unknown field and name refused; `__proto__`; size, pixel and range caps per part; `defaultSet` valid; higher `formatVersion`; a `realHeight` field refused and one value per place for every pack [FR-014, FR-040..FR-043, FR-052, FR-056].
- [ ] T017 [P] Floor-line rule from alpha in the encoder and on fixtures. Test: `test:world-packs` on fixture art: a floating or hanging fixture is refused within 2 px [FR-019, FR-055, SC-012]. **Not in P1:** it needs decoded alpha, which exists only in the encoder window (phase 5).
- [ ] T018 Real-tool samples: one package zipped by macOS Archive Utility, Windows Explorer and Linux `zip`, added as fixtures by whoever has each OS. Test: `test:worldzip` accepts each; `__MACOSX/../x` and `.DS_Store/x` are still refused; `real:` for how each sample was made; `[KNOWN GAP]` stays for an OS nobody ran [FR-051]. **P1 (2026-10-31, partly):** a Linux `zip` sample is made and accepted inside `test:worldzip` (`real:` Linux, `zip` 3.0 flat, folder, stored, with `.DS_Store` and `__MACOSX/._` junk; a `-y` symlink is refused). macOS Archive Utility and Windows Explorer samples are still `[KNOWN GAP]`; the test builds the Linux sample at run time, so no binary is committed.
- [x] T012 Tokens through `checkUserManifest`, `themeIssues`; `url(` and unknown fonts refused. Test: `test:worldpack` [FR-055].
- [ ] T013 Move or build `imagecheck.ts` and `webpcheck.ts` as spec 096 FR-021, FR-023 say, if 096 has not. Test: `test:imagecheck`; `.webp` holding SVG, animated WebP, APNG, truncated header [FR-052, FR-053]. **P1 (2026-10-31, partly):** `src/shared/webpcheck.ts` is #938's file, byte for byte (so the two PRs merge without a conflict, whichever lands first); `imagecheck.ts` is not copied because its 512 px floor is for characters, so the world picture header check is `pictureHeader` in `worldpack.ts` (PNG and WebP, animation, chunk list, bitstream against canvas). Left open: when #938 lands, decide whether `pictureHeader` calls `imagecheck.ts` for the shared part; `test:imagecheck` is #938's.
- [x] T014 Moment map and `momentCoverage` (`src/shared/worldmoments.ts`). Test: `test:worldpack` equals `docs/experience/world-moments.json`; a pack missing each part reports the moments [FR-030, FR-031, FR-034].
- [x] T015 Prompts per part with the exclusion clause and the guard wrapper (`src/shared/worldprompts.ts`). Test: `test:worldpack`: every prompt carries the clause and "no real person"; markers and backticks stripped from a description; at most 300 code points [FR-010, FR-131, FR-152].
- [x] T016 Synthetic fixture pack, drawn by script, and a hostile set of at least 30 packages (`scripts/fixtures/worlds/`, `scripts/make-world-fixtures.js`). `test:world-packs` calls `worldpack.ts`, so there is one rule. Test: `test:world-packs` [FR-050, FR-180, SC-002].

## Phase 2: Store, seam and windows (PR P2) - US1, US2 base

Depends on #921 and T010..T016.

- [ ] T020 Store: key, temp dot folder, rename, `installed.json`, caps, leftovers at start (`src/main/worlds/store.ts`). Test: `test:worldstore`: links (a link in temp pointing outside is not followed by removal), non-regular files, over-cap, crash between each pair of steps, replacement on a stand-in that refuses rename over a folder [FR-060, FR-061].
- [ ] T021 Re-check at load, damaged state, revocation sweep. Test: `test:worldstore`: one byte changed gives *Damaged*, nothing sent to the window [FR-062, FR-083].
- [ ] T022 `world:list`, `world:part`, `world:remove` through `ipcHandle`, `fromApp`; closed to `SIM_OPEN_CHANNELS`, MCP tools, remote control. Test: `test:worldipc` calls the registered channels on a stand-in `electron` (`test-orgwiring.ts`'s style), `test-ipcchannels` [FR-064, FR-065].
- [ ] T023 Blob display in the world seam; revoke on change; old pictures dropped; CSP `blob:` if 096 has not. Test: `sim:` request log: flat fetches nothing; `check:office` unchanged [FR-003, FR-004, FR-063].
- [ ] T024 World row lists installed worlds with their state words; bad `durbar.world` means `match`; a disallowed world draws `match` without rewriting the stored choice; shared people with 097 FR-083's note. Test: `sim:` both sizes, keyboard and accessible names [FR-001, FR-034, Edge cases].
- [ ] T025 Fixture world in the simulator through a dev hook; `check:office` and `check-office-ops` take a world id. Test: `sim:` every driver loading `simfloors`, and `ui-suite.js` once for a shared markup change; 15 and 40 agents, both sizes, chat closed and open, screens update, people animate, reduced motion [FR-032, FR-120, SC-004].
- [ ] T026 Room block drawn: wall, floor, welcome (with T002's registry change). Test: `sim:` first-run and empty-office with the fixture world [FR-041, FR-031].
- [ ] T027 `placeWindows`, pure, after fixtures. Test: `test:realoffice-layout`: exact fixture and visitor rects with and without windows, 1..15 agents, 9 and 12 places, both sizes; a window is exactly band height and intersects no fixture box; a too-narrow area has no window; fixture boxes equal across worlds [FR-020..FR-022, SC-005, SC-012].
- [ ] T028 Paint order and visitors in front. Test: `sim:` 12 visitors, plates opaque, 097 FR-117's foot and scale check unchanged [FR-023, FR-024].
- [ ] T031 Mode-switch and memory recorded with the fixture world from disk. Test: `check-perf --record`, read against 097 FR-178's rows; no time assert [FR-120, FR-123].

## Phase 3: Download from the project (PR P3) - US1, US5 first slice, US6 part

- [ ] T035 Catalogue format and seed: a `coming` row for each downloadable world (`worlds/catalogue.json`, `scripts/copy-assets.js`, `src/shared/worldsource.ts`). Test: `test:worldsource`; a file-list test: the app has the catalogue and no `worlds/` art [FR-002, FR-080, FR-085, SC-007].
- [ ] T036 Reproducible packer and catalogue test (`scripts/world-pack.js`, `scripts/test-world-catalogue.js`). Lands after #936, which brings T156..T159. The test reads their ticks (split on `/\r?\n/`, all four must be found, a missing task or file counts as not met, a mutant through `npm run test:world-catalogue` must fail) and refuses `available` without them, without a shippable registry row, and without provenance. Test: `test:world-catalogue` with fixtures for each failure [FR-035, FR-085, FR-170].
- [ ] T037 Hop rules, hash first, length cap, `makeDownloadGet` error words (`src/main/worlds/download.ts`, `netget.ts`). Test: `test:worldsource`, injected layer: off-list redirect not asked for, more than 3 hops, `http:`, longer and shorter than declared, one byte different, HTML answer; temp gone each time [FR-073, FR-074, FR-081, SC-003].
- [ ] T038 Notice token in main: one use, 5 minutes, names the URL's real host. Test: `test:worldipc`: the registered `world:download` channel without a token, or with a stale or reused one, makes no request; a test clock proves the monotonic timer is the one used [FR-070, FR-072, SC-001].
- [ ] T039 Dialog: places, sizes, *Coming*, *Unfinished*, notice, progress, Cancel, failure words, on `askDialog` (`src/renderer/worlds.js`, `screens.js`). Tool surface, tokens only, opaque. Test: `check-worlds` at both sizes: wrapped bridge shows no `world:download` before the click; text at least 10.5 px; one dark and one non-default theme; `test:theme-tokens` [FR-001, FR-002, FR-072, FR-075, FR-077, US1].
- [ ] T040 Offline and failures: no retry, the current world unchanged, an installed world works with the layer refusing and recording everything. Test: `test:worldsource` asserts zero requests in main; `sim:` draws [FR-075, FR-076].
- [ ] T041 **Manage** rows (FR-061), Update and Remove, with the notice, old kept until new passes. Test: `test:worldstore`, `check-worlds` [FR-061, FR-100, FR-101, US6].
- [ ] T042 Policy slice: machine folder only, 076 FR-005's trust check, `features.worldDownloads`, `worldsPolicyFrom` (`src/main/worlds/policy.ts`). Test: `test:worldsource`: main refuses whatever the window sends; unreadable, a read error and a timeout fail closed; bad types; one bad source entry empties the list; `true` never undoes `false`; a running download stops; `sim:` *Turned off by your organization* [FR-110, FR-112, FR-113, FR-114, SC-009].
- [ ] T043 First real asset: publish per OP-2, compare the served bytes with the catalogue, and download once on Linux, macOS, Windows. Test: `real:` recorded in the spec; 0 AI credits; `[KNOWN GAP]` for an OS nobody ran [FR-073, FR-086, FR-182].
- [ ] T044 README *Safety model* table, *Development* names, limits; `docs/agent-apps.md` entry for the redirect host; changelog fragment. Test: `npm run test:docsscripts`, `changelog:check` [FR-074].

## Phase 4: Picture worlds - US2

Each world waits for T036 and T042 and goes `coming` to `available` only through FR-035. Each costs image runs on the owner's ChatGPT plan, in small batches; the mockups stay out of the repo until the world's PR. Each task: card first (T093), compared with all others before any image run; brief from FR-011, one back-wall sheet plus parts by `worldprompts.ts`, windows only by FR-020..FR-024, postbox by FR-012, `worlds/<id>/` with `world.json`, parts and `ASSETS.md`, a registry row with every moment's cell, catalogue hash; no cutout from another world. Test for each: `test:world-packs`, `test:world-catalogue`, world matrix at both sizes, `check-office-ops`, `check-perf --record` (097 T163), `check-world-distinct`, and `read:` the owner's look and `distinct-check` recorded in `ASSETS.md` (T094).

- [ ] T080 Spain (from the sample: its look, calm floor colour; it stays different from Italy and Mexico by FR-014) [FR-010..FR-013, FR-170]
- [ ] T081 Greece, Santorini-style blue and white without a dome, church, arch or vault [FR-011]
- [ ] T082 [P] Italy [FR-011]
- [ ] T083 [P] Mexico [FR-011]
- [ ] T084 [P] Switzerland [FR-011]
- [ ] T085 [P] USA [FR-011]
- [ ] T086 [P] Australia [FR-011]
- [ ] T087 [P] India, a modern office and never a court [FR-011]
- [ ] T088 [P] France [FR-011]
- [ ] T089 [P] Germany [FR-011]
- [ ] T090 [P] Britain [FR-011]
- [ ] T113 Flat as a World row; not in the registry [FR-001, FR-212]. Test: `test:surfaces`; `sim:` request log.
- [ ] T114 [P] Calm office, default Office people [FR-011]
- [ ] T115 Retro game, shipped in the app, default Retro pixel people; waits for T111; lands in the same release as spec 035 T089 [FR-011, FR-213]
- [ ] T116 [P] Indian kingdom, arches by FR-210 [FR-011, FR-210]
- [ ] T117 [P] European kingdom, arches by FR-210 [FR-011, FR-210]
- [ ] T118 [P] Japanese kingdom, post and beam by FR-210 [FR-011, FR-210]
- [ ] T119 Cards for Photo office, Cave and Cheeky loft from their art; default sets recorded; any clash with a new world changes the new world. Test: `test:world-catalogue` card pairs [FR-011, FR-014].
- [ ] T091 Windows in built-in worlds: photo after the owner's look; cave and loft only on Paco's decision (OP-8). Test: T027's test; `read:` approvals in `ASSETS.md` [FR-020].
- [ ] T093 Cards and the card check: `worlds/<id>/card.json` for every picture world of FR-011; pairs in `test:world-catalogue`; `scripts/check-world-distinct.js` (hash, perceptual hash, average colour; near results reported only until T097). Needs to come before T080. Test: fixtures with a same-material pair, a light temperature under 200 K apart and a copied cutout each fail, named; a recoloured cutout is reported [FR-014..FR-016, SC-011].
- [ ] T094 Contact sheet (`scripts/world-contact-sheet.js`, artifact only, outside `DOC_SHOTS`) and the required `distinct-check` field. Test: `test:world-catalogue` fails without the field; `read:` the reviewer's look per new world [FR-017, FR-035, SC-011].
- [ ] T097 Set FR-016's near-match thresholds from real packs: measure every pair once at least two real worlds exist (T080, T081), plant a recoloured and a re-encoded cutout, record the numbers and the reasoning in a dated delta, and turn near results from reported to failing. Until then the thumbnail review decides. Test: `sim:` the planted recoloured and re-encoded cutouts fail and the real pairs pass; `read:` the delta [FR-016, SC-011].
- [ ] T092 The real-GPU run with one country world, simulator only, 0 AI credits, by whoever has the machine. Test: `real:` recorded with 097 T162 [FR-182, 097 FR-189].

## Phase 5: Hand path (PR P5) - US3, US6

- [ ] T055 [P] [US3] Encoder job list and alpha anchors (`src/main/worlds/job.ts`, encoder page; generalises 096 FR-022). Test: `test:worldpack` with the fake encoder; a Node-level fixture run; timeouts and crashes refuse [FR-053, FR-054, FR-055].
- [ ] T056 [US3] Upload: main's picker, zip or folder, then the full chain, try in memory or a dot folder. Test: `test:worldipc`; the hostile set; EXIF, trailing bytes gone [FR-133, SC-002].
- [ ] T057 [US3] Report, preview, Try it (try bar), Save, Discard, *Unfinished* with fallback labels. Test: `check-worlds` at both sizes; no file requested in flat; Discard restores the stored choice, `match` included; a hostile name with markup and bidi characters is plain text everywhere, so dropping the escape fails [FR-034, FR-056, FR-133, FR-134, Edge cases].
- [ ] T058 [P] [US3] Instructions and **Save the prompts…**. Test: `test:worldpack` on the written files; overwrite refused; `sim:` dialog [FR-130..FR-132].
- [ ] T059 [US6] Export, import as upload; `features.userWorlds`. Test: `test:worldstore`: round trip byte-equal parts; no description, prompt, path or name in the zip; `test:worldsource` policy [FR-110, FR-160, FR-161].
- [ ] T064 [US3] Near-another-world warning in the report (fixtures and colours in the encoder, against built-ins and worlds on this machine), never a refusal. Test: `check-worlds`: warning names the world, Save still works; nothing is stored after it [FR-018, SC-013].
- [ ] T060 [US3] One person who is not the builder follows the instructions with their own image tool. Test: `real:` result and time in the spec; findings fixed [SC-006].

## Phase 6: In the app (PR P6) - US4

Needs spec 096's adapter capability and probes.

- [ ] T061 [US4] `world:generate`, `world:regenerate`, cancel, a part at a time, cost line, API-key refusal, Codex-copies note; fake generator extended (`src/renderer/sim.ts`, `scripts/fakes/codex-app-server.ts`). Test: `test:worldipc`, `test:runtime`, `check-worlds`: no adapter means hand path only; symlink, text, oversized and hung parts [FR-150..FR-154].
- [ ] T062 [US4] One small world made in Durbar on the owner's plan, on his OK, after stating the cost. Test: `real:` number of pictures, time per part and any plan usage in the spec; provenance not needed as it stays a local own world [US4, FR-182].
- [ ] T120 [US4] In the same PR as T061..T063, spec 040's T041: the theme maker goes; never a release with no AI creation. Test: `read:` the PR holds both; `npm test` [FR-211].
- [ ] T063 [US4] Idea chips and README notes on copies and cost. Test: `test:worldpack`, `npm run test:docsscripts` [FR-151, FR-152].

## Phase 7: Other sources and sharing (PR P7, split if large) - US5, US7

- [ ] T050 [US5] Ed25519 catalogue, sequence, last-good copy with date (`src/shared/worldsource.ts`, `src/main/worlds/sources.ts`). Test: `test:worldsource`: bad signature, missing signature, wrong key, lower sequence, oversize, the largest allowed catalogue with a CPU bound, `__proto__` and nested junk, namespaced keys cannot clash [FR-071, FR-076, FR-082, FR-090, FR-091, SC-003].
- [ ] T051 [US5] URL rules; `worlds.sources` from the policy slice replaces the default; notice wording. Test: `test:worldsource`: private and metadata hosts, user or query in URL, more than 4 hosts, `trustedHosts`, project not contacted [FR-092, FR-110..FR-113].
- [ ] T052 [US5] Re-encode non-project packs; *Not checked by the Agent Durbar project* and *Unfinished* before download. Test: `check-worlds`, `test:worldstore` [FR-034, FR-053, FR-072].
- [ ] T065 [US7] **Add a source…**: parse and refuse first, warning, one-use token, record, Remove; `first-seen` and key modes; `features.userSources`, `worlds.userSourceHosts` (`src/main/worlds/sources.ts`, `src/renderer/worlds.js`). Test: `test:worldipc` on the registered channels; `check-worlds` with a wrapped bridge; policy refusal in main [FR-093, FR-094, FR-110, FR-111, US7].
- [ ] T066 [US7] Adversarial network set: redirect to another host; every SSRF form of US7-2, per hop, and behind a proxy stand-in; a declared size over the cap, a false length, decoded size over the cap, one byte a second on a test clock; a bad `file` name. Test: `test:worldsource`, injected layer asserts no request reached the target; planted mutants per guard [FR-092, FR-099, SC-014].
- [ ] T067 [US7] Remembered versions and hashes; changes shown, same-version warning, lower version refused, delisted label, nothing replaced until accepted and re-validated. Test: `test:worldsource`, `test:worldstore`, `check-worlds` [FR-096, FR-100].
- [ ] T068 [US7] Source on every listing, from main's record; look-alike names; a pack claiming `spain`, our source or our hash stays *Imported*. Test: `test:worldpack` with Cyrillic, dotless i and fullwidth names; `check-worlds` reads the source beside the name in the World row, dialog, Manage, notice and try bar; `test:worldstore`: nothing but a pinned download sets the project label [FR-095, FR-097, FR-098, SC-015].
- [ ] T069 [US7] Share: Export's statement and SHA-256, import's report, **Export as a source folder…**, `docs/worlds-source.md`, `scripts/world-sign.js`. Test: `test:worldstore`: exported source folder serves through the fake layer and passes end to end; a signature from the script verifies; no private key in any app file [FR-161..FR-163].
- [ ] T053 [US5] An organisation's own location behind a proxy, by whoever has one. Test: `real:`, else `[KNOWN GAP]` kept [FR-182].
- [ ] T054 [US5] Docs: admin page lines for the keys, 076's schema entry. Test: `read:`, `test:docsscripts` [FR-110, FR-111].

## Phase 8: Character sets (PR P8, split by the tasks) - US8

- [ ] T100 [US8] Set format and `checkSet`, shared with `worldpack.ts`; closed names, caps as constants (`src/shared/worldpack.ts`). Test: `test:worldpack`: each missing pose, anchor and size; fallback only for the four optional poses; `full`, `heads`, refused; hostile fixture set; `test:world-packs` on built-ins [FR-204, FR-205, FR-206].
- [ ] T101 [US8] `peopleFor` replaces 097's seams; heads from full frames; a theme's own figures while in use (`src/renderer/crew.js`, `src/shared/characters.ts`). Test: `test:characters`: every world, choice, level; `check:crew` at every density [FR-202, FR-203].
- [ ] T102 [US8] World and Characters rows; policy through main; `default` value. Test: `check-worlds`, `check-characters` at both sizes, keyboard, one dark and one non-default theme [FR-201].
- [ ] T103 [US8] Migration, once, in main. Test: `test:characters`: each row of FR-207, repeat run, bad value, no request and no door or send change; a mutant that skips writing fails [FR-207, SC-017].
- [ ] T104 [US8] Set store and lazy load through `world:part`-style channels. Test: `test:worldstore`, `test:worldipc`; request log in main: one world and one set only [FR-205, SC-018].
- [ ] T105 [US8] Sets through sources, sharing and the maker: `kind: "set"`. Test: `test:worldsource`, `test:worldstore` round trip [FR-205, FR-209].
- [ ] T106 [US8] Interoperability in the matrix (`scripts/world-matrix.js`), each full set in two worlds, rotating. Test: `sim:`; `read:` first weekly result [FR-208, SC-016].
- [ ] T121 [US8] Shipped art: Cave with Prehistoric and Cheeky loft with Cheeky in the app once each passes FR-035, per world under 10 MB, in total at most 30 MB; measured sizes replace FR-213's estimates. Test: `test:realoffice-assets`; a file-list test that nothing else ships; a mutant over the cap fails [FR-213, SC-007].
- [ ] T107 [US8] Office people as a set pack, checked. Test: `test:world-packs`, `test:realoffice-assets` [FR-206].
- [ ] T108 Cheeky frames to full, per picture by Paco (cost on his or the owner's plan, on their OK). Test: `test:world-packs`; `read:` approvals in `ASSETS.md` [FR-206].
- [ ] T109 Prehistoric frames to full, per picture by Paco. Test: `test:world-packs`; `read:` approvals in `ASSETS.md` [FR-206].
- [ ] T110 Minimalist to full poses, art in progress; until then `sim:` the Flat-only note. Test: `test:world-packs`; `read:` provenance and the owner's look [FR-206].
- [ ] T111 Retro pixel people, new, with provenance and likeness fields. Test: `test:world-packs`, asset test; `read:` the owner's look [FR-200, FR-209].
- [ ] T112 My characters: level per character, 096's Real office frames. Test: `test:world-packs` on 096's fixture; `test:charstore` [FR-206].

## Final

- [ ] T095 Screenshots at both sizes for linked pictures, `npm run shots:docs`; a country world only in `docs/` once it is `available` (the matrix stays artifacts only, 098 FR-054). Test: `npm run shots:docs`, look at each.
- [ ] T096 `/speckit.converge` against SC-001..SC-018; world matrix path filter and weekly run read after 14 worlds (shard if needed). Test: `npm run specs:check`, `read:` [FR-181].

## Dependencies

Other specs: #921 (097 P1), #936 and 097 T156..T159 (gate), 098's checks, 096 (P6, and pieces of P5), 076 (only its first slice here).

**MVP**: P1, P2, P3 and T080: one place, downloaded with a plain notice, after the gate. **Independent tests**: US1 by the fake request layer; US2 per world; US3 by hostile fixtures; US4 by the fake generator; US5 by policy fixtures; US6 by round trip; US7 by the adversarial set; US8 by `peopleFor`, migration and request logs.

**Parallel**: T010, T011 in P1; T082..T090, T114, T116..T118 in P4 (limited by art batches and the owner's looks, not by code); T055, T058 in P5.
