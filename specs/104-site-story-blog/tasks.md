# Tasks: 104 New website, story videos and agent blog

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII): Node tests with fixtures and mutations; 0 credits. Each task is one small PR, in this order. **Time and cost are estimates**, not measurements; costs are list-price equivalents of plan use (plan, *Costs*). Numbers taken: spec 104, FR-001..FR-079, SC-001..SC-006, T001..T024; in spec 021, FR-076 and T055 (checked 2026-11-03 against `main`, remote branches and open PRs: FR-073..FR-075 and FR-077 are merged, FR-076 and T055 are free).

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. `[P]` can run beside the task before it.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, `specs-index` block, spec 021 FR-076 (proposed) and T055, spec 050 delta. Test: `npm run specs:check`, `rules:check`, `changelog:check`.

## Phase 1: Guards first, measure first

- [x] T002 **Measure** a 10 s simulator capture: `capturePage` piped to `ffmpeg` against `x11grab`; real fps, KB per second, one Electron at a time. Write the result in the plan's tables; correct FR-021 and FR-022 if the figures say so. No code kept. Estimate: 1 h, under $1. **Done 2026-11-04** (plan, *Simulator capture*): both held 30 fps, about 15 KB/s; FR-021 and FR-022 unchanged; pick `capturePage`.
- [x] T003 **Unreleased gate** [FR-008]: `docs/site/unreleased.json`, the build check over HTML, feed, captions and README, `worlds.json`, and no `note` of a draft spec in the site's specs index. Lands before any page, and before an open PR's note reaches the site. Test: a stand-in phrase in each place fails; a shipped theme's text passes. Estimate: 1 h, $2.
- [x] T004 [P] **Release filter** [FR-027]: `latestRelease()` takes `v*` only. Test: fake list with `media-library` and `worlds-*` first picks the `v*` one; mutation fails. Estimate: 30 min, $2.
- [x] T005 **`blog:check`** [FR-060..FR-068]: `scripts/check-posts.js`, fixtures, allowlist, hash list with a stand-in in tests, an owner's name without `humanRead` fails, no employer list anywhere, online author check (fake `gh` in tests), security hold, in `npm test`. Owner's delta 2026-11-03 23:15 UTC: `humanRead` for the first 5 and every post with a name, `agentReview` from another side, the *Agent review* list in the spec. The real host's hash is added by a human-run step that reads it from stdin, prints nothing and is not in any log. Sensitive size (spec 021 FR-038): analyst, implementer, reviewer. Test: SC-004 and a mutant per rule. Estimate: 3 h, $6.
- [x] T006 [P] **Media manifest** [FR-022..FR-025, FR-024a]: `docs/site/media.json` with `licence`, `madeBy` and `approvedBy` required, schema and budget checks, player markup (no `autoplay`, `loop`), `media-src 'self'`, builds without files. Test: removing captions, poster or a hash fails; over budget fails. Estimate: 2 h, $4.

## Phase 2: Site

- [ ] T007 **Two mockups** of the hero and one section for the owner (Q9), at both widths, light and dark; static pictures shown to him directly, not in git. **Stop for his pick:** Q9 is still open and gates this choice; his 2026-11-03 "go ahead" covers the work that does not depend on it (T011 and so on; T002..T006 are built). Estimate: 2 h, $3.
- [ ] T008 **Store and deploy** [FR-024, FR-026]. Q2 settled (A, Vikram 2026-11-03 23:25 UTC), so it no longer waits; it is its own PR because it edits `pages.yml` (CODEOWNERS), which needs an owner-side review, and the `media-library` release is created after that PR as its own step. Also give `blog:check`'s CI step a read-only `GH_TOKEN` (FR-063; spec *Changes* 2026-11-04): `pages.yml` fetches, verifies and caches media; deploy job still `main` only. The workflow keeps top-level `permissions: contents: read` (the deploy job's own Pages permissions stay as they are), every action pinned to a full SHA including `actions/cache`, no `pull_request_target`, no `${{ }}` in `run:`; the fetch of a public release needs no token. The run is daily, so the cache avoids downloading about 73 MB each day. Test also: a `media.json` entry without `licence`, `madeBy` or `approvedBy` fails, and the PR states the reviewed draft copy's SHA-256 equal to `media.json`'s [FR-026]. Create `media-library` and the draft review release **after this PR merges** (Q2 is settled). **Measure** a deploy with a test file of about 73 MB against the 10-minute limit. Test: wrong hash fails the build with a fake fetch. Estimate: 2 h, $3; 0 credits in CI.
- [ ] T009 **New look** [FR-001..FR-007, FR-009]: tokens, landing page, worlds, safety, status-light motif and legend, cut pictures to stay under 8 MB. `landing.json` and `test-site.js` follow. **Measure** first view and largest paint; `sim:` screenshots at 1440x900 and 390x844, light and dark, looked at. Test: budgets, contrast pairs, status colours equal to the app's. Estimate: 3 h, $6.
- [ ] T010 **Story page** [FR-040..FR-045]: text by chapter from the plan, every claim linked; chapter one per FR-041; one diagram per chapter; disclaimer per FR-045. Goes through `blog:check`. A human reads it before merge. Estimate: 2 h, $4.

## Phase 3: Videos

- [ ] T011 `scripts/make-video.js` [FR-020, FR-021, FR-023]: recipe to MP4, WebVTT, WebP poster, contact sheet, manifest entry. Test: a recipe with 2 cards makes a clip with `+faststart`, within budget, with captions matching the recipe (skips with a message when `ffmpeg` is missing; not in the required suite). Estimate: 2 h, $4.
- [ ] T012 **Story film** [FR-020..FR-023, FR-024a, FR-040..FR-044], **gate: the licences of Kokoro, espeak and the music and pixel pipeline are checked and recorded first**; under 4 minutes, Kokoro voices in turns, chiptune, pixel cast, from T010's text and the sample in progress; measure its size. A human watches it before upload. Estimate: 4 h, $6.
- [ ] T013 [P] **Explainers page and 3 explainers** [FR-001, FR-022]: how the office works, the three permission modes, watching agents at no credit in the simulator. Estimate: 3 h, $6.
- [ ] T014 [P] **Mac clip** [FR-020], only if the owner wants Mac footage: by the Mac session, in simulator mode; same contact sheet. `real:`. Not verified until that session does it. Estimate: 1 h, $2.

## Phase 4: README

- [ ] T015 **README poster** [FR-030, FR-031]: palette PNG, link to `story.html`, links to story and blog, net lines not up; `test:site` and `test:docsscripts` green. Look at it on GitHub after the merge and record that. Estimate: 30 min, $2.

## Phase 5: Blog

- [ ] T016 **Blog pages and feed** [FR-050..FR-055]: reader, list, post page with label and *What this post did not verify*, feed; sample post only in test fixtures. Test: a post without label fails; list and feed links resolve. Estimate: 2 h, $4.
- [ ] T017 [P] `scripts/blog-digest.js` [FR-068, FR-072, FR-074]: reuses `weekly-retro.js`'s collection (adds the missing export of `gather`; it exports only `buildFacts` today), filters on author before printing, prints facts or "nothing to say". Test: fixtures for both, an outside author's title never appears, and a fixture commit's author, email and trailer never appear (mutations). Estimate: 1 h, $2.
- [ ] T018 **Rule change** [FR-070]: with Paco's and Ruben's views recorded on the PR (Vikram approved 2026-11-03 23:04 UTC), apply spec 021 FR-076's delta (T055). **Owner approved 2026-11-03; start when Ruben confirms Q10; Paco sees the final wording first.** Test: `rules:check`. Estimate: 15 min, under $1.
- [ ] T019 **Back-fill batch** [FR-041, FR-053, FR-075]: posts and clips on one PR, first evidence link PR #1. Names per FR-067. Dated by subject day, labelled with the day written. **A human owner reads the whole batch and approves in writing before merge.** Needs T016, T018 and Q3. Estimate: 1 day, $6 to $8, plus his reading.
- [ ] T020 **Start daily** [FR-071..FR-074, FR-078, FR-079]: add the digest step to the agents' daily round in `docs/collaboration.md`; post commits and `media-library` uploads follow spec 021 FR-061 (signed, Verified, no AI trailer) [FR-071]; first post by the rota in Q4; human reads per FR-079; review list in the PR template's place for posts. Subscription quota only (FR-073); a post is skipped when the quota runs out.
- [ ] T021 **Measure** [SC-005]: real token use of the first 3 posts, in the plan. Above the budget: stop daily posts and ask the owner. Also confirm playback by hand in a browser on the live site, and on a phone if a human can (`real:`, or say not checked).

- [ ] T024 **Taking a post down** [FR-077]: a recipe in `docs/collaboration.md` (revert PR, delete the `media-library` asset and its `media.json` entry, rebuild, rotate a leaked secret, tell the human what stays readable in history); the check fails a `media.json` entry whose post is gone. Test: fixture with an orphan entry fails. Estimate: 30 min, $2.

## Later

- [ ] T022 **Shorts render** [FR-028] in `make-video.js`: vertical, burned-in captions, release asset only. Test: a 2-card recipe makes one within 60 s. Estimate: 1 h, $2.
- [ ] T023 **YouTube upload** [FR-029]: after he sets the channel up and sets the sign-in himself; job on `main` only, comments off, private until the audit; a post that fails `blog:check` never uploads. **Needs his written yes, and FR-076 in force.** Read Google's rules first. Estimate: 2 h, $4; 0 credits in CI.
- A custom domain, only if asked (spec 050).
