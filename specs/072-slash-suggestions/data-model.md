# Data model 072

## SlashCommand (adapter boundary, `src/adapters/types.ts`)

| Field | Type | Rule |
| --- | --- | --- |
| `name` | string | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$` (Codex prompts are `prompts:<file name>`) |
| `description?` | string | one line, control characters removed, at most 200 characters |
| `argumentHint?` | string | one line, at most 80 characters |
| `source` | `'folder' \| 'user' \| 'app'` | |
| `kind` | `'skill' \| 'command' \| 'prompt' \| 'builtin'` | `builtin` only with `source: 'app'` |
| `where?` | string | display path: folder-relative with `/` separators, or `~/…`; never absolute |

`SlashCommandInfo` in `src/shared/api.ts` has the same fields (the window's copy; main re-checks and cuts them).

## Internal entry (main only)

`SlashCommand` plus `file` (absolute real path) and `dir` (skill folder). Never sent to the window.

## Ordering and de-duplication

Folder entries (in folder order), then user, then app; inside a group by name (case-insensitive). The first entry of a name wins.

## Caps

100 files per directory, 300 per listing, 64 KB per file, 8 KB read per file while listing, 300 entries over IPC.

## IPC contract

- `agents:slashCommands(id: string)` → `{ ok: true, entries: SlashCommandInfo[] } | { ok: false, error: string, entries: [] }`.
  Window-only (`fromApp`); unknown id or adapter without the member → `ok: false`.
- `agents:send(...)` → adds `slash?: string` (the expanded entry's `where`, else its name) when the text was expanded.

## Expansion

- Match: `^/([A-Za-z0-9][A-Za-z0-9._:-]{0,63})(?:\s+([\s\S]*))?$` on the trimmed message (a space or a new line starts the arguments); only folder and user entries.
- command / prompt: body; `$ARGUMENTS` → rest; `$1`..`$9` → whitespace-split words (missing → empty); no placeholder and rest non-empty
  → body + `\n\nARGUMENTS: ` + rest.
- skill: `Use the "<name>" skill. Its folder is <dir>.\n\n` + body + (rest ? `\n\nARGUMENTS: ` + rest : '').
