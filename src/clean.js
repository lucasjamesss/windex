import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from './engines.js';
import { parseClean } from './parse.js';
import { gatherRepo } from './context.js';
import { loadMemories, selectMemories, formatMemories } from './memory.js';
import { readHistory, readProfile, pickExamples, formatExamples } from './learn.js';
import { redact, truncate } from './text.js';
import { withPrinciples, stripPrinciples } from './principles.js';
import { stripExtras, withExtras } from './extras.js';
import { extractPastes, restorePastes, collapsePastes } from './pastes.js';

const PROMPTS = fileURLToPath(new URL('../prompts/', import.meta.url));
const readPrompt = (f) => fs.readFileSync(path.join(PROMPTS, f), 'utf8');

const TARGET_NAMES = { claude: 'Claude Code', codex: 'OpenAI Codex CLI' };

export function buildSystem(target, profile) {
  let sys = readPrompt('cleaner.md').replaceAll('{{TARGET}}', TARGET_NAMES[target] || target);
  sys += `\n<examples>\n${readPrompt('examples.md')}\n</examples>\n`;
  sys += `\n<profile>\n${profile || '(no learned preferences yet)'}\n</profile>\n`;
  return sys;
}

// Everything Windex knows before cleaning: repo facts, relevant memory, past examples.
export function gather({ rough, cwd, cfg, useMemory = true }) {
  const repo = gatherRepo(cwd, rough);
  let memories = [];
  let memoryIndex = [];
  if (useMemory) {
    try {
      const all = loadMemories(cfg.memoryDirs, cwd);
      memories = selectMemories(all, rough, cwd, cfg.memoryLimit);
      memoryIndex = all.filter((m) => !m.isChat).map((m) => `${m.name}: ${truncate(m.description, 110)}`);
    } catch {}
  }
  const history = readHistory();
  const project = path.basename(repo.root);
  const examples = pickExamples(history, rough, project, cfg.examplesFromHistory);
  return { repo, memories, examples, project, profile: readProfile(), index: memoryIndex };
}

export function buildUser({ rough, ctx, target, answers, feedback, previous, pasteKinds = [] }) {
  const parts = [];
  parts.push(`<target_agent>${TARGET_NAMES[target] || target}</target_agent>`);
  parts.push(`<repo>\n${ctx.repo.summary}\n</repo>`);
  if (ctx.repo.agentDocText) parts.push(`<agent_docs note="the agent already reads these; use them to understand, never repeat them">\n${ctx.repo.agentDocText}</agent_docs>`);
  parts.push(`<memory>\n${ctx.memories.length ? formatMemories(ctx.memories) : '(nothing relevant)'}\n</memory>`);
  if (ctx.index?.length) parts.push(`<memory_index note="every goldfish note by name and description; use it to choose what the agent should look up">\n${ctx.index.join('\n')}\n</memory_index>`);
  if (ctx.examples.length) parts.push(`<developer_past_prompts note="what this developer actually sent before; match their taste">\n${formatExamples(ctx.examples)}\n</developer_past_prompts>`);
  parts.push(`<rough_prompt>\n${rough}\n</rough_prompt>`);
  if (pasteKinds.length) parts.push(`<pasted_material note="Windex holds this text verbatim and puts it back for you. Keep each placeholder exactly as written, once, where it belongs in Context, and say in a few words what it is. Never reproduce or summarise its contents.">\n${pasteKinds.join('\n')}\n</pasted_material>`);
  if (previous) parts.push(`<previous_version>\n${stripExtras(stripPrinciples(previous))}\n</previous_version>`);
  if (answers?.length) parts.push(`<answers note="the developer answered your questions; rewrite the prompt using these and do not ask them again">\n${answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}\n</answers>`);
  if (feedback) parts.push(`<developer_feedback note="revise the previous version to address this">\n${feedback}\n</developer_feedback>`);
  parts.push(answers?.length || feedback ? 'Return the revised JSON. Ask no further questions unless something new is truly blocking.' : 'Return the JSON.');
  return redact(parts.join('\n\n'));
}

export async function clean({ rough, ctx, cfg, target, engine, answers, feedback, previous, onTry }) {
  const { text, pastes } = extractPastes(rough);
  const system = buildSystem(target, ctx.profile);
  const prev = previous ? collapsePastes(previous, pastes) : previous;
  const user = buildUser({ rough: text, ctx, target, answers, feedback, previous: prev, pasteKinds: pastes.map((p, i) => `[[PASTE_${i + 1}]] = pasted ${p.kind === 'code' ? 'code' : 'log or error output'}, ${p.body.split('\n').length} lines`) });
  const offlineInput = { rough: previous && feedback ? `${text}\n${feedback}` : text, checks: ctx.repo.checks, memories: ctx.memories };
  const run = await runChain(cfg, { system, user, parse: parseClean, offlineInput, only: engine, onTry });
  const meta = { kind: run.result.kind, size: run.result.size, rough };
  const base = withExtras(restorePastes(stripExtras(stripPrinciples(run.result.prompt)), pastes), run.result);
  run.result.prompt = withPrinciples(base, meta, cfg.principles);
  return run;
}
