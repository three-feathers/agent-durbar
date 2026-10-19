# Implementation Plan: Project website (050)

A generated static page. `scripts/build-site.js` reads the README, the specs index, `docs/site/gallery.json`, the CHANGELOG and the latest release, and writes `_site/`. `.github/workflows/pages.yml` builds it, uploads the Pages artifact and deploys it. `scripts/test-site.js` keeps it honest in `npm test`.

## Constitution Check

- **I.** Spec first (this folder).
- **III.** No secrets: the build reads only public files, and the latest release through the API with the workflow's read token.
- **V.** Calm and legible: system fonts, light and dark, 12.5px or larger.
- **VI.** Plain Node, so it builds on every OS.
- **VII.** `test:site` is in `npm test`.
- **VIII.** The site shows *Known limits* and the alpha warning.
