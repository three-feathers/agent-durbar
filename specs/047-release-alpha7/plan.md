# Implementation Plan: Release v0.1.0-alpha.7

Same steps as spec 046 (alpha.6): bump the version, cut the CHANGELOG section, update the README status, merge, tag on the merge commit, let `release.yml` build the draft, check the draft, set the notes, publish as a pre-release, record it in this spec, and post the link. No code change.

## Constitution Check

- **I.** The spec comes before the tag.
- **III.** No secrets in the notes.
- **VII.** CI must be green on the tagged commit.
- **VIII.** The honest limits go into the notes.
