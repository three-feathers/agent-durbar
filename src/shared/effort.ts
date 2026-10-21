/**
 * Spec 007 FR-008: a reasoning effort as the agent apps name it. The list is the runtime's (each model's own `efforts`), not ours:
 * real models list `none` too (Copilot `gpt-6-luna`, Codex models, 2026-10-20), and a new value must not be dropped silently. So a
 * value is accepted when it is a short lower-case word; the model's own list (where one is known) and the runtime decide the rest.
 */
export function parseEffort(v: unknown): string | undefined {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,19}$/.test(v) ? v : undefined;
}
