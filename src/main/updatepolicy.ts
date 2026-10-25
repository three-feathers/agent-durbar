/**
 * Spec 081 FR-022, T033: the organization policy as the update check needs it. Spec 076 (managed configuration) has no reader yet,
 * so this answers `none` and only the user's switch applies (`[KNOWN GAP]`, stated in the spec and the README). When 076's reader
 * lands, this one function returns its `allowInAppInstall`, `features.agentAppUpdateCheck`, `updates.mode` and `agentApps.versions.<app>.max`,
 * and `unreadable` for a policy that is present but cannot be read (the start check then does not run: fail closed).
 */
import type { UpdatePolicy } from '../shared/updatecheck';

export function updatePolicy(): UpdatePolicy {
  return { state: 'none' };
}
