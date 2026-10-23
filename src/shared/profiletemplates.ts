/**
 * Templates for a new profile file (spec 043 FR-013, FR-018; owner decision 2026-10-21). The default is an **Agent Success
 * Profile**, modelled on an HR job success profile; the other is a **Standard agent** (Claude Code's subagent shape: name,
 * description, tools, model, then the system prompt). Both are valid agent Markdown for the chosen agent app. No imports: the page
 * loads the compiled file as a plain script after `exports-shim.js` (main and the simulator use the same text). Placeholder
 * guidance only: no paths, no secrets, and read-only tools so a new profile never widens what an agent may do.
 */

export type TemplateApp = 'copilot' | 'claude';
export type TemplateKind = 'success' | 'standard';
export const PROFILE_TEMPLATES: readonly { id: TemplateKind; label: string; note: string }[] = [
  { id: 'success', label: 'Agent Success Profile', note: 'Title, reporting lines, behaviors, success criteria, skills, tools and responsibilities, like a job success profile.' },
  { id: 'standard', label: 'Standard agent', note: 'Name, description, tools and model, then the instructions (the agent app\'s usual format).' },
];
export const DEFAULT_TEMPLATE: TemplateKind = 'success';

/**
 * The sections of an Agent Success Profile, in order (headings in the file; the AI path checks they are all there). Spec 043 FR-043
 * (owner request 2026-10-23, issue #570): role and goal, scope, inputs, a working method, the quality bar, safety limits, output and
 * when to ask. The guidance names no agent app or tool, so the file reads the same in any agent app (constitution I).
 */
export const SUCCESS_SECTIONS: readonly { heading: string; guide: string }[] = [
  { heading: 'Role and goal', guide: 'Your title in a few words, the one goal you work towards, whom you report to, which agents you hand work to (or "None"), and the knowledge you bring.' },
  { heading: 'Scope and non-goals', guide: 'What you do, and what you leave alone even when asked in passing.' },
  { heading: 'Inputs and context to gather first', guide: 'What you read or ask for before you start: the task, the files or notes involved, the rules that apply.' },
  { heading: 'Working method', guide: 'Your steps, numbered, from understanding the task to checking the result.' },
  { heading: 'Quality bar and definition of done', guide: 'Checkable points that tell you the work is finished and good enough.' },
  { heading: 'Safety limits', guide: 'Anything you must never do beyond the two lines below, and the limits on each tool you use.' },
  { heading: 'Output format', guide: 'What your answer looks like: its parts, its length, and how you report what you changed and what you did not check.' },
  { heading: 'When to ask the user', guide: 'The moments you stop and ask before going on: unclear goals, risky or irreversible steps, anything outside your scope.' },
];
/**
 * FR-043: two lines every Agent Success Profile keeps in its Safety limits, word for word: the session's permission mode decides
 * (constitution II), and no secrets (constitution III). The AI reply check warns when one is missing.
 */
export const SAFETY_LINES: readonly string[] = [
  "- The session's permission mode decides what you may do: never ask to widen it and never work around an action that was denied.",
  '- Never read, print, store or commit secrets: tokens, keys, passwords, .env files or credentials.',
];

/** Read-only tools for a new file: a template never grants more than reading and searching. */
const READ_TOOLS: Record<TemplateApp, string> = { claude: 'tools: Read, Grep, Glob', copilot: 'tools: [view, grep, glob]' };
/** Claude Code takes `model: inherit` (the session's model); Copilot model ids differ per plan, so none is written. */
const MODEL: Record<TemplateApp, string> = { claude: 'model: inherit\n', copilot: '' };

export function profileTemplate(app: TemplateApp, name: string, kind: TemplateKind = DEFAULT_TEMPLATE): string {
  if (kind === 'standard') {
    return `---\nname: ${name}\ndescription: What this agent does and when to use it, in one line\n${READ_TOOLS[app]}\n${MODEL[app]}---\n\nYou are ${name}. Describe the agent's job, how it works, what it checks and what it never does.\n`;
  }
  const sections = SUCCESS_SECTIONS.map((s) => `## ${s.heading}\n\n${s.guide}\n${s.heading === 'Safety limits' ? '\n' + SAFETY_LINES.join('\n') + '\n' : ''}`).join('\n');
  return `---\nname: ${name}\ndescription: What this agent is accountable for and when to use it, in one line\n${READ_TOOLS[app]}\n${MODEL[app]}---\n\n# Agent Success Profile: ${name}\n\n${sections}`;
}

/* ---------------- Create with AI (spec 043 FR-026, FR-027) ---------------- */

export const MAX_GEN_DESCRIPTION = 2000;
export const MAX_GEN_ANSWER = 600;
/** The save path's limit (spec 043 FR-011), shared so a checked reply can always be saved (FR-035). UTF-8 bytes. */
export const MAX_PROFILE_BYTES = 256 * 1024;
/** Claude Code's own cap on an agent file (the Claude adapter's MAX_AGENT_BYTES, spec 043 FR-021; `test:profilegen` keeps them equal). */
export const MAX_CLAUDE_PROFILE_BYTES = 64 * 1024;
/** The most a profile file may hold for its app: the same numbers as `maxBytesFor` in main (FR-012, FR-021, FR-035). */
export const maxProfileBytes = (app: TemplateApp): number => (app === 'claude' ? MAX_CLAUDE_PROFILE_BYTES : MAX_PROFILE_BYTES);
export const MAX_GEN_TOOLS = 20;
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** The questionnaire: one optional question per section (FR-026). */
export const PROFILE_QUESTIONS: readonly { id: string; section: string; question: string; hint: string }[] = [
  { id: 'role', section: 'Role and goal', question: 'What is its role, and the one goal it works towards?', hint: 'Release reviewer for the payments service; no risky change ships unseen' },
  { id: 'scope', section: 'Scope and non-goals', question: 'What is in scope, and what must it leave alone?', hint: 'Reviews pull requests; does not refactor or fix code itself' },
  { id: 'inputs', section: 'Inputs and context to gather first', question: 'What should it read or ask for before it starts?', hint: 'The diff, the linked issue, the team rules for payments' },
  { id: 'method', section: 'Working method', question: 'How should it work, step by step?', hint: 'Read the issue, read the diff, check tests, list risks' },
  { id: 'quality', section: 'Quality bar and definition of done', question: 'When is the work done and good enough?', hint: 'Every changed file looked at; no missed security or rounding issue' },
  { id: 'safety', section: 'Safety limits', question: 'What must it never do, and how may it use its tools?', hint: 'Reads code only; never edits files or runs deploy commands' },
  { id: 'output', section: 'Output format', question: 'What should its answer look like?', hint: 'A short list of risks, most important first, under ten lines' },
  { id: 'ask', section: 'When to ask the user', question: 'When should it stop and ask you?', hint: 'When the goal is unclear or a change touches money handling' },
];

/** Read-only tools a template starts with: the only tools allowed without the Extra tools line listing them (FR-027, FR-032). */
export const DEFAULT_READ_TOOLS: Record<TemplateApp, readonly string[]> = { claude: ['Read', 'Grep', 'Glob'], copilot: ['view', 'grep', 'glob'] };
/** Tools beyond read-only that a user's text may mention (FR-033): a mention is warned about, never granted. */
export const KNOWN_EXTRA_TOOLS: Record<TemplateApp, readonly string[]> = {
  claude: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
  copilot: ['shell', 'bash', 'powershell', 'edit', 'write', 'web', 'fetch'],
};
const TOOL_ENTRY = /^[A-Za-z][\w.:-]{0,60}(?:\([^(),\n\r]{1,80}\))?$/;

/** FR-031: the Extra tools line, parsed (main parses it again; the renderer's copy is only a hint). Empty or missing: no extra tools. */
export function parseToolList(line: unknown): { ok: true; tools: string[] } | { ok: false; error: string } {
  if (line === undefined || line === null) return { ok: true, tools: [] };
  if (typeof line !== 'string') return { ok: false, error: 'The Extra tools line is not text.' };
  if (line.length > 2000) return { ok: false, error: 'The Extra tools line is too long.' };
  const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > MAX_GEN_TOOLS) return { ok: false, error: `List at most ${MAX_GEN_TOOLS} extra tools.` };
  const bad = parts.filter((x) => !TOOL_ENTRY.test(x));
  if (bad.length) return { ok: false, error: `Not a tool name: ${bad[0].slice(0, 80)}. Write tool names separated by commas, such as Bash(git:*), Edit.` };
  const seen = new Set<string>();
  return { ok: true, tools: parts.filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase())) };
}
const FM_KEYS: Record<TemplateApp, string> = {
  claude: 'name, description, tools (a comma-separated list, e.g. "tools: Read, Grep, Glob"), model ("inherit" or leave it out)',
  copilot: 'name, description, tools (a YAML list in brackets, e.g. "tools: [view, grep, glob]"); no model line',
};
const oneLine = (s: unknown, max: number): string => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);

export interface GenInput {
  app: TemplateApp;
  name: string;
  /** 'describe': `description`; 'questions': `answers` by question id. */
  mode: 'describe' | 'questions';
  description?: string;
  answers?: Record<string, string>;
  /** FR-031: the parsed Extra tools line; the only source of tools beyond the read-only defaults. */
  tools?: string[];
}

/** The user's own text from the input, capped: what the prompt carries (it never grants a tool, FR-032). */
export function userTextOf(input: GenInput): string {
  if (input.mode === 'describe') return oneLine(input.description, MAX_GEN_DESCRIPTION);
  const a = input.answers ?? {};
  return PROFILE_QUESTIONS.map((q) => oneLine(a[q.id], MAX_GEN_ANSWER)).filter(Boolean).join('\n');
}

/** One prompt (FR-026): the target app's front matter rules, the skeleton and only what the user typed. */
export function buildProfilePrompt(input: GenInput): string {
  const app = input.app;
  const appName = app === 'claude' ? 'Claude Code (a subagent file)' : 'GitHub Copilot (a custom agent file)';
  const skeleton = profileTemplate(app, input.name, 'success');
  let about: string;
  if (input.mode === 'describe') about = `The user describes the agent like this:\n"""\n${oneLine(input.description, MAX_GEN_DESCRIPTION)}\n"""`;
  else {
    const a = input.answers ?? {};
    const lines = PROFILE_QUESTIONS.map((q) => ({ q, v: oneLine(a[q.id], MAX_GEN_ANSWER) })).filter((x) => x.v).map((x) => `- ${x.q.question} (section "${x.q.section}")\n  """${x.v}"""`);
    about = lines.length ? `The user answered these questions (others were left empty: fill those sections with modest defaults marked "Assumed:"):\n${lines.join('\n')}` : 'The user left every question empty: write a modest, general profile, with each section marked "Assumed:".';
  }
  return [
    `Write an "Agent Success Profile" as a Markdown agent file for ${appName}. It is modelled on a job success profile: it tells an agent what success looks like and how to get there.`,
    'Reply with the file content only: no explanation, no code fence, no HTML.',
    `Front matter between --- lines, with only these keys: ${FM_KEYS[app]}. Keep "name: ${input.name}" exactly.`,
    `Tools: the tools line may hold only these, written exactly: ${allowedTools(input).join(', ')}. Tools named in the user's text below are not granted unless they are in that list. Never add any other tool, never "*", and never leave the tools line out.`,
    'Then the heading "# Agent Success Profile: <name>" and these sections as "## " headings, in this order: ' + SUCCESS_SECTIONS.map((s) => s.heading).join('; ') + '.',
    'Before you write, think the role through: first the one goal and what "done" means for it, then what the agent must know before it starts, then the steps that get it there, then where it could go wrong. Write only the result.',
    'Make every line concrete and checkable: replace each guidance line of the template with the agent\'s own text, a few short lines per section. "Working method" is a numbered list of steps. "Quality bar and definition of done" is a list of points someone could check.',
    'In "Safety limits", keep these two lines word for word, then add the agent\'s own limits:\n' + SAFETY_LINES.join('\n'),
    'Where the user said nothing about a section, write a modest default and start it with "Assumed:", so the user sees what to check.',
    'Write the instructions in the second person ("You ...") so they work in any agent app (harness-agnostic): do not name an agent app, a vendor or a tool in the sections (tools belong only in the tools line). No file paths, URLs, secrets or credentials.',
    '',
    'The template to fill in:',
    skeleton,
    about,
  ].join('\n');
}

/** FR-032: the read-only defaults plus the Extra tools line. */
export function allowedTools(input: GenInput): string[] {
  const out = [...DEFAULT_READ_TOOLS[input.app]];
  for (const t of input.tools ?? []) if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

/**
 * FR-034, FR-038: `name: <name>` inside the front matter only (rewritten, or inserted first when missing); body lines are never
 * touched. The `name` key is found with the editor's own parser, so a quoted (`"name":`, `'name':`) or spaced (`name :`) key is the
 * same key, and an indented continuation of its old value (`name: >` and the lines under it) goes with it.
 */
function setFrontmatterName(t: string, name: string, parse: (t: string) => FrontmatterParse): string {
  const fm = parse(t);
  if (!fm.has || !fm.closed) return t;
  const lines = t.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
  const hits = fm.entries.filter((e) => e.key === 'name');
  if (!hits.length) {
    lines.splice(1, 0, `name: ${name}`);
    return lines.join('\n');
  }
  // from the last one up, so earlier line numbers stay right (the parser already refuses a key given twice)
  for (const h of [...hits].reverse()) {
    const i = h.line - 1;
    let j = i + 1;
    while (j < end && (/^[ \t]/.test(lines[j]) || /^\s*(#.*)?$/.test(lines[j]))) j++;
    while (j > i + 1 && /^\s*(#.*)?$/.test(lines[j - 1])) j--; // keep blank and comment lines after the value
    lines.splice(i, j - i, ...(h === hits[0] ? [`name: ${name}`] : []));
  }
  return lines.join('\n');
}

export interface FrontmatterParse {
  has: boolean;
  closed: boolean;
  entries: { key: string; value: string; line: number }[];
  errors: { line: number; msg: string }[];
  body: string;
}

/**
 * The check of a generated file (FR-027). `parse` is the editor's front matter check (profileeditor.js), passed in so there is
 * one parser. Returns the cleaned text, or the reason it is refused. Never adds a tool.
 */
export function validateGeneratedProfile(reply: string, input: GenInput, parse: (t: string) => FrontmatterParse): { ok: true; text: string; warnings: string[]; extraTools: string[] } | { ok: false; error: string } {
  let t = String(reply ?? '').replace(/\r\n/g, '\n').trim();
  // a cheap early stop (a character is at least one byte); the real cap is in bytes, after neutralising (FR-035)
  if (t.length > MAX_PROFILE_BYTES) return { ok: false, error: 'The reply is too long.' };
  const fence = /^```[A-Za-z]*\n([\s\S]*?)\n```$/.exec(t);
  if (fence) t = fence[1].trim();
  const warnings: string[] = [];
  const before = t;
  // HTML is neutralised, not stripped: every "<" that could open a tag (or a comment, doctype or processing instruction) becomes
  // "&lt;" in one pass, so no tag can survive or be re-formed (`<scr<script>ipt>` included); the preview shows it as text (FR-027)
  t = t.replace(/<(?=[A-Za-z!/?])/g, '&lt;');
  if (t !== before) warnings.push('HTML in the reply is kept as plain text');
  const fm = parse(t);
  if (!fm.has || !fm.closed) return { ok: false, error: 'The reply has no front matter (--- lines).' };
  if (fm.errors.length) return { ok: false, error: 'The front matter does not parse: ' + fm.errors[0].msg };
  const keys = fm.entries.map((e) => e.key);
  const extra = keys.filter((k) => !['name', 'description', 'tools', 'model'].includes(k));
  if (extra.length) return { ok: false, error: `The front matter has keys a profile here may not set: ${extra.join(', ')}.` };
  const v = Object.fromEntries(fm.entries.map((e) => [e.key, e.value]));
  if (!v.description) return { ok: false, error: 'The reply has no description.' };
  if (!('tools' in v) || !String(v.tools).trim()) return { ok: false, error: 'The reply has no tools line (that would allow every tool).' };
  const tools = String(v.tools).split(',').map((x) => x.trim()).filter(Boolean);
  // FR-032: only the read-only defaults and the Extra tools line; the user's text never grants a tool
  const allowed = new Set(allowedTools(input).map((x) => x.toLowerCase()));
  const broader = tools.filter((x) => !allowed.has(x.toLowerCase()));
  if (tools.includes('*') || broader.length) return { ok: false, error: `The reply gives tools you did not list: ${(tools.includes('*') ? ['*', ...broader] : broader).join(', ')}. Durbar never adds tools; list them under Extra tools if the agent needs them.` };
  if (input.app === 'claude' && v.model && !/^(inherit|haiku|sonnet|opus|[A-Za-z0-9._-]{1,60})$/.test(v.model)) return { ok: false, error: 'The model line is not a model name.' };
  const heads = [...fm.body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase());
  const missing = SUCCESS_SECTIONS.filter((s) => !heads.includes(s.heading.toLowerCase())).map((s) => s.heading);
  if (missing.length) return { ok: false, error: `The reply misses sections: ${missing.join(', ')}.` };
  // the chosen name, whatever the reply said, only inside the front matter (FR-034)
  t = setFrontmatterName(t, input.name, parse);
  // FR-038: parsed again, so the saved file has exactly one name and it is the chosen one
  const after = parse(t);
  const names = after.entries.filter((e) => e.key === 'name');
  if (after.errors.length || names.length !== 1 || names[0].value !== input.name) return { ok: false, error: 'The reply\'s name line could not be set; try again.' };
  if (!t.endsWith('\n')) t += '\n';
  if (utf8Bytes(t) > maxProfileBytes(input.app)) return { ok: false, error: `The reply is too long (over ${maxProfileBytes(input.app) / 1024} KB, the most ${input.app === 'claude' ? 'Claude Code' : 'Copilot'} takes in an agent file).` };
  // FR-033: what the draft grants beyond read-only, and tools the text mentions that are not granted
  const defaults = new Set(DEFAULT_READ_TOOLS[input.app].map((x) => x.toLowerCase()));
  const extraTools = tools.filter((x) => !defaults.has(x.toLowerCase()));
  const words = new Set(userTextOf(input).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const listed = new Set((input.tools ?? []).map((x) => x.toLowerCase().replace(/\(.*$/, '')));
  for (const k of KNOWN_EXTRA_TOOLS[input.app]) if (words.has(k.toLowerCase()) && !listed.has(k.toLowerCase())) warnings.push(`You mentioned ${k}; it is not granted unless listed under Extra tools`);
  if (extraTools.length) warnings.push(`Tools beyond read-only: ${extraTools.join(', ')}. Check them before saving`);
  // FR-043: the two safety lines (warned, not refused: the user can add them in the editor before saving)
  const safety = (/^##\s+Safety limits\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(fm.body) || ['', ''])[1].toLowerCase();
  if (!/permission mode/.test(safety)) warnings.push('Safety limits does not say that the session\'s permission mode decides what the agent may do; add it before saving');
  if (!/secret/.test(safety)) warnings.push('Safety limits does not forbid handling secrets; add it before saving');
  return { ok: true, text: t, warnings, extraTools };
}
