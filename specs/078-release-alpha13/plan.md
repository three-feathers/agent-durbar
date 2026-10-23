# Plan 078

Same steps as spec 071 (alpha.11), plus the first `changelog:build`:

1. Wait for #554 (lounge) to merge.
2. Version bump; restore the alpha.12 CHANGELOG section from its tag; drop fragments alpha.12 already released, trim the ones that grew; `npm run changelog:build -- --release ...`; intro paragraph; README status.
3. `npm run typecheck && npm run build && npm test`; release PR; review; merge through the queue.
4. Tag on the green merge commit; check the `release.yml` draft (files, checksums, flags); publish as a pre-release.
5. Spec follow-up: mark this spec published.
