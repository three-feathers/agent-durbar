/**
 * Spec 045 FR-066 (issue #1682): a refusal or failure whose message Agent Durbar wrote for the person (or a runtime's reason a spec says to
 * show, such as spec 058 FR-012). Since 2026-11-23 (owner decision, issue #2060 item 1) every `Error`'s message reaches the window the same way,
 * masked (`failText` in `src/main/ipcerror.ts`); the class still marks words written for the person, which the adapters and main throw on purpose.
 */
export class ShownError extends Error {
  constructor(message: string) {
    super(message);
  }
}
