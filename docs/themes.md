# Themes

The six themes, the theme maker and the character crews. Moved out of the [README](../README.md) on 2026-10-31 so the README stays short (spec 021 FR-065); the text is unchanged except for its links.

## Themes

Settings has two choices, both applied live without a restart: **Theme** (colours, room frames, cards, fonts, place names, and the theme's own people and furniture) and **Characters** (who sits at the desks, on top of any theme).
- **Clean Office:** the default, and the fallback for anything unknown or broken.
- **Corporate:** a navy bar, white rooms with an accent edge, square corners.
- **Retro Pixel:** a dark arcade page with pixel characters at CRT desks.
- **Durbar · Indian / European / Japanese:** three royal courts, each with its own frames, colours and court place names.
- **Characters** (spec 077): **The theme's own** (the default: the calm office figure in Clean Office, suits in Corporate, pixel people in Retro Pixel, court figures in the three courts), **Minimalist** (the calm office figure on any theme), **Cheeky** (experimental): a playful desk and 13 young, cheeky, office-safe characters, **Prehistoric**: the same desk with 6 friendly cave people, **Pirate**: the same desk with 6 pirates (a captain, an eyepatch sailor, a hook pirate, a cook, a privateer and a cabin boy), or **Monster**: the same desk with 6 friendly monsters (Frankenstein, a ghost, a mummy, a sea creature, a vampire and a werewolf). Each session gets one at random, among those the office uses least, kept per session; a picture shows it working, waiting or resting. If a picture is missing, the plain figure is drawn. Each choice has a small preview in Settings. Cheeky Crew used to be a theme: if you had it, Durbar switches you once to Clean Office with Characters = Cheeky (the characters stay; the warm background and desk colours were the old theme's). Checked on the simulator only.
- **Make a theme with AI:** describe a look ("a pirate ship at night"), or pick one of the ideas, and Claude Code, Codex or Copilot designs a light or dark theme: colours, a style, place names (short enough for a lobby tile) and art for the people, furniture, room walls, windows and floors, and the lobby. Durbar keeps only safe values, cleans the art like an imported pack, and checks that text stays readable (also on each room's colour) and that the brand colour shows on lobby icons and buttons; the AI gets up to 3 passes to fix what fails. Try it on the whole app before you save it. One theme costs about a cent on Claude (haiku); Copilot spends AI credits from your plan (shown with the result): about 0.25 AI credits per pass on a free plan, checked on 2026-10-20.
- **Your own themes:** a folder with a `manifest.json` (colours, fonts, corner radii, shadows, the people's clothes and hair colours, a UI style and a scene kit from fixed lists, small SVG art including the desk's cup and laptop, place names), imported and exported in Settings. A theme is data only: no scripts and no CSS. Fonts are installed system fonts from an allow-list (a theme never downloads a font or loads a font file), sizes and spacing stay the app's so the office always fits, SVG art is rebuilt from allowed shapes, a value that is merely unusable falls back to the default and a text colour that would be hard to read is adjusted just enough (the theme stays light or dark), with a note in Settings, and a pack with markup or CSS in a value is refused with a message (spec 070).

Status, permission and credit wording, and the layout, are the same in every theme. Display fonts are your system's own serif and monospace fonts. Details: specs [035](../specs/035-theme-foundation/spec.md)-[040](../specs/040-user-themes/spec.md).

| Corporate | Retro Pixel | Durbar · Indian |
| --- | --- | --- |
| ![Corporate theme](screenshots/035-corporate-1440x900.png) | ![Retro Pixel theme](screenshots/035-retro-1440x900.png) | ![Durbar Indian theme](screenshots/035-durbar-indian-1440x900.png) |

**Settings > Detail level > Spacing** picks *Comfortable* (the default) or *Compact*, which tightens the chat, Settings, Tools, dialogs and the inbox; the office and the top bar keep their sizes.
