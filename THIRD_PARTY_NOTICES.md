# Third-party notices

Agent Durbar's own licence is in [LICENSE](LICENSE). Dependencies carry their own licences in their packages.

## gitleaks

Some secret formats in `src/shared/redact.ts` were written from the rules in gitleaks' `config/gitleaks.toml` (commit 5f6ec56, read 2026-11-01); see [the coverage table](specs/012-claude-codex-adapters/secret-coverage.md). The same notice is in that source file, so it ships in the built app.

```text
MIT License

Copyright (c) 2019 Zachary Rice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Consulted, nothing copied

Yelp detect-secrets (Apache-2.0): compared with its plugin list. TruffleHog (AGPL-3.0): only the names of its detector directories were read, to list services in the coverage table; no code, pattern or format was taken from it. GitHub's *Supported secret scanning patterns* page: names only.
