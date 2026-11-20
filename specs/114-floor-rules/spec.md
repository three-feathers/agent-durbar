# Feature Specification: Floor and general rules

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Floor and general rules (issue #1959, owner 2026-11-20): one plain-text instruction for the whole office and one per floor, edited in Settings and the Floors panel, sent framed in front of the first typed message of each session, the same way for Copilot, Claude Code and Codex; masked, shown before and after sending, carried by the setup export
status: draft
note: spec only (no plan or tasks yet); Q1..Q8 carry proposed defaults; nothing built
-->

**Feature Branch**: `114-floor-rules` (spec first; plan and tasks follow after the open questions are answered).
**Created**: 2026-11-20
**Status**: Draft. Nothing built. Q1..Q8 (*Clarifications*) carry the analyst's recommendation, not yet decided.
**Issue**: #1959 (rubenlupi).
**Input**: Owner request (Ruben, 2026-11-20, in Spanish, translated): "a harness for all of Durbar, e.g. how it manages messages with teams, so it is always the same ... I'd do it per floor: each floor can have its own harness, so floors make more sense, and then there is also a general harness." The coordinator proposed, and the owner accepted, the word **rules** instead of "harness", because in Durbar "harness" already means the agent app (spec 051, `src/main/harnesssetup.ts:1-5`). Issue #1959 records the scope: general rules, floor rules, the order general, floor, role brief, the same path and masking as spec 111 FR-036, plain text, saved with the setup export (spec 109). **Out of scope**: a message flow between team members (who hands work to whom), issue #569.

## Summary

Today every agent starts with only what its app loads by itself (the folder's own instruction files, spec 061) and what the person types. This spec adds two texts that Durbar owns and sends to every agent the same way, whatever its app:

1. **General rules**: one text for the whole office.
2. **Floor rules**: one text per floor, so a floor (spec 033) can mean a way of working ("Client A: answer in English, never push"), not only a group of folders.

An agent receives them **once per session**, framed, in front of the person's first typed message, in the order fixed by spec 116 Q10: general rules, floor rules, memory note (spec 116), role brief (spec 111). The rules are plain text, masked, shown before they are sent and visible after ("Rules sent"). They are instructions to the model only: they never change Durbar's permission mode, limits, tools or grants.

## Context: what exists today (spec 021 FR-031, reuse first)

- **Floors** (spec 033, spec 092): `FloorsDoc` `{ floors: [{ id, name, on }], lastFloor }` and pure ops in `src/shared/floors.ts:14-33` (`MAX_FLOORS` 40, `:11`); kept in `durbar-folders.json` by `FolderStore` (`src/main/main.ts:1150`, write at `src/main/folders.ts:743-749`, 0600, temp and rename); a folder's floor is `SavedFolder.floor`, read by `floorOfFolder` (`folders.ts:391`) and given to the window as `AgentInfo.floor` (`src/shared/api.ts:80`). IPC `floors:*` in `src/main/ipc/floors.ts:32-48`. **Spec 033 FR-015** says saved floor data holds "names, order, on/off state and folder paths ... no tokens, prompts, chat content or other secrets" (`specs/033-floors/spec.md:150`), so rule text does **not** fit in that file without changing 033 (Q1).
- **Floors UI**: one markup for the top-bar panel and Settings, `floorsBodyHTML(px)` (`src/renderer/app.js:6222`), painted by `renderFloorsPanel` (`app.js:6249`) and `renderFloorsSettings` (`app.js:6254`) into `#floorsPop` (`src/renderer/index.html:115`) and `#floorsSet` (Settings section, `src/renderer/screens.js:436-440`); every change goes through `floorCall` (`app.js:6259`). Each floor row already holds six controls (switch, Focus, Up, Down, Rename, Delete).
- **Settings screen**: `paintSettings` (`screens.js:366`), one `<section class="scr-sec">` with an `<h3>` per feature; the section list (`settingsnav.js`, spec 052 FR-226) and Settings search (spec 112) are built from those headings, so a new section is listed and searchable without extra code. App settings: `AppSettings` (`src/shared/credits.ts:77`), `SettingsStore` (`src/main/settings.ts`, write at `:493`, 0600, temp and rename).
- **Text sent in front of the first message, designed, not built**: spec 111 FR-036 (`specs/111-team-templates/spec.md:128-135`): a framed block with a random nonce drawn in main, built by one function and masked with `maskOutgoing`, preview byte-equal to what is sent, after `sendWithSlash`'s expansion, once per session id, never on scheduled, Autopilot, handover or remote sends, a *Role brief sent* line above the bubble. Task 111 T013 (`specs/111-team-templates/tasks.md:31`), open. Spec 116 (branch `origin/116-durbar-brain`, not merged) Q10 **decided (a)**: one framed chain, built by one function in main, in the order general rules, floor rules, memory note, role brief, each once per session id; its plan names the shared builder `firstMessageChain(parts)`, built by whichever of 116 T009 and 111 T013 starts first.
- **Text checks already built for the role brief** (spec 111 T004, `src/shared/teamtemplate.ts`): `LIMITS.ownBrief` 4,000 characters and 80 lines, `importedBrief` 2,000 and 40 (`:35-37`); `hiddenError` (hidden characters with the ZWJ/ZWNJ exception, `:86`); `frameCheck` and `frameError` (the best-effort frame guard, `:141`, `:231`); `tooLong` (`:274`). Today they are module-private except `frameCheck` and `LIMITS`; the plan decides how to share them (no copy).
- **Masking**: `maskOutgoing` (`src/shared/redact.ts:3389`; `changed` tells that something was masked, spec 084 FR-033 uses it to block a send and offer *Use the masked text*), `maskTokenShapes` (`:639`), `cut` (`:682`), `HIDDEN_CHARS` (`:2332`).
- **Send paths** (`src/main/main.ts`, `src/main/agentops.ts`): the person's send `sendOp` (`main.ts:604`) -> `ensureLive` -> `sendWithSlash` (`agentops.ts:203-213`) -> `AgentAdapter.send` (`src/adapters/types.ts:699`). Paths that must never carry rules: `scheduledSendOp` (`agentops.ts:314`, called at `main.ts:674`), `mcpNudgeOp` (`agentops.ts:289`, an automatic message), Autopilot continuations (spec 099), the *Continue in another app* summary (spec 030 FR-042), remote sends from the vendor's app (spec 054).
- **Per-session records in the folder store**: `sessionNames`, `sessionModes` on `SavedFolder` (`folders.ts:48,53`), `modeForSession` (`folders.ts:150`): the pattern for a per-session-id "rules sent" record.
- **A chat note after a send**: the slash-expansion note (`app.js:8013`, `addNote`) is the existing way to put a Durbar line in the chat next to a sent message.
- **Dialogs**: `DurbarDialog` (`src/renderer/dialog.js`), the larger editors `teameditor.js` and `profileeditor.js` (spec 043) as patterns for a text editor dialog.
- **Setup export** (spec 109, specified, **not built**): sections `settings`, `display`, `floors`, `folders`, ... (`specs/109-setup-export-import/spec.md:129`); floors export `id`, `name`, `on` (109 FR-014); a test fails when `AppSettings` gains an unclassified key (109 FR-013); free text masked twice (109 FR-021).
- **Name clash to avoid**: "folder rules" already means a folder's own permission rules (spec 061; `app.js:8295`, 109's `folderRules` section). The UI must not let "floor rules" read as permissions (FR-012, Q6).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - General rules for every agent (Priority: P1)

Ana wants every agent, whatever its app, to answer in Spanish and to ask before deleting files. She opens Settings > *General rules*, writes two lines, and saves. The next chat she starts on any floor sends them in front of her first message.

**Why this priority**: the general text alone already gives the "always the same" behaviour the owner asked for.

**Independent Test**: simulator: write general rules, open a new agent, type a message; the composer shows "Sent with your next message: general rules" with the exact text; after sending, a *Rules sent* line sits above the bubble and opens the same text; the fake adapter received the framed chain followed by the typed text.

**Acceptance Scenarios**:

1. **Given** general rules are saved, **When** Ana types the first message of a new session, **Then** the composer showed the framed text before sending, and the agent gets it once, in front of her text.
2. **Given** that session got the rules, **When** she sends a second message, **Then** nothing is added.
3. **Given** a scheduled prompt is the first message of a session, **When** it runs, **Then** it carries no rules; the rules wait for the first typed message.
4. **Given** she types a token in the rules, **When** she saves, **Then** the save is held, the editor shows the masked text and *Use the masked text*, and nothing unmasked is stored.

### User Story 2 - Floor rules (Priority: P1)

Ana has a floor *Client A* and a floor *Personal*. On *Client A* agents must write in English and never run `git push`. In the Floors panel she presses *Rules…* on *Client A*, writes it, saves. Agents in *Client A* folders get general rules then *Client A*'s rules; agents on *Personal* get only the general rules.

**Why this priority**: it is what makes floors "mean a way of working" (the owner's words).

**Independent Test**: simulator with three floors: the composer preview of an agent on each floor lists the right parts in the right order; the floor row says "Rules: set" in words.

**Acceptance Scenarios**:

1. **Given** rules on *Client A*, **When** an agent there sends its first message, **Then** the chain holds general rules, then "Floor rules: Client A".
2. **Given** a floor with no rules, **When** its agent sends, **Then** the floor part is left out (no empty frame).
3. **Given** Ana deletes *Client A*, **When** she confirms, **Then** the confirmation said "Its rules are deleted too" and the rules are gone; its folders go to the Ground floor (033 FR-004) and get that floor's rules from their next new session.

### User Story 3 - Rules changed while chats are running (Priority: P2)

Ana edits *Client A*'s rules while three chats there are running. Nothing is sent by itself. Each of those chats shows a quiet note "The rules changed since this chat got them" with *Add the updated rules to my next message*. A chat that has not sent its first message yet simply gets the new text (Q2).

**Independent Test**: simulator: change rules with one started and one not-started session on the floor; no adapter `send` happens; the started one shows the note; the action adds an "Updated rules" frame in front of the next typed message only.

### User Story 4 - Move a folder to another floor (Priority: P2)

Ana moves a folder from *Personal* to *Client A* (033 FR-005, FR-024). Its not-started sessions will get *Client A*'s rules; its started sessions show the same note as US3, naming the new floor.

### User Story 5 - Take the rules to another computer (Priority: P3)

Ana exports her setup (spec 109). The file holds her general and floor rules, masked. On the other computer the import preview shows each rule text in full; imported rules arrive **not sent** until she turns them on (Q4).

### Edge Cases

- One floor only (no top-bar Floors button, 033 FR-007): floor rules of the Ground floor are edited in Settings > Floors (Q7).
- A floor that is off: its agents keep running (033 FR-009) and still get its rules in new sessions; switching a floor off or on sends nothing.
- A floor is deleted while the app is closed or the rules file names a floor id that no longer exists: the orphan text is dropped at load, said once in Settings.
- The rules file is damaged or missing: no rules (nothing sent), a notice in Settings, the file is set aside (the pattern of 111's `setAside`), never an error that blocks the app.
- The first typed message is a slash command that goes as typed (a built-in, or an expansion over the cap): no chain; it waits for the next message (111 FR-036).
- Rules saved between the composer preview and *Send*: the send uses only what was shown; if the rules changed, the preview is rebuilt with a new nonce and the person sends again (FR-024).
- A helper (sub-agent) runs inside its parent's session: it gets nothing separately.
- A team member (spec 111) on a floor: chain = general, floor, memory note (116), role brief, one frame and one *Rules sent* line (Q8).
- A session resumed after a restart that already got the rules: not sent again (FR-025).
- Rules text that looks like a frame marker (`[End of rules]`, `<system>`): refused at save by the frame guard, with the line and reason, never the text (FR-004).
- An agent app that rejects or truncates a long first message: the send fails as any send does; the record is written only after a successful send (FR-025).

## Requirements *(mandatory)*

### Functional Requirements

#### A. The texts and their store

- **FR-001** **General rules**: one optional plain-text field for the whole office. Empty means none.
- **FR-002** **Floor rules**: one optional plain-text field per floor, the Ground floor included, keyed by floor id. Deleting a floor deletes its rules; 033 FR-004's confirmation adds "Its rules are deleted too." when it has some. Renaming or reordering keeps them.
- **FR-003** **Limits** (Q3): each text at most **4,000 characters and 80 lines** when the person writes it, **2,000 and 40** while it is marked as imported (FR-061); the same numbers as spec 111 `LIMITS` (`src/shared/teamtemplate.ts:35-37`), read from one place, not copied. The editor shows a live count ("1,240 of 4,000 characters, 12 of 80 lines") in words.
- **FR-004** **Plain text, the role brief's text rules** (111 FR-012): LF line ends (CRLF and CR normalised); no control characters except LF and TAB; any `HIDDEN_CHARS` character refused, with 111's ZWJ/ZWNJ exception; the best-effort frame guard (`frameCheck`, `teamtemplate.ts:141`) on the text as written and on the masked text; the error names the line and the reason, never the text. Shown with `textContent` only, never rendered as HTML or Markdown. The checks are shared with spec 111 (one module), not copied.
- **FR-005** **Masked on save, preview and send** with one function, `maskOutgoing` (`redact.ts:3389`). On save, when `changed` is true the save is held: the editor shows the masked text with *Use the masked text* (spec 084 FR-033's pattern) and stores only masked text. The preview and the send mask again with the same function, so what the person sees is what the agent gets.
- **FR-006** **Store** (Q1, recommended a): a separate file `durbar-rules.json` in the app's user data folder, owned by one `RulesStore` in main: `{ version: 1, general: { text, from? }, floors: [{ floor: <floor id>, text, from? }] }`; written 0600 with temp and rename (the pattern of `settings.ts:493` and `folders.ts:743-749`); parsed tolerantly with a size cap (`readCapped`); entries for unknown floor ids dropped at load. `durbar-folders.json` and `AppSettings` are **unchanged**, so 033 FR-015 stays true and 109 FR-013's key classification is not touched.
- **FR-007** **IPC**: `rules:get` (both texts, with marks and counts) and `rules:put(scope, text)` where `scope` is `general` or a floor id, through `ipcHandle` (`src/main/ipcguard.ts`, `fromAppFrame`, the simulator guard); main re-runs FR-003..FR-005 and refuses an unknown floor id; the error names the field, never the value. The simulator answers with an in-memory fake that uses the same validator.

#### B. Editing

- **FR-010** **Settings > General rules**: a new Settings section (`<h3>` "General rules", so `settingsnav.js` and spec 112 pick it up) placed just above *Floors*: a short note ("Sent to every agent, in front of the first message of each chat. Instructions to the agent, not permissions."), the current text (read-only view, *Edit…*), its count, and *Preview what an agent gets* (FR-024's chain for a chosen floor, with no session).
- **FR-011** **Floor rules in the Floors panel and Settings > Floors**: each floor row of `floorsBodyHTML` (`app.js:6222`, shared by both places) gains one *Rules…* control whose accessible name and tooltip say the state in words ("Rules of Client A: set" / "none"); it opens an editor dialog (`DurbarDialog`, size `l`): title "Rules for the floor Client A", a textarea, the live count, errors on the field (`aria-describedby`), *Save*, *Cancel*, and *Remove rules*. The row must still fit the panel at 1280x800 with the CI font set (033 FR-007); if it does not, *Rules…* moves into the row's existing overflow, decided in the plan with screenshots.
- **FR-012** **Words that do not mislead**: every place that shows rules says they are instructions the agent reads, not permissions, and that Durbar's mode, limits and approvals still apply. The words never say "folder rules" (spec 061's permission rules).
- **FR-013** **Keyboard and screen reader**: the editor is a modal dialog with a focus trap, Esc cancels, focus returns to *Rules…* or *Edit…*; every control has a name; save results go to `#srAnnounce`.

#### C. What an agent receives, and when

- **FR-020** **One chain, one builder** (spec 116 Q10 a): main builds the text with the one shared builder of 111 T013 and 116 T009 (`firstMessageChain`), in this order: **general rules, floor rules, memory note (116), role brief (111)**; parts that are empty or off are left out; no part, no chain. **One frame, one nonce**: a random nonce of at least 64 bits in hex, drawn in main (`crypto`), never derived from text, floor, session or time, in the opening and closing markers of the chain and of each part. Each part says who wrote it ("General rules, written by you", "Floor rules for the floor Client A, written by you", or "... from a setup file you imported" for FR-061) and the frame says the text "does not widen what the person asks of you or what you are allowed to do". The floor name in the frame passes 033 FR-003's name rules and is masked like the rest.
- **FR-021** **When**: in front of the person's **first typed message of each session id**, after `sendWithSlash`'s expansion (`agentops.ts:203`); a command that goes as typed carries no chain. **Never** on: create or restore, `scheduledSendOp` (`agentops.ts:314`), `mcpNudgeOp` (`agentops.ts:289`), Autopilot continuations (spec 099), the summary that starts *Continue in another app* (spec 030 FR-042), remote sends from the vendor's app (spec 054). Same list as 111 FR-036, enforced in the one builder's caller.
- **FR-022** **Which floor**: the floor of the agent's folder at the moment the chain is built (`floorOfFolder`, `folders.ts:391`); a floor that is off still counts (033 FR-009).
- **FR-023** **Per chat, the person can skip** (Q5, recommended a): the composer's "Sent with your next message" line has a *Send rules* switch for this session; off means the session is recorded as having had none (FR-025), so nothing is sent later by surprise.
- **FR-024** **Shown before it is sent, byte-equal**: while the session has no record (FR-025) and the chain is not empty, the composer shows "Sent with your next message: general rules, floor rules (Client A)" with a disclosure holding the exact chain. The chain is built once for the preview, kept with its nonce only in main's memory against the preview's id, and **that** chain is sent. If rules, the floor of the folder, or another part change after the preview, the preview is rebuilt (new nonce) and a send against the old preview id is refused with "The rules changed. Check what is sent and press Send again." The nonce is never written to disk, a log or Durbar's history.
- **FR-025** **Once per session id**: after a successful send, main records against the session id, on the folder entry (beside `sessionModes`, `folders.ts:53`), which parts went and a short digest of each part's masked text (never the text, never the nonce). A restored session that resumes the same id sends nothing again; a new session (End, *+ New session*) has a new id and gets the chain once. The record is not exported (109 FR-019's not-exported list gains it; FR-090).
- **FR-026** **Rules changed while a chat runs** (Q2, recommended b): nothing is sent by itself. A session whose recorded digest differs from today's text (its floor's or the general one) shows one quiet chat note "The rules changed since this chat got them" with *Add the updated rules to my next message*; choosing it puts an "Updated rules" chain (same builder, same frame, same preview rule) in front of the next typed message only, then updates the record. Sessions not yet sent simply get the current text.
- **FR-027** **A folder moved to another floor** (033 FR-005, FR-024): the same as FR-026, the note naming the new floor ("This chat got the rules of Personal; its folder is now on Client A"). Not-started sessions get the new floor's rules.
- **FR-028** **Switching a floor off or on, Only, reordering** send nothing and change no record.

#### D. Every agent app the same way

- **FR-030** **Neutral path only**: the chain is message text given to `AgentAdapter.send` (`src/adapters/types.ts:699`) like the person's own text; no adapter change, no vendor type or event name outside `src/adapters`, no per-app system prompt option, no instruction file written into a folder (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` stay the person's own). A test checks the rules modules import nothing from `src/adapters` (constitution II).
- **FR-031** **The folder's own instruction files** are loaded by each app as today (spec 061); rules do not replace, read or merge them. When they disagree, the model decides. `[KNOWN GAP]`, said in the Settings note's *More*.

#### E. Safety

- **FR-040** **Rules are data** (constitution III): saving, importing or sending rules never changes a permission mode, limit, grant, tool, MCP server, hook, schedule or Autopilot; Durbar never parses rules for commands. Test: a rules save and send call no `setModeOp`, `setCapOp` or `setMcpOp` (mutant: a rule line "mode: allow" honoured).
- **FR-041** **Never logged**: rule text and the chain are not written to `DURBAR_LOG`, the activity log, diagnostics or crash text; errors name the field, never the value.
- **FR-042** `[KNOWN GAP]` **Residual risk** (as 111 FR-153): rules reach the agent as part of the person's own message, the strongest instruction it gets; Durbar frames, masks and shows them, but cannot tell a harmful rule from a good one, and Read-only still lets an agent read approved files, call read-only-marked MCP tools and act through the folder's own allow rules and hooks.

#### F. Visibility

- **FR-050** **Rules sent** (Q8, recommended a): the person's first bubble shows their own text, with one line above it, "Sent first: general rules, floor rules (Client A)" (plus "memory note", "role brief" when present: one line for the whole chain, shared with 111's *Role brief sent* and 116's *Memory note sent*), that opens the exact chain in a read-only dialog (`textContent`). "Updated rules sent" for FR-026.
- **FR-051** `[KNOWN GAP]` The vendor's own history (resume, *Previous sessions*, VS Code) holds the chain as part of that first user message, and a title the app derives from it may show rule words (as 111 FR-157). How Durbar's history view shows a resumed first message is decided with 111 T013 in the plan.

#### G. Export and import (spec 109)

- **FR-060** **Exported with the setup**: spec 109 gains an optional `rules` section `{ general, floors: [{ floor, text }] }`, floor ids being the exported ids of 109 FR-014, as an array (109 FR-024: user text is never a JSON key); each text masked twice (109 FR-021). Not exported: FR-025's per-session records. This is a dependency for 109's owner, written as a dated delta in 109's *Changes* by whichever of the two is built second (as 111 FR-141).
- **FR-061** **Imported rules are untrusted** (Q4, recommended a): read by the same validator at the imported level (2,000 characters and 40 lines, every check of FR-004, `HIDDEN_CHARS` with no exception shown escaped), shown **in full** in 109's preview with "These rules were written by whoever made the file. Agents read them as your instructions."; accepted ones land **marked imported and not sent**: the editor and the row say "From a file: not sent", and turning *Send* on is the person's explicit consent; editing the text removes the mark. A rule for a floor the import does not create is dropped and listed.
- **FR-062** A separate "rules file" export is **out of scope**: rules travel only in the setup file.

#### H. Worlds, platforms, simulator

- **FR-070** **Calm UI**: the editor, the Settings section, the composer line and the *Rules sent* line take tokens only in Open office, Real office and Retro arcade; text at least 10.5 px; state in words, not colour; the office layout does not change (the 15-agent check of `check:office` is unchanged); the Floors panel row fits at 1440x900 and 1280x800 (FR-011).
- **FR-071** **Windows, macOS, Linux**: no path stored; LF written, CRLF read and normalised; 0600 on POSIX, the folder's permissions on Windows (`[KNOWN GAP]`, as 111 FR-155); pure tests on the three CI runners.
- **FR-072** **Simulator**: `DURBAR_SIM` has a fake rules store seeded with general rules and rules on one of its floors, so the preview, the *Rules sent* line, US3 and US4 run with zero AI credits; a driver captures them at both sizes in each world.

#### I. Honest limits

- **FR-080** `[KNOWN GAP]` `real:` that a framed rules chain steers a real agent in Copilot, Claude Code and Codex is not verified; one tiny read-only prompt per app (three in total) after the owner's OK, recorded here with the usage each app reports.
- **FR-081** `[KNOWN GAP]` Cost: the chain adds input tokens to one message per session (two 4,000-character texts are about 2,000 tokens), which costs money where the app bills tokens (Claude Code, Codex); on Copilot it adds no request (as 111 Q1).
- **FR-082** `[KNOWN GAP]` Masking catches known token shapes only; host names, client names and paths written in rules are sent and exported as written; the editor's note says so. Fixtures use only `example.invalid` and fictional names ("Client A").
- **FR-083** `[KNOWN GAP]` Rules are not enforcement: a model may ignore them, and a long session may drift from them; Durbar does not resend on its own.

#### J. Other specs this one touches (each gets a dated pointer in its own *Changes*, in the build PR)

- **FR-090** Spec 033 (FR-004's confirmation sentence; FR-015 stays true because rules live in their own file), spec 109 (FR-060, FR-061, the not-exported list of FR-025), spec 111 (FR-036: the chain holds rules first; the shared builder and the one *Sent first* line), spec 116 (Q10's "where spec 114 decides": Durbar's own store, FR-006), spec 112 (nothing: the new heading is found by the existing index).

### Key Entities

- **General rules**: text, `from` (`own` or `file`), *Send* (on unless imported). App level.
- **Floor rules**: floor id, text, `from`, *Send*. One per floor at most; removed with its floor.
- **Rules store**: the file holding both, owned by main.
- **First-message chain**: the framed text built per session from general rules, floor rules, memory note and role brief, with one nonce; lives only in main's memory until sent.
- **Rules-sent record**: per session id on the folder entry: which parts went and a digest of each; never the text; never exported.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the simulator, writing general rules and floor rules takes at most 3 actions each, and the next first message of an agent on that floor carries both in order (driver, fake adapter's received text).
- **SC-002**: The composer preview equals the sent chain byte for byte in every test case; two previews give different nonces.
- **SC-003**: Zero chains reach `AgentAdapter.send` on scheduled, nudge, Autopilot, handover, remote or create paths (test per path, mutants).
- **SC-004**: A saved, previewed, sent or exported rule text never holds an unmasked token from the fixture set; no rule text appears in any log fixture.
- **SC-005**: Changing rules or moving a folder causes zero adapter sends.
- **SC-006**: The Floors panel and Settings fit at 1440x900 and 1280x800 in all three worlds; text at least 10.5 px; `check:office` unchanged.
- **SC-007**: Zero AI credits in every test and driver; `npm test` green on Linux, macOS and Windows CI.

## Assumptions

- The shared builder (`firstMessageChain`) is built by 111 T013 or 116 T009 before this spec's send task, or this spec's send task builds it and records it in both specs' *Changes* (the rule of 116's plan).
- A framed block in a message needs no adapter change (it is message text), as 111 assumes.
- Spec 109 may land before or after this one (FR-060).

## Clarifications

Proposed by the analyst on 2026-11-20 for the coordinator and the owner; none decided yet.

- **Q1 Where the text is stored.** (a) **recommended**: its own file `durbar-rules.json`, one store for both kinds (FR-006): keeps 033 FR-015 and 109 FR-013 as they are, one validator, one export section; (b) general rules in `AppSettings`, floor rules on each floor record in `durbar-folders.json`: fewer files, but changes 033 FR-015 ("no prompts") and puts up to 160 KB of text in a file written on every floor or folder change; (c) files in spec 116's memory folder (`rules/general.md`, `rules/floors/<floor>.md`): edited in any editor, but the memory folder is optional, Durbar must not write what the person wrote there (116 US5), and a file anyone (an agent included) can edit becomes instructions with no preview at save; a later spec could add a read-only *Load from a file* instead.
- **Q2 Running sessions when rules change, and a folder moved to another floor.** (a) only new sessions get the new text, nothing shown; (b) **recommended**: (a) plus a quiet chat note with *Add the updated rules to my next message* (FR-026, FR-027): no extra request, the person decides; (c) automatic resend in front of the next typed message of every running session: surprising, costs tokens in every chat; (d) a *Send updated rules* action that sends now as its own message: one more turn (a premium request on Copilot).
- **Q3 Limits.** (a) **recommended**: 4,000 characters and 80 lines each, 2,000 and 40 when imported (111's numbers; FR-003); (b) 2,000 and 40 each, always; (c) (a) plus a total cap on the whole chain.
- **Q4 Imported rules.** (a) **recommended**: shown in full, land marked imported and not sent until the person turns *Send* on (FR-061, as 111's imported briefs); (b) ticking them in 109's preview counts as consent, sent at once; (c) rules are never imported.
- **Q5 Skip rules for one chat.** (a) **recommended**: a *Send rules* switch on the composer's preview line, per session (FR-023); (b) no switch: rules always go when set.
- **Q6 Names in the UI.** (a) **recommended**: "General rules" and "Floor rules" (the issue's words), with "instructions, not permissions" next to them (FR-012); (b) "Office rules" and "Floor rules"; either way never "folder rules" (spec 061's permission rules).
- **Q7 One floor only.** (a) **recommended**: the Ground floor's *Rules…* is shown in Settings > Floors only (there is no top-bar panel with one floor); (b) floor rules hidden until a second floor exists (general rules cover it).
- **Q8 The line in the chat.** (a) **recommended**: one *Sent first* line for the whole chain (general, floor, memory note, role brief), opening the exact text; changes 111 FR-036's *Role brief sent* and 116 FR-022's *Memory note sent* into parts of that line; (b) one line per part.

## Changes

### 2026-11-20: first draft (analyst, for issue #1959)

Spec only. FR, task and question numbers are new to this spec; `npm run specs:numbers` run before the push. Nothing in `src/` changes until the plan and tasks are committed.
