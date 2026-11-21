# Implementation Plan: Sound library (spec 115)

**Branch**: `115-sound-library` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md) | **Issue**: #1960

## Summary

An optional, calm sound for four agent moments, made live in the main window with Web Audio from recipes kept as data. No audio files, no new dependency, no change to the page CSP. Off by default.

Q1..Q9 were decided on 2026-11-21, all option (a): Q1, Q2, Q4 and Q5 by the owner (Ruben), the rest by the coordinator under Ruben's delegation. **Q2 (a) merges *Finished* and *New reply***, so this plan has four events: `needs-you`, `finished`, `error` and `limit`. The spec's FR-010, FR-023, US2 and *Summary* still name `reply`; T020 (converge) takes it out. All references are to `115-sound-library` at `5aca5f142`, where `src/` is unchanged from `origin/main` `8eaf0ee68`. Line numbers are a snapshot; each task re-reads them.

## Technical context

- **Language**: plain JS (UMD) in the renderer for the catalog, the gate and the player; TypeScript in `src/shared` and `src/main` for the settings value. No new runtime dependency.
- **Storage**: one optional key `sounds` in `AppSettings` (`durbar-settings.json`, written by `SettingsStore`). Only values that differ from the defaults are written, as with `notifyNeedsMe`.
- **Testing**: `scripts/test-*.ts` suites listed in `scripts/test-suites.txt`, with an injected clock and a fake `AudioContext` that records calls. There is one simulator driver with a recording player stub, plus screenshots at 1440x900 and 1280x800. **No test or CI job ever produces audio** (see *Keeping sound out of tests and CI*).
- **Platforms**: Windows, macOS and Linux run the same Web Audio code in Electron 44's Chromium. No OS sound API, no native module, no shell.
- **Constraints**:
  - constitution II: nothing touches adapters;
  - III: settings validated in main, own keys only;
  - IV: zero credits;
  - V: off by default, capped, never meaning by sound alone, 10.5 px;
  - VI: the same code everywhere;
  - VIII: `[KNOWN GAP]` for OS mute and Do Not Disturb, for how a sound sounds, and for autoplay on macOS and Windows until checked.

## Constitution check

| Principle | How this plan meets it |
|---|---|
| I Spec Kit | Spec (51932921a), clarify (5aca5f142); this plan and `tasks.md` come before any `src/` change; each phase PR ticks its tasks and converges (T020). |
| II Adapters are plug-ins | Events come from the window's existing attention model; no adapter, capability or vendor type is touched. |
| III Safe by default | Off by default. The `sounds` value is checked in main (known event names, ids by pattern, numbers in range, own keys only, spec 109 FR-059 style). No text from an agent reaches the sound layer (only ids, kinds and booleans). Nothing is logged. |
| IV No AI credits | Simulator and Node only; the listening check (T018) costs no credits. |
| V Calm UI | Off by default; one sound at a time; 1.5 s batch, 5 s cooldown, 6 per minute; quiet hours; the shown chat is silent; floors that are off are silent; one Settings section, screenshots at both sizes. |
| VI Parity | Pure modules tested on all three CI runners; the player has one code path; T019 is the device check. |
| VII Quality gates | A `test:` or `sim:` line per task, mutants on the gating rules, docs and changelog per phase. |
| VIII Honest limits | The `[KNOWN GAP]`s above, written in `docs/limits.md` (T010). |

No violation; *Complexity tracking* is empty.

## Existing capability check (spec 021 FR-031)

| Need | Reused (path:line) | Change |
|---|---|---|
| Who needs you | `needsMe` (`src/renderer/app.js:4739`), `needsMeOrder` (`:4746`), `NEED_SINCE` (`:4740`) | none |
| Stable item keys and kinds | `attentionItems(list, withText)` (`app.js:4761`): `id\|kind\|card`, kinds `p q w e l c` | none; the gate reads the keys and kinds (`withText` false) |
| One place that sees every change | `syncAttention(list)` (`app.js:4772`), called by `renderInboxBtn` (`app.js:4793`) and on focus (`app.js:4790`) | one call into the gate beside `NOTIFIER.observe` (T008) |
| Startup arming | `ATT_ARMED` (`app.js:4758`, set at `:10610`) | the gate takes the same flag |
| Batch and throttle pattern | `createNotifier` (`src/renderer/attention.js:45`): known keys, batch, `dueAt`/`take`, injected monotonic clock `MONO` (`:11`) | `createSoundGate` follows it in a new file |
| Due timer | `ATT.scheduleDue` and `attTimer` (`app.js:4779-4780`) | the same for the gate |
| Finished, not seen | `noteCompleted` (`app.js:3036-3042`), `UNREAD.complete` (`src/renderer/unread.js:21`) answering `'marked'` | one call into the gate on `'marked'` (T008) |
| Chat on screen | `chatShownNow(id)` (`app.js:3027`), `DurbarUnread.isShown` (`unread.js:11`) | none |
| Hidden folder or floor off | `roomShown` (`app.js:234`), `roomOf` | none |
| Simulator replay | the guard at `app.js:3038` | none |
| Kind grouping for limit | `liftKind` (`app.js:6070`): spending limit and coffee break are both `limit` | the gate uses the same grouping |
| OS notification | `showAttention` (`app.js:4782`), `new Notification(title, {body})` (`app.js:4786`) | P3: `silent` when sounds are on (T015) |
| Settings value | `AppSettings` (`src/shared/credits.ts:77`), `parseSettings` (`:145`), the `notifyNeedsMe` field (`:96`) | new optional `sounds` |
| Store | `SettingsStore` `notifyNeedsMe` getter and setter (`src/main/settings.ts:245-256`) | `sounds` getter and `setSounds` |
| IPC | `setting()` helper (`src/main/ipc/settings.ts:25`), `settings:setNotifyNeedsMe` (`:40`), `settings:get` (`:23`); preload (`src/preload/preload.ts:71`); bridge type (`src/shared/api.ts:1098`) | `settings:setSounds` |
| Simulator | setter `sim.ts:2830`, demo default `sim.ts:2691`, `getSettings` (`sim.ts:2824`); copied rules go in a marked block with an equality test (`docs/agent-notes.md:67`, the `simrecord:begin` block `sim.ts:1523`) | a `soundsettings:begin` block |
| Settings screen | `paintSettings` (`src/renderer/screens.js:366`), *Notifications* section (`:410-412`) and handler (`:1170-1175`), `sw()` (`:95`), select row (`:408`), `saveFailed` (`:982`); section list `settingsnav.js` and Settings search (spec 112) read the `<h3>` | new *Sounds* section after *Notifications* |
| Confirmation | `askDialog` (`src/renderer/dialog.js:65`) | pack switch confirmation (Q6, T012) |
| Renderer module wiring | `scripts/copy-assets.js:9` list, `<script>` tags (`src/renderer/index.html:161`, `:170`) | `soundgate.js`, `sounds.js` added |
| Simulator clock | `src/renderer/simclock.js` | quiet-hours driver (T013) |
| Mutant pattern for drivers | `scripts/check-005-announce-error.js:10-25` (`ANNOUNCE_ERR_MUTANT`, each mutant fails at its own label) | `SOUND_MUTANT` in the T008 driver |
| Settings save driver | `scripts/check-settings-save.js` | covers `settings:setSounds` (T009) |
| Synthesis prior art | `docs/site/talk/level-up-architect/assets/talk.js:59-99` (spec 050: `tone`, `noise`, master gain, `resume()`) | pattern only; the site file is not imported |
| Setup export (spec 109, **not built**) | 109 FR-013 allow-list (`specs/109-setup-export-import/spec.md:146`) | `sounds` added (P4) |

## Module layout

| File | Kind | Content |
|---|---|---|
| `src/shared/soundsettings.ts` | pure TS, erasable (loadable by plain Node, `docs/agent-notes.md:10`) | `SOUND_EVENTS` (`needs-you`, `finished`, `error`, `limit`); `SOUND_DEFAULTS` (`on: false`, `pack: 'quiet'`, `volume: 40`, `events: {}`, `quiet: { on: false, from: '22:00', to: '08:00' }`); `parseSoundSettings(v)`, which returns a fresh object with known keys only (FR-063 clamps and drops); `soundSettingsToStore(v)`, which returns only the non-default fields, or `undefined` |
| `src/renderer/soundgate.js` | pure UMD, no DOM, no timers | `createSoundGate({ now })` with `observe(items, flags)`, `finished(id, flags)`, `dueIn()`, `take()`, `played()`; `kindToEvent(kind)`; `inQuiet(date, from, to)` (P2) |
| `src/renderer/sounds.js` | UMD: pure catalog and validator, plus a thin player | `PACKS`, `SOUNDS` (recipes as data), `validateRecipe(r)`, `recipeLength(r)`, `resolve(settings, event)` (gives a sound id or `null`), `pluckBuffer(n, rate, seed)` (pure Karplus-Strong samples, P2); `createPlayer({ Ctx, now, onState })` with `play(id, volume)`, `state()` (`idle`, `playing` or `unavailable`) and `close()`; the player is the only code that touches `AudioContext` |

`app.js` gets only wiring: the gate instance, the calls from `syncAttention` and `noteCompleted`, the due timer, the settings read at `app.js:10631`, and a driver-only recording stub. `screens.js` gets the section.

## Synthesis design (FR-022..FR-026)

**A recipe is data**: `{ id, name, layers: [...], gap?, repeat? }`. Each layer is one of:

- `{ type: 'osc', wave: 'sine'|'triangle'|'square', f, f2?, glide?, start, dur, attack, decay, peak, detune? }`;
- `{ type: 'noise', band: { f, q }, start, dur, attack, decay, peak }`;
- `{ type: 'pluck', f, start, dur, peak }` (a buffer from `pluckBuffer`).

Envelopes are linear attack then exponential decay to silence, using `setValueAtTime`, `linearRampToValueAtTime` and `exponentialRampToValueAtTime` to 0.0001. Every layer goes to one master `GainNode` (the volume), then a `DynamicsCompressorNode` used as a soft limiter (threshold -12 dB, ratio 12), then the destination. Noise is one short white-noise `AudioBuffer`, generated once per context and reused.

**`validateRecipe` rules** (pure; tested on every built-in recipe):

- every number is finite and positive where it must be;
- `attack` is at least 0.005 s;
- the sum of layer peaks is at most 1;
- the total length (`recipeLength`, which counts repeats and gaps) is at most 1.5 s, or 2.5 s for ids marked `long` (*rin*, *furin*);
- frequencies are 40 Hz to 8 kHz;
- at most 8 layers;
- the id matches `[a-z0-9-]{1,32}`;
- own keys only.

**Quiet pack (P1)**: soft sine and triangle tones only.

| Event | Sound |
|---|---|
| Needs you | two notes up, about 660 then 880 Hz, 120 ms each |
| Finished | one round note, about 523 Hz triangle with a 0.6 s decay |
| Error | two notes down, about 440 then 330 Hz |
| Limit | three short low notes, about 392 Hz, 80 ms apart |

**Japanese street pack (P2).** Approximations written for this spec; the plan gives starting values and T011 tunes them by ear.

| Sound | Recipe outline |
|---|---|
| *Piyo piyo* (crosswalk bird) | two sine chirps, each `f` 3,000 -> `f2` 2,200 Hz over 90 ms, a 60 ms gap, the pair repeated once |
| *Kakko* (crosswalk cuckoo) | triangle at about 1,000 Hz for 150 ms, then about 800 Hz (a major third lower) for 200 ms |
| *Furin* (wind chime) | sine partials at about 2,000 Hz x 1, 2.76, 5.4 with peaks 0.4/0.2/0.1, decay 1.8 s, detune +-8 cents random per strike, two strikes 300 ms apart (`long`) |
| *Rin* (temple bowl) | sine at about 600 Hz plus partials x 2.7 and x 5.1; two partials 1.5 Hz apart so they beat slowly; decay 2.3 s (`long`) |
| *Shishi-odoshi* (bamboo knock) | noise band-pass 1,000 Hz Q 4 for 60 ms, plus a sine at 150 Hz for 80 ms with a fast decay |
| *Hyoshigi* (wooden clappers) | two noise clicks, band-pass 2,500 Hz Q 6, 25 ms each, 150 ms apart |
| *Koto* pluck | `pluck` layer, about 392 Hz (a note of the *hirajoshi* scale), 1 s, with a 2% low-pass damping in the loop |
| *Uguisu* (bush warbler) | sine held at 1,800 Hz for 400 ms rising to 2,100, a 100 ms gap, then a quick phrase 2,600 -> 2,000 -> 2,400 Hz, 3 x 80 ms; the whole sound is under 1.5 s |

Japanese pack mapping:

| Event | Sound |
|---|---|
| Needs you | *piyo piyo* |
| Finished | *koto* |
| Error | *hyoshigi* |
| Limit | *shishi-odoshi* |

*Kakko*, *rin*, *furin* and *uguisu* can be picked for any event.

**`pluckBuffer(n, rate, seed)`** fills a `Float32Array` with the Karplus-Strong algorithm. It is seeded noise, so the result is the same for the same inputs and can be tested. The player wraps the samples in an `AudioBuffer`. No `AudioWorklet` and no `ScriptProcessorNode`.

**Review rule (FR-025), in every PR that adds or changes a recipe.** The PR body lists each recipe and says it was written from the descriptions above. A reviewer confirms that no recipe is, or follows, a known melody: no station departure melody, train or shop door chime, game sound or brand jingle, and no sequence of more than three pitched notes taken from one. A recipe with more than three pitched notes needs a one-line note in `sounds.js` saying where its shape comes from (an animal call, a physical object). The source test in T006 refuses any audio file, `<audio>` element or `media-src`.

## Audio context lifecycle (FR-052, FR-053, FR-055)

1. **Lazy**: no `AudioContext` exists until the first `play` (an event or a *Play* button). Sounds off means no context, ever.
2. **One per window**, reused; `close()` only on page unload.
3. **Before each play**: if `state === 'suspended'`, call `resume()` and wait for it, with a 500 ms timeout. A rejected or timed-out `resume` marks the sound as not played. That counts towards *unavailable* (step 6), and the gate's cooldown still starts, so a dead device is not retried in a burst.
4. **Suspended when idle**: 1 s after the last sound ends, the player calls `suspend()`. It also suspends at once on `visibilitychange` to hidden when nothing is playing. A hidden window does not keep the audio thread running, but **an event while hidden still plays**: step 3 resumes the context. Playing while the window is in the background is the main use (Q4 (a)), so "suspend when hidden" never means "silent when hidden".
5. **One at a time**: while `state() === 'playing'`, `play` returns `false` and does nothing. The gate (FR-031) already avoids this; the player double-checks.
6. **No device**: if `new Ctx()` throws, or two `resume` calls in a row fail, the state becomes `unavailable` for this run. Events play nothing and nothing throws. `onState` tells the Settings section to show "No sound device found. Sounds are off for now." A *Play* press tries once more (one new context). Each failure is counted only in memory; nothing is logged.
7. **Autoplay**: the main window's `webPreferences` set no `autoplayPolicy` (`src/main/main.ts:1027-1033`), so Electron's default allows audio without a user gesture (`read:` Electron docs). T019 checks this on devices. If a platform still needs a gesture, the first event sound may be lost until the person clicks once; that becomes a `[KNOWN GAP]` line, not a workaround. The session browser's `autoplayPolicy: 'user-gesture-required'` (`src/main/hardening.ts:83`) is for views and stays as it is.

## Gate rules (FR-010..FR-016, FR-030..FR-034)

`observe(items, f)` takes `attentionItems(needsMeOrder(), false)` and `f = { armed, on, focused, shownId(id), roomShown(id), quiet }`. `finished(id, f)` is called on `'marked'`.

- **Kind to event**: `p`, `q` and `w` give `needs-you`; `e` gives `error`; `l` and `c` give `limit`. An unknown kind gives nothing.
- **Known keys** are kept as in `createNotifier`. Before `armed`, keys are only remembered (FR-013). A key seen again never plays (FR-011).
- **Dropped at once** (remembered, never played): `!on`; `!roomShown(id)` (FR-014); `focused && shownId(id)` (FR-015); an item with a `parent` (Q3: `needsMe` already excludes them, and the gate re-checks).
- **Batch**: the first new event opens a 1.5 s batch. A key that leaves the list leaves the batch. At `take()`, the batch's highest event plays, in the order `error`, `needs-you`, `limit`, `finished`, and the rest are discarded, not queued (FR-031, FR-032).
- **Cooldown**: 5 s after a play; at most 6 plays in any 60 s (a sliding window of play times). An event that arrives in the cooldown is discarded.
- **Quiet hours** (P2): `inQuiet(new Date(), from, to)`. `from === to` means never quiet. A window that crosses midnight is handled. Times are `HH:MM`, 24 h, local.
- **Preview** (FR-034) never goes through the gate.

## Keeping sound out of tests and CI

- Unit tests load `sounds.js` and `soundgate.js` in Node. The catalog, the validator, `resolve`, `pluckBuffer` and the gate are pure. The player is tested only with a **fake `Ctx`** that records node creation, parameter ramps, `resume` and `suspend`; it never makes sound.
- Drivers (`DURBAR_SIM`, Electron under `xvfb-run` on Linux CI) set `window.__durbarSoundRec` before `app.js` runs. The player factory then returns a **recording stub** that pushes `{ event, soundId, at }` and creates no `AudioContext`. The stub is installed only when `SIM` is true (the `__durbarSimUi` pattern, `app.js:10646`), and a source test checks that the real page has no other way to install it.
- Screenshot drivers leave sounds off (the default) or use the stub.
- **What no test proves**: how anything sounds, and that audio reaches a speaker. That is T018 (owner, by ear) and T019 (devices).

## Data flow

1. Agent state changes -> `renderInboxBtn` -> `syncAttention(list)` -> `NOTIFIER.observe(...)` (unchanged) and `GATE.observe(attentionItems(list,false), flags())`. Then the gate's due timer is set if needed.
2. A turn ends unseen -> `noteCompleted` -> `UNREAD.complete === 'marked'` -> `GATE.finished(a.id, flags())`.
3. Timer -> `GATE.take()` -> `{ event }` or `null` -> `SOUNDS.resolve(settings, event)` -> sound id or `null` -> `PLAYER.play(id, volume)`.
4. Settings -> `settings:setSounds` -> main validates (`parseSoundSettings`) and stores (`soundSettingsToStore`) -> the answer `{ ok, sounds }` -> the window updates its copy (no restart).

## Dependencies

- P1 needs nothing new.
- P2 needs P1.
- P3 needs P1. T015 needs the `on` flag.
- P4 needs spec 109's build. If 109 lands first, T017 is part of P1's T002 PR instead (109 FR-013's "a test fails when `AppSettings` gains a key" forces it).

## Phases (one small PR per phase; Refs #1960 until the last)

| Phase | Tasks | Content | Risk / who | Waits for |
|---|---|---|---|---|
| P1 | T002..T010 | `sounds` settings key (off), IPC, simulator; gate (events, arming, hiding, focus, batch, cooldown); Quiet pack recipes and validator; player with fake-context tests; app wiring and driver; Settings section with *Play* buttons; docs | Medium: senior for T002, T003, T007; junior for the rest; reviewer per author | spec, plan and tasks committed |
| P2 | T011..T014 | Japanese street pack recipes and `pluckBuffer`; per-event mapping editor and pack switch confirmation; quiet hours; docs | Low: junior; T011 has the FR-025 review | P1 |
| P3 | T015..T016 | `silent` on the OS notification when sounds are on (spec 052 FR-059 delta); pointers in specs 052, 068 and 070 | Low: junior | P1 |
| P4 | T017 | `sounds` in 109's allow-list, export and import validated by `parseSoundSettings` | Low-medium: junior; reviewer-senior because it is an import path | spec 109 built |
| Owner | T018 | listening check | Ruben, by ear, no credits | P2 |
| Devices | T019 | autoplay, background play and no-device checks on Windows and macOS | any owner with the device, no credits | P1 |
| Converge | T020 | spec text to four events, tags, index | coordinator | each phase |


## Test plan (zero AI credits, no audio)

- `test:soundsettings` (T002, T003): defaults; `parseSoundSettings` on `null`, arrays, `__proto__`, `constructor`, unknown events, ids with spaces, upper case or more than 32 characters, volume `-1`, `101`, `NaN` and `"40"`, times `24:00`, `9:5` and `aa:bb`; `soundSettingsToStore` writes nothing for defaults; `settings:setSounds` round trip through the `setting()` helper; the simulator block equals the shared code. **Mutants**: a default written; an inherited key accepted; volume not clamped; an unknown event kept.
- `test:soundgate` (T004, T005, T013): arming; once per key; a new card key plays again; hidden room; focused and shown; not focused and shown (plays, Q4 a); helper; off; batch priority; a key that leaves the batch; cooldown; 6 per 60 s with 15 agents; discarded, not queued; quiet hours (inside, outside, across midnight, `from === to`). Each rule has a named mutant: `arm`, `once`, `hidden`, `shown`, `helper`, `off`, `priority`, `stale`, `cooldown`, `cap`, `queue`, `midnight`. Each mutant fails at its own label.
- `test:sounds` (T006, T007, T011): every built-in recipe passes `validateRecipe` and fits its length; `resolve` with `none`, an unknown id and an unknown pack (FR-063); `pluckBuffer` (length, no NaN, peak at most 1, decays, the same output for the same seed); player with a fake `Ctx`: no context before the first play; one context for many plays; `resume` before play; `suspend` after idle and on hidden; `unavailable` when the constructor throws or `resume` rejects twice; no throw; `play` while playing returns false. Source test: no `.mp3`, `.wav`, `.ogg`, `.m4a` or `.flac` under `src/`; no `<audio` and no `media-src` in `src/renderer/index.html`; no `AudioContext` outside `sounds.js`. **Mutants**: a recipe over the length; an attack under 5 ms; a context made eagerly; `unavailable` never set.
- `sim: check-115-sounds` (T008): `DURBAR_SIM=15`, recording stub; sounds turned on; then a permission, a question, an error, a spending limit, a finish with the chat shown and focused, a finish with the chat closed, an agent on a floor that is off, and five finishes within 1 s. The driver checks the recorded list exactly. Run with sounds off: an empty list. `SOUND_MUTANT` (`arm`, `hidden`, `shown`, `off`), each failing at its own label.
- `sim: shots-115-sounds` (T009, T012, T013): the *Sounds* section at 1440x900 and 1280x800, in a light and a dark theme, with the "No sound device found" line forced; keyboard only (Tab, Space on the switch, Enter on *Play*); the section is listed in the Settings nav and found by Settings search ("sound").
- `test:attention` (T015): `ATT.notificationOptions(body, soundsOn)` gives `silent: true` only when sounds are on. **Mutants**: always silent; never silent.

## Real checks (separate; no AI credits; a person must listen)

- **T018** (owner, `real:`): Ruben turns on each pack and presses *Play* on each of the 12 sounds at 40% volume. He records yes, retune or drop per sound in the spec's *Changes*, with the date and the OS. A sound marked retune goes back to T011; a drop leaves the catalog. No credits; about 5 minutes.
- **T019** (`real:`, devices): on Windows and macOS, and on Linux on a machine with a speaker:
  - the first event sound plays without a click in the window;
  - sounds play while the window is minimized;
  - a machine with no output device, or with the output disabled, shows the line and does not throw;
  - the OS notification is silent when sounds are on (T015).

  Until then these are `[KNOWN GAP]`.

## Complexity tracking

None.

## Risks

- **The sounds may not sound right**: synthesis is an approximation. T018 is the only judge. A rejected sound is retuned (Q5 (a)), not replaced by a file.
- **Autoplay and background play** on macOS and Windows are `read:` only until T019.
- **Suspend and resume latency**: resuming may add a short delay or cut the attack on some systems. The 500 ms timeout keeps it bounded. Not measured.
- **OS mute and Do Not Disturb cannot be read**: `[KNOWN GAP]` (FR-054).
- **Protected melodies**: the FR-025 review is a human rule; a test only stops files.
- **Double sound**: until P3 lands, the OS notification may also make a sound on Windows and macOS.
- **The spec still names `reply`** in FR-010, FR-023, US2 and *Summary* (before Q2); T020 converges it. Build tasks follow this plan.
- **Spec 109 order**: if 109 lands first, its key-classification test forces T017 into P1.
