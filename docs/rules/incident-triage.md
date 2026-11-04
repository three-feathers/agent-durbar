# Bug and deployment incident triage

This file is rule text, part of [AGENTS.md](../../AGENTS.md) (FR-081): read it before you triage a bug or a deployment incident, or classify incidents at release prep. It binds like AGENTS.md, unlike the guidance files (review checklist, agent-notes, agent-apps); "here" and "this file" in it mean AGENTS.md with `docs/rules/`.

(FR-051..FR-053) For learning only: never to rank people or agents.
- Use the Bug form fields and the issue's comments; ask for a missing version, else `Unknown`. Never infer release or introducing PR from dates.
- `incident` (with `bug`) only for confirmed user impact from a published release. Keep this record, replacing `Unknown` only with evidence (`No` = fixed in the planned release). The fixing PR still says `Closes #N` and need not be the introducing one:
  ```text
  ### DORA triage
  - Affected release tag(s): Unknown
  - Suspected introducing PR: Unknown
  - Immediate intervention required: Unknown
  - Fixing PR: #N
  - Recovery release tag: Pending
  - Corrective unplanned release: Unknown
  ```
- At release prep, classify linked `incident` issues: `Yes` only for an unplanned corrective published release; unclear = `Unknown`; record the tag.
- Rework rate: published releases (prereleases too) once each; not drafts, unpublished or `-test.M` tags (a test-build defect is no `incident`); numerator = distinct `Yes` tags. Review revisions are not rework.
