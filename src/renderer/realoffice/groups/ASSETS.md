# Character group pictures (spec 102 FR-303, T343)

One picture per character set for the Settings cards (`Characters in <world>`, FR-303): the set's people, a head-and-shoulders square of each, in rows.

- **No new art.** Every pixel comes from the set's own shipped `<person>-rest.webp` (provenance in `../sets/<id>/ASSETS.md`); licence and likeness checks are those of the sets.
- **Made by** `scripts/build-character-groups.py` (`npm run groups:build`), Pillow 11.3.0 (the pin of `ci.yml`; another version writes other bytes), deterministic: sorted ids, no randomness, no network, WebP without EXIF, XMP or ICC. `--check` (in `npm run test:chargroups`) fails when a picture differs from what the set pictures give now.
- **Size:** at most 64 KB each (FR-303); the script lowers quality, then fails; it never drops a person.
- **Not shipped yet:** `scripts/copy-assets.js` copies `sets/` and `worlds/` only; T266 wires these into the app.

Files: `cheeky.webp` `minimalist.webp` `monster.webp` `office.webp` `pirate.webp` `prehistoric.webp` `rebels.webp` `retro.webp` `royal.webp`
