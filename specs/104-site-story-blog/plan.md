# Implementation Plan: 104 New website, story videos and agent blog

**Spec**: [spec.md](spec.md). **Tasks**: [tasks.md](tasks.md).

## Summary

Keep the generator: `scripts/build-site.js` gets new tokens, new pages and a post reader. Add one check script and one small video script. Videos are stored as release assets and copied into the Pages artifact at deploy, so they are same-origin and never enter git. All estimates here are labelled; measured figures name how they were measured.

## Technical context

- **Stack**: plain Node 22, `marked` (present), `ffmpeg` on authors' machines (6.1.1 here), Electron drivers (`scripts/shots-docs.js`, `H.shot`). No new npm dependency.
- **Existing capabilities reused** (FR-031 of spec 021): `build-site.js` (`page`, `makeMd`, `copyTalks` for copying), `test-site.js`, `compress-shots.js` (README poster), `shots-docs.js` drivers, `src/shared/redact.ts` (loads in plain Node, agent-notes), `scripts/trusted-lib.sh` and `gh-trusted.sh`, `scripts/weekly-retro.js` (digest facts), `specs-index.js`, `pages.yml`, the asset-only release pattern of spec 021 FR-066.
- **Site today** (`read:` local build 2026-11-01): 7.9 MB without `talk/` (budget 8 MB), 7.7 MB of it screenshots; `index.html` 32 KB, 9.7 KB compressed; `docs.html` 249 KB; `talk/` 48 MB, in git.

## Video storage

### Measured

`real:` re-encoding 30 s of `talk.mp4` (a mix of slides and footage, already compressed once, so a rough guide) with `ffmpeg` 6.1.1 on this 4-core machine under load. Simulator footage may differ: T002 measures it.

| Settings | 30 s | Per second |
|---|---:|---:|
| 1280x720, 30 fps, H.264 `slow` CRF 28, silent | 1,929 KB | 64 KB |
| same, with AAC 64 kb/s | 2,190 KB | 73 KB |
| 1280x720, 24 fps, H.264 `slow` CRF 32, silent | 1,213 KB | 40 KB |
| 960x540, 24 fps, H.264 `slow` CRF 30, silent | 1,052 KB | 35 KB |
| 1280x720, 30 fps, AV1 (SVT 1.7 preset 8, CRF 40), silent | 2,403 KB | 80 KB |

A 720p frame as a poster: PNG 722 KB, JPEG (`q:v` 6) 102 KB, WebP (quality 70) 52 KB. Encoding took about 15 s for 30 s of video at CRF 28 on 2 threads.

Why FR-021 and FR-022: at these rates 4 minutes with sound is about 17.5 MB, 90 s silent about 5.8 MB, and 45 s at the lower setting about 1.8 MB. AV1 at these settings was larger, so one H.264 file stays.

### Budget (estimates from the table)

| Item | Each | Count | Total |
|---|---:|---:|---:|
| Story film | 20 MB | 1 | 20 MB |
| Explainers | 6 MB | 3 | 18 MB |
| Retro clips | 2 MB | 17 at most | 34 MB |
| Posters | 60 KB | 21 | 1.3 MB |
| **Start** | | | **about 73 MB** |
| Daily clips, worst case | 2 MB | 365 a year | 730 MB a year |

With a 600 MB ceiling the worst case reaches it after about 263 posting days (`(600 - 73) / 2`), then the FR-022 rule takes the oldest clips off the site. With `talk/` and pages the deployed total stays near 656 MB, under the 1 GB limit.

Git gains text only: post, captions and manifest entry, an estimated 4 KB a post, about 1.5 MB a year before compression, plus one README poster of at most 150 KB each time it is retaken.

### Options

| Option | Repo weight | Limits (`read:` GitHub docs, 2026-11-01) | Privacy, site rules | Verdict |
|---|---|---|---|---|
| In git, as `talk/` is | 73 MB now, 730 MB a year, forever in history; `.git` is 1.4 GB already | Recommended repo limit 1 GB | Same-origin | No |
| Pages artifact only | None | Site 1 GB, 100 GB a month soft, deploy 10 minutes | Same-origin | Needs a source of files |
| Release assets, linked directly | None | Each under 2 GiB, 1,000 per release, no total or bandwidth limit | `real:` asset redirects to another host, `application/octet-stream`, `Content-Disposition: attachment`, no CORS header, range works (206). Breaks FR-004: a second host in the CSP; player behaviour not tried | No, as the player's source |
| **Release assets as the store, Pages as the server** | None | Both of the above | `real:` Pages serves `video/mp4`, ranges (206), `max-age=600`; same-origin, no CSP host | **Pick** |
| README attachments | None | 10 MB on a free plan, 100 MB paid | Hand upload, not for a site | No |
| YouTube, Vimeo | None | Theirs | Third-party embed and tracking, account, breaks FR-004 | No |
| Paid object storage or CDN | None | Theirs | Money and an account (needs approval), a second host | No: not needed at this size |

**Pick**: `media-library` release as the store, fetched and hash-checked into `_site/media/` by `pages.yml`, cached per file with `actions/cache`. Immutable releases are off on this repository (`read:` API, 2026-11-01), so assets can be added to one release. A clip and its poster are two assets, so the 1,000-asset limit is about 500 posts; then a new `media-library-2` follows the same pattern.

Measure first: a deploy with the start set (T008) confirms fetch and deploy fit the 10-minute limit; `pages.yml` ran about 4 minutes on 2026-11-01, queue included. If a much larger artifact is too slow, lower the ceiling.

## How a video is made

`scripts/make-video.js <recipe.json>` (needs `ffmpeg`, no `npm test` step). A recipe lists scenes: a text card (an HTML page rendered offscreen with the site's tokens) or a simulator capture (a driver script). Captions come from the recipe's lines, so WebVTT, transcript and on-screen text have one source. Output: MP4, WebVTT, WebP poster, contact sheet (`ffmpeg` tile, one frame per 3 s), manifest entry.

- **Capture**: T002 tries `capturePage` frames piped to `ffmpeg` (works on every OS) against `x11grab` under Xvfb (Linux only). Keep the one that holds 24 fps.
- **Load**: one Electron at a time, `nice`.
- **Mac**: only the Mac session records, in simulator mode, with its own screen tool; the file then takes the same encode and contact sheet.
- **Voice**: none (Q1). `espeak-ng` is present and not used.

## Site design

- **Tokens**: spec 101's palette (FR-014; on its PR, not merged) with a dark set; status colours copied from the app's `--status-*` meanings under an equality test. System font stack: no web font.
- **Layout**: the hero is the office picture at full width, with a row of status lights in plain CSS (off under reduced motion) and words beside each. Each section is a place in the office rather than a card grid. Two mockups for the owner first ("a mockup is a question", `docs/world-design.md`, on its open PR #992).
- **No scripts**: native `<video>`, `<details>` for transcripts, CSS only. Same CSP plus `media-src 'self'`.
- **Size**: `FR-007` forces a cut: the docs gallery and the themes strip give up pictures first.
- **Specs index**: `docs.html` renders each spec's `note`. Open PR #1005 adds a note naming an unreleased world to spec 102's block, which would reach the public page on merge. T003 stops this; until T003 lands, that note should be reworded on its PR.

## Story chapters and evidence

Facts `read:` from `origin/main` on 2026-11-01; commit counts by author date, merges included (1,464 of 3,703). The writer re-checks each when writing.

| Chapter | Facts | Evidence |
|---|---|---|
| 1. Before the repository | Owner's statement: first prototype and development with Grok, then he moved to Claude. No date | Spec FR-041; first commit holds `prototype/` |
| 2. Day 1, 2026-10-16 | First commit 12:53 +02:00; 97 commits; first PR merged 17:43 UTC; 22 spec files added; Spec Kit skills for Claude added 19:35 +02:00 | `3e0472e0`, PR #1, `2a309c3c`, constitution ("reverse-engineered") |
| 3. Three humans, agents build | "Humans set strategy; agents merge"; Three Feathers | `AGENTS.md`, README |
| 4. The busy week | 609 commits on 2026-10-22, 502 on 2026-10-23; about 1,100 required fixes in about 300 PRs grouped into a checklist | git log, `docs/review-checklist.md` |
| 5. First stable | `v0.1.0` on 2026-10-26, day 11; a stable release daily since the owner's call | release table, spec 021 FR-064 |
| 6. Working in public | Outside text rule and signed commits | spec 021 FR-060, FR-061 |
| 7. Mistakes become rules | Retro of 2026-10-29: facts, then one retro per side; rules pruned; one week showed 219 PRs merged, median 1.4 h to merge | #854, #887, spec 021 FR-063, `docs/agent-notes.md` |
| 8. Now | About 3,700 commits in 17 consecutive active days to 2026-11-01; what has shipped since, only released worlds | git log, CHANGELOG |

Back-fill candidates, one post per day at most, chosen after reading the record: adapter boundary (10-16), spec-first and reverse-engineered specs (10-16, 10-17), the simulator as a no-credit test bed (10-16, `3383110a`), masking and redaction lessons (checklist), test once and trust the record (spec 021 FR-036), changelog fragments (spec 025), palette screenshots (spec 050 FR-012), the review checklist (10-23), untrusted content (10-27), retro and fewer rules (10-29), daily release (10-30), short README (10-31), worlds must differ (11-01). Not a promise of 17 posts.

## Costs

All **estimates**, not measured. Prices are Anthropic's list prices as cached in our tooling on 2026-10-06, Sonnet 5.5 at $2 in and $10 out per million tokens; caching and flat plans change what is really paid. On a flat plan these use quota, not extra money.

| Work | Tokens (estimate) | List-price cost (estimate) |
|---|---:|---:|
| One post: read the digest and sources, write, fix the check | 150k in, 5k out; stop at 200k | about $0.35; ceiling about $0.45 |
| A 30-post month | 30 posts | about $11 to $14 |
| Back-fill batch | 17 posts at most | about $6 to $8, before reviews |
| Other side's review of a post | 30k in, 1k out | about $0.07 |
| Each build PR (T002..T017) | wide range; not sized | about $2 to $6, so about $30 to $85 in all |
| Making any video, CI, storage, Pages | none | $0 credits; machine time only |

Time, as estimates: site and check tasks are 1 to 3 hours of agent time each; the story film 3 to 5 hours with reviews; the back-fill a day, then the human's reading. First 3 real posts replace the first row's estimate with a measurement (SC-005).

## Daily flow

1. Agent's daily round, after the daily release: `node scripts/blog-digest.js <date>`: facts or "nothing to say" (then stop).
2. Branch `104-blog-<date>` in a worktree, write the post with `notVerified`.
3. `node scripts/make-video.js` for the clip; upload review copy to the draft release.
4. `npm run blog:check`; open the PR (`documentation`, `area:docs`, `spec:104`); `Docs: n/a`.
5. Another side's reviewer reads text and contact sheet; a human too for the first 5.
6. Upload to `media-library`, update nothing else, merge through the queue; Pages deploys.

## Constitution check

- **I. Spec first**: this folder; site, scripts and workflow code only after it. No `src/` change is planned.
- **II. Adapters**: not touched. The site names agent apps only as text, as today.
- **III. Safe, no secrets**: FR-060..FR-066; no key in Actions; no credentials in a clip.
- **IV. No AI credits in tests**: tests, videos and CI spend none. Writing posts spends within FR-073, only after the owner's OK; this is not a test.
- **V. Calm, legible**: FR-005, FR-023. No autoplay, no flashing, no counters. The app's own fit rules are untouched.
- **VI. Parity**: site and check scripts are plain Node on every OS. `make-video.js` needs `ffmpeg`, available on all three; it runs only for authors, and T002 prefers the cross-OS capture. A Linux-only `x11grab` result would be recorded here as a limit.
- **VII. Quality gates**: `test:site` and `blog:check` in `npm test`, with mutations (FR-066).
- **VIII. Honest limits**: required in every post; *Known gaps* in the spec; site not claimed to play until seen.

## Complexity tracking

| Addition | Why | Simpler option refused |
|---|---|---|
| One more release as a store, one workflow step | Keeps video out of git and same-origin | Video in git: permanent weight. Direct links: a second host in the CSP |
| Hash list of blocked names | The name must never appear, yet must be refused | Allowlist alone misses a bare name in prose; a secret needs a settings change |

## Project structure

```text
specs/104-site-story-blog/    spec.md, plan.md, tasks.md
scripts/build-site.js         tokens, pages, posts, feed, media
scripts/test-site.js          budgets, players, unreleased phrases
scripts/check-posts.js        blog:check (new)
scripts/blog-digest.js        daily facts, no AI (new)
scripts/make-video.js         recipe to clip (new)
docs/site/blog/               posts (new)
docs/site/media.json          manifest (new)
docs/site/captions/           WebVTT (new)
docs/site/worlds.json         shipped worlds (new)
docs/site/unreleased.json     blocked phrases (new)
docs/site/blocked-hashes.json blocked names as hashes (new)
.github/workflows/pages.yml   fetch and verify media
```
