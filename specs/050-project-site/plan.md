# Implementation Plan: Project website (050)

A generated static page. `scripts/build-site.js` reads the README, the specs index, `docs/site/gallery.json`, the CHANGELOG and the latest release, and writes `_site/`. Since 2026-10-20 it writes two pages: `index.html`, a curated landing page from `docs/site/landing.json` (validated against the README headings, the Harnesses table and the screenshots; the build fails otherwise), and `docs.html`, the whole README with a table of contents, the feature grid, the gallery and the release notes. `validateLanding` and the parsers are exported so `test-site.js` can test them directly; `main()` only runs when the script is executed. `.github/workflows/pages.yml` builds it, uploads the Pages artifact and deploys it. `scripts/test-site.js` keeps it honest in `npm test`.

## Constitution Check

- **I.** Spec first (this folder).
- **III.** No secrets: the build reads only public files, and the latest release through the API with the workflow's read token.
- **V.** Calm and legible: system fonts, light and dark, 12.5px or larger.
- **VI.** Plain Node, so it builds on every OS.
- **VII.** `test:site` is in `npm test`.
- **VIII.** The site shows *Known limits* and the alpha warning.
