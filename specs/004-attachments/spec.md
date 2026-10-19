# Feature Specification: Attachments (pick, drop, paste) and caps

**Feature Branch**: `004-attachments` (reverse-engineered; milestones 3 and 5)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/shared/attachments.ts`, `main.ts`, `copilot.ts`, `app.js`, README)
**Input**: "Attach files and images to messages, safely, with clear limits."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a file or image from a dialog (Priority: P1)

In the chat I press the file or image button, pick files, see them as chips in the composer, send, and the agent receives them.

**Independent Test**: simulator for the UI; `DURBAR_PICK=/a.txt:/b.png` answers the picker without a native dialog; on a real session in milestone 3 the agent described the PNG and summarised the text file (`real:`).

**Acceptance Scenarios**:

1. **Given** a text file and a PNG picked, **When** I send, **Then** the SDK receives a `file` attachment (display name) and a base64 `blob` (`image/png`) and both show as chips in my message. *(real: m3)*
2. **Given** a chip, **When** I press its x, **Then** it is removed before sending.

---

### User Story 2 - Drag and drop, paste images (Priority: P2)

I can drop files anywhere on the chat (an overlay says "Drop to attach") and paste images into the message box.

**Acceptance Scenarios**:

1. **Given** files dragged over the chat, **When** hovering, **Then** the overlay "Drop to attach - Up to 5 files, 10 MB each. Images: PNG, JPEG, GIF, WebP, BMP." shows. *(sim: m5 screenshot)*
2. **Given** an image on the clipboard and no text, **When** I paste, **Then** it attaches and nothing is pasted; with text too, it attaches and the text still pastes. *(sim: e2e driver m5)*
3. **Given** a file dropped outside the chat, **When** dropped, **Then** the window does not navigate away. *(read:)*

---

### User Story 3 - Clear limits (Priority: P1)

At most 5 files per message and 10 MB per file; I get a plain message saying what was not attached, which stays until my next action.

**Acceptance Scenarios**:

1. **Given** an 11 MB file, **When** attached, **Then** `"big.mov" is 11 MB, over the 10 MB per-file limit. Not attached.` shows. *(test: + sim:)*
2. **Given** 7 files, **When** attached, **Then** the first 5 attach and `Up to 5 files per message. Not attached: "d.png", "e.png".` shows (3 names, then "and N more"). *(sim:)*
3. **Given** exactly 10 MB, **When** attached, **Then** it is allowed. *(test:)*

---

### Edge Cases

- A pasted/dropped "image" that is not a PNG/JPEG/GIF/WebP/BMP (e.g. SVG, HTML renamed `.png`) is rejected. `[IMPLEMENTED]` test:
- Names with `../`, backslashes, control characters or leading dots are reduced to a safe file name; the extension of images follows the real format. `[IMPLEMENTED]` test:
- Empty pasted/dropped file: rejected "The file is empty." `[IMPLEMENTED]` test:
- Only files returned by the main-process picker or staged by the main process can be sent (the main process whitelists paths); anything else in an IPC `send` is dropped silently. `[IMPLEMENTED]` read:
- Count and size are checked again in the main process on send, so the UI cap is not the only gate. `[IMPLEMENTED]` read:
- A picked file deleted between pick and send: "<name> is no longer available." `[IMPLEMENTED]` read:
- Attaching in a demo/simulated agent never touches the disk. `[IMPLEMENTED]` sim:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` test: Caps: 10 MB per file, 5 files per message (`MAX_ATTACH_BYTES`, `MAX_ATTACH_FILES`), enforced in the renderer (fast feedback), in `stageAttachment` (size) and in `agents:send` (count and size).
- **FR-002** `[IMPLEMENTED]` test: Image type is decided by **magic bytes** (PNG, JPEG, GIF, WebP, BMP); the declared MIME/extension is not trusted; SVG is never accepted as an image.
- **FR-003** `[IMPLEMENTED]` test: Staged files go into a private temp folder (`agent-durbar-att-*`, dir mode 0700, files 0600), one sub-folder per file, with a sanitized name (NFKC, no path parts, no control or `<>:"|?*`, no leading dots, <= 80 chars).
- **FR-004** `[IMPLEMENTED]` read: The staging folder is deleted on app quit (`will-quit`).
- **FR-005** `[IMPLEMENTED]` real: Images are sent as base64 `blob` attachments with MIME type and display name; other files as `file` attachments (the runtime reads them from disk).
- **FR-006** `[IMPLEMENTED]` read: The renderer never sees a file system path for dropped/pasted files; it hands bytes to the main process (`stageAttachment`) and gets back a staged path to show.
- **FR-007** `[IMPLEMENTED]` sim: Chips show name, kind icon, size tooltip and a `n/5` counter; messages keep the chips after sending (also in replayed history, feature 006).
- **FR-008** `[IMPLEMENTED]` read: Dropped non-image files are copied to the staging folder like images (not referenced in place).
- **FR-009** `[IMPLEMENTED]` (Closed 2026-10-19: a picked file is an image only when its first bytes say so (`kindOfFile`, the same `sniffImage` as pasted files); main checks it again when sending and does not trust the kind the renderer sends.) Was: Files picked through the native dialog are **not** magic-byte checked; an `image` chip is decided by file extension, and the bytes are base64'd as-is up to 10 MB. Low risk (the user chose the file) but inconsistent with FR-002. `read:` (Task T020.)
- **FR-010** `[IMPLEMENTED]` (Closed 2026-10-19: at start, `agent-durbar-att-*` folders in the temp folder that are older than a day are removed (folders only, never a link).) Was: The staging folder is removed only on a clean quit; a crash leaves 0600 files in the OS temp folder. `read:` (Task T021.)
- **FR-011** `[KNOWN GAP]` Picked files are read **in place** when sent (text files are handed to the runtime by path); a file that changes between pick and send is sent as it is then. `read:`
- **FR-012** `[IMPLEMENTED]` (Closed 2026-10-19: empty (or unreadable) picked files are left out.) Was: A zero-byte file chosen in the native dialog is accepted (only pasted/dropped empty files are rejected). `read:`
- **FR-013** `[IMPLEMENTED]` (Closed 2026-10-19: the image button opens the picker with an image filter (PNG, JPEG, GIF, WebP, BMP).) Was: The file and image buttons open the same dialog (no image filter or type hint). `read:`
- **FR-014** `[KNOWN GAP]` Total attachment size per message is not capped (5 x 10 MB). `read:`
- **FR-015** `[IMPLEMENTED]` (Closed 2026-10-19: files are removed from the allow-list after a successful send (pick again to send again).) Was: The `pickedFiles` allow-list in the main process grows for the whole run (no removal after send). `read:`
- **FR-016** `[KNOWN GAP]` Drag-and-drop and paste were exercised through the real Electron main process by the e2e driver on Linux (xvfb); macOS/Windows clipboard and drag behavior are untested. `sim:`

### Key Entities

- **PickedFile**: `path`, `name`, `kind` (`file|image`), `size`.
- **StageResult**: ok with staged file, or an error text.

## Success Criteria *(mandatory)*

- **SC-001**: No attachment over 10 MB or beyond 5 per message reaches the runtime (test: + read:).
- **SC-002**: A pasted/dropped non-image can never be sent as an image, and a name can never escape the staging folder (test:).

## Assumptions

- The runtime accepts `file` and base64 `blob` attachments and the model on the account supports images (it did on the free-plan `auto` model in m3).

## Changes


### 2026-10-19: attachment gaps closed (sweep)

FR-009, FR-010, FR-012, FR-013 and FR-015 are closed (texts above; tasks T020, T021, T022, T024). `test:` `test:attachments` (kind from bytes, the sweep of stale folders). The size cap per message (FR-014, T023) still needs a number from the owner.

