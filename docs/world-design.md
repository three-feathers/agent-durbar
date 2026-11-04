# World design guide

How to design a world for Real office, built-in or user-made. Spec [098](../specs/098-experience-contract/spec.md) is the contract and the checks; spec [102](../specs/102-worlds-on-demand/spec.md) is the pack format. This page is the craft: what the owner's reviews of real mockups taught us. If this page and a spec disagree, the spec wins.

## First principles

1. **It is a real place, not a dashboard.** People, furniture and light belong to one room with one horizon, one scale and one light direction.
2. **At a glance, you know who needs you.** Someone across the room should read each person's state without reading a word.
3. **Design for 15 on one floor; make 3 to 4 beautiful.** Fifteen must fit at 1440x900 and 1280x800, with no overlap, no office scroll and text at least 10.5 px. Most real floors hold 3 or 4 people, so that view gets the most care. Lifts carry the rest. Faces may go down to 24 px only on a floor of 15, at both sizes; with fewer people they grow, and hover always shows them big (owner decision, 2026-11-01). Text never goes under 10.5 px.
4. **Space is for people and screens.** Decoration earns its pixels or goes. Grow people and screens to fill the room when few are present.
5. **Fast before fancy.** A world that lags does not ship. See [Performance](#performance).
6. **Worlds differ; contracts do not.** Fit rules, status colours and accessibility stay the same everywhere. Everything you can see changes, the seating plan included.

## Make each world its own

Between any two worlds, all of these differ, and you can tell them apart from a thumbnail:

- **arrangement**: how people sit on the floor (for example round a fire, along a hall, on loungers facing the sea), chosen from the arrangements the spec lists
- **monitor**: a design element like the desk (for example gold with beadwork, rock, flowers around driftwood), with the same dark face and real text
- **light and mood**: temperature, direction and the feeling of the room
- wall, floor and desk: material and colour
- fixtures: drawn for this world, never shared cutouts
- plants or props, and one signature material or motif

**A new wall, floor and desk on the same layout is a re-skin,** even when every material row differs. Sixteen such mockups, each with its own materials, looked the same to the owner. A palette swap is less still.

**The side-by-side test:** put two worlds side by side at thumbnail size. If the seating plan and screen shapes match, it is not a new world. Plan a new world against the others before drawing it.

**A mock with the same seats is a question about mood, not a plan.** The garage and rooftop mocks (2026-11-02) looked good and were one layout three times, and the two garages shared their fixtures: they showed the idea appeals, not that any of them is a world. Sketch the plan in grey boxes first, and look at it before spending an image.

Be specific without being a cliche: no tourist symbols, stereotypes, or copied logos and postal marks. **Flags:** invented flags with our golden logo mark are fine, as in the Durbar hall; flags of countries are not. Arches appear only in a world drawn from a historical court that used them, such as the Durbar hall. Anything sacred stays out of decoration.

## State must be obvious

- **One status signal per person, large and in the world's own language:** coloured flames in earthen lamps, flags with our mark, beacons, umbrellas. It is the first thing you see at 15.
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
- **Big props are one still picture of their own,** never things standing in the lobby band: a car or a palm in the band pushes plates and crowds labels. The name chips and the band's own crowding rules do the rest; never place a label by hand.
- **Decoration is never status.** A car, pool or palm never reacts to a state, is not clickable or focusable, and avoids saturated status colours: from across a room a green car reads as *done* and a red tool chest as *error*.
- **Use the space near the edges and the horizon.** Empty sand or floor is waste when people could be bigger.
- **Few people, big screens:** readable text in the room at 3 to 4. **Many people, small screens:** state by colour and marks, with text on hover or focus.
- Numbering and movement are natural: floor 1 at the bottom, up is up.

## Screens

- A monitor shows real, live text in HTML, masked like every other view, on a dark face with tested contrast, never text in the art.
- Hover or keyboard focus opens a big, readable screen. Nothing is hover-only.
- Screens look active: scrolling thinking, not placeholders.

## The whole app belongs to the world

Everything in the app must be in harmony with the world, not only the room. [Spec 097](../specs/097-real-office/spec.md) holds the rules:

- **Tool surfaces other than chat take the world through tokens only** (FR-113): settings, dialogs, the composer, toasts and the rest get colours, radii and shadows from tokens, with no art behind text and no size change except the fixed mat, binding and bezel of FR-233 (amended 2026-11-02; a pack may also set fonts, a built-in world does not).
- **The world's colours cover the whole page** (FR-130): while Real office is shown they replace the theme's colours and shadows, in the List view and Settings too, and its corners once FR-231 is built (amended 2026-11-02). The theme's fonts and title weight stay, and leaving gives the theme back.
- **Chat gets a world surface** (FR-106), at least 78 % opaque behind its text, with a header portrait. The desk-side column was removed (owner, 2026-11-01). It keeps its structure, controls, words and tab order, and the text is never on a picture.
- **Contrast rules stay** (FR-113, FR-106): each world's token set passes in light and forced-colours modes, and chat text is checked against the composited surface, 4.5:1, or 3:1 for large text.

**Decided, not built yet (owner, 2026-11-02; [spec 097](../specs/097-real-office/spec.md) FR-231..FR-235):** a world also sets corners; the chat header takes the bar's dark material; the chat is a sheet on the world's desk, code a monitor, your message a post-it in its own paper. In the Photo office the paper is cool stone, not beige: cream beside oak read as Flat.

**Recolouring the paper is not enough.** With the page colours alone, a chat measured nearly the same as Flat's (mean lightness 93.5 against 96.3, with the room at 60): a room is made of its materials, not its paper. Bring the materials to the edges of the reading, and keep text off them.

A world is not finished until its chat and settings screens have been looked at beside the room.

## Motion

- **Natural and smooth,** never choppy or GIF-like. Crossfade between frames, and add small eased moves.
- **Nobody moves in sync.** Vary timing per person, with small idle motion: breathing, shifting, a pause in typing.
- **Keep the head steady across a change.** Align frames on the head, so the eye follows it while the body changes, and add a short beat for sitting down.
- **Limbs must not double in a dissolve.** If they do, it needs in-between frames, not a longer fade.
- **Never two bodies at once.** A dissolve between two big poses shows a ghost. If moving a person looks wrong, do not move them across the room: ease them smaller and fade at the seat, and ease them up from small at the fixture, like a movie teleport. Nobody crosses over screens.
- **One post-it paper colour per reason (owner, 2026-11-02).** An empty seat's post-it takes its paper colour from the place the agent went to (Boss blue, Bank green, Coffee corner peach, Library canary, Software library lavender, Terminal aqua, Web pink, Other tools kraft, one plain default for a custom place), in one table, `NOTE_PAPER` in `src/shared/realoffice-layout.ts`. The words ("at Coffee corner until 6:13") always stay: colour never carries the meaning alone. Ink is dark on every colour (4.5:1 or better, checked by `test:realoffice-layout`); in forced colours the paper goes and the words and border stay. The Boss is a calm colour, not an alarm: most visits are ordinary. No shadow or animation is added for the colours. A world may restyle the paper but keeps one colour per reason and the same contrast.
- **A world pack may override the paper look.** The post-it is modern flat paper by default; a pack may restyle it (its own material, edge, tilt) as long as it keeps one colour per reason and the contrast above. **Open for the cave:** modern paper post-its look out of place in the Prehistoric cave (review, 2026-11-02; not yet an owner decision); the cave has no paper override yet, and its pieces (a slab, a bark scrap) are to be offered before it ships. Not redrawn now; the cave stays behind its closed flag.
- **The room stays put when someone leaves.** Their seat, plate and status stay, with a square, readable post-it (in the world's own style) saying where they went. Rows and screens resize only when the number of sessions changes, and they ease.
- **Prefer a rig to more pictures for small motions.** Cut a person into head, torso and hands with pivots, so hands stay on the keys. Image models repeat poses, so several "in-between" frames often add little.
- Reduced motion and Serious mode stop it. Hidden and off-screen pause it.

## Light

- People stand out from the background. A lighter room or a darker one is a choice to test against people, cards and labels, not a mood alone.
- The light has one direction and temperature. Shadows agree with it.
- **Light pools are pixels in the floor picture,** not extra layers, and never follow a person. No flicker and no moving water.
- **Status light is the one exception, and it belongs to the desk.** The room's own light (windows, ceiling lamps) is part of the art. A status light (spec 097 D4, FR-040) is an overlay on a real object, such as a monitor's light bar shining down onto the desk. It stays when its person is away, never moves, and never crosses a face (spec 097 FR-236, 2026-11-04).
- **Attention lights the desk, not the room.** Who needs you shows by a light at their desk and a word on their plate. The rest of the room keeps its light, and nothing dims labels or faces (owner, 2026-11-04: "just add light without any dusk"; spec 097 FR-236..FR-238).
- **A bright sky hurts labels by their edges, not their text.** A white chip on a pale sky measured 1.42:1 with the sky, and about 15:1 for its text: give it an edge at 3:1 against whatever is behind it, computed per world, since one edge passes a pale sky and fails a mid-grey floor, and keep the sky below glare. Text never sits on the sky itself.

## Performance

Spec 097 FR-178 and after hold the budgets. In short:

- Animate only `transform` and `opacity`. No `mix-blend-mode`. No blur on dialogs.
- **Endless loops change 12 times a second, on one clock** (spec 097 FR-229). Each keeps its own path and timing, so nobody moves in sync; only how often it is drawn changes. The owner saw no difference in a side-by-side recording, and it uses about a third of the CPU. A pixel world keeps its own stepped timing.
- Only the shown pictures load, at a size close to what is shown, without softening faces.
- Measure on a real GPU as well as without one: they disagree a lot.

## Review a world like this

1. The side-by-side test against every other world.
2. Look at 3, 4, 8 and 15, at both sizes, not only the flattering one.
3. Can you say who needs you in one second at 15?
4. Crop check: every person, every pose, at every count.
5. Labels: none cut, none over a person or a fixture.
6. Watch it move, on a video, before you believe it.
7. Look at its chat and settings screens beside the room.
8. Write down what still looks wrong. A mockup is a question, not a proof.
