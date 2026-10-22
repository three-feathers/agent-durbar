# Feature Specification: Profiles (personal and work, kept apart)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Profiles: separate offices per profile (Phase 1), then separate sign-ins through each harness's own home folder (`COPILOT_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`), never a token in Durbar (issue #131)
status: **draft for the owner's review**; Phase 2 needs research R1
-->

**Feature Branch**: `049-profiles`
**Created**: 2026-10-19
**Status**: Draft for the owner's review. No code until the owner answers the open questions below.
**Input**: Issue #131 (idea from @fjcabello, "Multiple Profiles"). The owner asked for a spec on 2026-10-19.

## Summary

Many people use two identities on one machine: a **personal** account with personal folders and a **work** account with corporate folders and policies. A **profile** (for example *Personal* and *Work*) keeps its own:
- folders, floors, settings, MCP extras, usage totals and tool counts;
- **sign-ins** for each harness.

A selector always shows the active profile.

**The key idea, which keeps constitution III intact:**
- Durbar never handles a token.
- Each harness already reads its sign-in and config from a home folder that an environment variable can move:
  - Copilot: `COPILOT_HOME` (the SDK's `baseDirectory`);
  - Claude Code: `CLAUDE_CONFIG_DIR`;
  - Codex: `CODEX_HOME`.
- A profile is a set of those folders. Durbar starts each harness with its profile's folders, and the user signs in once per profile with the vendor's own login command, run with the same variable.

Whether each vendor stores credentials in that folder or in a shared OS keychain entry has to be **verified per OS** (research R1). Phase 2 depends on the answer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Two offices on one machine, same sign-ins (Priority: P1, Phase 1)

I create a profile *Work* (Settings > Profiles > New), and the app restarts into it with an empty office. I add my work folders there. I switch back to *Personal*: the app restarts, and my personal folders, floors, caps and usage totals are as I left them.

**Acceptance Scenarios**:
1. **Given** two profiles, **Then** each has its own folders, floors, settings, MCP extras (with their encrypted secrets), usage totals and tool counts. **No file is shared.**
2. **Given** the active profile is *Work*, **Then** the top bar shows "Work" with its colour **and** its name (never colour alone), and the window title says "Agent Durbar · Work".
3. **Given** Phase 1, **Then** every profile uses this machine's sign-ins, and Settings > Profiles says so plainly: "All profiles use the sign-ins on this computer. Separate sign-ins come in a later version."
4. **Given** a switch, **Then** running sessions of the old profile are ended cleanly first, after a confirmation if any agent is working or waiting. They can be resumed later from Previous sessions.

### User Story 2 - Separate sign-ins per profile (Priority: P1, Phase 2, after research R1)

In Settings > Profiles > *Work* > Sign-ins, Durbar shows each harness's state for this profile (ready, not signed in) and the exact command to sign in for this profile. For example:
- `COPILOT_HOME=~/.durbar-profiles/work/copilot copilot login`;
- `CLAUDE_CONFIG_DIR=… claude`;
- `CODEX_HOME=… codex login`.

There is a button to copy it. Durbar never runs a login itself and never sees the token.

**Acceptance Scenarios**:
1. **Given** *Work* is signed in to Copilot with a work account and *Personal* with a personal one, **When** I start an agent in each profile, **Then** each uses its own account. This is checked on two real accounts (R1), with no prompt sent: the model list and the account check cost nothing.
2. **Given** a harness whose credentials live in a shared OS keychain entry, so that two homes overwrite each other (if R1 finds that), **Then** that harness is marked "shared sign-in" in the profile, and the profiles never pretend to be separate for it.

### User Story 3 - The wrong-folder guard (Priority: P3)

When I add a folder whose Git remote owner looks like the other profile's (an owner list per profile), Durbar asks: "This looks like a Work folder. Add it to Personal anyway?"

### Edge Cases

- Deleting a profile: it asks, then deletes only Durbar's data for it. The vendor homes are listed with their paths, and Durbar does not delete them (they hold the user's sign-ins).
- The old single-profile data becomes the profile *Default*, in place, with no copy and no migration risk.
- A future Office assistant (spec 048) and scheduled prompts with their starter templates (spec 044, including "Start my day") work inside the active profile only.

## Requirements *(mandatory)*

- **FR-001** Profiles live in a `profiles.json` at the top of the user-data folder (name, colour, id). Each profile's data is in `profiles/<id>/`, the same files as today. The existing data is profile `default` and stays where it is.
- **FR-002** The app runs **one profile at a time**. Switching relaunches the app with `--profile <id>`, which sets Electron's `userData` before anything is read (like `DURBAR_USER_DATA` today). This gives the strongest isolation: model C of the issue.
- **FR-003** Selector: the profile name in the top bar, with a menu of the profiles, *Manage profiles…* and the switch. It has keyboard support and is 10.5px or larger.
- **FR-004** Phase 2: each profile has optional harness homes. When set, the adapters start their child processes with:
  - Copilot: `baseDirectory`;
  - Claude: env `CLAUDE_CONFIG_DIR`;
  - Codex: env `CODEX_HOME`.

  The variables are set as arguments of a spawn, never through a shell. Detection (spec 012 FR-030) runs per profile, so "not signed in" is per profile.
- **FR-005** No token, cookie or credential is read, copied or stored by Durbar. Durbar only writes the paths of the vendor homes.
- **FR-006** Usage totals, tool counts and logs are per profile. A combined view is out of scope.
- **FR-007** Tests:
  - unit tests for the profile store, the arguments and the env per adapter, and the default profile;
  - a simulator check at both sizes of the selector and the switch confirmation.

## Success Criteria *(mandatory)*

- **SC-001** Two profiles on the simulator share no file (asserted by listing both data folders).
- **SC-002** Switching with 15 agents ends them cleanly and opens the other office in under 3 seconds on Linux.
- **SC-003** Phase 2: a real check with two Copilot accounts (and two Claude or Codex sign-ins if available) shows separate identities, recorded as `real:`.

## Research (before Phase 2)

- **R1** Per OS and per harness, does the login honour the home variable for where the credential is stored, or does it use one shared keychain entry? Can two runtimes with different homes run at once? This means checking `copilot login` with `COPILOT_HOME`, `claude` with `CLAUDE_CONFIG_DIR` and `codex login` with `CODEX_HOME`, on Linux first. Owner approval is needed for real accounts, with no prompts sent.
- **R1a** `baseDirectory` is honoured only when the runtime is a spawned process. Durbar uses `RuntimeConnection.forStdio`, so it should apply. The SDK says the in-process (FFI) host ignores it (`types.d.ts`, copilot-sdk issue 1934). Keep the stdio connection for profiles.
- **R2** What do Previous sessions and resume read per home? Claude already reads `CLAUDE_CONFIG_DIR` (spec 012 FR-125).

## Open questions for the owner

1. **Q1** Is Phase 1 useful on its own (separate offices, shared sign-ins), or should profiles wait until separate sign-ins are proven?
2. **Q2** Switching by relaunching the app (proposed, simplest and safest), or both profiles live at once in one window (model A, much more work)?
3. **Q3** Do you have a second Copilot, Claude or Codex account for R1?
4. **Q4** Should profile colours come from the theme, or be free colours?

## Assumptions and dependencies

- It builds on spec 006 (folders and sessions), 010 (`DURBAR_USER_DATA`), 011 (usage totals), 020 (MCP extras) and 033 (floors).
- It builds on spec 012 (adapters, detection, `configDir` for Claude) and spec 040 (themes).
