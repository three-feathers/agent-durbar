# Feature Specification: Code signing and notarization (macOS, Windows)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 011-014
title: Code signing and notarization
status: draft
note: needs approval (a purchase)
-->

**Feature Branch**: `014-signing-and-notarization`
**Created**: 2026-10-16
**Status**: Draft (backlog). **NEEDS-APPROVAL: this feature requires purchases and account sign-ups. Nothing has been bought, enrolled or configured, and nobody (human or agent) may do so before the maintainer approves in writing.**
**Input**: Releases are unsigned (feature 008 FR-009): macOS builds are ad-hoc signed (`identity "-"`) and not notarized, Windows builds have no Authenticode signature, so users must bypass Gatekeeper and SmartScreen (README "These builds are not code-signed").

## Approval gate (read first)

| Item | Cost / effect | Status |
| --- | --- | --- |
| Apple Developer Program membership (needed for Developer ID Application certificate and notarization) | paid yearly membership; ties to an identity (individual or organization) | **not purchased, needs approval** |
| Windows Authenticode certificate or a managed signing service (for example Azure Trusted Signing, a commercial CA, or SignPath for open-source projects) | paid, or free with eligibility review; identity validation | **not purchased, needs approval; pick after clarify** |
| GitHub Actions secrets (certificates, passwords, API keys) | stores signing credentials in repo settings | **not created, needs approval** |
| Repo/environment settings (protected environment for the release job) | repo settings change | **not changed; recommend only** |

Prices and eligibility change: the plan must check current Apple, Microsoft and vendor pages and quote them; none are asserted here. `[UNVERIFIED]`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install on macOS without bypassing Gatekeeper (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a downloaded `.dmg`/`.zip` from a release, **When** I open it on a clean Mac, **Then** Gatekeeper accepts it (signed with Developer ID, notarized, stapled) and no right-click/Open or `xattr` step is needed.
2. **Given** `spctl --assess` and `codesign --verify --deep --strict` on the app, **Then** both pass; the embedded Copilot runtime binary (unpacked from asar, feature 008) is signed too with hardened runtime and the right entitlements.
3. **Given** the app is offline at first launch, **Then** it opens (notarization ticket is stapled).

### User Story 2 - Install on Windows without a SmartScreen "unknown publisher" wall (Priority: P1)

1. **Given** the NSIS installer and the portable `.exe`, **When** I run them, **Then** Windows shows the publisher name; reputation/SmartScreen behavior is documented honestly (a new certificate may still warn until reputation builds). `[UNVERIFIED]`
2. **Given** the signature, **Then** it is timestamped so it stays valid after the certificate expires.

### User Story 3 - The release workflow signs safely (Priority: P2)

1. **Given** a `v*` tag, **When** the release workflow runs, **Then** signing happens only in the release job, only on tags, with secrets from a protected environment; PRs and forks never see secrets.
2. **Given** signing secrets are absent, **Then** the workflow still produces **unsigned** artifacts and says so (alpha behavior preserved) rather than failing silently or publishing something that looks signed.

### Edge Cases

- Linux AppImage: not covered by OS signing; optional detached signature/checksums (feature 008 FR-012).
- The packaged Copilot runtime must be signed/notarized as part of the bundle; if the runtime changes layout in a new SDK version, `after-pack.js` checks must be extended.
- Certificates expire or are revoked: document renewal and rotation.
- Constitution III: certificates and passwords are never committed, logged or printed in CI; the app itself still stores no tokens.
- Constitution VI/VII: the unsigned path must keep passing CI on all three OSes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** macOS: Developer ID Application signing, hardened runtime, entitlements file (reviewed for the minimum needed: the Copilot runtime may need JIT/unsigned memory entitlements; to be verified, not assumed), notarization via `notarytool` (API key or app-specific password in secrets), stapling, for both arm64 and x64.
- **FR-002** Windows: Authenticode signing of the installer, the portable `.exe` and the main executable, with an RFC 3161 timestamp, using the option chosen in `/speckit.clarify`.
- **FR-003** The release workflow gets a signing path that is opt-in by the presence of secrets, runs only for tags, and uses a protected GitHub environment (recommended to the maintainer; not set up by this feature draft).
- **FR-004** Verification steps in CI after signing (`codesign --verify`, `spctl --assess`, `stapler validate`, `Get-AuthenticodeSignature`) fail the job if the signature is missing when secrets were provided.
- **FR-005** README "These builds are not code-signed" is rewritten only after a real signed build was installed on a clean machine; until then it stays.
- **FR-006** Documentation of the secrets needed (names only), how to rotate them, and what to do if one leaks.
- **FR-007** No change to feature 008's unsigned behavior when secrets are absent.

## Success Criteria *(mandatory)*

- **SC-001**: A tagged release installs and opens on a clean macOS and a clean Windows machine without bypass steps (recorded in feature 013 style evidence).
- **SC-002**: No secret value appears in logs or artifacts (checked on a dry-run workflow).
- **SC-003**: Unsigned builds still work when secrets are not configured.

## Assumptions and open questions

- [NEEDS CLARIFICATION] Individual or organization Apple enrollment, and who pays? Which Windows signing option, given cost and open-source eligibility?
- [NEEDS CLARIFICATION] Is auto-update (not planned) ever wanted? It changes the signing and distribution requirements.
- Depends on: 008. Related: 013 (clean-machine verification).
