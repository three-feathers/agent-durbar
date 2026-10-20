# Implementation Plan: Release v0.1.0-alpha.9

Same steps as spec 053 (alpha.8), with one difference: the publish step waits for the owner's go-ahead in his session.
- bump the version, cut the CHANGELOG section and update the README status;
- merge, then tag a `main` commit whose CI is fully green, and let `release.yml` build the draft;
- check the draft and set the notes;
- publish as a pre-release, record it in this spec and post the link.

No code change.

## Constitution Check

- **I.** The spec comes before the tag.
- **III.** No secrets in the notes.
- **VII.** CI must be green on the tagged commit.
- **VIII.** The honest limits go into the notes.
