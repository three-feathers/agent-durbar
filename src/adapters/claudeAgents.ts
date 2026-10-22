/**
 * Claude Code custom agents (spec 043 FR-008): Durbar's flags keep Claude from loading agent files itself, so the adapter reads
 * them (read-only, capped) and passes the chosen one with `--agents` / `--agent`. Pure parsing plus a small fs wrapper.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanSessionTitle } from './history';
import { parseFrontMatter } from './slashcommands';
import type { AgentProfile } from './types';

export const MAX_AGENT_FILES = 50;
export const MAX_AGENT_BYTES = 64 * 1024;
export const MAX_AGENT_PROMPT = 16 * 1024;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** What `--agents` needs for one agent, plus the profile the UI shows. */
export interface ClaudeAgentDef {
  profile: AgentProfile;
  prompt: string;
}

/** Parses an agent file: `---` front matter (`name`, `description`, `tools`, `model`) then the prompt. Undefined when unusable. */
export function parseClaudeAgent(text: string, fileName: string, source: AgentProfile['source'], file?: string): ClaudeAgentDef | undefined {
  const { fm, lists, body: rawBody } = parseFrontMatter(text); // spec 072: one front-matter reader for agents and slash entries
  const body = rawBody.trim();
  const name = (fm.name || fileName.replace(/\.md$/i, '')).trim();
  if (!NAME.test(name) || !body) return undefined;
  const tools = lists.tools ?? (fm.tools ? fm.tools.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : undefined);
  const description = cleanSessionTitle(fm.description, 200);
  const model = fm.model && /^[A-Za-z0-9._-]{1,60}$/.test(fm.model) && fm.model !== 'inherit' ? fm.model : undefined;
  return {
    profile: { id: name, name, ...(description ? { description } : {}), source, ...(file ? { path: file } : {}), ...(tools && tools.length && !tools.includes('*') ? { tools: tools.slice(0, 100) } : {}), ...(model ? { model } : {}) },
    prompt: body.slice(0, MAX_AGENT_PROMPT),
  };
}

function readDir(dir: string, source: AgentProfile['source'], out: Map<string, ClaudeAgentDef>): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  } catch {
    return;
  }
  for (const n of names) {
    if (out.size >= MAX_AGENT_FILES) return;
    const file = path.join(dir, n);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_AGENT_BYTES) continue;
      const def = parseClaudeAgent(fs.readFileSync(file, 'utf8'), n, source, file);
      if (def && !out.has(def.profile.id)) out.set(def.profile.id, def); // the folder's own agent wins over a user agent of the same name
    } catch {
      /* unreadable: skipped */
    }
  }
}

/** The session folders' `.claude/agents` (repository) and the user's `agents` folder, repository first. */
export function listClaudeAgents(folders: readonly string[], configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')): ClaudeAgentDef[] {
  const out = new Map<string, ClaudeAgentDef>();
  for (const f of [...new Set(folders)]) readDir(path.join(f, '.claude', 'agents'), 'repo', out);
  readDir(path.join(configDir, 'agents'), 'user', out);
  return [...out.values()];
}

/** The `--agents` JSON for one agent (Claude's own shape). */
export function agentsArg(def: ClaudeAgentDef): string {
  const a: Record<string, unknown> = { description: def.profile.description ?? def.profile.name, prompt: def.prompt };
  if (def.profile.tools) a.tools = def.profile.tools;
  if (def.profile.model) a.model = def.profile.model;
  return JSON.stringify({ [def.profile.id]: a });
}
