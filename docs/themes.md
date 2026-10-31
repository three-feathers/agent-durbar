# Themes

The two themes, your saved themes and the character crews. Moved out of the [README](../README.md) on 2026-10-31 so the README stays short (spec 021 FR-065).

## Themes

Settings has two choices, both applied live without a restart: **Theme** (colours, room frames, cards, fonts, place names, and the theme's own people and furniture) and **Characters** (who sits at the desks, on top of any theme).
- **Clean Office:** the default, and the fallback for anything unknown or broken.
- **Retro Pixel:** a dark arcade page with pixel characters at CRT desks.
- **Removed on 2026-10-31 (spec 035 FR-017):** Corporate and the three Durbar courts (Indian, European, Japanese). If one was your theme, Durbar switches you once to Clean Office and keeps your Characters choice. A theme of your own that used one of their styles or people-and-furniture kits keeps working: that one value is drawn as Clean Office would, with a note in Settings.
- **Characters** (spec 077): **The theme's own** (the default: the calm office figure in Clean Office, pixel people in Retro Pixel), **Minimalist** (the calm office figure on any theme), **Cheeky** (experimental): a playful desk and 13 young, cheeky, office-safe characters, or **Prehistoric**: the same desk with 6 friendly cave people. Each session gets one at random, among those the office uses least, kept per session; a picture shows it working, waiting or resting. If a picture is missing, the plain figure is drawn. Each choice has a small preview in Settings. Cheeky Crew used to be a theme: if you had it, Durbar switches you once to Clean Office with Characters = Cheeky (the characters stay; the warm background and desk colours were the old theme's). Checked on the simulator only.
- **The AI theme maker is retired** (2026-10-31, spec 040 FR-031): *Make a theme with AI* and *Import a theme* are gone from Settings, and no new themes are made there. Themes you saved keep working and stay in the list, tagged "yours"; **Export** still copies one to a folder, and **Remove the active theme…** deletes one of them after a question (the theme in use goes to Clean Office; nothing is deleted by the update).
- **Your own themes:** a folder with a `manifest.json` (colours, fonts, corner radii, shadows, the people's clothes and hair colours, a UI style and a scene kit from fixed lists, small SVG art including the desk's cup and laptop, place names), exported in Settings (no new ones are imported or made any more). A theme is data only: no scripts and no CSS. Fonts are installed system fonts from an allow-list (a theme never downloads a font or loads a font file), sizes and spacing stay the app's so the office always fits, SVG art is rebuilt from allowed shapes, a value that is merely unusable falls back to the default and a text colour that would be hard to read is adjusted just enough (the theme stays light or dark), with a note in Settings, and a pack with markup or CSS in a value is refused with a message (spec 070).

Status, permission and credit wording, and the layout, are the same in every theme. Display fonts are your system's own serif and monospace fonts. Details: specs [035](../specs/035-theme-foundation/spec.md)-[040](../specs/040-user-themes/spec.md).

![Retro Pixel theme](screenshots/035-retro-1440x900.png)

**Settings > Detail level > Spacing** picks *Comfortable* (the default) or *Compact*, which tightens the chat, Settings, Tools, dialogs and the inbox; the office and the top bar keep their sizes.
