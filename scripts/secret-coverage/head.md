# Secret masking against public lists (spec 012 FR-080 delta 2026-11-01, T137, issue #1009)

The owner asked why we have no full list. The honest answer is in two parts: until this change the mask was written by hand and never compared with a list, and **no list can be complete**. This page is the comparison: every provider and token shape in the public lists, covered or not, and why.

## Sources, read as data on 2026-11-01

| List | Where | Licence file | What we did with it |
|---|---|---|---|
| gitleaks `config/gitleaks.toml` (222 rules, commit `{sha7}`) | github.com/gitleaks/gitleaks | MIT (Copyright (c) 2019 Zachary Rice) | Formats may be used with the notice: patterns in `src/shared/redact.ts` are written in our own form from these and from vendors' public formats; notice in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and beside the patterns (the comment ships in `dist/`) |
| GitHub secret scanning, *Supported secret scanning patterns* ({ghp} providers) | docs.github.com | Documentation; publishes names, no patterns | Names only, as a checklist |
| Yelp detect-secrets `detect_secrets/plugins` | github.com/Yelp/detect-secrets | Apache-2.0 | Read to compare; no text copied |
| TruffleHog `pkg/detectors` ({thn} service directories) | github.com/trufflesecurity/trufflehog | AGPL-3.0 | **Directory names only.** No detector opened, nothing copied, no format taken from it |

No new dependency, at run time or build time.

## Method and result

For each gitleaks rule a scratch script generated 12 made-up samples from the rule's own regex (random characters, never a real value; a random branch of each alternation each time) and ran them through `redact` and `maskTokenShapes`, once on `main` at 1a8317fa and once on this change. A rule counts as hidden when the rule's secret group is gone from the output in all 12. The samples are never committed; to regenerate this page, run [scripts/secret-coverage/coverage.py](../../scripts/secret-coverage/coverage.py). The families are tested in `scripts/test-redact-shapes.ts` with their own made-up samples, and each fails when its pattern is removed. *`yes` is a statement about those samples, not about live tokens: no format here was tried on a real token.*

| | Rules | `redact`, before | `redact`, after | `maskTokenShapes`, after |
|---|---:|---:|---:|---:|
| Fixed shape | {nS} | {beforeS} | {afterS} | {afterS} |
| Service word plus value | {nC} | {beforeC} | {afterC} directly, {afterN} more when next to a secret name | the same |

GitHub's list, by reading: {gy} providers covered, {gp} in part, {gn} by name only. TruffleHog's, by name: {thy} of {thn} services have a shape or URL rule that applies.

The sweep's claim, checked by running it on `main`: `npm_`, `AIza`, `sk_live_` and `aws_secret_access_key=` passed both masks; a URL password passed `maskTokenShapes` only. `npm_` in `redact.ts` was only an env *name* on the "long but harmless" list. PEM and PGP blocks passed both, which the sweep had not said. The two masks were not copies: `redact` ran `PATTERNS` and then `maskTokenShapes`, so `maskTokenShapes` alone lacked `Authorization:`, URL credentials, `tid=` and OAuth values. There is now one mask.

## Prefixes that are not in gitleaks

These came from outside the list. **Each one kept is shown on the vendor's own page, read on 2026-11-01** (fetched as data, the prefix searched for). An example on a page confirms the prefix, not its length or characters, so the body rules are ours and may be wrong for a real token.

| Prefix | Vendor page | Note |
|---|---|---|
| `ya29.` | docs.cloud.google.com/docs/authentication/rest | Example |
| `GOCSPX-` | codelabs.developers.google.com/generate_creatives_google_ads | Example in a codelab |
| `GOOG1` | docs.cloud.google.com/storage/docs/xml-api/post-hmac-create | Example; an access ID, not the secret |
| `cfut_`, `cfat_`, `cfk_` | developers.cloudflare.com/fundamentals/api/get-started/token-formats/ | Stated |
| `vcp_`, `vci_`, `vca_`, `vcr_`, `vck_` | vercel.com/changelog/new-token-formats-and-secret-scanning | Stated |
| `sbp_` | supabase.com/docs/reference/api/introduction | Stated |
| `sb_secret_` | supabase.com/docs/guides/api/api-keys | Stated |
| `napi_` | neon.com/docs/manage/api-keys | Stated |
| `AstraCS:` | docs.datastax.com/en/astra-db-serverless/administration/manage-application-tokens.html | Stated |
| `tskey-` | tailscale.com/kb/1085/auth-keys | Stated |
| `hvr.` | developer.hashicorp.com/vault/docs/concepts/tokens | Stated |
| `dp.st.`, `dp.ct.`, `dp.sa.`, `dp.scim.`, `dp.audit.` | docs.doppler.com/reference/auth-token-formats | Stated |
| `CCIPAT_`, `CCIPRJ_` | circleci.com/changelog/new-format-for-api-access-tokens | Stated |
| `gsk_` | console.groq.com/docs/production-readiness/security-onboarding | Placeholder in an example |
| `r8_` | replicate.com/docs/topics/security/api-tokens | Stated |
| `tvly-` | docs.tavily.com/documentation/quickstart | Example |
| `lsv2_??_` | docs.langchain.com/langsmith/create-account-api-key | The page names `lsv2_tr_`; the two-letter form is ours |
| `dckr_pat_` | docs.docker.com/reference/api/registry/latest/ | Example |
| `whsec_` | docs.stripe.com/webhooks | Example |
| `rzp_live_`, `rzp_test_` | razorpay.com/docs/us/payments/dashboard/test-live-modes/ | Stated, read through a search tool: a plain fetch of the page does not hold the text |
| `pdl_live_`, `pdl_sdbx_` | developer.paddle.com/api-reference/about/api-keys | `pdl_` shown |
| `phx_`, `phs_` | posthog.com/docs/api | Stated |
| `re_` | resend.com/docs/api-reference/introduction | Example |
| `sq0csp-` | Not a vendor page: Yelp detect-secrets' `square_oauth` | From a public list |

**Dropped, because no vendor page we could fetch confirmed them**, though they may well be real, so coverage is lower for them: `1//0` (Google refresh), `AKID` (Tencent), `AKLT` (Volcengine), `dos_v1_` (DigitalOcean), `nfp_`, `nfc_`, `nfu_`, `nfb_` (Netlify), `rnd_` (Render), `ATCTT3`, `ATBB`, `BBDC-` (Atlassian), `bkua_`, `bkcli_` (Buildkite), `csk-` (Cerebras), `xai-` (xAI), `pcsk_` (Pinecone), `nvapi-` (NVIDIA), `fw_` (Fireworks), `rpa_` (RunPod), `wandb_v1_` (W&B), `pylf_v1_` (Logfire), `oy2` (NuGet), `cio` (crates.io), `dckr_oat_` (Docker), `ovsxp_` (OpenVSX), `xsmtpsib-` (Brevo), `Mid-server-` (Midtrans), `access_token$production$` (PayPal), `figd_`, `figo_` (Figma: a forum only), `sk.eyJ` (Mapbox), `CFPAT-` (Contentful: the page refused the fetch), `unkey_` (Unkey), `pat-na1-` (HubSpot), `NRAA-` (New Relic), `pnb_` (Prefect), `secret_` (older Notion), `shptka_`, `shpua_` (Shopify), `lin_oauth_` (Linear). Many of these pages render with script, so a plain fetch misses them: adding one back takes the page that shows it, an alternative, a sample and a mutant.

## How we picked

By what can appear in agent logs and chat: cloud, code hosts and CI, AI providers, package registries, chat and mail, payment, common developer tools; generic `name=value`; URL credentials; PEM and PGP.

A shape goes in only with a prefix distinctive enough to stand beside normal text. Not added, by reason:

- **No fixed prefix** (a bare 32-character key, a UUID): Datadog, Cohere, Mistral, Algolia, Fastly, Twitter keys, most `context` rows below. gitleaks finds these with a service word, an exact length and an entropy test, tuned for scanning a repository and reviewing alerts. This mask rewrites what people read, and every git sha and hash would go too. They are hidden only next to a secret name.
- **Entropy** (detect-secrets `high_entropy_strings`): same reason.
- **Prefix too short** (Vault's legacy `s.`, Yandex's `YC`, detect-secrets' `AP`): ordinary words match.
- **Public by design** (`pk_live_`, `phc_`, `FLWPUBK`, Twilio `AC`): not secrets.
- **Rare in agent output** and a long-tail vendor: left for when someone meets one. Adding one is one alternative, one sample and a mutant.

## What no list fixes

- A secret with no fixed prefix and no secret name beside it passes. So does a password in prose.
- Encoded secrets pass: base64 (a Kubernetes `Secret`, a base64 JWT), hex, gzip, encryption. Percent, JSON and quoted-printable starts are handled at the start of a token, not throughout.
- A split secret passes when split by something FR-080 does not rejoin: a line break, a space, string concatenation in code. (Markdown marks are handled by `redactMarkdown` and `DurbarSafeText`; invisible characters only by spec 103's `maskAll`.)
- A quoted password with spaces: only its first word is looked at, which is usually too short to count.
- A value next to a secret name that is **letters and hyphens only** (`password=correcthorsebatterystaple`), or under 8 characters, or under 20 with no digit (`password=hunter`): kept so `token: CancellationTokenSource`, `token: string` and `Password: please-enter-your-password` stay readable. A saved note keeps its mask for good, so this side matters.
- A value starting with `<`, `{` or `[`, a `$lowercase_name` or `$UPPER_NAME` (variables), `%NAME`, or one that looks like a call or a path (`keys/a1.pem`, `/home/me/a1`) stays, even if it was really a password. A `/` start is hidden only when it reads as base64: 32 or more base64 characters, a digit, a run of 16 with no slash.
- A base64-only prefix right after `/` or `+`: `EAAA`, `AIza`, `SK` and the others in a URL path pass, so images stay whole. Base64 wrapped into lines can still lose a line that starts with one of them.
- `-u user:pass` of a tool other than curl: `-u` alone is too common (`git push -u origin:main`).
- PuTTY `.ppk` bodies, XML pairs such as `nuget.config`. `.netrc` is hidden only in the `machine … password …` form, not a lone `password x` line.
- Vendors change formats; a new prefix passes until it is added. Comparing again is a matter of rerunning this method.
- A token encoded more than 8 times (`%25` repeated) does not count as starting after an escape: 8 is the bound that keeps a `2525…` run cheap.
- Over-masking is accepted (a `next_page_token=…`, a `key-<32 hex>` that is a cache key at the start of a word, `pass: 12345678`, `auth: oauth2-proxy-config`, and a whole line after `Cookie: a=b`).

## Where the mask does and does not apply

Checked by reading the code on 2026-11-01 (`read:`), not by a run.

| Surface | Masked? | Through |
|---|---|---|
| Debug log (`DURBAR_LOG`, dev and test only) | Yes | `createDebugSink`: every record, once, after `JSON.stringify` |
| Codex stderr tail in that log | Yes | `redact` in `src/adapters/codex.ts` |
| MCP status, errors and failed tool cards | Yes | `src/main/mcpmask.ts`, also session secret values |
| MCP read tools (Durbar's own server) | Yes | `src/main/mcp/readtools.ts` |
| Activity log | Yes | `src/shared/activity.ts` (a one-line summary only) |
| Notes | Yes | `maskNoteText` |
| Desk lines, tooltips, inbox, session titles, helper cards, tool labels, permission lines, "Send failed" | Yes | `DurbarSafeText`, `LIVEACT` (fail closed when the module is missing) |
| File edit cards | Yes | adapters, and again in the window |
| Folder-setup display (`shownCommand`) | Bare shapes only, on purpose | `maskBareTokenShapes`: no name, header or cookie rule, because those hide to a space or a line's end and would let a repository hide its own shell syntax (spec 061 FR-014). A password in a hook command stays visible, as it did before |
| Pre-review bot reports (spec 103, PR #997, **not on `main`**) | Yes, when it lands | `maskAll`, which calls `maskTokenShapes` and gains all of this; its own PEM and `sk-ant-` lines then duplicate this mask and should go in that PR |
| **The chat's message bubbles** | **No** | The agent's text is shown as it wrote it (`mdSet`): the user's own session, and the text must be readable to work with. A secret an agent prints is on screen. Tool arguments in the chat are masked |
| **Saved prompts** (scheduled, `durbar-schedules.json`) | **No** | Stored as written, readable only by the user (see `docs/safety.md`) |
| **The agent apps' own session files** | **No** | Written by Copilot, Claude Code or Codex, not by Durbar |
| `console.*` outside the renderer | Yes | Fixed text or `redact(...)` only; `scripts/check-console-mask.js` refuses anything else (`npm test`). It reads the arguments, so a value built before the call and already masked must still be wrapped |
| `console.*` in the renderer | No | Only the window's own developer tools; the check does not cover it |
| `codexRpc` stderr buffer, `claudeTransport` `stderrTail` | Not masked, by design never logged | Comments there; callers mask before use |
| A simulator name check (`src/renderer/sim.ts`) | Own small regex | Not a mask: simulator only, refuses a name; left as it is |
