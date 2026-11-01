# Implementation Plan: Logo family (spec 101)

**Branch**: `101-logo-family` (spec) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

Bring the hand-drawn SVG family into `build/logo/`, generate the three OSes' icons from icon 1 with a small script and no new dependency, paint the top-bar tile from six tokens, add a Settings section, and connect the tokens to the resolved world. Each phase is one small PR. No cave or loft material enters the repo until Paco's approval.

## Technical Context

- **Language**: plain renderer JS (like `crew.js`, `theme.js`), plain Node for the build script and driver, TypeScript for the asset test (`tsconfig.scripts.json`, like `test-crew-assets.ts`).
- **Dependencies**: none new. Electron (already a dev dependency) renders; Node writes PNG-in-ICO and PNG-in-ICNS containers.
- **Storage**: `localStorage` `durbar.logo`.
- **Testing**: `test:logo-assets`, `scripts/check-logo-family.js`, existing `test:theme-tokens`, `test:site`, `shots:docs`.
- **Constraints**: 0 AI credits; CSP unchanged; one Electron at a time on a shared machine for `icons:build`.

## Architecture

```
build/logo/icon-N{,-32,-20,-16}.svg   masters, data-slot + literal fill
build/logo/ASSETS.md                  provenance + approved by
build/logo/icons.json                 source and output hashes
        |
        +- scripts/build-icons.js     npm run icons:build, by hand: Electron offscreen -> build/icon.{png,icns,ico,svg}
        |                             and src/renderer/logo-marks.js (the drawings as strings)
        +- scripts/test-logo-assets.ts  test:logo-assets, in npm test
src/renderer/logo-marks.js            window.DurbarLogo: id -> svg strings; no colours beyond the base fills
src/renderer/index.html               icon 1 inline, no script needed
src/renderer/logo.css                 the palettes (base, non-Clean = var(--brand-*), photo, cave, loft as html[data-world]); [data-slot] fills inside .brand-mark; forced colours (built 2026-11-01)
src/renderer/logo-marks.js            (above) also reads durbar.logo early, sets data-logo, swaps the SVG; no theme.js change
src/renderer/screens.js               Settings > Logo, the Characters pattern
src/renderer/realoffice/worlds/<id>/  (not built: until 097 P1 lands the palettes stay in logo.css)
src/renderer/logo/art/<world>/        192 px WebP previews: approved worlds only
```

**Why strings in JS and not `<use>` or `<img>`**: CSS on `[data-slot]` must reach the shapes; an `<img>` cannot be recoloured, and an external `<use>` hides them from attribute selectors.

**Precedence, top to bottom**: forced colours; the resolved world's approved palette while Real office is on; a non-Clean UI style's brand pair; the base palette.

**The `.icns` padding**: the script wraps `icon-1.svg` at 80.47% on a transparent canvas for 128 px up (D3).

## Phases

- **P1 Icon 1 everywhere** (no choice yet): masters, build script, build icons, top bar, tokens, README, site, screenshots, asset test. Needs Q2, Q3, Q7.
- **P2 Picker**: the other three icons, Settings > Logo, persistence, driver. Needs Q1.
- **P3 Worlds**: photo palette (after 097 P1), then cave and loft after Paco's approval (Q6).
- **P4 Painted previews**: photo after Q4; cave and loft after Q6.

## Risks

- **#929 and 097 P1 touch the top bar and world seams**: rebase; the tile markup is not changed by this spec.
- **Screenshot churn**: P1 retakes nearly every picture; do it once, with no other picture-changing PR in flight on this side.
- **Real desktops**: not verifiable here. P1's PR says so, and asks each owner to look on their OS.

## Complexity Tracking

None. No constitution deviation.
