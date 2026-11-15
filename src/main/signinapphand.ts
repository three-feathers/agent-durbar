import type { SignInAppChoice } from '../shared/signinapp';
import { addSignInAppMaskId, maskSignInAppText } from './mcpmask';

/**
 * Spec 058 FR-236..FR-238 (issue #1667; review of #1681, F2): main's two wiring points of the Copilot sign-in app, kept out of `main.ts`
 * so `test-signinapp` drives them with a fake adapter and a fake sink (and checks that `main.ts` uses them).
 */
export interface SignInAppHandDeps {
  /** True only when the Copilot adapter is registered with the `signInAppChoice` capability (the simulator's stand-in has none). */
  available(): boolean;
  /** The Copilot adapter (created for it if need be: no client starts here). */
  adapter(): { setSignInApp?(choice: SignInAppChoice | undefined): string | undefined };
}

/**
 * FR-237/FR-238: hand a stored or saved choice to the adapter; FR-236: the client ID it will use (VS Code's default included) is added to
 * the masked IDs, so it never shows in a masked text or the debug log. Nothing is handed or masked when the adapter is not available.
 */
export function createSignInAppHand(d: SignInAppHandDeps): (choice: SignInAppChoice | undefined) => void {
  return (choice) => {
    if (!d.available()) return;
    addSignInAppMaskId(d.adapter().setSignInApp?.(choice));
  };
}

/** FR-236: the `DURBAR_LOG` sink's append with every sign-in app ID of this run masked in each line (after the sink's own redact). */
export function maskedAppend(append: (file: string, data: string) => void): (file: string, data: string) => void {
  return (file, data) => append(file, maskSignInAppText(data));
}
