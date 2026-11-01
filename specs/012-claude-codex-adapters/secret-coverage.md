# Secret masking against public lists (spec 012 FR-080 delta 2026-11-01, T137, issue #1009)

The owner asked why we have no full list. The honest answer is in two parts: until this change the mask was written by hand and never compared with a list, and **no list can be complete**. This page is the comparison: every provider and token shape in the public lists, covered or not, and why.

## Sources, read as data on 2026-11-01

| List | Where | Licence file | What we did with it |
|---|---|---|---|
| gitleaks `config/gitleaks.toml` (222 rules, commit `5f6ec56`) | github.com/gitleaks/gitleaks | MIT (Copyright (c) 2019 Zachary Rice) | Formats may be used with the notice: patterns in `src/shared/redact.ts` are written in our own form from these and from vendors' public formats; notice in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and beside the patterns (the comment ships in `dist/`) |
| GitHub secret scanning, *Supported secret scanning patterns* (208 providers) | docs.github.com | Documentation; publishes names, no patterns | Names only, as a checklist |
| Yelp detect-secrets `detect_secrets/plugins` | github.com/Yelp/detect-secrets | Apache-2.0 | Read to compare; no text copied |
| TruffleHog `pkg/detectors` (893 service directories) | github.com/trufflesecurity/trufflehog | AGPL-3.0 | **Directory names only.** No detector opened, nothing copied, no format taken from it |

No new dependency, at run time or build time.

## Method and result

For each gitleaks rule a scratch script generated 12 made-up samples from the rule's own regex (random characters, never a real value; a random branch of each alternation each time) and ran them through `redact` and `maskTokenShapes`, once on `main` at 1a8317fa and once on this change. A rule counts as hidden when the rule's secret group is gone from the output in all 12. Samples came from Python's `re` parser walking each rule, with a fixed seed; the generator and samples are not committed (a static page, by the reviewer's decision on #1015), so `before` holds for `main` at 1a8317fa and `after` for this PR's code on 2026-11-01. To repeat it: walk each rule's regex to make samples, run them through both masks, and count a rule as hidden when its secret group is gone. The families are tested in `scripts/test-redact-shapes.ts` with their own made-up samples, and each fails when its pattern is removed. *`yes` is a statement about those samples, not about live tokens: no format here was tried on a real token.*

| | Rules | `redact`, before | `redact`, after | `maskTokenShapes`, after |
|---|---:|---:|---:|---:|
| Fixed shape | 120 | 17 | 105 | 105 |
| Service word plus value | 101 | 0 | 7 directly, 87 more when next to a secret name | the same |

GitHub's list, by reading: 64 providers covered, 23 in part, 121 by name only. TruffleHog's, by name: 105 of 893 services have a shape or URL rule that applies.

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

**Kept, marked: format from public lists, not confirmed by a vendor page.** A leak costs more than a false hit, so these stay where a body with a digit and not reading as lower-case words is required: `xai-`, `nvapi-`, `csk-`, `pcsk_`, `1//0`, `AKLT`, `oy2`, `cio`, `ATBB`, `BBDC-`, `CFPAT-`, `unkey_`, `fw_`, `rnd_`, `nfp_` (and `nfc_`, `nfu_`, `nfb_`), `vcc_`, `bkua_`, `lin_oauth_`, `sk.eyJ`. They may be wrong in length or characters.

**Dropped**, no vendor page and not asked back, so coverage is lower for them: `AKID` (Tencent), `dos_v1_` (DigitalOcean), `ATCTT3` (Atlassian), `bkcli_` (Buildkite), `rpa_` (RunPod), `wandb_v1_` (W&B), `pylf_v1_` (Logfire), `dckr_oat_` (Docker), `ovsxp_` (OpenVSX), `xsmtpsib-` (Brevo), `Mid-server-` (Midtrans), `access_token$production$` (PayPal), `figd_`, `figo_` (Figma), `pat-na1-` (HubSpot), `NRAA-` (New Relic), `pnb_` (Prefect), `secret_` (older Notion), `shptka_`, `shpua_` (Shopify).

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
- **A value stops at a simple rule**: a space, a quote, a backtick, `<`, `>`, `,`, `;`, `|`, `&`, `$(`, `${`, `**`, a closing bracket of one opened before the name, and `#` in a URL query. So `password=Summer2024&Secure!9` shows `password=[redacted]&Secure!9`. This is a choice: a tail is a smaller loss than eating a person's saved note, or hiding a command an agent wrote from a permission line.
- Next to a secret name these stay, on purpose: `password=/short12345` (reads as a path), `password=1234-5678` (a number with punctuation), `password=abc\"def123` (the check stops at the escape, 3 characters are not a value), letters and hyphens only (`password=correcthorsebatterystaple`), under 8 characters, under 20 with no digit (`password=hunter`), lower-case words (`password=reset-flow-v2`), lower-case paths, dotted names (`token = config.token2`), a value starting with `<`, `{` or `[`, `$lowercase_name`, `$UPPER_NAME`, `%NAME`.
- A cookie value ends at `|`, `&`, a backtick, `$(` and `${` too, and `curl -u` and `.netrc` passwords at those and at brackets, so a password holding one of them shows its tail.
- `Cookie: a=b` followed by more text and a value under 8 characters is prose (`cookie: a=b is the format`), even if it was real.
- `Authorization: x$(y)` still hides to the next space, comma or semicolon, as on `main`: not changed here.
- Base64-only prefixes (`EAAA`, `AIza`, `SK`, ...) do not start after `/`, `+`, `-` or `_`, so a real `AIza…` right after `_` or `/` passes. In exchange, 1103 repo images and 400 seeded random buffers stay whole as base64, base64url and wrapped text. **Residual:** `sk-` still starts after `-` or `_` (a real `_sk-…_` in Markdown, on `main` too), so base64url can lose a run by chance: a few of the 1103 images, within their first 32 KB. Other short prefixes can still hit by chance in base64 not tried here; no check can prove none.
- Encoded secrets pass: base64 (a Kubernetes `Secret`, a base64 JWT), hex, gzip, encryption. Percent, JSON and quoted-printable starts are handled at the start of a token, not throughout.
- A split secret passes when split by something FR-080 does not rejoin: a line break, a space, string concatenation in code. (Markdown marks are handled by `redactMarkdown` and `DurbarSafeText`; invisible characters only by spec 103's `maskAll`.)
- A quoted password with spaces: only its first word is looked at, which is usually too short to count.
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
| Approval card (`.pcmd`, and `p.summary` in Expert) | **No** | Shown as the adapter wrote it (`app.js` `plainAsk`, `pre.textContent`): what a person approves is the whole command. The desk's "Waiting for permission" line and tool labels do go through `maskSecretCommand`, which is why its values must stop at shell syntax |
| The approval card's "Show the change" (diff) | Yes | Codex: `redact(perm.diff, …)`. Other adapters: `finishEdit`'s `redact`. So a value must stop at shell syntax here too |
| Pre-review bot reports (spec 103, PR #997, **not on `main`**) | Yes, when it lands | `maskAll`, which calls `maskTokenShapes` and gains all of this; its own PEM and `sk-ant-` lines then duplicate this mask and should go in that PR |
| **The chat's message bubbles** | **No** | The agent's text is shown as it wrote it (`mdSet`): the user's own session, and the text must be readable to work with. A secret an agent prints is on screen. Tool arguments in the chat are masked |
| **Saved prompts** (scheduled, `durbar-schedules.json`) | **No** | Stored as written, readable only by the user (see `docs/safety.md`) |
| **The agent apps' own session files** | **No** | Written by Copilot, Claude Code or Codex, not by Durbar |
| `console.*` outside the renderer | Yes | Fixed text or `redact(...)` only; `scripts/check-console-mask.js` refuses anything else (`npm test`). It reads the arguments, so a value built before the call and already masked must still be wrapped. Limits, in its header: `globalThis.console`, aliases of `process`, `require("console")`, `fs.writeSync(2, x)`, a local function named `redact` |
| `console.*` in the renderer | No | Only the window's own developer tools; the check does not cover it |
| `codexRpc` stderr buffer, `claudeTransport` `stderrTail` | Not masked, by design never logged | Comments there; callers mask before use |
| A simulator name check (`src/renderer/sim.ts`) | Own small regex | Not a mask: simulator only, refuses a name; left as it is |

## gitleaks: every rule, measured

`Before` is `redact` on `main` at 1a8317fa, `after` this change. *kind*: `shape` has a fixed form; `context` needs a service word next to the value.

| Rule | Kind | Before | After | Why not fully |
|---|---|---|---|---|
| `1password-secret-key` | shape | no | yes |  |
| `1password-service-account-token` | shape | no | yes |  |
| `adafruit-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `adobe-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `adobe-client-secret` | shape | no | yes |  |
| `age-secret-key` | shape | no | yes |  |
| `airtable-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `airtable-personnal-access-token` | shape | no | yes |  |
| `algolia-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `alibaba-access-key-id` | shape | no | yes |  |
| `alibaba-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `anthropic-admin-api-key` | shape | yes | yes |  |
| `anthropic-api-key` | shape | yes | yes |  |
| `artifactory-api-key` | shape | no | yes |  |
| `artifactory-reference-token` | shape | no | yes |  |
| `asana-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `asana-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `atlassian-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `authress-service-client-access-key` | shape | no | yes |  |
| `aws-access-token` | shape | partial | yes |  |
| `aws-amazon-bedrock-api-key-long-lived` | shape | no | yes |  |
| `aws-amazon-bedrock-api-key-short-lived` | shape | no | yes |  |
| `azure-ad-client-secret` | shape | no | yes |  |
| `beamer-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `bitbucket-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `bitbucket-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `bittrex-access-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `bittrex-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `cisco-meraki-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `clickhouse-cloud-api-secret-key` | shape | no | yes |  |
| `clojars-api-token` | shape | no | yes |  |
| `cloudflare-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `cloudflare-global-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `cloudflare-origin-ca-key` | shape | no | yes |  |
| `codecov-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `cohere-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `coinbase-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `confluent-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `confluent-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `contentful-delivery-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `curl-auth-header` | shape | partial | partial | `Authorization`, `Bearer` and secret-named headers are hidden; a custom header with an unknown name is not. |
| `curl-auth-user` | shape | no | partial | `user:pass` is hidden after `curl`; a value without a colon has no password to split. |
| `databricks-api-token` | shape | no | yes |  |
| `datadog-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `defined-networking-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `digitalocean-access-token` | shape | no | yes |  |
| `digitalocean-pat` | shape | no | yes |  |
| `digitalocean-refresh-token` | shape | no | yes |  |
| `discord-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `discord-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `discord-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `doppler-api-token` | shape | no | yes |  |
| `droneci-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `dropbox-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `dropbox-long-lived-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `dropbox-short-lived-api-token` | context | no | yes |  |
| `duffel-api-token` | shape | no | yes |  |
| `dynatrace-api-token` | shape | no | yes |  |
| `easypost-api-token` | shape | no | yes |  |
| `easypost-test-api-token` | shape | no | yes |  |
| `etsy-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `facebook-access-token` | shape | no | partial | Hidden for the real `<15-16 digits>\|<27-40 chars>` form; some generated bodies hold characters outside it. |
| `facebook-page-access-token` | shape | no | yes |  |
| `facebook-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `fastly-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `finicity-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `finicity-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `finnhub-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `flickr-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `flutterwave-encryption-key` | shape | no | yes |  |
| `flutterwave-public-key` | shape | no | no | Public by design, not a secret. |
| `flutterwave-secret-key` | shape | no | yes |  |
| `flyio-access-token` | shape | no | yes |  |
| `frameio-api-token` | shape | no | yes |  |
| `freemius-secret-key` | shape | no | no | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `freshbooks-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `gcp-api-key` | shape | no | yes |  |
| `generic-api-key` | context | no | partial | Covered when the name is a secret word and the value qualifies; the list's entropy test is not ours. |
| `github-app-token` | shape | yes | yes |  |
| `github-fine-grained-pat` | shape | yes | yes |  |
| `github-oauth` | shape | yes | yes |  |
| `github-pat` | shape | yes | yes |  |
| `github-refresh-token` | shape | yes | yes |  |
| `gitlab-cicd-job-token` | shape | no | partial | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `gitlab-deploy-token` | shape | no | yes |  |
| `gitlab-feature-flag-client-token` | shape | no | yes |  |
| `gitlab-feed-token` | shape | no | yes |  |
| `gitlab-incoming-mail-token` | shape | no | yes |  |
| `gitlab-kubernetes-agent-token` | shape | no | yes |  |
| `gitlab-oauth-app-secret` | shape | no | yes |  |
| `gitlab-pat` | shape | yes | yes |  |
| `gitlab-pat-routable` | shape | yes | yes |  |
| `gitlab-ptt` | shape | no | yes |  |
| `gitlab-rrt` | shape | no | yes |  |
| `gitlab-runner-authentication-token` | shape | no | yes |  |
| `gitlab-runner-authentication-token-routable` | shape | no | yes |  |
| `gitlab-scim-token` | shape | no | yes |  |
| `gitlab-session-cookie` | shape | no | yes |  |
| `gitter-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `gocardless-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `grafana-api-key` | shape | no | yes |  |
| `grafana-cloud-api-token` | shape | no | yes |  |
| `grafana-service-account-token` | shape | no | yes |  |
| `harness-api-key` | shape | no | yes |  |
| `hashicorp-tf-api-token` | shape | no | yes |  |
| `hashicorp-tf-password` | context | no | partial | Covered for a name next to a value that qualifies; a value with no digit and under 20 characters stays. |
| `heroku-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `heroku-api-key-v2` | shape | no | yes |  |
| `hubspot-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `huggingface-access-token` | shape | no | yes |  |
| `huggingface-organization-api-token` | shape | no | yes |  |
| `infracost-api-token` | shape | no | yes |  |
| `intercom-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `intra42-client-secret` | shape | no | yes |  |
| `jfrog-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `jfrog-identity-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `jwt` | shape | no | no | Real JWTs start `eyJ` and are hidden; the list also accepts `ey` plus anything and no signature, which matches base64 in normal output. |
| `jwt-base64` | shape | no | no | Base64 of a JWT: encoded secrets pass (see the limits). |
| `kraken-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `kubernetes-secret-yaml` | shape | no | no | Values are plain base64 with no prefix: encoded secrets pass. |
| `kucoin-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `kucoin-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `launchdarkly-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `linear-api-key` | shape | no | yes |  |
| `linear-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `linkedin-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `linkedin-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `lob-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `lob-pub-api-key` | context | no | no | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `looker-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `looker-client-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `mailchimp-api-key` | context | no | yes |  |
| `mailgun-private-api-token` | context | no | yes |  |
| `mailgun-pub-key` | context | no | no | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `mailgun-signing-key` | context | no | partial | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `mapbox-api-token` | context | no | partial | Sample at the list's minimum length: shorter than our form accepts, or no safe prefix. |
| `mattermost-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `maxmind-license-key` | shape | no | yes |  |
| `messagebird-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `messagebird-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `microsoft-teams-webhook` | shape | no | yes |  |
| `netlify-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `new-relic-browser-api-token` | context | no | yes |  |
| `new-relic-insert-key` | context | no | yes |  |
| `new-relic-user-api-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `new-relic-user-api-key` | context | no | yes |  |
| `notion-api-token` | shape | no | yes |  |
| `npm-access-token` | shape | no | yes |  |
| `nuget-config-password` | shape | no | no | An XML attribute pair (`key=... value=...`), not a name next to its value; rare in agent output. |
| `nytimes-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `octopus-deploy-api-key` | shape | no | yes |  |
| `okta-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `openai-api-key` | shape | yes | yes |  |
| `openshift-user-token` | shape | no | yes |  |
| `perplexity-api-key` | shape | no | yes |  |
| `pkcs12-file` | path-only | no | no | A file name rule, not text. The mask does not read files. |
| `plaid-api-token` | context | no | yes |  |
| `plaid-client-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `plaid-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `planetscale-api-token` | shape | no | yes |  |
| `planetscale-oauth-token` | shape | no | yes |  |
| `planetscale-password` | shape | no | yes |  |
| `postman-api-token` | shape | no | yes |  |
| `prefect-api-token` | shape | no | yes |  |
| `private-key` | shape | no | yes |  |
| `privateai-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `pulumi-api-token` | shape | no | yes |  |
| `pypi-upload-token` | shape | no | yes |  |
| `rapidapi-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `readme-api-token` | shape | no | yes |  |
| `rubygems-api-token` | shape | no | yes |  |
| `scalingo-api-token` | shape | no | yes |  |
| `sendbird-access-id` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sendbird-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sendgrid-api-token` | shape | no | yes |  |
| `sendinblue-api-token` | shape | no | yes |  |
| `sentry-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sentry-org-token` | shape | no | yes |  |
| `sentry-user-token` | shape | no | yes |  |
| `settlemint-application-access-token` | shape | no | yes |  |
| `settlemint-personal-access-token` | shape | no | yes |  |
| `settlemint-service-access-token` | shape | no | yes |  |
| `shippo-api-token` | shape | no | yes |  |
| `shopify-access-token` | shape | no | yes |  |
| `shopify-custom-access-token` | shape | no | yes |  |
| `shopify-private-app-access-token` | shape | no | yes |  |
| `shopify-shared-secret` | shape | no | yes |  |
| `sidekiq-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sidekiq-sensitive-url` | shape | yes | yes |  |
| `slack-app-token` | shape | yes | yes |  |
| `slack-bot-token` | shape | yes | yes |  |
| `slack-config-access-token` | shape | yes | yes |  |
| `slack-config-refresh-token` | shape | yes | yes |  |
| `slack-legacy-bot-token` | shape | yes | yes |  |
| `slack-legacy-token` | shape | partial | yes |  |
| `slack-legacy-workspace-token` | shape | no | yes |  |
| `slack-user-token` | shape | yes | yes |  |
| `slack-webhook-url` | shape | no | no | The real `T/B/secret` form is hidden (`hooks.slack.com` rule); the generated sample has no slashes. |
| `snyk-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sonar-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `sourcegraph-access-token` | shape | no | partial | `sgp_` is hidden; the rule also accepts a bare 40 hex string, which is a git sha. |
| `square-access-token` | shape | no | partial | `sq0atp-` is hidden, and `EAAA` from 60 characters: a shorter `EAAA` run is too close to base64. |
| `squarespace-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `stripe-access-token` | shape | no | no | Real keys are 24 or more; the list accepts 10, and the samples are at that minimum. We take 16 or more, so `sk_test_helpers` stays. |
| `sumologic-access-id` | context | no | partial | By name when the value has a digit; `su` + 12 characters alone has no safe prefix. |
| `sumologic-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `telegram-bot-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `travisci-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twilio-api-key` | shape | no | yes |  |
| `twitch-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twitter-access-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twitter-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twitter-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twitter-api-secret` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `twitter-bearer-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `typeform-api-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `vault-batch-token` | shape | no | yes |  |
| `vault-service-token` | shape | no | partial | `hvs.` is hidden; the legacy `s.` + 24 characters is too short a prefix (matches ordinary dotted words). |
| `yandex-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `yandex-api-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `yandex-aws-access-token` | context | no | by name | No fixed prefix: needs a secret name next to it. |
| `zendesk-secret-key` | context | no | by name | No fixed prefix: needs a secret name next to it. |

## GitHub secret scanning: every provider, by reading

GitHub publishes names, not patterns, so this table is a judgement from the names and the public formats, not a measurement. `by name`: no shape, hidden only next to a secret name.

| Provider | Secret types | Status | How, or why not |
|---|---|---|---|
| 1Password | 1Password Service Account Token | yes | `ops_eyJ`, `A3-` |
| Adafruit | Adafruit IO Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Adobe | Adobe Client Secret, Adobe Device Token, Adobe PAC Token, Adobe Refresh Token, Adobe Service Token, Adobe Short-Lived Access Token | partial | `p8e-`; other Adobe tokens by name |
| Aikido | Aikido API Client Secret, Aikido CI Scanning Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Airtable | Airtable API Key, Airtable Personal Access Token | partial | `pat…`; old keys by name |
| Aiven | Aiven Auth Token, Aiven Service Password | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Alibaba | Alibaba Cloud AccessKey ID | yes | `LTAI` |
| Amazon AWS | Amazon AWS Access Key ID, Amazon AWS API Key ID, Amazon AWS Session Token | yes | `AKIA`, `ASIA`, `ABIA`, `ACCA`, `A3T`; session token by name, Bedrock `ABSK` |
| Anthropic | Anthropic Admin API Key, Anthropic API Key, Anthropic Service Account API Key, Anthropic Session ID, Anthropic User API Key | yes | `sk-ant-`, also glued |
| APIclub | APIclub API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Apify | Apify Actor Run API Token, Apify Actor Run Proxy Password, Apify API Token, Apify Integration API Token, Apify Proxy Password, Apify UI Token, Apify Webhook Dispatch API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Asaas | Asaas API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Asana | Asana Legacy Format Personal Access Token, Asana Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Atlassian | Atlassian API Token, Atlassian JSON Web Token | yes | `ATATT3`; JWT shape |
| Authress | Authress Service Client Access Key | yes | own four-part shape |
| Azure | Azure Active Directory Application Secret, Azure AI Services Key, Azure Anomaly Detector EE Key, Azure Anomaly Detector Key, Azure Apim Direct Management Key, Azure Apim Gateway Key, Azure Apim Repository Key, Azure Apim Subscription Key, Azure App Configuration Connection String, Azure App Configuration Key, Azure Batch Key Identifiable, Azure Cache for Redis Access Key, Azure Cognitive Services Key, Azure Communication Services Connection String, Azure Communication Services Key, Azure Computer Vision Key, Azure Registry Key Identifiable, Azure Content Moderator Key, Azure Content Safety Key, Azure Cosmosdb Key Identifiable, Azure Custom Vision Prediction Key, Azure Custom Vision Training Key, Azure DevOps Personal Access Token, Azure Event Grid Key Identifiable, Azure Event Hub Key Identifiable, Azure Face Key, Azure Fluid Relay Key, Azure Form Recognizer Key, Azure Function Key, Azure Health Decision Support Key, Azure Health Insights Key, Azure Immersive Reader Key, Azure Internal All In One Key, Azure IoT Device Connection String, Azure IoT Device Key, Azure IoT Device Provisioning Key, Azure IoT Hub Connection String, Azure IoT Hub Key, Azure IoT Provisioning Connection String, Azure Knowledge Key, Azure Logic Apps URL, Azure Luis Authoring Key, Azure Luis Key, Microsoft Azure Service Management Certificate, Azure Maps Key, Azure Metrics Advisor Key, Azure Mixed Reality Key, Azure ML Inference Key, Azure ML Internal Service Principal Key, Azure ML Studio (classic) Web Service Key, Azure OpenAI Key, Azure Personalizer Key, Azure QnA Maker Key, Azure QnA Maker V2 Key, Azure Quantum Key, Azure Relay Key Identifiable, Azure SAS Token, Azure Search Admin Key, Azure Search Query Key, Azure Service Bus Key Identifiable, Azure SignalR Connection String, Azure SignalR Key, Azure Speech Services Key, Azure Speech Translation Key, Azure SQL Internal Default CloudSA Key, Azure SQL password, Azure Storage Account Access Key, Azure Text Analytics Key, Azure Text Translation Key, Azure Video Intelligence Key, Microsoft Azure Web App Bot Key, Azure Web Pub Sub Connection String, Azure Web Pub Sub Key, Microsoft Azure Entra ID Token | partial | Entra `…Q~…`; `AccountKey=`, `SharedAccessKey=` and `sig=` by name; the many other Azure keys have no public fixed prefix |
| Baidu | Baidu AI API Key, Baidu Cloud API Access Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Beamer | Beamer API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Bitbucket | Bitbucket Server Personal Access Token | yes | `ATBB`, `BBDC-` (public lists, no vendor page) |
| Bitrise | Bitrise Personal Access Token, Bitrise Workspace API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Block Protocol | Block Protocol API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Brevo | Sendinblue API Key, Sendinblue SMTP Key | partial | `xkeysib-`; SMTP key by name |
| Buildkite | Buildkite Agent Access Token, Buildkite Agent Job Token, Buildkite Agent Registration Token, Buildkite Cluster Queue Token, Buildkite Cluster Token, Buildkite Packages Registry Token, Buildkite Packages Temporary Token, Buildkite Portal Secret, Buildkite Portal Token, Buildkite User Access Token | yes | `bkua_` (public lists, no vendor page) |
| Canadian Digital Service | Canadian Digital Service Notify API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Canva | Canva App Secret, Canva Connect API Secret, Canva Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Cashfree | Cashfree API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Cfx.re | Cfx.re Server Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Checkout.com | Checkout.com Production Secret Key, Checkout.com Test Secret Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Chief Tools | Chief Tools Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| CircleCI | CircleCI Bot API Token, CircleCI Personal Access Token, CircleCI Project Access Token, CircleCI Release API Token | partial | `CCIPAT_`, `CCIPRJ_`; others by name |
| Clojars | Clojars Deploy Token | yes | `CLOJARS_` |
| Cloudflare | Cloudflare Account API Token, Cloudflare Global User API Key, Cloudflare User API Token | partial | `cfut_`, `cfat_`, `cfk_`, origin `v1.0-`; older tokens by name |
| Cloudsmith | Cloudsmith API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Cockroach Labs | CockroachDB Cloud API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Cohere | Cohere API Key | by name | no public prefix |
| Contentful | Contentful Personal Access Token, Contentful Web Token | yes | `CFPAT-` (public lists, no vendor page) |
| Contributed Systems | Contributed Systems Credentials | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Coveo | Coveo Access Token, Coveo API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| crates.io | Crates.io API Token | yes | `cio` (public lists, no vendor page) |
| Databento | Databento API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Databricks | Databricks API Token, Databricks Account Session Token, Databricks Federated Account Session Token, Databricks OAuth Code, Databricks OAuth Refresh Token, Databricks OAuth Secret Token, Databricks OAuth Single Use Refresh Token Child, Databricks OAuth Single Use Refresh Token Parent, Databricks Scoped API Token, Databricks Scoped Internal Token, Databricks Token, Databricks Workspace Session Token | partial | `dapi`; session and OAuth tokens by name |
| Datadog | Datadog API Key, Datadog Application Key, Datadog Personal Access Token, Datadog RCM, Datadog Service Account Token | by name | 32/40 hex, no prefix |
| Datastax | Datastax AstraCS Tokens | yes | `AstraCS:` |
| DeepSeek | DeepSeek API Key | yes | `sk-` |
| Defined Networking | Defined Networking Managed Nebula API Key | by name | `dnkey-` not added: rare in agent logs |
| DevCycle | DevCycle Client API Key, DevCycle Mobile API Key, DevCycle Server API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| DigitalOcean | DigitalOcean OAuth Token, DigitalOcean Personal Access Token, DigitalOcean Refresh Token, DigitalOcean System Token | yes | `doo_v1_`, `dop_v1_`, `dor_v1_`; system token by name |
| Discord | Discord Bot Token | yes | bot token shape, webhook path |
| Docker | Docker Organization Access Token, Docker Personal Access Token, Docker Swarm Join Token, Docker Swarm Unlock Key | partial | `dckr_pat_`; other tokens by name |
| Doppler | Doppler Audit Token, Doppler CLI Token, Doppler Personal Token, Doppler SCIM Token, Doppler Service Account Token, Doppler Service Token | yes | `dp.pt.`, `dp.st.` and the others |
| Dropbox | Dropbox Access Token, Dropbox Short-Lived Access Token | partial | `sl.`; long-lived by name |
| Duffel | Duffel Live Access Token, Duffel Test Access Token | yes | `duffel_live_`, `duffel_test_` |
| Dynatrace | Dynatrace API Token, Dynatrace Internal Token | yes | `dt0c01.` |
| EasyPost | EasyPost Production API Key, EasyPost Test API Key | yes | `EZAK`, `EZTK` |
| eBay | eBay Production Client ID (App ID), eBay Sandbox Client ID (App ID) | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Elastic | Elastic Cloud API Key, Elastic Stack API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Facebook | Facebook Access Token | yes | `EAAC`, `EAAM`, `<id>\|<token>` |
| Fastly | Fastly API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Fieldguide | Fieldguide API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Figma | Figma Personal Access Token, Figma SCIM API Token | by name | `figd_` dropped: only a forum, no vendor doc |
| Finicity | Finicity App Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Firebase | Firebase Cloud Messaging Server Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Flickr | Flickr API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Flutterwave | Flutterwave Live API Secret Key, Flutterwave Test API Secret Key | yes | `FLWSECK` |
| Frame.io | Frame.io Developer Token, Frame.io JSON Web Token | partial | `fio-u-`; JWT shape |
| FullStory | FullStory API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Generic | ec_private_key, generic_private_key, http_basic_authentication_header, http_bearer_authentication_header, mongodb_connection_string, mysql_connection_url, openssh_private_key, pgp_private_key, postgres_connection_string, rsa_private_key | partial | PEM, OpenSSH, PGP, Bearer, Basic in `Authorization:`, URL credentials; a bare Basic value not next to its header is not |
| GitHub | GitHub App Installation Access Token, GitHub OAuth Access Token, GitHub Personal Access Token, GitHub Refresh Token, GitHub SSH Private Key, GitHub Test Token | yes | `gh[pousr]_`, `github_pat_`; SSH key as PEM block |
| GitLab | GitLab Access Token, GitLab CI/CD Job Token, GitLab Deploy Token, GitLab Feature Flag Client Token, GitLab Feed Token, GitLab Incoming Mail Token, GitLab Agent for Kubernetes Token, GitLab OAuth Application Secret, GitLab Pipeline Trigger Token, GitLab Runner Authentication Token, GitLab Runner Registration Token, GitLab SCIM Token | yes | `glpat-`, `gldt-`, `glrt-`, `glft-`, `glffct-`, `glimt-`, `glagent-`, `gloas-`, `glsoat-`, `glptt-`, `glcbt-`, `GR1348941`, `_gitlab_session` |
| GoCardless | GoCardless Live Access Token, GoCardless Sandbox Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Google | Google API Key, Google Cloud Service Account Credentials, Google Cloud Storage Service Account Access Key ID, Google Cloud Storage User Access Key ID, GCP API Key Bound to a Service Account, Google Gemini API Key, Google OAuth Access Token, Google OAuth Client ID, Google OAuth Refresh Token | partial | `AIza`, `ya29.`, `GOCSPX-`, `GOOG1`, `1//0` (public lists, no vendor page); service account key as PEM block |
| Grafana | Grafana Cloud API Key, Grafana Cloud API Token, Grafana Project API Key, Grafana Project Service Account Token | yes | `glc_`, `glsa_`, `eyJrIjoi` |
| Groq | Groq API Key | yes | `gsk_` |
| GuardSquare | GuardSquare AppSweep API Key, GuardSquare CLI Access Token, GuardSquare Maven Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Hack Club | Hack Club AI Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| HashiCorp | HashiCorp Vault Batch Token, HashiCorp Vault Root Service Token, HashiCorp Vault Service Token, Terraform Cloud / Enterprise API Token | yes | `hvs.`, `hvb.`, `hvr.`, `.atlasv1.` |
| hCaptcha | hCaptcha Siteverify Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Heroku | Heroku Platform API OAuth2 Token, Heroku Postgres Connection URL | partial | `HRKU-`; Postgres URL as URL credential |
| Hex | Hex API key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Highnote | Highnote RK Live Key, Highnote RK Test Key, Highnote SK Live Key, Highnote SK Test Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| HOP | HOP Bearer, HOP PAT, HOP PTK | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Hubspot | Hubspot API Key, Hubspot Personal Access Key, Hubspot Private Apps User Token, Hubspot SMTP Credential | by name | `pat-na1-` dropped: no vendor page confirmed it |
| Hugging Face | Hugging Face Organization API Token, Hugging Face User Access Token | yes | `hf_`, `api_org_` |
| IBM | IBM Cloud IAM Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Intercom | Intercom Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Ionic | Ionic Personal Access Token, Ionic Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Iterative | DVC Studio Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| JFrog | JFrog Platform Access Token, JFrog Platform API Key, JFrog Platform Reference Token | partial | `AKCp`, `cmVmd`; platform access tokens are JWTs |
| Langchain | LangSmith Personal Access Token, LangSmith Service Key, LangSmith License Key, LangSmith SCIM Bearer Token | yes | `lsv2_??_` |
| Lark | Lark APaaS Client Secret, Lark Application Secret, Lark MCP Grant Token, Lark Meego Plugin Secret, Lark User Session | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| LaunchDarkly | LaunchDarkly API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Lichess | Lichess OAuth Access Token, Lichess Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Lightspeed | Lightspeed Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Limbar | Limbar Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Linear | Linear API Key, Linear OAuth Access Token | yes | `lin_api_`; `lin_oauth_` (public lists, no vendor page) |
| LinkedIn | LinkedIn Client Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Lob | Lob Live API Key, Lob Test API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Localstack | Localstack API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| LogicMonitor | LogicMonitor Bearer Token, LogicMonitor LMv1 Access Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Login with Amazon | Login with Amazon OAuth Client ID | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Lovable Labs | Lovable API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Mailchimp | Mailchimp API Key, Mandrill API Key | yes | `<32 hex>-usNN`; Mandrill by name |
| Mailersend | Mailersend API Token, Mailersend SMTP Password, Mailersend SMTP Username | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Mailgun | Mailgun API Key, Mailgun SMTP Credential | partial | `key-<32 hex>`; newer keys by name |
| Mapbox | Mapbox Secret Access Token | yes | `sk.eyJ` (public lists, no vendor page) |
| MaxMind | MaxMind License Key | yes | `_mmk` |
| Meraki | Meraki Dashboard API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Mercury | Mercury Non-Production API Token, Mercury Production API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Mergify | Mergify Application Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| MessageBird | MessageBird API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Microsoft | Power Automate Webhook SAS | yes | Power Automate `sig=`; Teams webhook path |
| Midtrans | Midtrans Production Server Key, Midtrans Sandbox Server Key | by name | `Mid-server-` dropped: no vendor page confirmed it |
| Mistral AI | Mistral AI API Key | by name | no public prefix |
| MongoDB | MongoDB Atlas Database URI with credentials, MongoDB Atlas Service Account Secret | partial | URI as URL credential; Atlas secret by name |
| Naver Cloud | Naver Cloud Gov Access Key ID, Naver Cloud Gov Secret Key, Naver Cloud Gov Secure Token Service, Naver Cloud Gov Secure Token Service Secret, Naver Cloud Access Key ID, Naver Cloud Secret Key, Naver Cloud Secure Token Service, Naver Cloud Secure Token Service Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Neon | Neon API Key, Neon Connection URI | partial | `napi_`; URI as URL credential |
| Netflix | Netflix NetKey | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| New Relic | New Relic Insights Query Key, New Relic License Key, New Relic Personal API Key, New Relic REST API Key | partial | `NRAK-`, `NRII-`, `NRJS-`; others by name |
| Notion | Notion API Token, Notion Integration Token, Notion OAuth Client Secret | partial | `ntn_`; older `secret_` by name |
| npm | npm Access Token | yes | `npm_`, `_authToken=` |
| NuGet | NuGet API Key | yes | `oy2` (public lists, no vendor page) |
| Octopus Deploy | Octopus Deploy API Key | yes | `API-` |
| Oculus | Oculus Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| OneChronos | OneChronos API Token, OneChronos Expressive Bidding API Key, OneChronos Expressive Bidding Encryption Key, OneChronos OAuth Token, OneChronos Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| OneSignal | OneSignal Rich API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Onfido | Onfido Live API Token, Onfido Sandbox API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| OpenAI | OpenAI API Key | yes | `sk-`, `sk-proj-` |
| OpenRouter | OpenRouter API Key | yes | `sk-or-` |
| OpenVSX | OpenVSX Access Token | by name | `ovsxp_` dropped: no vendor page confirmed it |
| Openweather | Openweather API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Oracle | Oracle API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Orbit | Orbit API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Paddle | Paddle API Key, Paddle Sandbox API Key | yes | `pdl_live_`, `pdl_sdbx_` |
| PagerDuty | PagerDuty OAuth Secret, PagerDuty OAuth Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Palantir | Palantir JSON Web Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Pangea | Pangea Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Perplexity | Perplexity API Key | yes | `pplx-` |
| Persona  Identities | Persona Production Api Key, Persona Sandbox Api Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Pineapple Technologies Limited | Pineapple Technologies Incident API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Pinecone | Pinecone API Key | yes | `pcsk_` (public lists, no vendor page) |
| Pinterest | Pinterest Access Token, Pinterest Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| PlanetScale | PlanetScale Database Password, PlanetScale OAuth Token, PlanetScale Service Token | yes | `pscale_tkn_`, `pscale_oauth_`, `pscale_pw_` |
| Planning Center | Planning Center OAuth Access Token, Planning Center OAuth Application Secret, Planning Center Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Plivo | Plivo Auth ID | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Polar | Polar Access Token, Polar Authorization Code, Polar Client Registration Token, Polar Client Secret, Polar Customer Session Token, Polar Personal Access Token, Polar Refresh Token, Polar User Session Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| PostHog | PostHog Project Secret API Key, PostHog OAuth Access Token, PostHog OAuth Refresh Token, PostHog Personal API Key | yes | `phx_`, `phs_`; `phc_` is public |
| Postman | Postman API Key, Postman Collection Key | yes | `PMAK-` |
| Prefect | Prefect Server API Key, Prefect User API Key | partial | `pnu_`; `pnb_` by name |
| Proctorio | Proctorio Consumer Key, Proctorio Linkage Key, Proctorio Registration Key, Proctorio Secret Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Proof | Proof Full Access API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Pulumi | Pulumi Access Token | yes | `pul-` |
| Pydantic Services Inc. | Logfire Token, Pydantic AI Gateway API Key | by name | `pylf_` dropped: no vendor page confirmed it |
| PyPI | PyPI API Token | yes | `pypi-Ag` |
| Rainforest Pay | Rainforest API Key, Rainforest Sandbox API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Ramp | Ramp OAuth Client ID, Ramp OAuth Client Secret, Ramp OAuth Access or Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Raycast | Raycast Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| ReadMe | ReadMe API Key | yes | `rdme_` |
| redirect.pizza | redirect.pizza API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Replicate | Replicate API Token | yes | `r8_` |
| Resend | Resend API Key | yes | `re_` |
| Rootly | Rootly API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| RubyGems | RubyGems API Key | yes | `rubygems_` |
| RunPod | RunPod API Key | by name | `rpa_` dropped: no vendor page confirmed it |
| Salesforce | Salesforce Access Token, Salesforce Marketing Cloud API OAuth2 Token, Salesforce OAuth2 Consumer Key, Salesforce Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Samsara | Samsara API Token, Samsara OAuth Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Scalr | Scalr API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Segment | Segment Public API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| SendGrid | SendGrid API Key | yes | `SG.` |
| Sentry | Sentry Integration Token, Sentry Organization Token, Sentry Personal Token, Sentry User App Auth Token | yes | `sntrys_`, `sntryu_` |
| Shippo | Shippo Live API Token, Shippo Test API Token | yes | `shippo_live_`, `shippo_test_` |
| Shopee | Shopee Open Platform Partner Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Shopify | Shopify Access Token, Shopify App Client Credentials, Shopify App Client Secret, Shopify App Shared Secret, Shopify Custom App Access Token, Shopify Marketplace Token, Shopify Merchant Token, Shopify Partner API Token, Shopify Private App Password | partial | `shpat_`, `shpca_`, `shppa_`, `shpss_`; others by name |
| Siemens | Siemens API Token, Siemens Code Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Sindri | Sindri API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Slack | Slack API Token, Slack Incoming Webhook URL, Slack Workflow Trigger URL, Slack Workflow Webhook URL | yes | `xox*-`, `xapp-`, webhook and workflow paths |
| Snowflake | SFPG Connection String, SFPG Host, Snowflake Programmatic Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Sourcegraph | Sourcegraph Access Token, Sourcegraph Dotcom User Gateway Access Token, Sourcegraph Access Token with Instance Identifier, Sourcegraph License Key Token, Sourcegraph Product Subscription Token | yes | `sgp_` |
| SpaceX | Starlink Public API V2 Client Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Square | Square Access Token, Square Production Application Secret, Square Sandbox Application Secret | yes | `sq0atp-`, `sq0csp-`, `EAAA` |
| SSLMate | SSLMate API Key, SSLMate Cluster Secret | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Stripe | Stripe API Key, Stripe Legacy API Key, Stripe Live API Restricted Key, Stripe Test API Restricted Key, Stripe Test API Secret Key, Stripe Webhook Signing Secret | yes | `sk_`, `rk_` + `live`, `test`, `prod`; `whsec_` |
| Supabase | Supabase OAuth Access Token, Supabase Personal Access Token, Supabase Personal Access Token (scoped), Supabase Secret Key | yes | `sbp_`, `sb_secret_` |
| Tableau | Tableau Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Tailscale | Tailscale API Key | yes | `tskey-` |
| Tavily | Tavily API Key | yes | `tvly-` |
| Telegram | Telegram Bot Token | yes | `<digits>:<35>` |
| Telnyx | Telnyx API V2 Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Temporal | Temporal Cloud API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Tencent | Tencent Cloud International Access Token, Tencent Cloud Secret ID, Tencent WeChat API App ID, Tencent WeChat Pay Token | by name | `AKID` dropped: no vendor page confirmed it |
| Thunderstore | Thunderstore IO API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Twilio | Twilio Access Token, Twilio Account String Identifier, Twilio API Key | partial | `SK`; `AC` is an account id; auth token by name |
| Typeform | Typeform Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Uniwise | WISEflow API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Unkey | Unkey Root Key | yes | `unkey_` (public lists, no vendor page) |
| Val Town | Val Town API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Vercel | Vercel API Key, Vercel App Refresh Token, Vercel App User Access Token, Vercel Integration Access Token, Vercel Personal Access Token, Vercel Support Access Token | yes | `vcp_`, `vci_`, `vca_`, `vcr_`, `vck_` |
| VolcEngine | VolcEngine Access Key ID, VolcEngine Ark API Key | partial | `AKLT` (public lists, no vendor page); Ark key by name |
| Wakatime | WakaTime API Key, WakaTime App Secret, WakaTime OAuth Access Token, WakaTime OAuth Refresh Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Wave Mobile Money Inc. | Wave Production API Key, Wave Test API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Weatherstack | Weatherstack API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Weights & Biases | Weights & Biases API Key | by name | `wandb_v1_` dropped: no vendor page confirmed it |
| Workato | Workato Developer API Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| WorkOS | WorkOS Production API Key, WorkOS Staging API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| WSO2 | WSO2 Choreo Personal Access Token | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| xAI | xAI API Key | yes | `xai-` (public lists, no vendor page) |
| Yandex | Yandex.Cloud API Key, Yandex.Cloud Access Secret, Yandex.Cloud IAM Cookie, Yandex.Cloud IAM Token, Yandex.Cloud Smartchapta Server Key, Yandex.Dictionary API Key, Yandex.Passport OAuth Token, Yandex.Predictor API Key, Yandex.Translate API Key | by name | listed prefixes (`AQVN`, `YC`, `t1.`) are too short beside normal text |
| ZenHub | ZenHub Personal API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |
| Zuplo | Zuplo Consumer API Key | by name | GitHub publishes the name, no pattern; not picked. Hidden only next to a secret name. |

## Yelp detect-secrets: every plugin

| Plugin | Status | How, or why not |
|---|---|---|
| `artifactory` | partial | `AKCp`; `AP…` password shape not added: 2-letter prefix |
| `aws` | partial | Access key ids; secret by name (`aws_secret_access_key=`), 40 chars with no name stays |
| `azure_storage_key` | yes | `AccountKey=` by name |
| `basic_auth` | yes | URL credentials |
| `cloudant` | partial | As URL credential; bare key has no prefix |
| `discord` | yes | Bot token shape |
| `github_token` | yes | `gh[pousr]_`, `github_pat_` |
| `gitlab_token` | yes | `gl*-` family |
| `high_entropy_strings` | no | Not used: entropy flags git shas, hashes and base64 in normal output; a mask over display text would hide them all |
| `ibm_cloud_iam` | by name | By name only |
| `ibm_cos_hmac` | by name | By name only |
| `ip_public` | no | Not a secret for this mask |
| `jwt` | yes | `eyJ…` three parts |
| `keyword` | partial | Same idea as the generic name rule; its name list checked against ours (`api_key`, `auth_key`, `service_key`, `account_key`, `private_key`, `password`, `passwd`, `pwd`, `secret`, `contrasena`); `db_key`, `client_key` and `key_pass` not taken, too close to ordinary config names |
| `mailchimp` | yes | `<32 hex>-usNN` |
| `npm` | yes | `npm_`; `_authToken=` by name |
| `openai` | yes | `sk-` |
| `private_key` | partial | Key blocks; also PuTTY lines are not (see limits) |
| `pypi_token` | yes | `pypi-Ag` |
| `sendgrid` | yes | `SG.` |
| `slack` | yes | `xox*-`, webhook paths |
| `softlayer` | by name | By name only |
| `square_oauth` | yes | `sq0csp-` |
| `stripe` | yes | `sk_live_`, `rk_live_` |
| `telegram_token` | yes | `<digits>:<35>` |
| `twilio` | partial | `SK`; `AC` is an account id, not secret |

## TruffleHog: service names only

AGPL-3.0: only the directory names of `pkg/detectors` were read; no detector was opened and nothing is copied. The grouping is by name, not measured.

**A shape or URL rule here applies (105):** adobeio, airtablepersonalaccesstoken, alibaba, anthropic, artifactory, artifactoryreferencetoken, atlassian, aws, azure_entra, azure_storage, buildkite, circleci, cloudflareapitoken, cloudflarecakey, databrickstoken, deepseek, digitaloceantoken, digitaloceanv2, discordbottoken, discordwebhook, docker, dockerhub, doppler, dropbox, duffeltoken, facebookoauth, flutterwave, flyio, frameio, ftp, gcp, gcpapplicationdefaultcredentials, gemini, github, github_oauth2, githubapp, gitlab, gitlaboauth2, googlegemini, googleoauth2, grafana, grafanaserviceaccount, groq, hashicorpvault, hashicorpvaultauth, heroku, huggingface, jdbc, jwt, langsmith, ldap, linearapi, mailchimp, mailgun, maxmindlicense, microsoftteamswebhook, mongodb, newrelicbrowserkey, newrelicinsightsinsertkey, newrelicpersonalapikey, notion, npmtoken, npmtokenv2, octopusdeploy, openai, openaiadmin, openrouter, planetscale, planetscaledb, postgres, posthog, postman, prefect, privatekey, pulumi, pypi, rabbitmq, razorpay, readme, redis, replicate, resend, rubygems, sendgrid, sentryorgtoken, sentrytoken, shippo, shopify, shopifyoauth, slack, slackwebhook, sourcegraph, sourcegraphcody, sqlserver, square, squareapp, stripe, supabasetoken, tailscale, telegrambottoken, terraformcloudpersonaltoken, twilio, twilioapikey, uri, vercel.

**Not picked; hidden only next to a secret name (788):** abstract, abuseipdb, abyssale, accuweather, adafruitio, adzuna, aeroworkflow, agora, aha, airbrakeprojectkey, airbrakeuserkey, airship, airtableoauth, airvisual, aiven, alchemy, alconost, alegra, aletheiaapi, algoliaadminkey, alienvault, allsports, amadeus, ambee, amplitudeapikey, anypoint, anypointoauth2, apacta, api2cart, apideck, apiflash, apifonica, apify, apilayer, apimatic, apimetrics, apitemplate, apollo, appcues, appfollow, appointedd, appsynergy, apptivo, artsy, asanaoauth, asanapersonalaccesstoken, assemblyai, atera, atlassiandatacenter, audd, auth0managementapitoken, auth0oauth, autodesk, autoklose, autopilot, avazapersonalaccesstoken, aviationstack, axonaut, aylien, ayrshare, azure_batch, azure_cosmosdb, azure_openai, azureapimanagement, azureapimanagementsubscriptionkey, azureappconfigconnectionstring, azurecontainerregistry, azuredevopspersonalaccesstoken, azuredirectmanagementkey, azurefunctionkey, azuresastoken, azuresearchadminkey, azuresearchquerykey, bannerbear, baremetrics, beamer, beebole, besnappy, besttime, betterstack, billomat, bitbar, bitbucketapppassword, bitcoinaverage, bitfinex, bitlyaccesstoken, bitmex, blazemeter, blitapp, blocknative, blogger, bombbomb, boostnote, borgbase, box, boxoauth, braintreepayments, braintrust, brandfetch, browserstack, browshot, bscscan, buddyns, budibase, bugherd, bugsnag, bulbul, bulksms, buttercms, caflou, calendarific, calendlyapikey, calorieninja, campayn, cannyio, capsulecrm, captaindata, carboninterface, cashboard, caspio, censys, centralstationcrm, cexio, chartmogul, chatbot, chatfule, checio, checklyhq, checkout, checkvist, cicero, clarifai, clearbit, clickhelp, clicksendsms, clickuppersonaltoken, cliengo, clientary, clinchpad, clockify, clockworksms, closecrm, cloudconvert, cloudelements, cloudflareglobalapikey, cloudimage, cloudinary, cloudmersive, cloudplan, cloudsmith, cloverly, cloze, clustdoc, coda, codacy, codeclimate, codemagic, codequiry, coinapi, coinbase, coinlayer, coinlib, collect2, column, commercejs, commodities, companyhub, composio, confluent, contentfulpersonalaccesstoken, conversiontools, convertapi, convertkit, convier, copper, couchbase, countrylayer, courier, coveralls, craftmypdf, crowdin, cryptocompare, currencycloud, currencyfreaks, currencylayer, currencyscoop, currentsapi, customerguru, customerio, d7network, dailyco, dandelion, dareboost, databox, datadogapikey, datadogtoken, datagov, debounce, deepai, deepgram, delighted, demio, deno, deputy, detectify, detectlanguage, dfuse, diffbot, diggernaut, disqus, ditto, dnscheck, docparser, documo, docusign, dotdigital, dovico, dronahq, droneci, duo, duply, dwolla, dynalist, dyspatch, eagleeyenetworks, easyinsight, ecostruxureit, edamam, edenai, eightxeight, elasticemail, elevenlabs, enablex, endorlabs, enigma, envoyapikey, eraser, etherscan, ethplorer, eventbrite, everhour, exchangerateapi, exchangeratesapi, exportsdk, extractorapi, faceplusplus, fastforex, fastlypersonaltoken, feedier, fetchrss, fibery, figmapersonalaccesstoken, fileio, finage, financialmodelingprep, findl, finnhub, fireworks, fixerio, flatio, fleetbase, flexport, flickr, flightapi, flightlabs, flightstats, float, flowflu, fmfw, formbucket, formcraft, formio, formsite, foursquare, freshbooks, freshdesk, front, fulcrum, fullstory, fxmarket, geckoboard, generic, gengo, geoapify, geocode, geocodify, geocodio, geoipifi, getemail, getemails, getgeoapi, getgist, getresponse, getsandbox, gitter, glassnode, gocanvas, gocardless, godaddy, goodday, graphcms, graphhopper, groovehq, gtmetrix, guardianapi, gumroad, guru, gyazo, happyscribe, harness, harvest, hasura, hellosign, helpcrunch, helpscout, hereapi, hive, hiveage, holidayapi, holistic, honeycomb, host, html2pdf, hubspot_apikey, humanity, humioapitoken, hunter, hybiscus, hypertrack, ibmclouduserkey, iconfinder, iexapis, iexcloud, imagekit, imagga, impala, infisical, infura, insightly, instabot, instamojo, intercom, interseller, intra42, intrinio, invoiceocean, ip2location, ipapi, ipgeolocation, ipinfo, ipinfodb, ipquality, ipstack, jiratoken, jotform, jumpcloud, jupiterone, juro, kanban, kanbantool, karmacrm, keenio, kickbox, klaviyo, klipfolio, knapsackpro, kong, kontent, kraken, kucoin, kylas, lambdacloud, langfuse, languagelayer, larksuite, larksuiteapikey, launchdarkly, leadfeeder, lemlist, lemonsqueezy, lendflow, lessannoyingcrm, lexigram, linemessaging, linenotify, linkpreview, liveagent, livestorm, loadmill, lob, locationiq, loggly, loginradius, logzio, lokalisetoken, loyverse, lunchmoney, luno, m3o, madkudu, magicbell, magnetic, mailboxlayer, mailerlite, mailjetbasicauth, mailjetsms, mailmodo, mailsac, mandrill, manifest, mapbox, mapquest, marketstack, mattermostpersonaltoken, mavenlink, meaningcloud, mediastack, meistertask, meraki, mesibo, messagebird, metaapi, metabase, metrilo, mindmeister, miro, mite, mixmax, mixpanel, mockaroo, moderation, monday, monkeylearn, moonclerk, moosend, moralis, mrticktock, mux, myfreshworks, myintervals, nasdaqdatalink, nethunt, netlify, netsuite, neutrinoapi, newrelicinsightsquerykey, newreliclicensekey, newrelicmobileapptoken, newrelicuserkey, newsapi, newscatcher, nexmoapikey, nftport, ngc, ngrok, nicereply, nightfall, nimble, noticeable, nozbeteams, nugetapikey, numverify, nutritionix, nvapi, nylas, oanda, okta, omnisend, onedesk, onelogin, onepagecrm, onesignal, onfleet, oopspam, opencagedata, openuv, openvpn, openweather, opsgenie, optimizely, overloop, owlbot, packagecloud, pagarme, pagerdutyapikey, pandadoc, pandascore, paperform, paralleldots, parsehub, parsers, parseur, partnerstack, pastebin, paydirtapp, paymoapp, paymongo, paypaloauth, paystack, pdflayer, pdfshift, peopledatalabs, pepipost, percy, pganalyzereadkey, photoroom, phraseaccesstoken, pinata, pinecone, pipedream, pipedrive, pivotaltracker, pixabay, plaidkey, planviewleankit, planyo, plivo, podio, pollsapi, poloniex, polygon, portainer, portainertoken, positionstack, postageapp, postbacks, postmark, powrbot, privacy, prodpad, prospectcrm, protocolsio, proxycrawl, pubnubpublishkey, pubnubsubscriptionkey, purestake, pushbulletapikey, pusherchannelkey, qase, qualaroo, qubole, railwayapp, ramp, rapidapi, raven, rawg, reachmail, reallysimplesystems, rebrandly, rechargepayments, redhatpyxis, refiner, rentman, repairshopr, replyio, requestfinance, restpackhtmltopdfapi, restpackscreenshotapi, rev, revampcrm, ringcentral, ritekit, roaring, robinhoodcrypto, rocketreach, rootly, route4me, rownd, runrunit, saladcloudapikey, salesblink, salescookie, salesflare, salesforce, salesforceoauth2, salesforcerefreshtoken, salesmate, sanity, satismeterprojectkey, satismeterwritekey, saucelabs, scalewaykey, scalr, scrapeowl, scraperapi, scraperbox, scrapestack, scrapfly, scrapingant, scrapingbee, screenshotapi, screenshotlayer, scrutinizerci, securitytrails, segmentapikey, selectpdf, semaphore, sendbird, sendbirdorganizationapi, sendinbluev2, serphouse, serpstack, sheety, sherpadesk, shipday, shodankey, shortcut, shotstack, shutterstock, shutterstockoauth, signable, signalwire, signaturit, signupgenius, sigopt, simfin, simplesat, simplynoted, simvoly, sinchmessage, sirv, siteleaf, skrappio, skybiometry, smartsheets, smartystreets, smooch, snipcart, snowflake, snykkey, solarwindsobservability, sonarcloud, sonarqube, sparkpost, spectralops, speechtextai, splunkobservabilitytoken, spoonacular, sportsmonk, spotifykey, squarespace, sslmate, statuscake, statuspage, statuspal, stitchdata, stockdata, storecove, stormboard, stormglass, storyblok, storyblokpersonalaccesstoken, storychief, strava, streak, stripepaymentintent, stripo, stytch, sugester, sumologickey, supernotesapi, surveyanyplace, surveybot, surveysparrow, survicate, swell, swiftype, tableau, tallyfy, tatumio, taxjar, teamgate, teamworkcrm, teamworkdesk, teamworkspaces, technicalanalysisapi, tefter, teletype, telnyx, testingbot, textmagic, theoddsapi, thinkific, thousandeyes, ticketmaster, tickettailor, tiingo, timecamp, timezoneapi, tineswebhook, tly, tmetric, todoist, toggltrack, tokeet, tomorrowio, tomtom, tradier, transferwise, travelpayouts, travisci, trelloapikey, tru, trufflehogenterprise, twelvedata, twist, twitch, twitchaccesstoken, twitter, twitterconsumerkey, tyntec, typeform, typetalk, ubidots, uclassify, unifyid, unplugg, unsplash, upcdatabase, uplead, uploadcare, uptimerobot, upwave, urlscan, user, userflow, userstack, vagrantcloudpersonaltoken, vatlayer, vbout, verifier, verifierauth, verimail, veriphone, versioneye, viewneo, virustotal, visualcrossing, voiceflow, voicegain, voodoosms, vouchery, vpnapi, vultrapikey, vyte, walkscore, weatherbit, weatherstack, web3storage, webex, webexbot, webflow, webscraper, webscraping, websitepulse, weightsandbiases, wepay, whoxy, wistia, wit, wiz, worksnaps, workstack, worldcoinindex, worldweather, wrike, xai, yandex, yelp, youneedabudget, yousign, youtubeapikey, zapierwebhook, zendeskapi, zenkitapi, zenrows, zenscrape, zenserp, zeplin, zerobounce, zerotier, zipapi, zipbooks, zipcodeapi, zipcodebase, zohocrm, zonkafeedback, zulipchat.
