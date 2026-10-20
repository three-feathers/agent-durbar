# Feature Specification: Send one message to several sessions

**Feature Branch**: `064-send-to-several`
**Created**: 2026-10-21
**Status**: Built (simulator, unit tests).
**Input**: Overnight owner request (2026-10-20), "natural evolution … without making the app messy". Research (`evolution.md` idea 2): with 5-15 agents in the office, the same instruction often goes to many of them ("pull main and run the tests again", "stop and summarise where you are"), and today that means opening each chat and typing it again.

## User Scenarios

### Story 1 - One message, chosen sessions (P1)
From **Ctrl+K** ("Send to several sessions…") or the top bar's **⋯** menu, a dialog opens:
- a message box;
- the running sessions, each with a checkbox showing its name, folder, agent app and mode. None are ticked at the start.

**Send to N** stays disabled until there is a message and at least one session is ticked. Each ticked session receives the message as if it had been typed in its own chat. A toast says how many got it; nothing jumps or opens.

### Story 2 - Busy sessions are left alone (P1)
A session that is working, thinking or waiting for you cannot be ticked; its line says why ("busy", "waits for you"). A session that is ended, signed out or at its spending limit is not listed as sendable.

## Requirements

- **FR-001** Entry points: a palette action, "Send to several sessions…", shown only when at least two running main sessions are idle; and the same item in the top bar's ⋯ menu. No new always-visible button.
- **FR-002** The dialog is the shared `askDialog`, extended with:
  - `input.multiline` (a textarea);
  - `picks: [{ label, note, value, checked, disabled }]` (a checkbox list; the result has `picked`);
  - `need: { text: true, picks: 1 }`, which keeps the primary button disabled until both are met.

  The extension is generic and unit-tested; existing callers are unchanged.
- **FR-003** Sending reuses each session's own send path (`sendLive`, with an option that leaves the open chat's composer and attachments alone). Each message goes with that session's own agent app, mode, model and spending limit (spec 011 still applies). Nothing about permissions widens. The message is at most 4,000 characters.
- **FR-004** The sends go one after another (each awaited, as typing them would be). A failure in one does not stop the others. The toast says "Sent to N sessions" or names the ones that failed.
- **FR-005** The primary button says the count ("Send to 3 sessions"), so the spend is visible before it happens.
- **FR-006** Simulator: works with `DURBAR_SIM=15` (the simulated sessions answer as usual).

## Out of scope
Attachments in the group message; scheduling a group message (spec 044 already schedules per folder or session); sending to sub-agents.
