# Implementation Plan: MCP server catalog and Paste a config (spec 110)

**Branch**: `110-mcp-catalog` (spec) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md) | **Issue**: #539

## Summary

A shipped, reviewed JSON catalog in spec 076's `durbar-mcp-list-v1` format, read and validated in main, feeds a new catalog dialog whose picks prefill the existing add form (`editServer`). *Paste a config* sends untrusted text to main, which parses it with `parseMcpConfig` (given a front end for VS Code and single-server shapes), keeps the values, and returns a masked preview and a token; applying uses the existing folder-extras store or spec 069's per-file global review. *Import from VS Code* moves onto the same pipeline and targets the agent apps' own lists. No new sign-in code, no adapter change, no dependency.

## Technical context

- **Language and stack**: TypeScript in `src/shared` and `src/main`; plain JS in `src/renderer/screens.js` (the MCP screens live there) or a small new module beside it.
- **Dependencies**: none new. The schema check is the hand-written `durbar-mcp-list-v1` reader of spec 076's plan (`src/shared/policymcp.ts`), built here first for v1 only; tests may use `ajv`, already installed as a dependency of electron-builder, to prove it agrees with the published schema (as 076's plan says).
- **Storage**: none new. Folder extras (`mcpstore.ts`, OS-encrypted secrets) and spec 069's writers (backups, owner-only mode, hash check). Paste tokens live in main memory only, at most 5 minutes.
- **Testing**: Node unit tests in `npm test` (`test:mcpcatalog`, `test:mcppaste`, extended `test:mcp` for the import target), simulator drivers (`scripts/shots-110-*.js`, `until()` waits, both sizes, three worlds), zero AI credits.
- **Targets**: Windows, macOS, Linux; 1440x900 and 1280x800.

## Constitution check

- **I Spec Kit**: this spec, plan and tasks come before any `src/` code; spec 020 gets a dated delta when G5 is built (FR-052). Pass.
- **II Adapters**: no adapter change. Sign-in stays behind spec 058's optional `mcpSignIn` capability and the per-row `canSignIn` (FR-016); per-app file formats stay in spec 069's writers. Pass.
- **III Safe by default**: pasted text and VS Code files are untrusted, capped, parsed as data, never run; values stay in main after **Check**, masked in every view, never logged; folder pastes are saved off and untrusted; global writes need spec 069's per-file confirmation; the catalog is reviewed data with a host allow-list test (FR-060..FR-066). Pass.
- **IV No credits**: simulator and fixtures only; the real check T018 reads files with the apps' own `mcp list` commands at 0 credits, as spec 069's T060 did, and needs the owner's OK per AGENTS.md. Pass.
- **V Calm UI**: tool-surface dialogs, text at least 10.5 px (12 px list), list scrolls inside, state by word and icon, keyboard and screen reader contract (FR-070..FR-073). Pass.
- **VI Platforms**: paths with `path` and spec 069's resolvers; `WIN_EXTS` for the command check; Windows `npx` follows Q6 (answered C: plain `npx` with a note until the real check) and a `[KNOWN GAP]` (FR-081, FR-093). Pass with a stated gap.
- **VII Quality gates**: unit tests, drivers, screenshots at both sizes per UI group, feature inventory row. Pass.
- **VIII Honest limits**: FR-090..FR-095; vendor URLs confirmed per entry in G1, never from memory. Pass.

## Existing capability check (spec 021 FR-031)

| Need | Reused | Change |
|---|---|---|
| The add form, both targets | `editServer(v, st, o)` with `o.input` (`screens.js`) | `o.input` also carries env and header keys (no values) and the catalog's notes and check date |
| Validation of any server input | `validateInput`, `NAME_RE`, `MAX_SERVERS` (`src/shared/mcp.ts`) | none |
| Folder save, secrets, trust | `mcp:upsert`, `mcpstore.ts`, `needsSecrets`, `trustHash`, the trust prompt | none (a paste apply calls the store's upsert in main, as `applyFolderImport` does) |
| Global save | `mcp:globalPreview` / `mcp:globalApply`, `reviewGlobal`, 069 writers | none (a global paste apply builds `globalPreview` inputs in main) |
| Parsing | `parseMcpConfig`, `parseVSCodeMcp`, `stripJsonc`, `candidateInput` (`src/shared/mcpimport.ts`) | a front end for the shapes of FR-032, placeholder detection (FR-034), hidden-character refusal (FR-037), caps |
| VS Code files | `previewFolderImport`, `readVSCodeFile` (`src/main/mcpimport.ts`), `vscodeUserDirs` (`src/main/vscode.ts`), `mcp:importPreview` / `mcp:importApply` | apply targets spec 069's writers (G5; Q1 A, Q2 B) |
| Command found | `commandFound`, `foldersFor`, `WIN_EXTS` (`src/main/mcpcmdcheck.ts`) | none |
| Sign-in | `agents:mcpSignIn`, `canSignIn`, `signInSteps`, `mcpwords.js` (spec 058) | none |
| Masking | `redact`, `maskSecretArgs`, `maskSecretUrl`, `HIDDEN_CHARS` (`redact.ts`) | none; a gap found is fixed in `redact.ts` for everyone |
| Org lists | spec 076's `durbar-mcp-list-v1` schema and its planned `policymcp.ts` | this spec builds the v1 reader first |
| Links, dialogs, live region | `app:openExternal`, `dialog()`, `askDialog`, `#srAnnounce` | none |

## Module layout

| Unit | Kind | Job | Spec |
|---|---|---|---|
| `src/shared/mcpcatalog.json` | data | The built-in catalog in FR-008's wrapper (`durbar-mcp-catalog` v1; each `server` a 076 v1 server). **How it ships** (review 15): there is no `resolveJsonModule` in the tsconfig, so `scripts/copy-assets.js` copies it byte for byte (and `mcpcatalog.schema.json`) into `dist/main/`; the loader reads `path.join(__dirname, 'mcpcatalog.json')` with `fs`. `test:mcpcatalog` asserts the built copy equals the source; a missing copy makes the catalog show *Custom…* and *Paste a config…* only (FR-006) and fails the test | FR-001..FR-005, FR-008 |
| `src/main/mcpcatalog.ts` | main | The only reader of the file (FR-018): load once, validate at level `builtin`, serve `mcp:catalog` | FR-006, FR-009, FR-018 |
| `src/shared/policymcp.ts` | pure TS | The v1 server reader: schema rules by hand, an explicit source level (`builtin`, `machine`, `remote`), no-secret rule (FR-004), the catalog wrapper check, returns entries and per-entry errors (no values) | FR-004, FR-006, FR-007, FR-008, FR-009 |
| `src/shared/jsonscan.ts` | pure TS | FR-040's iterative JSONC scanner: depth, syntax position (line, column), forbidden keys, duplicate keys; never returns input text; takes options `{comments, maxDepth, maxBytes, duplicateKeys: 'refuse'}`, defaults = 110's own settings (2026-11-10 delta, for spec 111's strict-JSON use) | FR-040..FR-042 |
| `src/shared/mcpimport.ts` | pure TS (existing) | `parseMcpConfig` front end: `mcpServers`, `servers` (VS Code rules), bare map, single object; JSONC; caps; placeholders; hidden characters; warnings list (FR-036) | FR-032..FR-037, FR-051 |
| `src/main/mcpcatalog.ts` | main | Loads and validates the file once; answers `mcp:catalog` with entries plus `found` per stdio command (`commandFound`) and the per-app sign-in ability from `adapters:list` capabilities | FR-006, FR-011, FR-013, FR-015 |
| `src/main/mcppaste.ts` | main | `mcp:pastePreview(text)` and `mcp:pasteApply(token, ids, target)`: caps, parse, masked preview, token store (5 min), folder apply through the store, global apply through spec 069's `lists().preview` | FR-030..FR-039, FR-061, FR-064 |
| `src/main/mcpipc.ts`, `src/preload/preload.ts`, `src/shared/api.ts` | existing | Register the three channels with `ipcHandle`; typed bridge members `mcpCatalog`, `mcpPastePreview`, `mcpPasteApply` | FR-064 |
| `src/renderer/mcpcatalog.js` (new, UMD) + `screens.js` | renderer | The catalog dialog (search, list, Custom…, Paste a config…), the paste dialog and its preview, entry points; `editServer` prefill extension | FR-010..FR-017, FR-030, FR-035, FR-070..FR-073 |
| `src/renderer/sim.ts` | simulator | Fake catalog answers, fake paste store, a fake adapter with and without `canSignIn` | FR-064, SC-008 |

**IPC (new, three channels, all through `ipcHandle`):**

- `mcp:catalog()` → `{entries: CatalogEntryView[], errors: string[]}`: read only; no argument.
- `mcp:pastePreview(text: unknown)` → `{ok, token?, servers: PasteServerView[], error?}`: `text` must be a string of at most 64 KiB with no NUL; otherwise refused before parsing. `PasteServerView` holds no value of any environment variable or header.
- `mcp:pasteApply(token: unknown, ids: unknown, target: unknown)`: `token` a known, unused, unexpired string; `ids` an array of at most 20 ids of that token; `target` either `{kind: 'folder', key}` with a known folder key (`knownKey`) or `{kind: 'global', apps, mode}` with apps from the three known and `mode` `ref` or `plain`. Under `DURBAR_SIM`, `simguard` refuses the real store and file writers; the simulator page answers.

## Phases (one small PR per group)

| Group | Content | Waits for |
|---|---|---|
| G1 | Catalog data (entries checked against vendor pages), `policymcp.ts` v1 reader, `mcp:catalog`, tests | Q4 A, Q5 A (answered) |
| G2 | Catalog dialog, entry points, `editServer` prefill, needs and Needs sign-in lines, simulator, driver, screenshots | G1; Q3 A (answered) |
| G3 | Paste parser front end, placeholders, warnings, refusals, caps (pure) | none |
| G4 | `mcp:pastePreview` / `mcp:pasteApply`, the paste dialog and preview, both targets, driver, screenshots | G3, G2 |
| G5 | Import from VS Code on the paste pipeline, targeting the apps' own lists; spec 020 delta | Q1 A, Q2 B (answered 2026-11-09) |
| G6 | Windows `npx` handling per Q6 | Q6 C (A until T019) |
| G7 | Worlds and accessibility audit, docs, feature inventory, changelog | G2, G4 |
| G8 | Real checks (owner's OK) | G2, G4 |

## Test plan (zero AI credits)

- **Unit**: `test:mcpcatalog` (the shipped file passes; planted entries with a secret value, a `user:pass@` URL, a new host, an `@latest` package, a duplicate id, an unknown field, a `bash -c` / `sh` / `node -e` / `npx --call` / `npx -p` command each fail; the reader agrees with both schemas through `ajv`; the channel serves exactly the file's entries; a source scan finds no other reader or entry literal; the built copy equals the source; the level rules of FR-009); `test:jsonscan` (positions, depth 17 on 64 KiB of `[` without recursion, forbidden and duplicate keys, no input text in any result); `test:mcppaste` (each shape of FR-032; JSONC; BOM; caps; depth; 500 servers; duplicate keys; placeholders; hidden and bidi characters with JSON path and no value in the message; credentials in URL; warnings of FR-036; the preview holds no value of a planted secret; token expiry, reuse and foreign ids refused; folder apply saves off and untrusted; global apply returns spec 069's preview); `test:mcp` (G5 target). Mutation-check the masking and refusal branches (AGENTS notes: a mutant "killed" by a compile error does not count). Named mutants from the security review: show `JSON.parse`'s message (FR-040); a recursive scan (FR-040); build env as `{}` (FR-041); last duplicate wins (FR-042); drop the command allow-list (FR-002); add an entry in the handler (FR-018); accept unknown server keys (FR-008); read the catalog at `remote` or without a level (FR-009); compare a shell's full path (FR-036); keep every token (FR-043); write a reference-mode value (FR-044).
- **Drivers** (simulator, `until()`, 1440x900 and 1280x800, Open office, Real office, Retro arcade): `shots-110-catalog` (open from each entry point, search, pick, prefilled form, both targets, focus return, accessible names, announcements, fit), `shots-110-paste` (valid, placeholder, warning, refused, hostile; counters show 0 writes before confirm), `shots-110-signin` (an OAuth entry reads Needs sign-in; Sign in only with `canSignIn`).
- **Screenshots** under `docs/screenshots/110-*`, with `DOC_SHOTS` entries in `scripts/shots-docs.js`.

## Complexity tracking

None.

## Risks

A vendor changes its URL (FR-094; the check date is shown, and the real check T018 reads every entry); the catalog going stale without an owner (each entry names its vendor page in its PR); a paste parser gap leaking a value (one parser, masked in main, the preview type has no value field); Windows `npx` behaviour per app (Q6, T019).
