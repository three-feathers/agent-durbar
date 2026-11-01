# Tasks: 104 New website, story videos and agent blog

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII): Node tests with fixtures and mutations; 0 credits. Each task is one small PR, in this order. **Time and cost are estimates**, not measurements; costs are list-price equivalents of plan use (plan, *Costs*). Numbers taken: spec 104, FR-001..FR-079, SC-001..SC-006, T001..T021; in spec 021, FR-076 and T055.

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. `[P]` can run beside the task before it.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, `specs-index` block, spec 021 FR-076 (proposed) and T055, spec 050 delta. Test: `npm run specs:check`, `rules:check`, `changelog:check`.

## Phase 1: Guards first, measure first

- [ ] T002 **Measure** a 10 s simulator capture: `capturePage` piped to `ffmpeg` against `x11grab`; real fps, KB per second, one Electron at a time. Write the result in the plan's tables; correct FR-021 and FR-022 if the figures say so. No code kept. Estimate: 1 h, under $1.
- [ ] T003 **Unreleased gate** [FR-008]: `docs/site/unreleased.json`, the build check over HTML, feed, captions and README, `worlds.json`, and no `note` of a draft spec in the site's specs index. Lands before any page, and before an open PR's note reaches the site. Test: a stand-in phrase in each place fails; a shipped theme's text passes. Estimate: 1 h, $2.
- [ ] T004 [P] **Release filter** [FR-027]: `latestRelease()` takes `v*` only. Test: fake list with `media-library` and `worlds-*` first picks the `v*` one; mutation fails. Estimate: 30 min, $2.
- [ ] T005 **`blog:check`** [FR-060..FR-066]: `scripts/check-posts.js`, fixtures, allowlist, hash list with a stand-in in tests, online author check (fake `gh` in tests), security hold, in `npm test`. The real host's hash is added by a human-run step that reads it from stdin, prints nothing and is not in any log. Sensitive size (spec 021 FR-038): analyst, implementer, reviewer. Test: SC-004 and a mutant per rule. Estimate: 3 h, $6.
- [ ] T006 [P] **Media manifest** [FR-022..FR-025]: `docs/site/media.json`, schema and budget checks, player markup (no `autoplay`, `loop`), `media-src 'self'`, builds without files. Test: removing captions, poster or a hash fails; over budget fails. Estimate: 2 h, $4.

## Phase 2: Site

- [ ] T007 **Two mockups** of the hero and one section for the owner (Q9), at both widths, light and dark; static pictures shown to him directly, not in git. **Stop for his pick.** Estimate: 2 h, $3.
- [ ] T008 **Store and deploy** [FR-024, FR-026]: `pages.yml` fetches, verifies and caches media; deploy job still `main` only. Create `media-library` and the draft review release **after the owner's OK on Q2**. **Measure** a deploy with a test file of about 73 MB against the 10-minute limit. Test: wrong hash fails the build with a fake fetch. Estimate: 2 h, $3; 0 credits in CI.
- [ ] T009 **New look** [FR-001..FR-007, FR-009]: tokens, landing page, worlds, safety, status-light motif and legend, cut pictures to stay under 8 MB. `landing.json` and `test-site.js` follow. **Measure** first view and largest paint; `sim:` screenshots at 1440x900 and 390x844, light and dark, looked at. Test: budgets, contrast pairs, status colours equal to the app's. Estimate: 3 h, $6.
- [ ] T010 **Story page** [FR-040..FR-045]: text by chapter from the plan, every claim linked; chapter one per Q3, no date until he gives one; disclaimer names Grok's owner. Goes through `blog:check`. A human reads it before merge. Estimate: 2 h, $4.

## Phase 3: Videos

- [ ] T011 `scripts/make-video.js` [FR-020, FR-021, FR-023]: recipe to MP4, WebVTT, WebP poster, contact sheet, manifest entry. Test: a recipe with 2 cards makes a clip with `+faststart`, within budget, with captions matching the recipe (skips with a message when `ffmpeg` is missing; not in the required suite). Estimate: 2 h, $4.
- [ ] T012 **Story film** [FR-020..FR-023, FR-040..FR-044], under 4 minutes, no voice (Q1), from T010's text. A human watches it before upload. Estimate: 4 h, $6.
- [ ] T013 [P] **Explainers page and 3 explainers** [FR-001, FR-022]: how the office works, the three permission modes, watching agents at no credit in the simulator. Estimate: 3 h, $6.
- [ ] T014 [P] **Mac clip** [FR-020], only if the owner wants Mac footage: by the Mac session, in simulator mode; same contact sheet. `real:`. Not verified until that session does it. Estimate: 1 h, $2.

## Phase 4: README

- [ ] T015 **README poster** [FR-030, FR-031]: palette PNG, link to `story.html`, links to story and blog, net lines not up; `test:site` and `test:docsscripts` green. Look at it on GitHub after the merge and record that. Estimate: 30 min, $2.

## Phase 5: Blog

- [ ] T016 **Blog pages and feed** [FR-050..FR-055]: reader, list, post page with label and *What this post did not verify*, feed; sample post only in test fixtures. Test: a post without label fails; list and feed links resolve. Estimate: 2 h, $4.
- [ ] T017 [P] `scripts/blog-digest.js` [FR-072, FR-074]: reuses `weekly-retro.js`'s collection, filters on author before printing, prints facts or "nothing to say". Test: fixtures for both, and an outside author's title never appears (mutation). Estimate: 1 h, $2.
- [ ] T018 **Rule change** [FR-070]: after the owner's OK, with Paco's and Ruben's views recorded on the PR, apply spec 021 FR-076's delta (T055). **Needs a written yes; do not start before.** Test: `rules:check`. Estimate: 15 min, under $1.
- [ ] T019 **Back-fill batch** [FR-041, FR-053, FR-075]: posts and clips on one PR, first evidence link PR #1. Dated by subject day, labelled with the day written. **A human owner reads the whole batch and approves in writing before merge.** Needs T016, T018 and Q3. Estimate: 1 day, $6 to $8, plus his reading.
- [ ] T020 **Start daily** [FR-071..FR-074, FR-078, FR-079]: add the digest step to the agents' daily round in `docs/collaboration.md`; first post by the rota in Q4; first 5 read by a human. Estimate: at most $0.45 a post.
- [ ] T021 **Measure** [SC-005]: real token use of the first 3 posts, in the plan. Above the budget: stop daily posts and ask the owner. Also confirm playback by hand in a browser on the live site, and on a phone if a human can (`real:`, or say not checked).

## Later, only if asked

- A human voice on the film (Q1). A custom domain (spec 050).
