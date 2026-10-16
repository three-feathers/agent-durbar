# Plan: 016
- Deps (exact pins): `marked`, `dompurify` (runtime, copied to `dist/renderer/vendor/` by `scripts/copy-assets.js`), `jsdom` (dev, tests only).
- `markdown.js`: marked with `html` renderer override (escape raw HTML), custom `image` renderer (no `<img>`), `link` renderer; DOMPurify with a tight ALLOWED_TAGS/ATTR list and `ALLOWED_URI_REGEXP` http/https/mailto-free (http/https only); hook forces `rel="noopener noreferrer"`.
- `app.js`: `mdSet(el, raw)` patches via `morphChildren`; click delegate for `a[href]` -> `bridge.openExternal`, copy buttons added after render.
- main: `app:openExternal` IPC validates `new URL(u).protocol in http/https`; `setWindowOpenHandler` denies, `will-navigate` blocked.
- Tests: `scripts/test-markdown.ts`.
