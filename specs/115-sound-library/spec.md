# Feature Specification: Sound library

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Sound library (issue #1960, owner 2026-11-20): optional, calm sounds for needs you, finished, error, limit reached and new reply; a quiet default pack and a Japanese street pack, made live with Web Audio (no audio files); each event's sound can be changed or set to none, with preview, volume, cooldown and quiet hours; carried by the setup export
status: draft
note: spec only (first draft 2026-11-21); Q1..Q9 open; nothing built
-->

**Feature Branch**: `115-sound-library` (spec only; plan and tasks follow once the questions are answered).
**Created**: 2026-11-21
**Status**: Draft. Nothing built. Q1..Q9 (*Clarifications*) are open, each with a recommendation.
**Issue**: #1960 (rubenlupi).
**Input**: Owner request (Ruben, 2026-11-20, in Spanish, translated): "a library of different sounds: for when it is waiting for an answer, when it has finished something, etc., and that you can change it. I'd like Japanese sounds, the little bird and the owl when you cross traffic lights, etc. ... and see if more can be put." The coordinator told the owner that the second crosswalk sound is a cuckoo (*kakko*), not an owl; this spec uses *kakko*.

## Summary

Agent Durbar has no sound today (spec 070 FR-050 says so). Everything that needs the person is shown: the state word and icon, the Needs you inbox, the window title count, the app badge, one OS notification when the window is in the background (spec 052 FR-059), the screen-reader announcement and, on floors, the lift badge (spec 092 FR-014).

This spec adds an **optional sound** for five moments, on top of what is already shown, never instead of it:

1. **Needs you**: a permission request, a question, an Autopilot run that ended for a reason other than done.
2. **Finished**: a turn ended with a reply nobody has seen yet.
3. **Error**.
4. **Limit reached**: the spending limit card or the usage-limit coffee break.
5. **New reply** while that chat is not shown (see Q2: it may be the same moment as *Finished*).

Sounds come in **packs**: a quiet default pack and a **Japanese street pack** (crosswalk *piyo piyo* and *kakko*, wind chime *furin*, temple bowl *rin*, bamboo knock *shishi-odoshi*, wooden clappers *hyoshigi*, *koto* pluck, bush warbler *uguisu*). The person picks a pack, can change the sound of any one moment, or set it to none, and can listen to each one first. Sounds are **made live in the window with Web Audio** from small recipes in code: no audio files, nothing downloaded, nothing copied.

## Context: what exists today (spec 021 FR-031, reuse first)

- **The attention model.** `needsMe(a)` (`src/renderer/app.js:4739`): a main agent (no `parent`) that is waiting, in error, at a spending limit or whose Autopilot run ended for a reason other than done. `needsMeOrder()` (`app.js:4746`) is the one list the inbox, the title, the badge, the rail and the notifications read; `NEED_SINCE` (`app.js:4740`) is when each started needing you.
- **OS notification path** (spec 052 FR-059): `attentionItems(list, withText)` (`app.js:4761`) gives each item a stable key `id|kind|card` with kinds `q` question, `p` permission, `e` error, `l` spending limit, `c` coffee break, `w` other waiting; `syncAttention(list)` (`app.js:4772`) feeds `NOTIFIER.observe`; `showAttention()` (`app.js:4782`) fires `new Notification(title, {body})` at `app.js:4786` (no `silent` option today). `ATT_ARMED` (`app.js:4758`, set at `app.js:10610`, 3 s after start) stops anything that was already waiting at startup from alerting. The pure notifier is `createNotifier` in `src/renderer/attention.js:45` (coalesce 2 s and throttle 10 s, `attention.js:13-14`; injected clock).
- **Finished and unread** (spec 001 FR-170..FR-177, spec 005 FR-176): `noteCompleted(a)` (`app.js:3036`) is called when a turn that worked goes idle (`app.js:7938`); it asks `UNREAD.complete(id, chatShownNow(id))` (`src/renderer/unread.js:21`), which answers `'marked'` (new, not seen), `'already'` or `'seen'`; on `'marked'` it announces "finished. New reply." only if `roomShown(roomOf(a))` (`app.js:3041`, `roomShown` at `app.js:234`: folder not hidden and floor on). `chatShownNow(id)` (`app.js:3027`) with `DurbarUnread.isShown` (`unread.js:11`) is the existing "this chat is on screen" test. The simulator's start-up replay is skipped at `app.js:3038`.
- **Where states change.** The live event handler's `status` case (`app.js:7900`): `needs-permission` -> waiting (`app.js:7926`), `idle` after work -> `noteCompleted` and Done (`app.js:7938`), `error` (`app.js:7943`), plus `showPerm` (`app.js:7578`), `showQuestion` (`app.js:7245`), `showLimit` (`app.js:7113`), `startCoffee` (`app.js:7487`). All of them end in `renderInboxBtn()` (`app.js:4793`), which calls `syncAttention(needsMeOrder())`: that one call already sees every needs-you change.
- **Floor lift badge** (spec 092 FR-014, FR-015): `liftKind(a)` (`app.js:6070`) maps an agent to `limit` (spending limit or coffee), `error`, `waiting` or `reply` (unread). The same four words this spec uses.
- **Screen-reader announcements**: `announce(text, prio)` (`app.js:4879`), `ANN_REQUEST` (`app.js:4869`). Sound never replaces them.
- **Settings**: `paintSettings` (`src/renderer/screens.js:366`), one `<section class="scr-sec">` with an `<h3>` per feature; the *Notifications* section (`screens.js:410-412`) and its switch handler (`screens.js:1170-1175`) are the pattern; `sw()` switch (`screens.js:95`); a `<select>` row (*Chat links*, `screens.js:408`); `saveFailed` (`screens.js:982`). The section list (`src/renderer/settingsnav.js`, spec 052 FR-226) and Settings search (spec 112) are built from the headings, so a new section needs no extra code there.
- **Store and IPC**: `AppSettings` (`src/shared/credits.ts:77`), tolerant `parseSettings` (`credits.ts:145`); `SettingsStore` getters and setters (`src/main/settings.ts:245-256`, `notifyNeedsMe` as the pattern); the `setting()` IPC helper (`src/main/ipc/settings.ts:25`) and its handlers (`settings.ts:40`); preload `setNotifyNeedsMe` (`src/preload/preload.ts:71`); the bridge type (`src/shared/api.ts:1098`); the simulator's setter (`src/renderer/sim.ts:2830`, notifications off in the demo, `sim.ts:2691`).
- **Main window**: `webPreferences` (`src/main/main.ts:1027-1033`) set no `autoplayPolicy`; the page CSP (`src/renderer/index.html:6`) is `default-src 'none'` with no `media-src`. Synthesis needs neither changed; audio files would need a `media-src` change.
- **Prior art for synthesis**: the project site's talk (spec 050, `specs/050-project-site/spec.md:179`) makes original 8-bit sounds with Web Audio in `docs/site/talk/level-up-architect/assets/talk.js` (`tone` and `noise` with short envelopes, `talk.js:71`, `:78`; master gain and mute, `:59-67`, `:93-99`; `resume()` when suspended, `:90`). Same approach, a different file: the site is not the app and is not imported.
- **Simulator clock**: `src/renderer/simclock.js` for quiet-hours checks.
- **Setup export** (spec 109, specified, **not built**): app settings travel through an explicit allow-list (109 FR-013, `specs/109-setup-export-import/spec.md:146`), and a test fails when `AppSettings` gains a key that is not classified.

### Existing "no sound" promises, and how this spec treats each

| Where | Promise | This spec |
|---|---|---|
| Constitution V (`.specify/memory/constitution.md:118-130`) | Calm, legible UI; state never by colour alone | Nothing forbids sound. Sound is off by default (Q1), never carries meaning alone (FR-040), and is capped (FR-030..FR-034). |
| 070 FR-050 (`specs/070-theme-tokens/spec.md:80`) | "sounds (the app has none)", out of scope for theme tokens | A fact that becomes stale: a dated pointer in 070's *Changes*. Themes still carry no sound (FR-061). |
| 092 FR-015 (`specs/092-floors-as-places/spec.md:189`) | The lift badge must not use sound, toast or OS-notification paths | Kept: the badge never plays anything. Sounds come from the agent's change of state (FR-010), counted once, whatever floor shows it; a lift badge appearing or growing is not an event. |
| 033 FR-010 (`specs/033-floors/spec.md:145`) | Attention from a floor that is off: only text on its row; "no toast, no sound" | Kept: no sound for an agent whose floor is off or whose folder is hidden (FR-014). |
| 001 FR-174 (`specs/001-office-view-and-densities/spec.md:602`) | Nothing drawn or announced for a hidden folder or floor | Same rule as 033 FR-010 (FR-014). |
| 041 edge case (`specs/041-durbar-mcp/spec.md:129`) | Durbar MCP request while minimized: taskbar flagged, "no sound by default" | Kept by default (Q1: off). A Durbar MCP request is not in `needsMe()` today and gets no sound in this spec (FR-016). |
| 058 FR-215 (`specs/058-mcp-session-controls/spec.md:2225`) | MCP sign-in status: no modal, no focus move, no sound | Kept: MCP sign-in lines are not an event here (FR-016). |
| 094 FR-060 (`specs/094-terminal-tab/spec.md:147`, `:248`) | A terminal bell is ignored: no sound | Kept: the terminal bell never plays a sound (FR-016). |
| 080 FR-012 (`specs/080-session-browser/spec.md:189`) | Session browser views start muted | Untouched: this spec never unmutes a view; its own sounds play in the main window only (FR-052). |
| 024, 034, 068 *Out of scope* (`specs/024-office-places/spec.md:99`, `specs/034-agent-health/spec.md:88`, `specs/068-coffee-break/spec.md:180`) | Sounds are out of those specs | Still true for them; the coffee break gets a sound through this spec's *Limit reached* (FR-011). A dated pointer in 068's *Changes*. |
| 050, 104 (project site) | Site talk sounds; site videos silent until play | Not the app; nothing changes. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hear when an agent needs me (Priority: P1)

Ana runs eight agents and reads email in another window. In Settings > *Sounds* she turns sounds on. When an agent asks for permission she hears one soft two-note sound, once, and finds the request in the inbox as before.

**Why this priority**: the waiting agent is the moment that costs the most when missed; this alone delivers the request.

**Independent Test**: simulator (`DURBAR_SIM=15`) with sounds on: a scripted permission request leads to exactly one play request for the *Needs you* sound (recorded by the player stub, FR-072); the inbox, title and badge behave as before.

**Acceptance Scenarios**:

1. **Given** sounds are off (the default), **When** an agent asks for permission, **Then** nothing plays and everything else is as today.
2. **Given** sounds are on, **When** an agent asks for permission, **Then** the *Needs you* sound plays once; the same request never plays again.
3. **Given** three agents ask within one second, **When** the batch is played, **Then** one sound plays (FR-031).
4. **Given** agents were already waiting at start, **When** the app opens, **Then** nothing plays for them (FR-013).

### User Story 2 - Choose the Japanese street pack and change one sound (Priority: P1)

Ana picks the *Japanese street* pack. Needs you becomes the crosswalk *piyo piyo*. She does not like the error sound, so she sets *Error* to the temple bowl, presses its *Play* button to hear it, and sets *New reply* to *None*.

**Why this priority**: the owner asked for exactly this: a library, Japanese sounds, and changing them.

**Independent Test**: simulator: change pack and two events; reload; the choices are kept; each *Play* button produces one play request with the chosen sound id.

**Acceptance Scenarios**:

1. **Given** the Japanese pack, **When** Ana changes *Error* to *Rin (temple bowl)*, **Then** only *Error* changes and the row says "changed from the pack".
2. **Given** *New reply* is *None*, **When** a reply arrives unseen, **Then** no sound plays; the New marker shows as before.
3. **Given** she switches back to the quiet pack, **When** asked, **Then** the dialog says her own changes are kept or reset, as she chooses (Q6).

### User Story 3 - Calm with fifteen agents (Priority: P2)

Fifteen agents finish within a minute. Ana hears a few sounds, never two at once, never a stream.

**Independent Test**: pure test of the throttle with 15 events in 60 s (FR-070).

**Acceptance Scenarios**:

1. **Given** sounds on, **When** 15 agents finish within 60 s, **Then** at most the FR-032 count plays, at least the cooldown apart.
2. **Given** an error and two finishes in one batch, **When** played, **Then** the error sound plays (FR-031 order).
3. **Given** Ana is reading agent A's chat with the window focused, **When** A finishes, **Then** no sound plays for A (FR-015).

### User Story 4 - Quiet hours (Priority: P3)

Ana sets quiet hours 22:00-08:00. At night nothing plays; everything is still shown.

**Independent Test**: pure test of the window across midnight with an injected clock.

### User Story 5 - Take my sounds to another computer (Priority: P3)

The setup export (spec 109) carries the on/off choice, pack, per-event choices, volume and quiet hours.

### Edge Cases

- **No audio device** (a server, a remote desktop, a headset unplugged): creating or resuming the audio context fails or stays suspended. Nothing throws, nothing retries in a loop; the *Play* button says "No sound device found" in the section's status line (FR-053).
- **Window hidden or minimized**: sounds still play; that is when they help most. The audio context may be suspended by the OS or Chromium; the player resumes it before playing and gives up quietly if it cannot (FR-052).
- **The OS is muted**: the sound is silent, as every app's is. Durbar cannot read the OS mute or a Do Not Disturb / Focus mode reliably on all three systems: `[KNOWN GAP]` (FR-054).
- **OS notification and sound together**: today's notification (spec 052 FR-059) may already play the OS's own sound on Windows and macOS, since `silent` is not set: not verified on a device. Q7 decides.
- **A helper (sub-agent) asks for something**: helpers are not in `needsMe()` (`!a.parent`), so they play nothing of their own (Q3).
- **Demo / simulator**: sounds follow the same setting as in the app but start off, like notifications in the demo (`sim.ts:2691`).
- **Answering in the inbox while a sound plays**: the sound is short (FR-022) and is never cut on purpose.
- **A request answered before the batch is played**: it leaves the batch, as in `createNotifier` (FR-031).
- **Reduced motion, Serious mode, Still highlights**: unrelated to sound; they change nothing here.
- **A broken or unknown sound id in the settings file** (hand-edited, older or newer version): read as the pack's sound for that event (FR-063).

## Requirements *(mandatory)*

### Functional Requirements

#### A. Events

- **FR-010** **Five events, from the existing model.** The events are `needs-you`, `finished`, `error`, `limit` and `reply` (Q2 may merge `finished` and `reply`). They are derived in one pure function from what `attentionItems()` (`app.js:4761`) and `noteCompleted()` (`app.js:3036`) already compute, not from new hooks in each card function:
  - `needs-you`: a new key of kind `p`, `q` or `w` in `attentionItems(needsMeOrder())` (permission, question, waiting, an Autopilot run that ended for a reason other than done);
  - `error`: a new key of kind `e`;
  - `limit`: a new key of kind `l` (spending limit card) or `c` (coffee break, spec 068); liftKind's grouping (`app.js:6070`);
  - `finished` / `reply`: `UNREAD.complete()` answered `'marked'` in `noteCompleted` (`app.js:3040-3041`).
- **FR-011** **Once per thing.** An event plays at most once per key (the same `id|kind|card` key the notifier uses), so a status repeated by an adapter, a repaint or a reconnect never plays twice. A new request from the same agent is a new key and may play.
- **FR-012** **Sound is an extra, the state is the source.** The sound layer reads the attention list and the unread result; it never changes state, sort, counts, focus, the inbox, the title, the badge or the notification.
- **FR-013** **Nothing at startup.** Keys present before `ATT_ARMED` (`app.js:4758`, `:10610`) are only remembered; the simulator's start-up replay plays nothing (as `app.js:3038`).
- **FR-014** **Hidden and off floors are silent** (033 FR-010, 001 FR-174). No sound for an agent whose folder is hidden or whose floor is off (`roomShown(roomOf(a))`, `app.js:234`). When the floor is switched on again, nothing plays for what was already waiting (its keys are remembered, FR-011).
- **FR-015** **Not for the chat you are looking at.** No sound for agent A when the window has focus and `chatShownNow(A)` (`app.js:3027`) is true. The `finished` event already follows this through `UNREAD.complete` (`'seen'`). Q4 decides whether sounds also play while the window has focus on the office.
- **FR-016** **What is not an event**: helpers' own states (Q3), the lift badge appearing or growing (092 FR-015), MCP sign-in lines (058 FR-215), the terminal bell (094 FR-060), Durbar MCP requests (041; not in `needsMe()` today), toasts, schedules starting, Working, Thinking. A later spec may add one; it names it here.

#### B. Packs and sounds

- **FR-020** **A sound** is an entry with an id (`[a-z0-9-]`, at most 32 characters), a name in English with its Japanese word where it has one ("Piyo piyo (crosswalk bird)"), and a synthesis recipe (FR-024). A **pack** is an id, a name, and one sound id per event (or none).
- **FR-021** **Built-in packs, in code.** Packs and sounds ship with the app as data in one renderer module; this spec adds no way to load a pack from a file, the web or another person (room for it later, FR-062).
- **FR-022** **Short and soft.** Every sound lasts at most 1.5 s (the *rin* and *furin* tails at most 2.5 s, fading), peaks at the chosen volume (FR-030) with no clipping (a master gain and a gentle compressor or limiter at the end of the chain), and starts with an attack of at least 5 ms (no click).
- **FR-023** **Two packs at first:**
  - **Quiet** (default pack): soft sine and triangle tones only. Needs you: two notes up; Finished: one round note; Error: two notes down, lower; Limit: three short low notes; New reply: one very short tick. (Q2: if `finished` and `reply` merge, the tick is dropped.)
  - **Japanese street**: Needs you: *piyo piyo*; Finished: *koto* pluck; Error: *hyoshigi*; Limit: *shishi-odoshi*; New reply: *furin*. *Kakko*, *rin* and *uguisu* are in the list for any event. Every sound of every pack can be chosen for any event.
- **FR-024** **Made live with Web Audio**, from oscillators, filtered noise and gain envelopes in the main window: no audio files, no `<audio>` element, no network, no change to the page CSP (`index.html:6`). A recipe is plain data (frequencies, durations, envelope times, filter values, repeats), validated by a pure function (positive finite numbers, total length within FR-022). Approximations, for the plan to tune (none is a recording or a copy):
  - *Piyo piyo* (crosswalk bird): two or three short sine chirps, each a fast pitch drop in the 2-3 kHz range, about 100 ms each with a short gap, repeated once.
  - *Kakko* (crosswalk cuckoo): two soft sine or triangle notes, the second lower by about a major third, about 150 ms each.
  - *Furin* (wind chime): a few sine partials at inharmonic ratios (about 1 : 2.7 : 5.4) with slow exponential decay and a tiny random detune per strike; one or two strikes.
  - *Rin* (temple bowl): a mid fundamental (about 500-700 Hz) with inharmonic partials and two slightly detuned partials that beat slowly; long fading tail.
  - *Shishi-odoshi* (bamboo knock): a short noise burst through a band-pass around 1 kHz plus a brief low sine thump; about 80 ms.
  - *Hyoshigi* (wooden clappers): two very short, bright band-passed noise clicks (about 2-3 kHz, 20-30 ms) about 150 ms apart.
  - *Koto* pluck: a plucked-string model (Karplus-Strong style delay with a low-pass in the loop) or a triangle tone with a fast attack, a slight pitch fall and about 1 s decay; notes from a Japanese pentatonic scale.
  - *Uguisu* (bush warbler): a held whistle (sine with a slow rise) then a quick falling phrase, after the "ho-hokekyo" shape, kept under 1.5 s.
- **FR-025** **Nothing protected.** No sound copies or imitates a station departure melody, a shop or train door chime, a game sound, a brand jingle or any other melody someone owns; recipes are written for this spec. A review checks each recipe against this rule.
- **FR-026** **Files only as a fallback, never by default.** If the plan finds a sound that synthesis cannot make acceptable (Q5), a CC0 file may be added only with its source URL, author, license and date recorded next to it in the repo, at most 50 KB, and with the CSP change named in that PR. Not part of this spec's first build.

#### C. Calm

- **FR-030** **Off by default** (Q1). One switch *Play sounds*; a volume with steps from 10% to 100% (default 40%, Q8); changing it plays the *Needs you* sound once as a sample.
- **FR-031** **One at a time, the most important.** Events arriving within 1.5 s form one batch; one sound plays for the batch, the event first in this order: `error`, `needs-you`, `limit`, `finished`, `reply`. A key that leaves the attention list before the batch plays leaves the batch. While a sound plays, nothing else starts.
- **FR-032** **Cooldown.** After a sound, nothing plays for 5 s; at most 6 sounds in any 60 s. Events dropped by the cooldown are not queued for later (the visual state is still there). Pure, with an injected monotonic clock, as `createNotifier`.
- **FR-033** **Quiet hours** (optional, off by default): a start and end time (local, 24 h, may cross midnight). Inside them nothing plays except the *Play* buttons.
- **FR-034** **Preview is always allowed.** A *Play* button plays its sound once at the current volume, even with sounds off, in quiet hours or in the cooldown; it does not start a cooldown for events.

#### D. Accessibility

- **FR-040** **Never meaning by sound alone.** Every event already has a visible state with a word and an icon, and a screen-reader announcement; this spec adds none of those and removes none.
- **FR-041** Sounds do not change or delay `announce()`; a sound is short enough not to cover a screen reader's speech for long (FR-022). Each control has a name; *Play* buttons are named "Play <sound name>".

#### E. Settings UI

- **FR-050** **A *Sounds* section in Settings**, next to *Notifications* (`screens.js:410`), built like it: an `<h3>`, a short note ("Sounds are an extra: everything is still shown on screen. Off by default; kept on this computer."), the *Play sounds* switch (`sw()`, `screens.js:95`), a *Pack* `<select>` (as `screens.js:408`), a volume control (Q8), one row per event with a `<select>` of every sound plus *None* and a *Play* button, *Quiet hours* (switch and two times), a status line (`role="status"`) with `saveFailed` (`screens.js:982`). The section list and Settings search pick it up from its heading (spec 052 FR-226, spec 112).
- **FR-051** **Stored as one value.** `AppSettings.sounds` (`credits.ts:77`): `{ on, pack, volume, events: { <event>: <soundId> | "none" }, quiet: { on, from, to } }`, only fields that differ from the defaults are written (as `notifyNeedsMe`, `settings.ts:245`); read by `parseSettings` (`credits.ts:145`) tolerantly (FR-063); one IPC setter through the `setting()` helper (`ipc/settings.ts:25`), validated in main (own keys only, known event names, ids by pattern, numbers in range); the simulator bridge gets the same setter (`sim.ts:2830`). Text at least 10.5px; the section fits both screen sizes.
- **FR-052** **Player in the main window only.** One audio context, created lazily on the first sound or *Play*; resumed before each play if suspended; closed never (reused). The session browser views (spec 080) are never touched.
- **FR-053** **No audio device.** If the context cannot be created or resumed, the player records "unavailable" for the run, plays nothing, throws nothing, and the *Sounds* section shows "No sound device found. Sounds are off for now." A later *Play* tries once more.
- **FR-054** **OS mute and Do Not Disturb.** Durbar does not read the OS mute or focus modes; it relies on the OS muting its output. `[KNOWN GAP]` on all three systems, written in the section note's help text and in the README's limits.

#### F. Platforms

- **FR-055** **Same code on Windows, macOS and Linux**: Web Audio in Electron's Chromium, no OS sound API, no native module, no shell. The main window sets no `autoplayPolicy` (`main.ts:1027-1033`), so Electron's default allows audio without a user gesture: `read:` Electron's `webPreferences` documentation; to confirm on a device (`real:`, all three systems). If a platform still suspends the context until a gesture, the first event's sound may be lost until the person clicks in the window once: then a `[KNOWN GAP]` line, not a workaround.

#### G. Export, worlds, later packs

- **FR-060** **Setup export** (spec 109): `sounds` joins 109 FR-013's allow-list of app settings (pack, events, volume, quiet hours, on). It is not a safety key (109 FR-067). Imported values pass the same validator as FR-051. Whichever of 109 and 115 is built second adds the key in its PR.
- **FR-061** **Worlds and themes carry no sound** in this spec. Pointer only: the Retro arcade world (spec 102) may later want an original 8-bit pack (square and triangle tones, as spec 050's talk sounds, no game melody); that is a new spec delta, and a world never turns sounds on by itself.
- **FR-062** **More packs later** are new entries in the same data, each reviewed against FR-025; loading packs from files is out of scope.
- **FR-063** **Tolerant read.** An unknown pack id reads as *Quiet*; an unknown sound id for an event reads as that pack's sound; an unknown event name is dropped; a volume out of range is clamped; nothing in the file stops the app or other settings from loading.

#### H. Tests and honest limits

- **FR-070** **Pure tests** (`test:`), Node only, no audio: event derivation from attention items and unread results (FR-010, FR-011, FR-013, FR-014, FR-015); the batch, priority, cooldown and per-minute cap with an injected clock (FR-031, FR-032), including 15 agents in 60 s; quiet hours across midnight (FR-033); the pack and per-event resolution with *None* (FR-023); the recipe validator, every built-in recipe within FR-022 (FR-024); `parseSettings` and the IPC validator with bad values (FR-051, FR-063). Each with mutants that fail at their own label, as other specs do.
- **FR-071** **What cannot be tested**: how a sound *sounds*. The tests check the parameters, never the audio. Whether *piyo piyo* sounds like a crosswalk is the owner's listening check (`real:`, owner), recorded in this spec's *Changes* with the date.
- **FR-072** **Simulator check** (`sim:`): the player has a stub that records `{event, soundId}` instead of playing (in drivers only); a driver with `DURBAR_SIM=15` turns sounds on, scripts a permission, an error, a finish with the chat shown and one with it closed, an agent on an off floor, and checks the recorded list. Screenshots of the *Sounds* section at 1440x900 and 1280x800.
- **FR-073** **No credits.** Nothing here needs a real session; all checks run on the simulator and Node.

### Key Entities

- **Event**: one of `needs-you`, `finished`, `error`, `limit`, `reply`; derived, never stored.
- **Sound**: id, name, recipe (plain numbers), built in.
- **Pack**: id, name, sound id or none per event, built in.
- **Sound settings**: `{ on, pack, volume, events, quiet }` in `AppSettings`, on this computer, exported by spec 109.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With sounds off (the default), the app plays nothing and behaves exactly as today (no change to any existing check).
- **SC-002**: With sounds on, 15 agents changing state within 60 s produce at most 6 sounds, never two at once (pure test).
- **SC-003**: A person changes one event's sound and hears it with *Play* in under 15 seconds from opening Settings.
- **SC-004**: No audio file, `<audio>` element or `media-src` is added (a test fails if one is).
- **SC-005**: The owner listens to every Japanese sound once and records yes or which to retune.

## Assumptions

- The person who wants sounds turns them on; nobody is surprised by a sound after an update (Q1).
- Web Audio behaves the same in Electron 44 on the three systems; only Linux is checked by a person until a spec says otherwise (constitution VI).
- The Japanese sounds are evocations made for this app, not recordings; "sounds like it" is the owner's judgement.
- Spec 109 is not built; FR-060 is applied by whichever lands second.

## Clarifications

Proposed by the analyst on 2026-11-21; all open.

- **Q1 Default.** (a) **recommended**: off by default, one switch turns on the Quiet pack (calm by default, no surprise after an update, matches 041's "no sound by default"); (b) on by default with only *Needs you* in the Quiet pack; (c) a one-time "Turn on sounds?" line in the inbox. Recommendation (a), with a mention in *What's new*.
- **Q2 Finished and new reply.** (a) **recommended**: one event *Finished* ("finished, reply not seen yet": exactly `UNREAD.complete() === 'marked'`), so four events; (b) two events: *Finished* for every completed turn, even with the chat shown and focused, and *New reply* only when unseen (more noise, and FR-015 then needs a rule for the first); the owner's words name "finished" once.
- **Q3 Helpers.** (a) **recommended**: helpers play nothing of their own, as `needsMe()`, unread and the lift badge exclude them (`!a.parent`); their parent's state carries them; (b) helpers count as their parent's event; (c) a separate switch. Not verified: whether every helper request already surfaces as its parent's waiting state.
- **Q4 Window focused on the office.** (a) **recommended**: play, except for the chat on screen (FR-015): a sound helps while reading another agent's chat; (b) only while the window is in the background, as the OS notification.
- **Q5 Synthesis or files.** (a) **recommended**: synthesis only in the first build (FR-024); a sound the owner rejects is retuned, not replaced by a file; (b) allow CC0 files under FR-026 from the start (adds a CSP change, review of each source, and size).
- **Q6 Changing pack after own changes.** (a) **recommended**: a pack switch resets the events to the new pack, after a confirmation that names how many own changes go; (b) own changes stay on top of any pack; (c) no question, always reset.
- **Q7 OS notification sound.** Today's notification (`app.js:4786`) sets no `silent`, so Windows and macOS may play their own sound (not verified on a device). (a) **recommended**: when *Play sounds* is on, notifications are created with `silent: true` so only Durbar's sound plays; off, nothing changes (a spec 052 FR-059 delta); (b) leave notifications as they are and accept a double sound; (c) always `silent: true` (changes behaviour for people who never turn sounds on).
- **Q8 Volume control.** (a) **recommended**: a `<select>` of 10 steps (10%..100%), as existing selects (`screens.js:408`), no new control type; (b) a range slider (`<input type="range">`), a new control in Settings, with its text value beside it.
- **Q9 Quiet hours in the first build.** (a) **recommended**: yes, it is a small pure function and a section row; (b) later, as its own task.

## Changes

### 2026-11-21: first draft (analyst, for issue #1960)

Spec only. FR, SC and Q numbers are new to this spec; `npm run specs:numbers` run before the push. Nothing in `src/` changes until the plan and tasks are committed. The build PR adds dated pointers to the *Changes* of specs 052 (FR-059, if Q7 (a)), 068 (coffee break has a sound), 070 (FR-050 "the app has none" is stale) and 109 (FR-013 allow-list), and the docs-sync entries.
