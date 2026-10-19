# Feature Specification: Release v0.1.0-alpha.6 (pre-release)

**Feature Branch**: `046-release-alpha6`
**Created**: 2026-10-19
**Status**: Built and **published as a pre-release on 2026-10-19** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.6>; release PR #244; the new app icon from #246 included; tag on `b0e0565`, CI green on that commit).
**Input**: Vikram, 2026-10-19, in the session: "cut a pre release" and "go ahead and cut the pre-release", after "look at all security and quality issues and add it to pre release". AGENTS.md "Needs approval": publishing a release is approved here, in writing, for this release only, as for alpha.4 and alpha.5 (specs 031, 042). Release engineering only: a version bump, the changelog and download notes.

## Requirements

- **FR-001** `package.json` and `package-lock.json` carry version `0.1.0-alpha.6` (and the simulator's About label). The release workflow refuses a tag that does not match it.
- **FR-002** `CHANGELOG.md` moves the *Unreleased* items into a `v0.1.0-alpha.6` section, and the README's status, *Install from releases* and "what's new" text name alpha.6. The main changes since alpha.5:
  - Claude Code offered next to Copilot when installed, with a **Harness** picker when two or more are ready (spec 012 FR-135/FR-136);
  - a folder continues its last session after a restart (spec 006 FR-020/FR-021);
  - questions from agents, custom agents per session and a folder default (043), scheduled prompts (044);
  - copy buttons, safer attachments, a welcome card, arrow keys, moods in the List view;
  - the security sweep (spec 045).
- **FR-003** Tag `v0.1.0-alpha.6` on the merge commit of this branch's PR triggers `.github/workflows/release.yml` (spec 008): macOS arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage, and `SHA256SUMS.txt`, attached to a **draft pre-release**. The draft is checked (flags, eight files, checksums of the files that can be checked on Linux), given notes with the honest limits below, and published as a **pre-release**.

## Honest limits (carried into the release notes)

- Builds are **unsigned and not notarized** (spec 014 still needs the owner's approval: certificates cost money). macOS needs right-click Open or `xattr -dr com.apple.quarantine`; Windows shows SmartScreen.
- `[KNOWN GAP]` Only Linux has been run by hand. The macOS and Windows packages are built by CI and are **untested on real Macs and Windows PCs** (`read:`).
- Claude Code uses your own installed and signed-in `claude`, and its cost is shown as a dollar **estimate**, never as AIU. It has no credit cap (spec 012 T081). Codex is not offered.
- `[KNOWN GAP]` Switching between two real Copilot models, the long-context tier and `confirmation_required` were never seen on a real account (spec 030).
- `[KNOWN GAP]` An in-place upgrade from alpha.5 was not checked. A folder saved by alpha.5 has no remembered session, so it starts fresh once and continues its last session from then on.
- One build-time dependency (`sprintf-js` under electron-builder) has a moderate advisory with no fix; it is not in the app (spec 045).
- No auto-update.

## Release record

- Tag `v0.1.0-alpha.6` on `b0e0565` (the merge of #246, the new app icon; after #244). CI on that commit was green.
- `release.yml` run 39221422754: the Windows, macOS, Linux and draft jobs succeeded.
- **Draft checked:**
  - draft and pre-release flags;
  - eight files: arm64 and x64 dmg and zip, the Windows installer and portable exe, the Linux AppImage, `SHA256SUMS.txt`;
  - the portable exe and the AppImage were downloaded and match `SHA256SUMS.txt`;
  - the AppImage extracts, has `app.asar`, and its icon is the new F2a design (1024 px).
- Notes set with the honest limits above, and **published as a pre-release on 2026-10-19 at 08:24 UTC** on the owner's instruction ("go ahead and cut the pre-release"). The link was posted in the team's Telegram group.
- `[KNOWN GAP]` The packaged app turns its developer hooks off, so the shipped files were not driven by a test. CI's unpacked-app smoke check passed on the tagged commit. Nobody has run the published files on macOS or Windows.
