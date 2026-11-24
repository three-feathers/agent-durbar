/**
 * Spec 003 FR-121..FR-127: the fixed sentences of the agent app's reviewer switch (assisted approvals), for main's answers and the
 * activity log. Plain text only; no vendor type. Only Copilot offers the switch today (`capabilities.assistedApproval`), so its name is in them.
 */

/** FR-121: an agent app without the capability. */
export const NO_ASSISTED = 'This agent app has no assisted approvals.';
/** FR-127: a policy block and a live fallback (refusal, chat note, log row). The runtime's own text is never shown. */
export const ASSISTED_POLICY_LINE = "Your organization turned off Copilot's assisted approvals. This session stays in Ask first.";
/** FR-123: the app did not turn it on (no such call in this runtime, it failed or did not answer). Never retried silently. */
export const ASSISTED_UNSUPPORTED_LINE = "Copilot did not turn on its reviewer, so this session stays in plain Ask first. Nothing was retried.";
/** FR-126 (C6): never together with remote control, either way round. */
export const ASSISTED_REMOTE = 'Stop remote control first: assisted approvals and remote control from GitHub are never on together.';
/** FR-120: Ask first only. */
export const ASSISTED_NOT_ASK = "Copilot's reviewer works in Ask first only. Switch to Ask first, then turn it on.";
/** C8: the real check (T056) has not passed for this app (`assistedApproval.verified` is false): main never turns it on. */
export const ASSISTED_UNVERIFIED = "Copilot's reviewer has not been checked on a real session yet, so Agent Durbar does not turn it on.";
/** FR-121: the switch is set on a running session (FR-129: never saved). */
export const ASSISTED_NOT_RUNNING = "Send a message first so the session is running, then turn on Copilot's reviewer.";
/** FR-122: the activity log's `mode-change` rows. */
export const ASSISTED_ON_ROW = 'Ask first to Ask first + review';
export const ASSISTED_OFF_ROW = 'Ask first + review to Ask first';
