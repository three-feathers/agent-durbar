# World design guide

How to design a world for Real office, built-in or user-made. Spec [098](../specs/098-experience-contract/spec.md) is the contract and the checks; spec [102](../specs/102-worlds-on-demand/spec.md) is the pack format. This page is the craft: what the owner's reviews of real mockups taught us. If this page and a spec disagree, the spec wins.

## First principles

1. **It is a real place, not a dashboard.** People, furniture and light belong to one room with one horizon, one scale and one light direction.
2. **At a glance, you know who needs you.** Someone across the room should read each person's state without reading a word.
3. **Design for 15 on one floor; make 3 to 4 beautiful.** Fifteen must fit at 1440x900 and 1280x800, with no overlap, no office scroll and text at least 10.5 px. Most real floors hold 3 or 4 people, so that view gets the most care. Lifts carry the rest.
4. **Space is for people and screens.** Decoration earns its pixels or goes. Grow people and screens to fill the room when few are present.
5. **Fast before fancy.** A world that lags does not ship. See [Performance](#performance).
6. **Worlds differ; contracts do not.** Layout rules, status colours and accessibility stay the same everywhere, and everything you can see changes.

## Make each world its own

Between any two worlds, all of these differ, and you can tell them apart from a thumbnail:

- wall, floor and desk: material and colour
- fixtures: drawn for this world, never shared cutouts
- **monitor**: a design element like the desk (for example gold with beadwork, rock, flowers around driftwood), with the same dark face and real text
- light temperature, plants or props, and one signature material or motif

A palette swap is not a new world. Sharing a cultural region is no excuse for looking alike. Plan a new world against the others before drawing it.

Be specific without being a cliche: no flags of countries, tourist symbols, stereotypes, or copied logos and postal marks. Arches appear only in kingdom worlds whose history had them. Anything sacred stays out of decoration.

## State must be obvious

- **One status signal per person, large and in the world's own language:** coloured flames in earthen lamps, royal flags, beacons, umbrellas. It is the first thing you see at 15.
- **The same colours in every world.** People learn them once.
- **Never colour alone.** Pose, expression and a bubble say it too: working types, waiting turns and waves, thinking holds a chin, done and relaxing lean back, error shows distress.
- **Let the light reach the surroundings** with a glow on the ground, so state reads at low size.
- **Only waiting and error move for attention,** calmly. Everything else is steady.
- Style matters: a modern lamp in a palace breaks the room. Match the object to the world, and keep it where it belongs, on the desk or the ground, not floating.

## People

- **Standing means standing on the floor.** Feet on the floor plane, with a real contact shadow. Check it at every size.
- **Visitors face what they are using** and are drawn at a readable size. They may stand in front of windows and walls.
- **Backs are welcome.** A person seen from behind shows their screen best. Faces matter, but not always.
- **Seats are for sitting.** A body sits in its seat, with no furniture across a torso, no cut hips between table legs, no chair cut off at the edge. Check every person and every pose: one good crop proves nothing about the others.
- **The seat can follow the state:** working at a table, relaxing on a lounger.
- **Crews keep their own art style.** Never redraw a crew as realistic. Clothes are office-appropriate in the style of the set, loose rather than tight. Crew art needs its owner's approval per image.
- Any character set must work in any world, so every set has the full pose list. Each world names a default set that suits it.

## Space and layout

- **No dead strips.** A view or window earns its place only if it costs no space and looks right: full height on wall that already exists, never a band above fixtures that shrinks them.
- **Fixtures can live in the room.** A central cluster or an aisle frees the band and makes walking real.
- **Scale tells the truth.** Fixtures, people and furniture agree: a bar is a building, a postbox is not. One scale per depth, and shrink everything together, not one thing.
- **Use the space near the edges and the horizon.** Empty sand or floor is waste when people could be bigger.
- **Few people, big screens:** readable text in the room at 3 to 4. **Many people, small screens:** state by colour and marks, with text on hover or focus.
- Numbering and movement are natural: floor 1 at the bottom, up is up.

## Screens

- A monitor shows real, live text in HTML, masked like every other view, on a dark face with tested contrast, never text in the art.
- Hover or keyboard focus opens a big, readable screen. Nothing is hover-only.
- Screens look active: scrolling thinking, not placeholders.

## Motion

- **Natural and smooth,** never choppy or GIF-like. Crossfade between frames, and add small eased moves.
- **Nobody moves in sync.** Vary timing per person, with small idle motion: breathing, shifting, a pause in typing.
- **Keep the head steady across a change.** Align frames on the head, so the eye follows it while the body changes, and add a short beat for sitting down.
- **Limbs must not double in a dissolve.** If they do, it needs in-between frames, not a longer fade.
- **Never two bodies at once.** A dissolve between two big poses shows a ghost. If moving a person looks wrong, do not move them across the room: ease them smaller and fade at the seat, and ease them up from small at the fixture, like a movie teleport. Nobody crosses over screens.
- **The room stays put when someone leaves.** Their seat, plate and status stay, with a square, readable post-it (in the world's own style) saying where they went. Rows and screens resize only when the number of sessions changes, and they ease.
- **Prefer a rig to more pictures for small motions.** Cut a person into head, torso and hands with pivots, so hands stay on the keys. Image models repeat poses, so several "in-between" frames often add little.
- Reduced motion and Serious mode stop it. Hidden and off-screen pause it.

## Light

- People stand out from the background. A lighter room or a darker one is a choice to test against people, cards and labels, not a mood alone.
- The light has one direction and temperature. Shadows agree with it.

## Performance

Spec 097 FR-178 and after hold the budgets. In short:

- Animate only `transform` and `opacity`. No `mix-blend-mode`. No blur on dialogs.
- Only the shown pictures load, at a size close to what is shown, without softening faces.
- Measure on a real GPU as well as without one: they disagree a lot.

## Review a world like this

1. Thumbnail test against every other world.
2. Look at 3, 4, 8 and 15, at both sizes, not only the flattering one.
3. Can you say who needs you in one second at 15?
4. Crop check: every person, every pose, at every count.
5. Labels: none cut, none over a person or a fixture.
6. Watch it move, on a video, before you believe it.
7. Write down what still looks wrong. A mockup is a question, not a proof.
