// Pull the first complete JSON object out of a model reply, tolerating code fences and stray prose.
import { LIMITS, normalizeAssumptions, normalizeCritique, normalizeSuggestions } from './extras.js';

export function extractJSON(raw) {
  const text = String(raw).replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('unterminated JSON object in reply');
}

const KINDS = new Set(['build', 'fix', 'refactor', 'research', 'design', 'ops', 'content', 'question', 'other']);
const SIZES = new Set(['small', 'medium', 'large']);
const CATEGORIES = ['goal', 'why', 'tradeoff', 'edge', 'audience', 'failure', 'avoid', 'assumption', 'other'];

export function normalizeClean(obj) {
  if (!obj || typeof obj.prompt !== 'string' || !obj.prompt.trim()) throw new Error('reply has no prompt');
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    title: String(obj.title || 'Untitled task').slice(0, 80),
    kind: KINDS.has(obj.kind) ? obj.kind : 'other',
    size: SIZES.has(obj.size) ? obj.size : 'medium',
    prompt: obj.prompt.trim(),
    goldfish_lookups: arr(obj.goldfish_lookups)
      .filter((l) => l && typeof l.query === 'string' && l.query.trim())
      .slice(0, 4)
      .map((l) => ({ tool: /^goldfish_(recall|search|context)$/.test(l.tool) ? l.tool : 'goldfish_search', query: l.query.trim(), why: String(l.why || '') })),
    questions: arr(obj.questions)
      .filter((q) => q && typeof q.question === 'string' && q.question.trim())
      .slice(0, LIMITS.questions[SIZES.has(obj.size) ? obj.size : 'medium'])
      .map((q) => ({
        category: CATEGORIES.includes(q.category) ? q.category : 'other',
        question: q.question.trim(),
        why: String(q.why || ''),
        options: arr(q.options).map(String).filter(Boolean).slice(0, 6),
        default: String(q.default ?? ''),
      })),
    assumptions: normalizeAssumptions(obj.assumptions),
    critique: normalizeCritique(obj.critique),
    suggestions: normalizeSuggestions(obj.suggestions),
    memory_used: arr(obj.memory_used).map(String).filter(Boolean),
    changes: String(obj.changes || ''),
  };
}

export function parseClean(raw) {
  return normalizeClean(extractJSON(raw));
}
