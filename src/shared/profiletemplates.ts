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

/** The sections of an Agent Success Profile, in order (headings in the file; the AI path checks they are all there). */
export const SUCCESS_SECTIONS: readonly { heading: string; guide: string }[] = [
  { heading: 'Title', guide: 'The role in a few words, for example "Release reviewer for the payments service".' },
  { heading: 'People responsibility', guide: 'Other agents that report to this one and what it delegates to them. Write "None" when it works alone.' },
  { heading: 'Reporting to', guide: 'Whom this agent reports to (you, a lead agent) and when it must check in or escalate.' },
  { heading: 'Behaviors', guide: 'How it works: tone, how much it explains, what it asks before acting, what it never does.' },
  { heading: 'Key Success Criteria', guide: 'How you judge a good result, as checkable points (tests pass, no new warnings, a short summary).' },
  { heading: 'Skills', guide: 'The knowledge it needs to do the job: languages, frameworks, domain rules.' },
  { heading: 'Tools and accountability', guide: 'Each tool it may use, what for, and its limits (for example: reads files freely, edits only after you agree, never runs deploy commands).' },
  { heading: 'Key responsibilities', guide: 'The main duties, most important first.' },
];

/** Read-only tools for a new file: a template never grants more than reading and searching. */
const READ_TOOLS: Record<TemplateApp, string> = { claude: 'tools: Read, Grep, Glob', copilot: 'tools: [view, grep, glob]' };
/** Claude Code takes `model: inherit` (the session's model); Copilot model ids differ per plan, so none is written. */
const MODEL: Record<TemplateApp, string> = { claude: 'model: inherit\n', copilot: '' };

export function profileTemplate(app: TemplateApp, name: string, kind: TemplateKind = DEFAULT_TEMPLATE): string {
  if (kind === 'standard') {
    return `---\nname: ${name}\ndescription: What this agent does and when to use it, in one line\n${READ_TOOLS[app]}\n${MODEL[app]}---\n\nYou are ${name}. Describe the agent's job, how it works, what it checks and what it never does.\n`;
  }
  const sections = SUCCESS_SECTIONS.map((s) => `## ${s.heading}\n\n${s.guide}\n`).join('\n');
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
  { id: 'title', section: 'Title', question: "What is this agent's job or title?", hint: 'Release reviewer for the payments service' },
  { id: 'reportsTo', section: 'Reporting to', question: 'Who does it report to?', hint: 'Me; it checks in before any change' },
  { id: 'reports', section: 'People responsibility', question: 'Which agents report to it?', hint: 'None, or: a test writer it hands test work to' },
  { id: 'duties', section: 'Key responsibilities', question: 'What are its key responsibilities?', hint: 'Review pull requests, flag risky changes' },
  { id: 'success', section: 'Key Success Criteria', question: 'How do you judge success?', hint: 'No missed security issue, short clear notes' },
  { id: 'skills', section: 'Skills', question: 'Which skills does it need?', hint: 'TypeScript, payments rules, reading diffs' },
  { id: 'tools', section: 'Tools and accountability', question: 'How should it use its tools, and what must it never do?', hint: 'Reads code only; never edits files' },
  { id: 'behavior', section: 'Behaviors', question: 'How should it behave and when should it escalate?', hint: 'Calm, brief; asks me when unsure' },
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
    about = lines.length ? `The user answered these questions (others were left empty: fill those sections with sensible, modest defaults):\n${lines.join('\n')}` : 'The user left every question empty: write a modest, general profile.';
  }
  return [
    `Write an "Agent Success Profile" as a Markdown agent file for ${appName}. It is modelled on a job success profile.`,
    'Reply with the file content only: no explanation, no code fence, no HTML.',
    `Front matter between --- lines, with only these keys: ${FM_KEYS[app]}. Keep "name: ${input.name}" exactly.`,
    `Tools: the tools line may hold only these, written exactly: ${allowedTools(input).join(', ')}. Tools named in the user's text below are not granted unless they are in that list. Never add any other tool, never "*", and never leave the tools line out.`,
    'Then the heading "# Agent Success Profile: <name>" and these sections as "## " headings, in this order, each with a few short, concrete lines: ' + SUCCESS_SECTIONS.map((s) => s.heading).join('; ') + '.',
    'Write the agent\'s instructions in the second person ("You ..."). No file paths, URLs, secrets or credentials.',
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

/** FR-034: `name: <name>` inside the front matter only (rewritten, or inserted first when missing); body lines are never touched. */
function setFrontmatterName(t: string, name: string): string {
  const lines = t.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
  if (lines[0].trimEnd() !== '---' || end < 0) return t;
  const at = lines.slice(1, end).findIndex((l) => /^name\s*:/.test(l));
  if (at >= 0) lines[at + 1] = `name: ${name}`;
  else lines.splice(1, 0, `name: ${name}`);
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
  t = setFrontmatterName(t, input.name);
  if (!t.endsWith('\n')) t += '\n';
  if (utf8Bytes(t) > maxProfileBytes(input.app)) return { ok: false, error: `The reply is too long (over ${maxProfileBytes(input.app) / 1024} KB, the most ${input.app === 'claude' ? 'Claude Code' : 'Copilot'} takes in an agent file).` };
  // FR-033: what the draft grants beyond read-only, and tools the text mentions that are not granted
  const defaults = new Set(DEFAULT_READ_TOOLS[input.app].map((x) => x.toLowerCase()));
  const extraTools = tools.filter((x) => !defaults.has(x.toLowerCase()));
  const words = new Set(userTextOf(input).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const listed = new Set((input.tools ?? []).map((x) => x.toLowerCase().replace(/\(.*$/, '')));
  for (const k of KNOWN_EXTRA_TOOLS[input.app]) if (words.has(k.toLowerCase()) && !listed.has(k.toLowerCase())) warnings.push(`You mentioned ${k}; it is not granted unless listed under Extra tools`);
  if (extraTools.length) warnings.push(`Tools beyond read-only: ${extraTools.join(', ')}. Check them before saving`);
  return { ok: true, text: t, warnings, extraTools };
}
