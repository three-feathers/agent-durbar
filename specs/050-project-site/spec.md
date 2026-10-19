# Feature Specification: Project website on GitHub Pages

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
