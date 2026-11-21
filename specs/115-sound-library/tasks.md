# Tasks: 115 Sound library

**Input**: [spec.md](spec.md), [plan.md](plan.md). Write the tests first. 0 AI credits, 0 audio: simulator, Node, a fake `AudioContext` and the recording stub only (plan *Keeping sound out of tests and CI*). One PR per phase (P1..P4); each task is one issue (Refs #1960 until the last phase closes it). Numbers checked with `npm run specs:numbers` on 2026-11-21.

Every task names its check:

- `test:` is a `scripts/test-*.ts` suite listed in `scripts/test-suites.txt`;
- `sim:` is a simulator driver;
- `real:` is a person's check.

A mutant must fail at its own label. **Four events** after Q2 (a): `needs-you`, `finished`, `error`, `limit`.

## Spec

- [x] T001 Spec (51932921a), clarify (5aca5f142), plan and tasks (`specs/115-sound-library/`). Check: `npm run specs:check`, `npm run specs:index -- --check`, `npm run specs:numbers`. Who: analyst, coordinator.

## P1: settings key (off), gate, Quiet pack, Settings section with preview

- [ ] T002 [P1] `src/shared/soundsettings.ts` (plan *Module layout*): `SOUND_EVENTS`, `SOUND_DEFAULTS`, `parseSoundSettings`, `soundSettingsToStore`. Add `sounds?` to `AppSettings` (`src/shared/credits.ts:77`) and read it in `parseSettings` (`:145`); FR-063 says a bad value never stops the other settings from loading. **Accept**:
  - defaults write nothing;
  - every bad value in plan *Test plan* is clamped or dropped;
  - only own keys are copied, into new objects.

  `test:` `test:soundsettings`, `test:credits`. **Mutants**: `default-written`, `inherited-key`, `volume-unclamped`, `unknown-event-kept`. Who: senior. [FR-051, FR-063]
- [ ] T003 [P1] Store and IPC. `SettingsStore.sounds` and `setSounds(v)` follow the `notifyNeedsMe` pattern (`src/main/settings.ts:245-256`). `settings:setSounds` goes through the `setting()` helper (`src/main/ipc/settings.ts:25`), and `settings:get` (`:23`) returns the parsed value. Add the preload member (beside `src/preload/preload.ts:71`) and the bridge type (`src/shared/api.ts:1098`). The simulator setter and `getSettings` (`src/renderer/sim.ts:2824-2830`) use a `/* soundsettings:begin */` block compared with the shared code (`docs/agent-notes.md:67`). **Accept**:
  - the answer is `{ ok, sounds }`, and `ok` is true only when the write reached disk;
  - a non-object is refused;
  - the simulator starts off.

  `test:` `test:soundsettings` (round trip through the helper, block equality), `test:ipcchannels`. **Mutants**: `ok-on-failed-write`, `sim-block-drift`. Who: senior. [FR-051]
- [ ] T004 [P1] `src/renderer/soundgate.js` (UMD; added to `scripts/copy-assets.js:9` and `src/renderer/index.html` beside `attention.js` `:161`): `createSoundGate({ now })`, `kindToEvent`. It derives events (plan *Gate rules*): `p q w` give needs-you, `e` gives error, `l c` give limit, and `finished(id)` gives finished. **Accept**:
  - nothing before `armed`;
  - once per key, and a new card key is new;
  - dropped for `!on`, a hidden room, focused-and-shown, and a helper;
  - not focused but shown still plays (Q4 a).

  `test:` `test:soundgate`. **Mutants**: `arm`, `once`, `hidden`, `shown`, `helper`, `off`. Who: junior. [FR-010..FR-016]
- [ ] T005 [P1] Throttle in the same gate: a 1.5 s batch played by priority (`error` > `needs-you` > `limit` > `finished`); a key that leaves the list leaves the batch; a 5 s cooldown; at most 6 plays in any 60 s; anything dropped is discarded, never queued; `dueIn()` and `take()` use the injected monotonic clock (the `MONO` pattern, `src/renderer/attention.js:11`). **Accept**: 15 agents changing state in 60 s give at most 6 plays, at least 5 s apart (SC-002). `test:` `test:soundgate`. **Mutants**: `priority`, `stale`, `cooldown`, `cap`, `queue`. Who: junior. [FR-031, FR-032]
- [ ] T006 [P1] `src/renderer/sounds.js` (UMD, wired as T004), catalog part: the recipe format, `validateRecipe`, `recipeLength`, `resolve(settings, event)`, and the **Quiet** pack's four recipes (plan *Synthesis design*). **Accept**:
  - every recipe is valid and at most 1.5 s;
  - `none`, an unknown id and an unknown pack resolve as FR-063 says;
  - a source test finds no audio file under `src/`, no `<audio` or `media-src` in `index.html`, and no `AudioContext` outside `sounds.js` (SC-004).

  `test:` `test:sounds`. **Mutants**: `long-recipe`, `click-attack`, `peak-over-1`, `none-plays`. Who: junior. [FR-020..FR-024, FR-026]
- [ ] T007 [P1] Player in `sounds.js`: `createPlayer({ Ctx, now, onState })`, following plan *Audio context lifecycle* 1-6:
  - lazy;
  - one context;
  - resume before each play, with a 500 ms timeout;
  - suspend 1 s after idle and on hidden;
  - one sound at a time;
  - `unavailable` after a constructor throw or two failed resumes;
  - never throws.

  Master gain plus compressor. **Accept**: all of it, with a fake `Ctx` that records calls and makes no sound. `test:` `test:sounds`. **Mutants**: `eager-context`, `no-resume`, `no-suspend`, `unavailable-never`, `throws`. Who: senior. [FR-052, FR-053, FR-055]
- [ ] T008 [P1] Wiring in `src/renderer/app.js`:
  - `GATE.observe(attentionItems(list,false), flags)` in `syncAttention` (`:4772`) beside `NOTIFIER.observe`;
  - `GATE.finished` on `'marked'` in `noteCompleted` (`:3041`);
  - the flags come from `ATT_ARMED` (`:4758`), `roomShown(roomOf(a))` (`:234`), `document.hasFocus()` and `chatShownNow` (`:3027`);
  - a due timer like `attTimer` (`:4780`);
  - settings read at `:10631`;
  - the recording stub only when `SIM` (plan, the `__durbarSimUi` pattern `:10646`).

  **Accept**: sounds off gives nothing recorded and no context; the scenario list of plan *Test plan* is recorded exactly. `sim:` `check-115-sounds` (`DURBAR_SIM=15`), with `SOUND_MUTANT` `arm`, `hidden`, `shown`, `off` (the pattern of `scripts/check-005-announce-error.js:10-25`). Who: junior. [FR-010..FR-015, FR-072]
- [ ] T009 [P1] Settings > **Sounds** section in `src/renderer/screens.js`, after *Notifications* (`:410-412`), with the same parts:
  - the FR-050 note;
  - a *Play sounds* switch (`sw()`, `:95`);
  - a *Pack* select (only Quiet in P1);
  - a *Volume* select with 10 steps (Q8 a; changing it plays the Needs you sound once);
  - one row per event with its sound's name and a *Play* button named "Play <sound>" (FR-034: it plays even when off, in quiet hours or in the cooldown);
  - a status line with `saveFailed` (`:982`) and the "No sound device found" text from `onState`.

  Add the handler beside `:1170`. **Accept**:
  - text is at least 10.5 px;
  - it fits both sizes;
  - it works from the keyboard only;
  - it is listed in the Settings nav and found by Settings search ("sound").

  `sim:` `shots-115-sounds` (1440x900 and 1280x800, light and dark theme, the unavailable line forced), `check-settings-save.js` extended to `settings:setSounds`. Who: junior. [FR-030, FR-034, FR-041, FR-050]
- [ ] T010 [P1] Docs for P1:
  - `docs/features.md` (off by default; an extra, never the only sign);
  - `docs/limits.md` with the `[KNOWN GAP]`s: OS mute and Do Not Disturb are not read; how a sound sounds is untested; autoplay and background play are unchecked on macOS and Windows (T019);
  - a *What's new* line (Q1 a);
  - a CHANGELOG fragment;
  - spec tags.

  `test:` `npm run rules:check` and the docs-sync check. Who: junior. [FR-054, FR-071]

## P2: Japanese street pack, mapping editor, quiet hours

- [ ] T011 [P2] The **Japanese street** pack in `sounds.js`:
  - the eight recipes of plan *Synthesis design*: *piyo piyo*, *kakko*, *furin*, *rin*, *shishi-odoshi*, *hyoshigi*, *koto*, *uguisu*;
  - `pluckBuffer(n, rate, seed)` (pure Karplus-Strong, no worklet);
  - the pack mapping.

  **Accept**:
  - every recipe is valid (2.5 s for `long`);
  - `pluckBuffer` has the right length, no NaN, a peak of at most 1, decays, and gives the same output for the same seed;
  - the PR body carries the FR-025 recipe list and the reviewer's sentence.

  `test:` `test:sounds`. **Mutants**: `long-over`, `pluck-nan`, `pluck-unseeded`. Who: junior; reviewer checks FR-025. [FR-023..FR-025]
- [ ] T012 [P2] Per-event mapping editor in the *Sounds* section. Each event row gets a select of every sound plus *None* and a *Play* button; a row that differs from the pack says "changed from the pack". Switching pack after own changes asks through `askDialog` (`src/renderer/dialog.js:65`): "Use the <pack> sounds? Your N changes go." (Q6 a). **Accept**:
  - only the changed event is stored;
  - *None* plays nothing (the FR-072 recording);
  - a cancelled switch changes nothing.

  `sim:` `shots-115-sounds` (editor at both sizes), `check-115-sounds` (a *None* event records nothing). `test:` `test:sounds` (`resolve` with own changes). **Mutant**: `switch-keeps-changes`. Who: junior. [FR-020, FR-023, FR-050]
- [ ] T013 [P2] Quiet hours (Q9 a): `inQuiet(date, from, to)` in `soundgate.js`, used by the gate (preview exempt), plus a switch and two `HH:MM` selects in the section. **Accept**:
  - inside the window nothing plays;
  - a window across midnight works;
  - `from === to` is never quiet.

  `test:` `test:soundgate`. **Mutants**: `midnight`, `equal-means-always`, `preview-blocked`. `sim:` `check-115-sounds` with `src/renderer/simclock.js` set inside the window. Who: junior. [FR-033, FR-034]
- [ ] T014 [P2] Docs for P2 (the pack, the names with their Japanese words, quiet hours), CHANGELOG fragment, spec tags. Who: junior. [FR-023, FR-033]

## P3: the notification's own sound, and pointers

- [ ] T015 [P3] `ATT.notificationOptions(body, soundsOn)` in `src/renderer/attention.js`, used at `src/renderer/app.js:4786`: `{ body, silent: true }` when sounds are on, `{ body }` otherwise (Q7 a). Add a dated delta to spec 052's *Changes* for FR-059. **Accept**: with sounds off nothing changes. `test:` `test:attention`. **Mutants**: `always-silent`, `never-silent`. Who: junior. [Q7]
- [ ] T016 [P3] Dated pointers:
  - spec 070's *Changes*: FR-050's "the app has none" is now out of date; themes still carry no sound;
  - spec 068's *Changes*: the coffee break has the *Limit* sound through spec 115;
  - spec 092: FR-015 is unchanged and the badge never plays.

  Docs-sync. `test:` `npm run specs:check`. Who: junior. [spec Context table]

## P4: export and import (waits for spec 109's build)

- [ ] T017 [P4] Add `sounds` to 109 FR-013's allow-list (not a safety key, 109 FR-067). Export writes `soundSettingsToStore`; import passes `parseSoundSettings`. **Accept**:
  - a hostile file (`__proto__`, a 10,000-character id, volume 1e9, unknown events) is clamped or dropped;
  - import never turns sounds on without the box being ticked in 109's preview.

  `test:` 109's setup suite plus `test:soundsettings`. **Mutant**: `import-unvalidated`. Who: junior; reviewer-senior (import path). If 109 lands before P1, this goes into T002's PR. [FR-060]

## Real checks (no AI credits; a person listens; never in CI; `[KNOWN GAP]` until done)

- [ ] T018 `real:` (owner, needs P2) Ruben presses *Play* on each of the 12 sounds (Quiet 4, Japanese street 8) at 40%. He records yes, retune or drop per sound in the spec's *Changes*, with the date and the OS. A retune goes back to T011. About 5 minutes, 0 credits. [FR-071, SC-005]
- [ ] T019 `real:` (any owner with the device, needs P1 and T015) On Windows and macOS, and on Linux on a machine with a speaker:
  - the first event sound plays without a click in the window;
  - sounds play while the window is minimized;
  - with no output device, the line shows and nothing throws;
  - the OS notification is silent while sounds are on.

  Record each result in the spec. 0 credits. [FR-053, FR-055]

## Converge

- [ ] T020 `/speckit.converge` after each phase. The spec text goes to four events after Q2 (a): FR-010, FR-023, US2, *Summary* and the specs-index title drop `reply`. Every FR is tagged `[IMPLEMENTED]`, `[KNOWN GAP]`, `test:`, `sim:` or `read:`. The specs-index status and note are current. *Changes* entries record each decision made while building. Check: `npm run specs:check`, `npm run specs:index -- --check`, `npm run specs:numbers`. Who: coordinator.
