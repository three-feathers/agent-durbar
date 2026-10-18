# Feature Specification: Durbar court themes (Indian, European, Japanese) (spec 039)

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Spec phase
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
| place-terminal | Yantra Kaksh | The Engine Room | The Machine Room |
| place-web | Jaal Khidki | The Signal Tower | The Radio Room |
| place-other | Chhota Kaam | The Pantry | Odd Jobs |
| door-open | Gate | Door | Door |
| door-close | Gate | Door | Door |

## Requirements

- **FR-001** `[PLANNED]` Three packs, each: distinct token palette (royal maroon/gold/sandlewood; court navy/silver/parchment; indigo/vermilion/rice-paper), art slots: head accessory (turban arc / crown notch / kanzashi pin) drawn on long/bun/short styles only where it reads at the small size, plant → lotus pot / topiary / bonsai, desk wood tones, door ornaments.
- **FR-002** `[PLANNED]` Accessories come from an optional `hair-acc` art slot layered by `hairFront()`; missing slot = no accessory (Clean Office).
- **FR-003** `[PLANNED]` Status/permission/credit wording unchanged; contrast pairs pass; reduced motion applies.
- **FR-004** `[PLANNED]` `check:themes` covers all three.

## Success Criteria
- Each court is instantly recognizable by palette and small accessories; no status ambiguity; office check green per pack.
