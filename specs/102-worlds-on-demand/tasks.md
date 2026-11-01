# Tasks: 102 Worlds on demand

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-027). Node tests and the simulator only; 0 AI credits; no network in `npm test`. Each new rule gets a planted mutation that a test catches, listed in its PR (`docs/review-checklist.md`). Driver waits use `until()`, never a fixed sleep; no wall-clock assertion. `real:` tasks are separate and named.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` part. `[P]` = can run in parallel. A phase = one PR, except P4 (one PR per world or small batch). Numbers taken: spec 102, FR-001..FR-270 (sparse by group; FR-240..FR-244 on #999), SC-001..SC-027, T001..T232 (sparse by phase; T190..T194 on #999).

**Order**: P0 -> P1 -> P2 and P8 -> P3 -> P5 and P6 as ready (OP-7), P4 -> P7. Removals are separate PRs under specs 035 (T083..T088), 040 (T039..T042) and 017 (T020..T027), each after spec 021 T053. **Nothing visible as available, and no maker, reaches a release before spec 097 FR-179 is met** (FR-035, FR-124): T156..T159 of spec 097 and its op rows.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, checklist and specs-index block (`specs/102-worlds-on-demand/`). Test: `npm run specs:check`, `npm run rules:check`.
- [ ] T002 After #921, #925 and #936 land, write FR-190's lines into the `## Changes` of specs 076, 077, 096, 097 and 098, naming 097 FR-060, FR-100, FR-112, FR-114, FR-115, T100, T102, D3, FR-001..FR-004, FR-081, FR-083, FR-084, Q6; add block `room` and `defaultSet` to the registry and its test. Test: `npm run specs:check`, `test:surfaces` [FR-190].
- [x] T004 AGENTS.md's *Needs approval* and *Rework rate* lines name `worlds-*` releases, per spec 021 FR-066, with the owner's direct OK on the text (an agent's relay does not authorise a rule-file change). Test: `npm run rules:check`; `read:` [FR-086].
- [ ] T003 Paco's answer on OP-8, and any owner change to the agent decisions OP-1, OP-5, written into the spec. Test: `read:` [Open points].

## Phase 1: Format and validator (PR P1), no UI, no network

- [ ] T010 [P] Strict zip reader and stored-only writer (`src/shared/worldzip.ts`). Test: `test:worldzip`: traversal, absolute, drive letter, `:` stream, backslash, NUL, reserved names, case and Unicode duplicates, symlink attribute, encryption, ZIP64, method, header mismatch, overlap, polyglot prefix and suffix, entry count, bomb stopped by `maxOutputLength`; the writer's output is byte-identical on two runs [FR-051, FR-085].
- [ ] T011 [P] Closed part list, manifest reader and caps (`src/shared/worldpack.ts`). Test: `test:worldpack`: every unknown field and name refused; `__proto__`; size, pixel and range caps per part; `defaultSet` valid; higher `formatVersion`; a `realHeight` field refused and one value per place for every pack [FR-014, FR-040..FR-043, FR-052, FR-056].
- [ ] T017 [P] Floor-line rule from alpha in the encoder and on fixtures. Test: `test:world-packs` on fixture art: a floating or hanging fixture is refused within 2 px [FR-019, FR-055, SC-012].
- [ ] T018 Real-tool samples: one package zipped by macOS Archive Utility, Windows Explorer and Linux `zip`, added as fixtures by whoever has each OS. Test: `test:worldzip` accepts each; `__MACOSX/../x` and `.DS_Store/x` are still refused; `real:` for how each sample was made; `[KNOWN GAP]` stays for an OS nobody ran [FR-051].
- [ ] T012 Tokens through `checkUserManifest`, `themeIssues`; `url(` and unknown fonts refused. Test: `test:worldpack` [FR-055].
- [ ] T013 Move or build `imagecheck.ts` and `webpcheck.ts` as spec 096 FR-021, FR-023 say, if 096 has not. Test: `test:imagecheck`; `.webp` holding SVG, animated WebP, APNG, truncated header [FR-052, FR-053].
- [ ] T014 Moment map and `momentCoverage` (`src/shared/worldmoments.ts`). Test: `test:worldpack` equals `docs/experience/world-moments.json`; a pack missing each part reports the moments [FR-030, FR-031, FR-034].
- [ ] T015 Prompts per part with the exclusion clause and the guard wrapper (`src/shared/worldprompts.ts`). Test: `test:worldpack`: every prompt carries the clause and "no real person"; markers and backticks stripped from a description; at most 300 code points [FR-010, FR-131, FR-152].
- [ ] T016 Synthetic fixture pack, drawn by script, and a hostile set of at least 30 packages (`scripts/fixtures/worlds/`, `scripts/make-world-fixtures.js`). `test:world-packs` calls `worldpack.ts`, so there is one rule. Test: `test:world-packs` [FR-050, FR-180, SC-002].

## Phase 2: Store, seam and windows (PR P2) - US1, US2 base

Depends on #921 and T010..T016.

- [ ] T020 Store: key, temp dot folder, rename, `installed.json`, caps, leftovers at start (`src/main/worlds/store.ts`). Test: `test:worldstore`: links (a link in temp pointing outside is not followed by removal), non-regular files, over-cap, crash between each pair of steps, replacement on a stand-in that refuses rename over a folder [FR-060, FR-061].
- [ ] T021 Re-check at load, damaged state, revocation sweep. Test: `test:worldstore`: one byte changed gives *Damaged*, nothing sent to the window [FR-062, FR-083].
- [ ] T022 `world:list`, `world:part`, `world:remove` through `ipcHandle`, `fromApp`; closed to `SIM_OPEN_CHANNELS`, MCP tools, remote control. Test: `test:worldipc` calls the registered channels on a stand-in `electron` (`test-orgwiring.ts`'s style), `test-ipcchannels` [FR-064, FR-065].
- [ ] T023 Blob display in the world seam; revoke on change; old pictures dropped; CSP `blob:` if 096 has not. Test: `sim:` request log: flat fetches nothing; `check:office` unchanged [FR-003, FR-004, FR-063].
- [ ] T024 World row lists installed worlds with their state words; bad `durbar.world` means `match`; a disallowed world draws `match` without rewriting the stored choice; shared people with 097 FR-083's note. Test: `sim:` both sizes, keyboard and accessible names [FR-001, FR-034, Edge cases].
- [ ] T025 Fixture world in the simulator through a dev hook; `check:office` and `check-office-ops` take a world id. Test: `sim:` every driver loading `simfloors`, and `ui-suite.js` once for a shared markup change; 15 and 40 agents, both sizes, chat closed and open, screens update, people animate, reduced motion [FR-032, FR-120, SC-004].
- [ ] T026 Room block drawn: wall, floor, welcome (with T002's registry change). Test: `sim:` first-run and empty-office with the fixture world [FR-041, FR-031].
- [ ] T027 `placeWindows`, pure, after fixtures. Test: `test:realoffice-layout`: exact fixture and visitor rects with and without windows, 1..15 agents, 9 and 12 places, both sizes; a window is exactly band height and intersects no fixture box; a too-narrow area has no window [FR-020..FR-022, SC-005, SC-012].
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

Each world waits for T036 and T042 and goes `coming` to `available` only through FR-035. Each new world's seating plan and monitor are planned against the others first (FR-010, FR-014). Each costs image runs on the owner's ChatGPT plan, in small batches; the mockups stay out of the repo until the world's PR. Each task: card first (T093), compared with all others before any image run; brief from FR-011, one back-wall sheet plus parts by `worldprompts.ts`, windows only by FR-020..FR-024, postbox by FR-012, `worlds/<id>/` with `world.json`, parts and `ASSETS.md`, a registry row with every moment's cell, catalogue hash; no cutout from another world. Test for each: `test:world-packs`, `test:world-catalogue`, world matrix at both sizes, `check-office-ops`, `check-perf --record` (097 T163), `check-world-distinct`, and `read:` the owner's look and `distinct-check` recorded in `ASSETS.md` (T094).

- [ ] T113 Flat as a World row; not in the registry [FR-001, FR-212]. Test: `test:surfaces`; `sim:` request log.
- [ ] T115 Retro arcade, shipped in the app, default Retro pixel people, arrangement `aisles`, day and night; waits for T111 and T179; lands in T230's one PR with spec 035 T089 and T122. Test: as this phase says, and T230's [FR-011, FR-213, FR-250]
- [ ] T119 Cards for Photo office, Cave and Cheeky loft from their art, arrangement, monitor and mood included; default sets recorded; any clash with a new world changes the new world. Test: `test:world-catalogue` card pairs [FR-011, FR-014].
- [ ] T091 Windows in built-in worlds: photo after the owner's look; cave and loft only on Paco's decision (OP-8). Test: T027's test; `read:` approvals in `ASSETS.md` [FR-020].
- [ ] T093 Cards and the card check: `worlds/<id>/card.json` for every picture world of FR-011; pairs in `test:world-catalogue`; `scripts/check-world-distinct.js` (hash, perceptual hash, average colour; near results reported only until T097). Needs to come before any world's first image run. Test: fixtures with a same-material pair, a same-arrangement pair, a same-monitor pair, a light temperature under 200 K apart and a copied cutout each fail, named; a recoloured cutout is reported [FR-014..FR-016, SC-011].
- [ ] T094 Contact sheet (`scripts/world-contact-sheet.js`, artifact only, outside `DOC_SHOTS`) and the required `distinct-check` field. Test: `test:world-catalogue` fails without the field; `read:` the reviewer's look per new world [FR-017, FR-035, SC-011].
- [ ] T097 Set FR-016's near-match thresholds from real packs: measure every pair once at least two real worlds exist, plant a recoloured and a re-encoded cutout, record the numbers and the reasoning in a dated delta, and turn near results from reported to failing. Until then the thumbnail review decides. Test: `sim:` the planted recoloured and re-encoded cutouts fail and the real pairs pass; `read:` the delta [FR-016, SC-011].
- [ ] T092 The real-GPU run with one downloadable world, simulator only, 0 AI credits, by whoever has the machine. Test: `real:` recorded with 097 T162 [FR-182, 097 FR-189].

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
- [ ] T068 [US7] Source on every listing, from main's record; look-alike names; a pack claiming `photo`, our source or our hash stays *Imported*. Test: `test:worldpack` with Cyrillic, dotless i and fullwidth names; `check-worlds` reads the source beside the name in the World row, dialog, Manage, notice and try bar; `test:worldstore`: nothing but a pinned download sets the project label [FR-095, FR-097, FR-098, SC-015].
- [ ] T069 [US7] Share: Export's statement and SHA-256, import's report, **Export as a source folder…**, `docs/worlds-source.md`, `scripts/world-sign.js`. Test: `test:worldstore`: exported source folder serves through the fake layer and passes end to end; a signature from the script verifies; no private key in any app file [FR-161..FR-163].
- [ ] T053 [US5] An organisation's own location behind a proxy, by whoever has one. Test: `real:`, else `[KNOWN GAP]` kept [FR-182].
- [ ] T054 [US5] Docs: admin page lines for the keys, 076's schema entry. Test: `read:`, `test:docsscripts` [FR-110, FR-111].

## Phase 8: Character sets (PR P8, split by the tasks) - US8

- [ ] T100 [US8] Set format and `checkSet`, shared with `worldpack.ts`; closed names, caps as constants (`src/shared/worldpack.ts`). Test: `test:worldpack`: each missing pose, anchor and size; fallback only for the four optional poses and the back views; `full`, `heads`, refused; hostile fixture set; `test:world-packs` on built-ins [FR-204, FR-205, FR-206].
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
- [ ] T111 Retro pixel people, new, 15 people approved by the owner; delivered by T201 and T207, with provenance and likeness fields. Test: `test:world-packs`, asset test; `read:` the owner's look [FR-200, FR-209].
- [ ] T122 Retro pixel people as the `pixel` Characters value in Flat, with a dated delta in spec 077 (its FR number taken at build): the Settings pick, heads by FR-203, built in RA8 behind the closed flag, opened by T230's one PR with spec 035 T089. Needs T111. Test: `test:characters`, `test:crew`, `test:crew-assets`, `check-characters`; a mutant that drops the value fails [FR-214]
- [ ] T112 My characters: level per character, 096's Real office frames. Test: `test:world-packs` on 096's fixture; `test:charstore` [FR-206].

## Final

- [ ] T095 Screenshots at both sizes for linked pictures, `npm run shots:docs`; a downloadable world only in `docs/` once it is `available` (the matrix stays artifacts only, 098 FR-054). Test: `npm run shots:docs`, look at each.
- [ ] T096 `/speckit.converge` against SC-001..SC-018; world matrix path filter and weekly run read as worlds are added (shard if needed). Test: `npm run specs:check`, `read:` [FR-181].

## Monitor and arrangements (FR-220..FR-236, SC-019..SC-021)

Numbers taken: T164..T178. One small PR per step, after #921, #974 and P1. 0 AI credits except the art runs, which are on the owner's plan and his look.

- [ ] T164 After #921 lands, write into spec 097's `## Changes`: `realLayout` takes an arrangement; `meta.monitor`; 097 FR-013's `screen` and `glass` with a monitor; FR-229's limits; the 24 px face floor at 15 agents in place of FR-012's 40 and 28 px and SC-002 for project worlds, and `check:office`'s ratchet (31 px on the 097 build branch) with it. Test: `npm run specs:check` [FR-220, FR-228]
- [ ] T165 **Before anything else:** `src/shared/realoffice-arrangements.ts`, `circle`, `facing-view` and `flanking` (`aisles` after T179), with `arrangementFits`; not wired to the app. `test:realoffice-layout` at 1..40 agents in 1..8 folders at both sizes, chat closed and open: rectangles do not overlap, stay in the floor; face at least 24 px at 15 agents, larger with fewer. **If 15 agents do not fit at that floor, redesign the arrangement and tell the owner the numbers (A5).** [FR-227, FR-229, FR-230]
- [ ] T166 Seam in `realLayout` and `realoffice.js`, `Layout.arrangement`, `Layout.focus`, lazy load; a fixture world in the simulator with a plain test `focus`. Test: `sim:` `shots-097-realoffice`-style driver with `until()` at both sizes; `check:office`; simulator shots to the owner and Paco (A4) [FR-228, FR-234]
- [ ] T167 Rows proof: byte-identical `Layout` to today over seeded models; the arrangement file not fetched with `rows` (a driver lists the page's scripts); `check-office-ops` rows limits unchanged. Test: `test:realoffice-layout`, `sim:` [FR-231, SC-020]
- [ ] T168 A project world never falls back on count and keeps its arrangement at 1..4 with bigger screens; a shared pack's fall-back: count only, two-agent margin, status changes never switch; All floors and small windows. Test: `test:realoffice-layout`, including a run through every status at the boundary count [FR-230]
- [ ] T169 Keyboard order: DOM and Tab order follow the sequence, neighbours on screen; a screen reader's order is the same. Test: `test:` pure on rectangles; `sim:` real Tab presses at 15 agents [FR-229]
- [ ] T170 Op budgets per arrangement in `check-office-ops` (a world id parameter, plan's table), reduced motion and Serious mode (`document.getAnimations()`), FR-019's time with a fall-back attempt. Test: `sim:`, `test:officeops` [FR-229, SC-019]
- [ ] T171 `worldpack.ts`: `arrangement`, `ARRANGEMENTS` (five ids); `focus.webp`; `monitor`, `monitor-half`, `desk-back` parts, caps, `screenRect`. Test: `test:worldpack`: `__proto__`, `constructor`, an array, a number, a long string, a known id with different case, `focus` with `rows`, `aisles` or `flanking`, no `focus` with `circle`; `screenRect` too small, outside 0..1, monitor without one; a position or radius field refused. `test:world-packs` shares it [FR-220, FR-221, FR-226, SC-021]
- [ ] T172 Engine and renderer: monitor picture contained in `screen`, opaque token face at `glass`, `ro-bezel` fallback, big screens' bezel; no `meta.monitor` gives today's output. Test: `test:realoffice-layout`; `sim:` text on a monitor fixture with a noisy picture: contrast of the face, nothing under 10.5 px, `textContent` only (hostile text fixture) [FR-220..FR-222]
- [ ] T173 `test:world-catalogue`: monitor required for a project world's `available`; prompt pack and maker know the closed list and new parts. Test: `test:world-catalogue`, `test:worldprompts` [FR-222, FR-236]
- [ ] T174 Cave's circle: `cave` names it, fire `focus`; Paco's art approval, `ASSETS.md`. Test: `sim:` matrix, `real:` his look [FR-234]
- [ ] T175 #987's order in a ring: saved room and desk order seat as saved; `DurbarReorder` preview on ring rectangles, once 033 FR-086's attachment exists; the status sort follows the owner's answer to its Q2. Test: `sim:` [FR-232]
- [ ] T176 Mutants, listed in the PR: object lookup for the id; a position field let through; `arrangementFits` keyed on state; rows calling new code; fall-back without a margin; text under the floor on a monitor; `innerHTML` on a screen. Each fails a test. Test: SC-021 [SC-021]
- [ ] T177 `barcelona-beach`: card first (FR-016, FR-017), then one image run on the owner's plan, on his new approval (FR-172); `facing-view`, furniture, monitor as laptop, umbrellas in `desk-back`. Test: `sim:` matrix, faces at least 24 px at 15 agents at both sizes, `[KNOWN GAP]` until the redesign reaches it; `real:` his look in `ASSETS.md`, naming the FR-235 exception [FR-223..FR-225, FR-235]
- [ ] T178 Docs: `docs/features.md` and `docs/limits.md`, world-maker notes, a `changelog.d/` fragment in each build PR; `/speckit.converge`. Test: `test:docsscripts`, `changelog:check` [FR-236]
- [ ] T179 Retro arcade's `aisles`, split by the plan into T200, T202..T205, T211. The owner's look at the mockup is done, his look at the level cabinet is T200. Test: as those tasks say [FR-227, FR-238, FR-256]
- [ ] T180 `durbar-hall`: card first (FR-016, FR-017), on the owner's new approval (FR-172); `flanking`, gold bead monitor, flags with our mark, period lamp. Test: `sim:` matrix at 3, 4, 8 and 15 agents; `real:` his look in `ASSETS.md`; the numbers against FR-229 [FR-210, FR-237]
- [ ] T181 Back views `backA`, `backB` per set, for `circle`, `facing-view` and `flanking`: art on the owner's plan and approval, crew art by Paco per image; seat choice in the engine. `[KNOWN GAP]` until drawn. Test: `test:world-packs`, `test:realoffice-layout`, `sim:` hover and keyboard focus show the big screen for a back seat; `read:` approvals in `ASSETS.md` [FR-204, FR-227]

## Retro arcade (FR-250..FR-270, SC-022..SC-027)

Numbers taken: T200..T232. Base for the build: `097-chat-in-world` (#1001); see the plan, including phases and the measure-first order. One reviewer per phase. 0 AI credits; no new image run (the people exist; cabinets, room and fixtures are drawn by a script). Drivers use `until()`, no wall-clock assert. Every phase carries its `changelog.d/` fragment and docs; nothing is visible until T230.

### RA0: art, in the cache, no repo code

- [ ] T200 **Measure first.** Level cabinet (two sizes, four colours, level glass and marquee, side panel) beside the slanted one, at 15 and 4, with real text at 10.5 px; fixtures at Q6's size if he agrees. Test: `read:` the owner's look recorded in the spec (Q1, Q6) [FR-258]. **2026-11-01 (RA0): the side-by-side exists** (`~/.cache/realoffice-art/layouts/mock/arcade-level-compare.png`, 1440x900, not committed); the owner's look is still to come, so this stays open; the build assumes level glass.
- [ ] T201 Art clean-up: `r8-waveA` and `r4-waveB` are not on the 8x grid and one more frame has mixed blocks; `faceBox` measured per person; provenance corrected (the notes contradict themselves, Q11); likeness per 097 FR-067, FR-068. Test: the script of T206 refuses a frame off the grid; `read:` the notes [FR-256, FR-269].

### RA1: `aisles`, pure (one PR)

- [x] T202 **Measure first.** `aisles` in `realoffice-arrangements.ts` (this builds T165's file and T166's pure half; `rows` stays byte-identical, T167): `g`, seats, stagger, bend, facing, zones, folder signs, plates, 1..15 and 40 agents in 1..8 folders, both sizes, chat closed and open. Test: `test:realoffice-layout`: no overlap of rectangles, in the floor; every rectangle on `g`; face at least 24 px at 15 and larger at 8 than at 15, at both sizes; sign has name, counts, **+**, menu at every count; numbers to the owner; if it does not fit, redesign (FR-229) [FR-255, FR-256, SC-022]. **Built in RA1 (pure part), 2026-11-01** in `src/shared/realoffice-arrangements.ts`, `scripts/test-realoffice-aisles.ts`: no overlap, on `g`, faces, signs; **measured**: 15 fit without scroll on all four floors; face 48 px (provisional `FACE_GRID` x g); the level cabinet (146x146 px, not 146x164) is what buys the sign strip; signs lose path and cost to hover for some folders (see the test's printout); 1280x800 with the chat open has 810 px: the cabinet narrows to 122 px (glass 88x60, so bars) and 8 people stay at `g = 2`, **faces at 8 equal faces at 15 there: `[KNOWN GAP]`**.
- [x] T203 Past 15: more rows, floor scrolls inside; All floors stays rows; a status change moves no zone and no sign. Test: `test:realoffice-layout` over every status at 15, 16 and 40 [FR-230, FR-256]. **Built in RA1.** More rows at the smallest cabinet, the floor scrolls; a status change moves no zone, sign or cabinet (tested at 15, 16, 40).
- [ ] T204 **Measure first.** Device pixel ratio 1, 1.25, 1.5, 2: uneven pixels at 15, simulator shots at each, then the rule of FR-255 if needed. Test: `test:realoffice-layout` for the rule, if built; `sim:` `--force-device-scale-factor`; `read:` the look, recorded [FR-255]. **RA1 (pure part only):** the rule is not built; at ratio 1.25 no integer `g` that fits gives whole device pixels (`g = 2` is 2.5, 4 would be 5), at 1.5 `g = 2` is 3 and `g = 3` is 4.5; the look in the simulator waits for RA3 (nothing draws yet).
- [x] T205 Keyboard order for `aisles` (T169's shape). Test: pure on rectangles; `sim:` in T211 with real Tab presses [FR-229, FR-256]. **Built in RA1 (pure part):** `aisleTabOrder`, tested row by row; the real Tab presses stay in T211.

### RA2: frames and packs, nothing draws them (one PR)

The new fields go into `worldpack.ts` (T171's list) when #955 lands; until then `test:realoffice-assets` holds them, and FR-269 (b) stays open.

- [ ] T206 `scripts/build-arcade-pack.py`: room in both lights, cabinets, fixtures, glow strip, from the mockup's drawing with the level cabinet; `worlds/retro/`, `world.json` with `arrangement`, `pixelArt`, `lightSets`, `nightTokens`, `monitor`. Test: `test:realoffice-assets`: every file `VP8L` only (lossless, by chunk), no `ANMF`; caps; `read:` two runs give the same bytes; a frame off the grid fails the script [FR-252, FR-254, FR-259, SC-025].
- [ ] T207 `sets/retro/`: 15 people x 17 frames from the art, `set.json` with `pixelArt`, `faceBox`, `foot`, `facing`, `ASSETS.md`. Needs T201; it is T111's art. Test: `test:realoffice-assets`; a person missing a required frame fails [FR-200, FR-254, FR-259].
- [ ] T208 **Measure first.** Sizes of the committed files replace FR-253's table, by a dated line; the shipped total against 30 MB. Test: `test:realoffice-assets` with a planted file over each cap; `read:` the table [FR-253, SC-025].

### RA3: draw the hall (one PR, or two if over one reviewer)

- [ ] T209 Row in `WORLDS` and `REAL_SETS`, flag `retro`, closed; `realoffice.js` scales pictures by `g`, with `image-rendering: pixelated` from `pixelArt`; `world.css`. Test: `shots-102-arcade` (new, `until()` waits, in `ui-suite`): flag closed, no `retro` file asked for and no entry; flag open, only `retro` files; `test:realoffice-assets` no filter or blend [FR-254, FR-255].
- [ ] T210 T172 for this world: cabinet part, level glass, marquee at `marqueeRect`, CRT through FR-030..FR-033, scanlines under the text. Test: `shots-102-arcade`: the face's contrast against each text, nothing under 10.5 px, marquee at least 12 px, `textContent` with a hostile name and hostile output, no text in a mirrored element, no `skew` in computed styles; long name ellipsis; mutants: `innerHTML`, a mirrored text [FR-257, FR-258].
- [ ] T211 Signs, plates, fixtures, visitors, people by `AISLE_POSE`, glow. Test: `shots-102-arcade` at 3, 4, 8 and 15 agents, 1440x900 and 1280x800, chat closed and open: no overlap, including visitors over fixtures, the bubble and the coin (the mockup's own check left these out); no office scroll at 15; Tab order; `check:office` with a world id [FR-229, FR-256, FR-259, SC-022].
- [ ] T212 Op rows. Test: `check-office-ops` with the world id at 15 and 40: 097 FR-178's rows, no new allowance; a mutant adding a node on a status update fails; `rows` limits unchanged [FR-229, FR-261, SC-024].

### RA4: status and motion (one PR)

- [ ] T213 Marquee, glow, bubble and flourish per FR-260's table, from `lightFor`. Test: `test:realoffice-layout` for the pure table over every state and flag, with `lampWords` unchanged; `shots-102-arcade`: reduced motion, Serious mode and forced colours: `document.getAnimations()` empty, states still differ, words remain; error's glow inside its own slot [FR-260].
- [ ] T214 Shared beat and 4 people phases, `steps()`, `opacity` and `transform` only. Test: `test:realoffice-assets` on `@keyframes`; `shots-102-arcade`: all flashes report one phase from `getAnimations()`; flashes under 3 a second; hidden window: 0 frames; a mutant with its own delay per marquee fails [FR-260, FR-261, SC-024].
- [ ] T215 **Measure first.** Pixel dissolve by static masks; a plain stepped fade beside it, frames and idle CPU, then the one that holds. Test: `shots-102-arcade`: only `opacity` and `transform` animate; no node added by a status update; no ghost, one body at a time; none under reduced motion; `read:` a recording, as #979 was judged [FR-262].
- [ ] T216 **Measure first.** `check-perf --record` for `retro`, 4 mixes, day and night, against Photo office on the same machine, plus chase on and off for Q2. Test: `sim:` the record (never an assert, 097 FR-187); `real:` by T231 [FR-261, SC-024].

### RA5: Light (one PR)

- [ ] T217 `WORLD_SETS.retro` with day (Retro Pixel's values, moved) and night; `setWorld` and `worldContrast` take the light. Test: `test:theme-tokens`: every pair at AA in both lights and forced colours; a mutant dimming night's ink fails; cream surfaces at night [FR-263, SC-023].
- [ ] T218 `wall-night`, `floor-night`, `welcome-night` in the drawing; only the shown light fetched; switching drops the other. Test: `shots-102-arcade` request log; memory row with `check-perf --record` [FR-252, SC-023].
- [ ] T219 **Light** group under the entry: radios, keyboard, screen reader, tokens; stored beside `world`; hidden for any other world with no tab stop; default Day; bad value Day; never follows the system (`prefers-color-scheme` emulated dark changes nothing). Test: `shots-102-arcade` at both sizes; `Layout` byte-equal in both; `test:realoffice-layout` for parsing `__proto__`, numbers, long strings; a mutant following the system fails [FR-251, SC-023].

### RA6: chat and Settings (one PR)

- [ ] T220 `ui: "retro"` while the world shows; leaving restores the theme's. Test: `test:theme` allow-list; `check:geometry` beside Clean Office: same boxes; `shots-102-arcade`: Settings, List view, palette in both lights; `test:surfaces` [FR-263].
- [ ] T221 #1001's chat in the arcade: marquee header, column with cabinet and person, portrait. Test: `shots-097-chat` with the world id at 1440x900, 1280x800 and 1100x800: opacity, every pair at 4.5:1 (3:1 large), both lights; tab order equal to flat's; `read:` beside the room (the guide's rule) [FR-263].

### RA7: moments (one PR)

- [ ] T222 The nine of the plan's table. Test: `shots-097-moments` for `retro`, both sizes, both lights, reduced motion, forced colours; words and buttons as the flat ones [FR-264].
- [ ] T223 Every other cell looked at; the registry row for `retro`, `shippable: false`, with each of 26 cells. Test: `test:surfaces`; `read:` the list in the PR [FR-264, SC-022].

### RA8: sets (one PR); needs T207

- [ ] T224 FR-204 and `checkSet` follow 097 FR-191..FR-193; optional `face-*`; `-half` not needed with `pixelArt`. Written into 098 FR-030 by T232. Test: `test:world-packs` or, until #955, `test:realoffice-assets`: Office people and Prehistoric still `full`; a required frame missing refused [FR-259].
- [ ] T225 Interoperation: Office people and Prehistoric in the arcade (fallback, report line), Retro pixel people in Photo office. Test: `shots-102-arcade` at 15, both sizes; `test:characters` through `peopleFor`; no other pack fetched [FR-200, FR-259, SC-016].

### RA9: coverage (one PR, no behaviour change)

- [ ] T226 Fixture user theme with a dark page; every script naming `retro` as its second theme moves to it, and the arcade joins the layout checks; spec 008 FR-111 with a dated line. Test: `test:userthemes`; `check:geometry` and `check-parallel` list the same number of layouts as before; a saved-theme fixture naming `ui: "retro"` and `scene: "pixel"` falls back to `clean` and `office` [FR-267, SC-026].

### RA10: the flip

- [ ] T227 Migration, once, built behind the flag: FR-266's row in FR-207, `theme` to `pixel`, an explicit Characters choice untouched. Test: `test:characters`: stored `retro` with each Characters value; a repeat changes nothing; no request; mutants: skipping the write, overwriting an explicit choice; `shots-102-arcade`: after the move no dialog, toast or notice appears, day is shown, and Flat is one click away in Settings [FR-266, SC-026].
- [ ] T228 `worlds/retro/card.json`, both lights; FR-010's words; `distinct-check`. Needs T093, T094. Test: `test:world-catalogue`: a planted world within 200 K of either light fails; `read:` the contact sheet [FR-268].
- [ ] T229 The owner's look before the flip (FR-035 (f)), day and night, with FR-265's table, each item kept or named. Test: `read:` recorded in `ASSETS.md` and the spec [FR-265, SC-026].
- [ ] T230 **The flip, one PR:** `WORLD_FLAGS.retro` removed; T115; T122's `pixel` value; T227 live; spec 035 T089 (theme and `pixel` kit code, `retro` style rules the arcade does not use, tests, drivers, docs, screenshots, spec 038 `superseded`); a changelog fragment that says Retro Pixel users move to the arcade; `shippable: true`; README, `docs/themes.md`, `docs/features.md`, `docs/limits.md`, the Characters row, FR-213's measured sizes. Only when FR-269 is met. Test: `npm test`; `test:world-catalogue`; `test:theme`: no `retro` built-in and the world offered, together: a mutant doing one fails; `test-site`; `npm run shots:docs`, each looked at; every check in FR-035 [FR-250, FR-266, SC-027].
- [ ] T231 Real-GPU run for this world, simulator only, 0 AI credits, by whoever has the machine, with 097 T162; and FR-269's list read against the tree on the day. Test: `real:` numbers in a dated delta; `read:` [FR-261, FR-269].
- [ ] T232 Other specs' lines (FR-270) as their PRs land; `docs/world-design.md` learns: level text, frames not code, shared beat, sign first. `/speckit.converge`. Test: `npm run specs:check`, `npm run test:docsscripts`, `changelog:check` [FR-270].

## Dependencies

Other specs: #921 (097 P1), #936 and 097 T156..T159 (gate), 098's checks, 096 (P6, and pieces of P5), 076 (only its first slice here). Retro arcade: #979, #991, #993, #994, #1001, #955; spec 001 on #984 for the gate (FR-269).

**MVP**: P1, P2, P3 and one world: downloaded with a plain notice, after the gate. **Independent tests**: US1 by the fake request layer; US2 per world; US3 by hostile fixtures; US4 by the fake generator; US5 by policy fixtures; US6 by round trip; US7 by the adversarial set; US8 by `peopleFor`, migration and request logs.

**Parallel**: T010, T011 in P1; worlds in P4 (limited by art batches and the owner's looks, not by code); T055, T058 in P5.
