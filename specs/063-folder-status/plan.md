# Plan 063
1. `src/main/gitstatus.ts`: `parsePorcelainZ`, `parseNumstatZ`, `folderGitStatus(dir, exec)` (argv, limits), pure parsers unit-tested.
2. IPC `agents:gitStatus(id)` in main (`fromApp`, known agent, its cwd), preload + `api.ts`.
3. Renderer: folder chip text and button, dialog through `askDialog`, refresh on chat open and turn end (debounced); a small `gitstatus.js` formatter (unit-tested).
4. Simulator data; driver `scripts/shots-063-folder-status.js` at 1440x900 and 1280x800.
5. README line, CHANGELOG line, `specs/README` row.
