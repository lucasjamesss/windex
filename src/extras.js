// Thinking-partner sections Windex adds to a cleaned prompt: ranked assumptions, a short critique,
// and marked suggestions. Rendered in code (not by the model) so the marker is always identical and a
// suggestion can be dropped by removing exactly one line. Core engine: no adapter-specific knowledge.

export const TAG = '[Windex suggestion]';
export const H_ASSUMPTIONS = '## Assumptions';
export const H_CRITIQUE = '## Windex critique';
export const H_SUGGESTIONS = '## Suggestions';
const HEADINGS = [H_ASSUMPTIONS, H_CRITIQUE, H_SUGGESTIONS];

export const LIMITS = {
  assumptionsInPrompt: 5,
  suggestionsInPrompt: 3,
  critiquePerAngle: 2,
  questions: { small: 2, medium: 8, large: 8 },
};

const IMPACTS = ['high', 'medium', 'low'];
const str = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const arr = (v) => (Array.isArray(v) ? v : []);

// Assumptions arrive as strings (old schema) or { text, impact, if_wrong }. Rank worst-if-wrong first.
export function normalizeAssumptions(list) {
  const items = arr(list).map((a) => {
    if (typeof a === 'string') return { text: str(a), impact: 'medium', if_wrong: '' };
    return {
      text: str(a?.text ?? a?.assumption),
      impact: IMPACTS.includes(a?.impact) ? a.impact : 'medium',
      if_wrong: str(a?.if_wrong),
    };
  }).filter((a) => a.text);
  return items
    .map((a, i) => ({ a, i }))
    .sort((x, y) => IMPACTS.indexOf(x.a.impact) - IMPACTS.indexOf(y.a.impact) || x.i - y.i)
    .map((x) => x.a);
}

export function normalizeCritique(c) {
  const lines = (v) => arr(v).map(str).filter(Boolean).slice(0, LIMITS.critiquePerAngle);
  return {
    risks: lines(c?.risks),
    alternatives: lines(c?.alternatives),
    right_task: str(c?.right_task),
  };
}

export const critiqueIsEmpty = (c) => !c || (!c.risks.length && !c.alternatives.length && !c.right_task);

// Suggestions: only concrete ones; caller decides which are "strong" via the `inject` flag.
export function normalizeSuggestions(list) {
  return arr(list).map((s) => {
    if (typeof s === 'string') return { text: str(s), why: '', inject: true };
    return { text: str(s?.text ?? s?.suggestion), why: str(s?.why), inject: s?.inject !== false };
  }).filter((s) => s.text).slice(0, 6);
}

const suggestionLine = (s) => `- ${TAG} ${s.text}`;

// Remove the thinking-partner sections (and everything after the first one) from a prompt, so a
// revision starts from the clean base. Callers strip "How to work" first.
export function stripExtras(prompt) {
  let cut = -1;
  for (const h of HEADINGS) {
    const m = new RegExp(`(^|\\n)${h.replace(/[#]/g, '\\#')}\\s*(\\n|$)`).exec(prompt);
    if (m && (cut < 0 || m.index < cut)) cut = m.index;
  }
  return (cut >= 0 ? prompt.slice(0, cut) : prompt).trimEnd();
}

export function renderExtras({ assumptions = [], critique, suggestions = [] }) {
  const parts = [];
  const ass = assumptions.slice(0, LIMITS.assumptionsInPrompt);
  if (ass.length) {
    parts.push(`${H_ASSUMPTIONS}\n${ass.map((a) => `- (${a.impact}) ${a.text}`).join('\n')}`);
  }
  if (!critiqueIsEmpty(critique)) {
    const l = [];
    for (const r of critique.risks) l.push(`- Risk: ${r}`);
    for (const r of critique.alternatives) l.push(`- Simpler option: ${r}`);
    if (critique.right_task) l.push(`- Right task? ${critique.right_task}`);
    parts.push(`${H_CRITIQUE}\n${l.join('\n')}\nThese are concerns to weigh, not blockers. Follow the task as written unless one is serious; if so, say so first.`);
  }
  const sug = suggestions.filter((s) => s.inject).slice(0, LIMITS.suggestionsInPrompt);
  if (sug.length) {
    parts.push(`${H_SUGGESTIONS}\n${sug.map(suggestionLine).join('\n')}`);
  }
  return parts.join('\n\n');
}

// Suggestions currently present in a prompt text, in order. Used by the review UI.
export function suggestionsIn(prompt) {
  return prompt.split('\n').filter((l) => l.startsWith(`- ${TAG} `)).map((l) => l.slice(`- ${TAG} `.length).trim());
}

// Drop one suggestion (by 0-based index among those present). Removes the heading when none are left.
export function dropSuggestion(prompt, index) {
  const lines = prompt.split('\n');
  const at = [];
  lines.forEach((l, i) => { if (l.startsWith(`- ${TAG} `)) at.push(i); });
  if (index < 0 || index >= at.length) return prompt;
  lines.splice(at[index], 1);
  let out = lines.join('\n');
  if (!suggestionsIn(out).length) {
    out = out.replace(new RegExp(`\\n*${H_SUGGESTIONS}[ \\t]*\\n+(?=\\n*##|\\n*$)`), '\n\n').replace(new RegExp(`\\n*${H_SUGGESTIONS}[ \\t]*$`), '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trimEnd();
}

// Insert extras between the base prompt and "## How to work" handled by caller ordering.
export function withExtras(base, extras) {
  const block = renderExtras(extras);
  return block ? `${stripExtras(base)}\n\n${block}` : stripExtras(base);
}
