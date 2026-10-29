# Feature Specification: Safe Markdown in the chat

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 015-018
title: Safe Markdown in the chat
status: built
-->

**Feature Branch**: `016-markdown-in-chat` (milestone 7)
**Created**: 2026-10-16
**Status**: Implemented (milestone 7)
**Input**: Vikram: "agent output shows raw markdown like **bold**".

## Acceptance
1. Assistant messages, thinking text and sub-agent results render as Markdown: bold/italic, headings, lists, links, inline code, fenced code blocks with a **Copy** button, tables, blockquotes.
2. Links open in the system browser only for `http:`/`https:` (main process `shell.openExternal` after re-validating the URL); other schemes (`javascript:`, `data:`, `file:`...) render as plain text.
3. XSS-safe: `marked` (parser) + `DOMPurify` (sanitiser), both bundled locally from `node_modules` (no CDN); raw HTML in the message is escaped/removed; no `<img>`/media/iframe/form elements; remote images are **never** loaded (shown as a link-like "image: alt" text); CSP stays `default-src 'none'; img-src 'self' data:`.
4. Streaming: the block is re-rendered on each delta (batched per animation frame, DOM patched not replaced), no flicker, selection/scroll preserved; auto-scroll only while the user is at the bottom.
5. User messages stay plain text.

## Requirements
- **FR-001** `src/renderer/markdown.js` (plain script, also `require`-able) exposes `renderMarkdown(text) -> safe HTML`.
- **FR-002** Unit tests (jsdom, no credits) cover formatting and malicious input (script tags, event handlers, `javascript:` links, `data:` URLs, images, nested HTML, huge input cap).
- **FR-003** Very large messages (> 200 kB) are truncated for rendering with a note.
- **LIMIT** Math, footnotes, task-list checkboxes, syntax highlighting and images are not rendered.
