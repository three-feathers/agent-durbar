# Feature Specification: Project website on GitHub Pages

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Project website on GitHub Pages, generated from the README, the specs index, screenshots, the CHANGELOG and the latest release; deployed by CI (issue #293)
status: **built and live** at https://three-feathers.github.io/agent-durbar/; delta 2026-10-20: a curated landing page from `docs/site/landing.json` (checked against the README) plus a docs page with the whole README (FR-006..FR-010) built
-->

**Feature Branch**: `050-project-site`
**Created**: 2026-10-19
**Status**: Built and **live** at <https://three-feathers.github.io/agent-durbar/> (first deploy 2026-10-19, run 39300604574)
**Input**: Issue #293 (idea from Ruben, 2026-10-19). Owner approved it in the team chat: "publish it as GitHub pages now and have a custom domain later … part of ci … update the site every time something is worth". He confirmed in his Claude Code session: "Yes, enable it" (Pages with GitHub Actions as the source). Ruben's agent handed the issue over. The approach is from the comment on #293.

## Summary

A friendly front door at <https://three-feathers.github.io/agent-durbar/>: what Agent Durbar is, every built feature, screenshots, harnesses, install, safety, costs, themes, honest limits and how we work. It is **generated from what the repository already maintains**, so it never needs a second, hand-made copy.

## Requirements

- **FR-001** **Sources.** `scripts/build-site.js` (plain Node, uses the existing `marked` dependency, no framework) builds `_site/` from:
  - README sections: the intro, *What you can do*, *Harnesses*, *Install*, *Safety model*, *Costs and caps*, *Themes*, *Known limits*, *How we work*;
  - the specs index, as a card per built feature linking to its spec (release specs left out);
  - `docs/site/gallery.json`, the only hand-written file: which screenshots, with captions and alt text;
  - the newest `CHANGELOG.md` release section;
  - the latest GitHub release, for the download buttons and checksums (the Releases page if there is no network).
- **FR-002** **Self-contained and private.**
  - No scripts, external fonts, CDNs, analytics or cookies; a CSP of `default-src 'none'`.
  - Raw HTML in Markdown is shown as text.
  - Repository links point to GitHub, and images are copied next to the page.
  - The same trademark disclaimer as the README.
- **FR-003** **Legible:**
  - light and dark (`prefers-color-scheme`);
  - responsive down to phone width, with no horizontal scroll;
  - text 12.5px or larger;
  - alt text on every image.
- **FR-004** **CI is the hook.** `.github/workflows/pages.yml`:
  - **builds and deploys** on a push to `main` that touches the sources, daily (for a new release; the `github-pages` environment deploys from `main` only), and on demand;
  - on a pull request touching the site files, it **only builds and checks**;
  - `pages: write` and `id-token: write` are granted to the deploy job only, and actions are pinned by SHA.
- **FR-005** **Checked in `npm test`.** `test:site` builds without network into a temp folder and checks:
  - every local link and image exists;
  - nothing is loaded from another site, and there are no scripts;
  - external links go to GitHub only;
  - the CSP and the disclaimer are there, all sections exist, and the feature grid comes from the specs index;
  - every image has alt text, and the site is under 15 MB.

## Out of scope (later)

- One page per built spec.
- An automatic screenshot refresh from the simulator.
- A custom domain (a `CNAME` plus DNS, an owner decision).

## Changes

### 2026-10-19: built

- `test:` `npm run test:site` (in `npm test`).
- `sim:` the page rendered in Electron at 1280 px and 390 px: no horizontal scroll (scroll width 1264/1279 and 375/390), smallest text 12.5px.
- `read:` GitHub Pages enabled via the API with `build_type: workflow` (the owner's approval, recorded on #293).
- `real:` the first deploy on the merge of #295 (`pages.yml` run 39300604574): *Build site* and *Deploy to GitHub Pages* succeeded, and the page answers HTTP 200 (41 KB of HTML).
- `[KNOWN GAP]` The custom domain is not set up (an owner decision).

### 2026-10-20: landing page and docs page from three persona reviews

Three persona reviews of the live site (a first-time visitor, an evaluating developer, a brand designer) found it was the README dumped into one page (about 13,000px on desktop, 30,000px on a phone): a 70-word hero full of jargon, four identical download buttons, an outdated hero screenshot, the whole changelog with internal spec numbers, process specs listed as features, the honest limits at the very bottom, the themes hidden as thumbnails, and every section the same white card. The site becomes two pages.

- **FR-006** **Two pages.** `index.html` is a short, curated landing page; `docs.html` is the whole README (every `##` section, ids as GitHub's anchors) with a table of contents, plus the built-feature grid, the gallery and the full newest release notes. The landing page links to it (*Read the docs*). The output folder (`_site/`) and `pages.yml` are unchanged. `[IMPLEMENTED]`
- **FR-007** **`docs/site/landing.json`, hand-written and checked.** It holds the hero (title, tagline, image), the status line, four value cards (title, text, icon, screenshot, `readmeAnchor`), three *How it works* steps, the six themes (name, screenshot, swatch), the agent apps (name, what was verified, what is not yet), three safety points and `featuresExclude` (process-only specs: 008, 013, 021, 025, 045, 050). The build **fails** when a `readmeAnchor` is not a README heading, a screenshot is missing, or a harness name is not in the README's Harnesses table. `[IMPLEMENTED]`
- **FR-008** **Landing content, plain and honest, no FR or spec numbers.**
  - Hero: eyebrow, the headline "See all your AI agents at once", a one-sentence subline, a primary *Download alpha* (the latest release page, or the Releases page without network) and a secondary *Read the docs*; small OS links to the release files; right under them the status line "Alpha · unsigned · run by hand on Linux only…"; a large framed screenshot of the current office.
  - Four value cards with inline SVG icons; *How it works* in three steps; a strip of the six themes with swatches and a line on AI-made themes; three agent-app tiles with what was checked on a real account and one "not verified yet" line each (from the README table and limits); three safety and cost points; downloads with the README's first-run step per OS and checksums in a `<details>`; *What's new* as the latest release heading and at most 5 bullets (bold lead and first sentence, spec references stripped) with a link to the CHANGELOG; a footer with GitHub, Docs, Changelog, Security, License and credits. `[IMPLEMENTED]`
- **FR-009** **Visual design.** Warm tokens (`--bg:#f7f4ee` … `--gold:#c8962e`) and a dark set under `prefers-color-scheme:dark`, a 4-112px spacing scale, the system font stack, sections directly on the page background (no card wrappers) with 112px between them, a soft gold radial behind the hero, a framed hero screenshot with a title bar, 44px buttons (primary ink, secondary outlined; a 1px lift on hover, none with reduced motion), a CSS-only "durbar" arch divider used three times. Phones (≤640px): 16px gutters, 64px between sections, full-width buttons, the theme strip as a horizontal scroll-snap row, one-column cards, the nav reduced to Docs and GitHub, tables that scroll. Images have `width`/`height`, `loading="lazy"` below the hero, and alt text. `[IMPLEMENTED]`
- **FR-010** **Checked in `npm test`.** `test:site` also checks: the validation function rejects a bad anchor, a missing screenshot and an unknown harness; `docs.html` has every README section, the table of contents and the feature grid without the excluded specs; the landing page has the hero, the status line before the features, the current hero screenshot, the six themes, the three agent apps, no `FR-`/spec numbers and at most 5 *What's new* bullets; every in-page anchor resolves; screenshots carry width and height. `[IMPLEMENTED]`

Evidence:
- `test:` `npm run test:site` (in `npm test`); the build run locally with and without release info (index ≈ 25 KB, docs ≈ 56 KB of HTML).
- `[KNOWN GAP]` Not yet rendered by the author of this change: the desktop and phone screenshots and the phone height target (under about 7,000px) are checked by the lead before merge.
- **2026-10-20 (round 8, a marketing review):** the hero says the pain it removes ("Run all your AI coding agents. Answer only the ones that need you."); the secondary button is *View on GitHub*; under the hero screenshot, "Simulator demo data: names, costs and tasks are invented."; the status line says the macOS and Windows builds are made in CI but not tried by hand; card titles say outcomes; a short "built in the open, spec-driven" line links to the specs and the board (no invented numbers); the OS links hide on phones (they overflowed); Open Graph and theme-color meta tags with an absolute `og:image`; "never logs your prompts" was dropped (not backed by a check). `test:` `scripts/test-site.js`.
- **2026-10-20 (overnight, 5 visitor rounds: usability, understandability, curiosity):** `sim:` the built site screenshotted at 1440x900 and 390x844 in Electron.
  - **Visitors:** a developer who never heard of Durbar, a team lead, a skeptical security reviewer, a curious non-expert, a phone visitor.
  - **Usability:**
    - `docs.html` scrolled sideways on phones (836 px in 375 px; the column was `1fr` and grew with long code). Now `minmax(0,1fr)`, inline code wraps, `pre` and tables scroll inside themselves;
    - the phone header keeps **Download** on both pages;
    - every landing screenshot (hero, how it works, the six themes, the AI theme) opens at full size in the same tab, with no script;
    - on phones, the hero caption says "Tap the picture to see it full size."
  - **Understandability:**
    - the how-it-works screenshot shows only the Agent apps cards (`crop` in landing.json: a pixel box on the source image, done with plain CSS), with a caption;
    - long install notes (Windows) show their first sentence, and the rest sits under "More for Windows";
    - "What's new" on the landing page is cut at a sentence near 360 characters, with the full text one link away;
    - a 7-question FAQ, "Before you try it", sits between Safety and Download: what an AI agent is, whether you need all three apps, accounts and keys, whether your code goes anywhere new, team use, cost, not only code. Each answer links to its README section, and the build checks those anchors.
  - **Honesty** (found by the skeptic):
    - "reads inside its folders only" → "Durbar asks agents to stay in their folders; only Codex is held there by its own sandbox";
    - the spending-limit line now says limits are checked between replies;
    - "Agents ask before they act" → "Agents act only as far as you allow" (Read-only denies, it does not ask);
    - a "Report a security problem" link (SECURITY.md) next to the safety links.
  - **Curiosity:** a one-line name note under the hero ("A durbar is a royal court where everyone gets a hearing…").
  - `test:` `scripts/test-site.js` asserts each of these (zoom links, crop, FAQ and its anchors, no overclaim, security link, phone Download, phone hint, docs `minmax`).
  - Not changed here (owned by the docs sweep, #404): the hero status line and the agent apps' "not yet" lines. Measured: no text under 10.5 px and no sideways scroll on either page at either width.

### 2026-10-26: screenshots are palette-compressed (issue #759)

The site reached 15.5 MB with the pictures of spec 083, against the 15 MB budget of FR-005, almost all of it screenshots (the 76 linked PNGs were 15.6 MB). Lossless re-encoding gains about 0% (they are already well deflated: `real:` Pillow `optimize=True` on one picture, 112,583 to 112,937 B, measured by Vikram's agent), so the saving has to come from a 256-colour palette (what `pngquant` does). Decided by the coordinator under Ruben's delegation.

- **FR-012** **Screenshots are palette PNGs, made without a binary or a dependency.**
  - `scripts/compress-shots.js` (module and CLI: `node scripts/compress-shots.js [--check] [--dither] [files...]`, `npm run shots:compress`) reads an 8-bit PNG with Node's `zlib`, quantises it to at most 256 colours (median cut on the colour histogram, weighted by pixel count, then 4 k-means steps; a picture that already has 256 colours or fewer keeps them exactly) and writes a palette PNG (best of two filterings, deflate level 9, palette numbered in order of first appearance so a second pass changes nothing). The colour chunks `iCCP`, `sRGB`, `gAMA`, `cHRM`, `pHYs` are kept; text and `eXIf` chunks are dropped. No new dependency, no `pngquant`/`oxipng`, nothing native: it runs the same on Windows, macOS and Linux and in CI. A tiny npm package (UPNG.js) was considered and not used: the code is about 250 lines, reads only our own screenshots, and each new package is supply-chain risk this repo does not need to take.
  - **Quality guard.** The result is compared pixel by pixel with the original; the original is **kept** (the picture is never made worse) when any limit is broken: mean per-channel error above 1.0 (of 255); any channel off by more than 96; more than 0.4% of pixels with a channel off by more than 24; or the result less than 5% smaller. With the same guard a picture with transparency is kept as it is unless it already has 256 colours or fewer (then it is written as an exact palette with `tRNS`). Dithering (Floyd-Steinberg) is tried only when the plain result fails the guard. Measured on the 76 linked pictures: mean error 0.04 to 0.44, at most 0.073% of pixels off by more than 24, worst channel error 81; none refused.
  - **Every retake is compressed.** `npm run shots:docs` compresses each picture it writes, in place, after the copy (`squeeze` in `scripts/shots-docs.js`). It never fails the run: a refused or unreadable picture prints one line and stays as the driver wrote it. `DURBAR_SHOTS_COMPRESS=off` skips it. A picture added by hand needs `npm run shots:compress`.
  - **The site check.** `test:site` fails when a linked picture is not a palette PNG, unless it is named in `KEPT_ORIGINAL` with the reason the guard refused it (none today). The 15 MB budget of FR-005 stays: the site is now 5.6 MB, so 15 MB leaves room, and a regression to uncompressed pictures would show as the palette check first. `[IMPLEMENTED]`
- `test:` `npm run test:compressshots` (`scripts/test-compress-shots.ts`): valid palette PNG of the same size with at most 256 colours; a second pass changes nothing; the guard refuses random colours and a too-lossy quantiser (and the same quantiser is written when the guard limits are removed, so the guard is what stops it); crisp 1px strokes and flat colours; transparency; the CLI (`--check`); `shots-docs` writes a compressed picture end to end with a fake driver. `sim:` one real retake (`shots-006-crash` under `xvfb-run`): 4 pictures written, 577 KB smaller.
- `[KNOWN GAP]` The palette is **lossy**: up to 256 colours per picture, so a soft shadow or a large smooth gradient can show faint banding, and antialiased text edges move by a few levels (looked at in the worst-case 320x200 area of 16 pictures at 2x: dark, light, retro, the six themes, the lobby, avatars, the cost-cap chart, the composer; no banding, no fuzzy text seen). The guard bounds the error; it does not replace a look at a new picture. Pictures that are not linked, and pictures other drivers write straight into `docs/screenshots/` without `shots:docs`, are not compressed.
