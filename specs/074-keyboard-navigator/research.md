# Research: Keyboard navigator

## R1 Default shortcut (D1)

- **Decision**: Ctrl+J on Windows and Linux, ⌘J on a Mac. **Superseded 2026-10-23** (issue #587, spec Changes): Ctrl+F / ⌘F, "F for floor"; the checks below still hold for Ctrl+J, and the spec entry of that date has the checks for Ctrl+F.
- **Rationale** (`read:` vendor shortcut docs and the app's own key handler, not tried on a Mac or Windows machine):
  - In the app: Ctrl/⌘+K (palette), Ctrl/⌘+O, Ctrl/⌘+Shift+O, Ctrl/⌘+Shift+A, Ctrl/⌘+Shift+N, Ctrl+`, ⌘, and the chat answer keys are taken (`src/renderer/app.js`, `src/main/appmenu.ts`); J is free with a modifier (plain J/K move list rows only, without a modifier).
  - macOS: ⌘Space (Spotlight), ⌥⌘Space (Finder search), ⌃Space / ⌃⌥Space (input sources), ⌃⌘Space (Emoji & Symbols) are system-wide. ⌘J has no system-wide meaning; Electron's `editMenu`/`windowMenu` roles do not bind it.
  - Windows: Ctrl+Space and Ctrl+Shift+Space toggle IMEs (Chinese/Japanese/Korean input); Win+Space switches the keyboard layout. Ctrl+J is not global.
  - Linux: GNOME uses Super+Space for input sources; IBus/Fcitx use Ctrl+Space (and some setups Ctrl+Shift+Space). Ctrl+J is not global in GNOME or KDE.
  - Chromium text fields in Electron do not bind Ctrl+J (the browser's Downloads shortcut is a Chrome UI accelerator, not present in Electron).
- **Alternatives considered**: Ctrl/⌘+Shift+Space (IME toggles on Windows and Linux; risky), Ctrl+Space (input methods everywhere), ⌘Space (Spotlight), Ctrl/⌘+P (people expect print or a file finder), Ctrl/⌘+G (find next on a Mac), Ctrl/⌘+Shift+K (too close to Ctrl+K, which Firefox-trained users read as a console).

## R2 One box or two (D2)

See the decision table in [plan.md](plan.md). Chosen: the palette in a Go-to mode.

## R3 Letters and filtering (D4)

- **Decision**: `f` / `c` switch level only when followed by a space (or, for `c`, digits). A **Folders** and a **Chats** row at the start level also match `f` / `c` first, so `f` Enter works.
- **Rationale**: a bare letter that switches immediately would make it impossible to filter folders such as "core" or "frontend" at the start level, where folders are listed when only one floor is on.
- **Alternatives**: a bare letter on an empty input switches (VS Code's `>`-style single character): rejected for the filter clash above; Tab to change level: hidden, and Tab is the focus-trap key.

## R4 Stable chat numbers (D5)

- **Decision**: lowest free positive number, assigned when a main session first appears; stored per session id in `localStorage` (`durbar.chatNo`, ids only). After the agent list has loaded, ids no longer present are dropped, freeing their numbers.
- **Rationale**: agent ids are session ids and survive restarts (`src/main/main.ts` restores with the saved session id; the recent-chats list already relies on this, spec 052 FR-091). Lowest-free keeps numbers small so `C 3` stays short.
- **Alternatives**: position in the office (changes when anything is added or sorted: guesswork, rejected by the issue); a counter that never reuses numbers (numbers grow without bound over weeks).

## R5 Shortcut matching

- **Decision**: match `e.code` (key position) plus modifiers with `keys.js`'s `modDown` (⌘ on a Mac, Ctrl elsewhere, never both). Stored as `{mod, alt, shift, code}`; Ctrl on a Mac is a separate flag (`ctrl`), allowed but labelled ⌃.
- **Rationale**: the other app shortcuts match by `code` too (Ctrl+`, the answer keys), so layouts such as AZERTY or Dvorak do not move them. Limit (review round 2): the typed letter counts too (FR-017), and on a Mac with Dvorak ⌘J types H, which macOS takes as Hide before the page sees it, so ⌘J cannot be Go to there; the user picks another key (documented in Settings and the README).
