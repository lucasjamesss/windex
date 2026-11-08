// Rule-based cleaner used when no model engine is reachable. It cannot infer intent, but it
// strips dictation noise, fixes common typos, and applies the same outcome / done-when shape.

const TYPOS = {
  teh: 'the', hte: 'the', adn: 'and', taht: 'that', wiht: 'with', becuase: 'because', becasue: 'because',
  recieve: 'receive', seperate: 'separate', definately: 'definitely', occured: 'occurred', untill: 'until',
  wich: 'which', whcih: 'which', thier: 'their', alot: 'a lot', ect: 'etc', abit: 'a bit',
  promt: 'prompt', promts: 'prompts', prompot: 'prompt', promting: 'prompting', fucntion: 'function', funtion: 'function',
  componet: 'component', compnent: 'component', databse: 'database', enviroment: 'environment', enviornment: 'environment',
  implment: 'implement', implmentation: 'implementation', authentification: 'authentication', resposive: 'responsive',
  dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't", wasnt: "wasn't",
  shouldnt: "shouldn't", couldnt: "couldn't", wouldnt: "wouldn't", im: "I'm", ive: "I've", youre: "you're",
  thats: "that's", whats: "what's", theres: "there's", u: 'you', ur: 'your', pls: 'please', plz: 'please',
  wat: 'what', abt: 'about', b4: 'before', bc: 'because', cuz: 'because', tho: 'though', thru: 'through',
  automaticly: 'automatically', automaticaly: 'automatically', basicly: 'basically', quesiotns: 'questions', questoins: 'questions',
  assumtions: 'assumptions', assumtinos: 'assumptions', instrutions: 'instructions', thining: 'thinking',
};

const SPOKEN = [
  [/\s*\b(full stop|period)\b\s*/gi, '. '],
  [/\s*\bcomma\b\s*/gi, ', '],
  [/\s*\bquestion mark\b\s*/gi, '? '],
  [/\s*\b(new line|newline)\b\s*/gi, '\n'],
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
];

const FILLER = /\b(um+|uh+|erm|you know|i mean|like,|sort of|kind of|kinda|basically|literally|honestly|so yeah|yeah so|okay so|ok so)\b[,]?\s*/gi;

export function scrub(text) {
  let s = String(text).replace(/\r/g, '');
  for (const [re, rep] of SPOKEN) s = s.replace(re, rep);
  s = s.replace(FILLER, '');
  s = s.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  s = s.replace(/[A-Za-z']+/g, (w) => {
    const fix = TYPOS[w.toLowerCase()];
    if (!fix) return w;
    return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
  });
  s = s.replace(/\bi\b/g, 'I').replace(/[ \t]+/g, ' ').replace(/ +([,.?!])/g, '$1').replace(/([.?!]){2,}/g, '$1');
  // Capitalise sentence starts.
  s = s.replace(/(^|[.?!]\s+|\n\s*)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return s.trim();
}

function sentences(text) {
  return text.split(/(?<=[.?!])\s+|\n+/).map((x) => x.trim()).filter(Boolean).map((x) => (/[.?!:]$/.test(x) ? x : x + '.'));
}

export function offlineClean({ rough, checks = [], memories = [] }) {
  const clean = scrub(rough);
  const parts = sentences(clean);
  const small = clean.length < 220 && parts.length <= 2;
  const doneChecks = checks.slice(0, 3).map((c) => `- \`${c.replace(/\s+#.*$/, '')}\` passes.`);
  let prompt;
  if (small) {
    prompt = `${parts.join(' ')}\n\nKeep the change minimal.${doneChecks.length ? ' Run ' + checks.slice(0, 2).map((c) => '`' + c.replace(/\s+#.*$/, '') + '`').join(' and ') + ' after.' : ''} Report what changed and how you checked it.`;
  } else {
    const [goal, ...rest] = parts;
    const ctx = memories.slice(0, 3).map((m) => `- ${m.description || m.name}`);
    prompt = [
      goal,
      ctx.length ? `\n## Context\n${ctx.join('\n')}` : '',
      rest.length ? `\n## Task\n${rest.map((r) => `- ${r}`).join('\n')}` : '',
      `\n## Done when\n${[...doneChecks, '- Report back: commands run with results, what changed, anything skipped.'].join('\n')}`,
    ].filter(Boolean).join('\n');
  }
  return {
    title: parts[0]?.split(/\s+/).slice(0, 6).join(' ').replace(/[.?!]$/, '') || 'Task',
    kind: 'other',
    size: small ? 'small' : 'medium',
    prompt: prompt.trim(),
    questions: [
      { category: 'goal', question: 'What does done look like?', why: 'Becomes the checkable "Done when"', options: [], default: '' },
      { category: 'avoid', question: 'Anything the agent must not touch or do?', why: 'Becomes a constraint', options: [], default: '' },
    ].slice(0, small ? 1 : 2),
    goldfish_lookups: [],
    assumptions: [],
    critique: { risks: [], alternatives: [], right_task: '' },
    suggestions: [],
    memory_used: memories.slice(0, 3).map((m) => m.name),
    changes: 'Offline clean-up (no model reachable): typos, dictation noise, basic structure.',
  };
}
