# Implementation Plan: Office assistant (048)

**Status**: Draft. Waits for the owner's answers in spec.md before any code.

## Technical Context

Electron main and plain-JS renderer. The data comes from the normalized events (spec 002), usage totals (011), tool usage (020) and floors (033). No new dependency.

## Constitution Check

- **I.** Spec first: this plan and tasks come before code.
- **II.** The query layer reads only normalized events and app state, never vendor types.
- **III.** No secrets: the snapshot never holds attachments, files or tool outputs; nothing new is stored on disk.
- **IV.** Simulator first: the query layer is free and fully testable; the model layer gets one small real check per harness.
- **V.** The panel reuses the chat layout, with 10.5px text or larger, at both sizes.
- **VI.** No OS-specific code.
- **VIII.** Every number is labelled measured, estimate or not reported, and units are never mixed.

## Design

1. `src/shared/officequery.ts`: pure functions over a snapshot type `OfficeState` (agents, timelines, totals) that return answer rows. Built by the renderer from what it already holds, so there is no new IPC for Phase 1 without a model.
2. A bounded in-memory timeline per agent in the renderer (status changes only).
3. Renderer: an `Office assistant` button and panel, question chips, rows with links.
4. Model layer: a hidden-folder session started through the existing `addWorkspace` path with `tools: none`. The snapshot is built in the renderer, sent as the first message of each question, and wrapped in the untrusted-data preamble.
