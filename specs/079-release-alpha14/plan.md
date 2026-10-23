# Plan 079

Same steps as spec 078 (alpha.13):

1. Wait until #630 (MCP health) and #625 (keychain prompts) have merged (#598 already had).
2. Version bump; `npm run changelog:build -- --release ...`; intro paragraph; README status.
3. `npm run typecheck && npm run build && npm test`; release PR; review; merge through the queue.
4. Tag the merge commit; check the `release.yml` draft (files, checksums against GitHub's digests, flags); publish as a pre-release, not latest.
5. Mark the test pre-release superseded; delete `099-mcp-test-build`. Spec follow-up: mark this spec published.
