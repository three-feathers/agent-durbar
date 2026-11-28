/**
 * The credential folders under the home folder (`~/<entry>`, `/` inside an entry is a separator on every OS), one list for the OS sandbox
 * (`src/adapters/sandboxRoots.ts`) and the office memory folder check (`memoryfolder.ts`, spec 116 FR-004; FR-031 of spec 021: no second list
 * that can drift). No imports: both the adapters and the shared code may use it.
 */
export const HOME_SECRETS: readonly string[] = Object.freeze([
  '.ssh', '.aws', '.config/gh', '.gnupg', '.netrc', '.npmrc', '.git-credentials', '.docker', '.kube', '.azure', '.config/gcloud', '.claude', '.copilot', '.codex',
  // spec 116 FR-004 (review of PR 2116): browser profiles and password stores
  '.mozilla', 'snap/firefox', '.var/app', '.password-store', '.pki', '.terraform.d', 'snap/chromium', '.thunderbird',
]);
