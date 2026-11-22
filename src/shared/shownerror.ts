/**
 * Spec 045 FR-066 (issue #1682): a refusal or failure whose message Agent Durbar wrote for the person (or a runtime's reason a spec says to
 * show, such as spec 058 FR-012). Only this kind of error keeps its message when an `ipcHandle` channel answers the window with a throw, and
 * that message is masked again on the way (`answer` in `src/main/ipcguard.ts`). Any other thrown value is unexpected: the window gets one
 * fixed text, and the real error is logged in main only, masked.
 */
export class ShownError extends Error {
  constructor(message: string) {
    super(message);
  }
}
