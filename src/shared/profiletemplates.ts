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
