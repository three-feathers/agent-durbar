# Feature Specification: Durbar court themes (Indian, European, Japanese) (spec 039)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 035-040
title: Durbar court styles: Indian, European, Japanese (head accessory slots, court words)
status: built
note: word lists await owner review
-->

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
**Input**: Vikram (issue #129): the app's namesake — court styles, culturally respectful, one per region.

## Clarifications (binding)

- Three packs: `durbar-indian`, `durbar-european`, `durbar-japanese`. Respectful, restrained: **no faces or religious iconography**; distinct palettes, ornament via geometry (turban, crown, kanzashi as abstract small accessories on the figure's head via art slots), carpets/lacquer/wood via room tints and desk tokens.
- Names given in English with one local word in the name (checked by the owner for cultural fit — he reviews this spec's word lists).

## Word maps (draft for owner review)

| key | Indian | European | Japanese |
| --- | --- | --- | --- |
| lobby label | The durbar | The court | The tea hall |
| place-library | Records Kothi | The Archive | The Library |
| place-software | Shastra Ghar | The Atelier | The Workshop |
| place-terminal | Yantra Kaksh | Engine Room | Machine Room |
| place-web | Jaal Khidki | Signal Tower | The Radio Room |
| place-other | Chhota Kaam | The Pantry | Odd Jobs |
| door-open | Gate | Door | Door |
| door-close | Gate | Door | Door |

## Requirements

- **FR-001** `[IMPLEMENTED]` Three packs, each: distinct token palette (royal maroon/gold/sandlewood; court navy/silver/parchment; indigo/vermilion/rice-paper), art slots: head accessory (turban arc / crown notch / kanzashi pin) drawn on long/bun/short styles only where it reads at the small size, plant → lotus pot / topiary / bonsai, desk wood tones, door ornaments.
- **FR-002** `[IMPLEMENTED]` Accessories come from an optional `hair-acc` art slot layered by `hairFront()`; missing slot = no accessory (Clean Office).
- **FR-003** `[IMPLEMENTED]` Status/permission/credit wording unchanged; contrast pairs pass; reduced motion applies.
- **FR-004** `[IMPLEMENTED]` `check:themes` covers all three.

## Success Criteria
- Each court is instantly recognizable by palette and small accessories; no status ambiguity; office check green per pack.

## Changes

### 2026-10-18: a UI style of its own (spec 035 FR-009..FR-012)

- `[IMPLEMENTED]` The pack sets `ui` and stronger core colours: three courts with their own frame: **Indian** a maroon top bar with a gold rule, ivory pages, arched room tops with a double gold frame and serif headings; **European** a royal navy top bar with gilt rules, parchment pages, gilded double frames, small corners and serif small-caps headings; **Japanese** a paper top bar with a vermilion rule and a red seal brand mark, washi pages, thin ink lines, nearly square corners and Mincho-style serif headings. The Japanese terminal place is renamed **Machine Room** so it fits its tile. Sizes are unchanged; `check:themes` covers it. Owner review of the look requested in PR #137.
- `[IMPLEMENTED]` (2026-10-18, spec 035 FR-013) Its own people and furniture: **Indian** courtiers in sherwanis with a sash and turbans with a jewel (or braids and buns with flowers) on an arched velvet throne, a carved low desk, the screen in a jharokha arch and a brass lamp; **European** nobles with ruffs, an order sash and powdered periwigs (or a tiara) on a gilt throne, a mahogany bureau, the screen in a gilded frame and a candlestick; **Japanese** figures in kimono and obi with topknots or a bun with a kanzashi, before a gold folding screen, at a low lacquer table, the screen in a wooden frame, a teacup and a bonsai (`court-*` kits). European place names shortened to Engine Room and Signal Tower so they fit.
