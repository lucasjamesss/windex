import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { loadConfig, loadState, saveState, PATHS } from './config.js';
import { gather, clean } from './clean.js';
import { ENGINES, availableEngines, runChain, which } from './engines.js';
import { loadMemories } from './memory.js';
import {
  appendHistory, updateHistory, readHistory, readProfile, newId, learnDue, learnInBackground, buildLearnInput, saveProfile,
} from './learn.js';
import { c, err, out, spinner, ask, readMultiline, readKey, renderPrompt } from './tui.js';
import { truncate } from './text.js';
import { suggestionsIn, dropSuggestion, critiqueIsEmpty } from './extras.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `${c.bold('windex')} ${VERSION} · rough prompt in, clean prompt out, straight into your coding agent

${c.bold('Usage')}
  windex                       type, paste or dictate a rough prompt (Enter on an empty line to finish)
  windex "fix the thing…"      clean a prompt given as an argument
  pbpaste | windex             clean a prompt from stdin
  windex --clip                clean whatever is on the clipboard

${c.bold('Options')}
  -t, --target claude|codex    agent to send to (default: last used, then config)
  -e, --engine NAME            cleaning engine only: claude | codex | gemini | offline
  -C, --dir PATH               project directory (default: current)
  -p, --print                  print the cleaned prompt and exit (no review, no send)
      --json                   with --print: full JSON result
      --no-questions           never stop for clarifying questions
      --no-memory              do not pull memory files

${c.bold('Commands')}
  windex history [n]           recent runs
  windex rate [1-5] [note]     rate the last sent prompt's outcome
  windex learn                 rebuild your style profile from history now
  windex profile [edit]        show or edit learned preferences
  windex doctor                check engines, memory and paths
  windex mark <id> < final.md  record that a printed prompt was sent (final text on stdin)

${c.bold('Review keys')}
  enter send · t switch agent · e edit · r revise with a note · c copy & quit · q quit

Files: ${PATHS.config}, ${PATHS.history}, ${PATHS.profile}`;

export function parseArgs(argv) {
  const o = { _: [], questions: true, memory: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-t' || a === '--target') o.target = val();
    else if (a === '-e' || a === '--engine') o.engine = val();
    else if (a === '-C' || a === '--dir') o.dir = val();
    else if (a === '-p' || a === '--print') o.print = true;
    else if (a === '--json') o.json = true;
    else if (a === '--clip') o.clip = true;
    else if (a === '--no-questions') o.questions = false;
    else if (a === '--no-memory') o.memory = false;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--') { o._.push(...argv.slice(i + 1)); break; }
    else if (a.startsWith('-') && a.length > 1) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => resolve(s));
  });
}

function copy(text) {
  for (const [cmd, args] of [['pbcopy', []], ['wl-copy', []], ['xclip', ['-selection', 'clipboard']]]) {
    if (!which(cmd)) continue;
    try { execFileSync(cmd, args, { input: text }); return true; } catch {}
  }
  return false;
}

function paste() {
  for (const [cmd, args] of [['pbpaste', []], ['wl-paste', []], ['xclip', ['-selection', 'clipboard', '-o']]]) {
    if (!which(cmd)) continue;
    try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch {}
  }
  return '';
}

function editText(text) {
  const file = path.join(PATHS.work, `prompt-${process.pid}.md`);
  fs.writeFileSync(file, text);
  const editor = process.env.VISUAL || process.env.EDITOR || (which('nano') ? 'nano' : 'vi');
  const r = spawnSync('/bin/sh', ['-c', `${editor} "$1"`, 'sh', file], { stdio: 'inherit' });
  const edited = fs.readFileSync(file, 'utf8').trim();
  fs.rmSync(file, { force: true });
  if (r.status !== 0) err(c.yellow(`editor exited ${r.status}; keeping what was saved`));
  return edited || text;
}

const otherTarget = (t) => (t === 'claude' ? 'codex' : 'claude');

const AGENT = { claude: 'Claude Code', codex: 'Codex' };

const IMPACT = { high: 'red', medium: 'yellow', low: 'dim' };

// Review-screen panel: ranked assumptions with what breaks, critique, and marked suggestions.
// The cleaned prompt above carries the short versions; this adds the why. Nothing here blocks sending.
function showThinking(res) {
  const rows = [];
  if (res.assumptions?.length) {
    rows.push(c.bold('Assumptions') + c.dim(' (worst if wrong first)'));
    res.assumptions.forEach((a, i) => rows.push(`  ${i + 1}. ${c[IMPACT[a.impact]](a.impact.padEnd(6))} ${a.text}${a.if_wrong ? c.dim(` → ${a.if_wrong}`) : ''}`));
  }
  if (!critiqueIsEmpty(res.critique)) {
    rows.push(c.bold('Critique'));
    for (const r of res.critique.risks) rows.push(`  ${c.red('risk')}  ${r}`);
    for (const r of res.critique.alternatives) rows.push(`  ${c.yellow('simpler')}  ${r}`);
    if (res.critique.right_task) rows.push(`  ${c.magenta('right task?')}  ${res.critique.right_task}`);
  }
  const live = suggestionsIn(res.prompt);
  if (live.length) {
    rows.push(c.bold('Suggestions in prompt') + c.dim('  press d to drop one'));
    live.forEach((t, i) => rows.push(`  ${c.green(`d${i + 1}`)}  ${t}`));
  }
  if (rows.length) out('\n' + rows.join('\n'));
}

function showResult(res, engine, target, ctx) {
  const used = [];
  if (ctx?.memories?.length) used.push(`${ctx.memories.length} memory note${ctx.memories.length > 1 ? 's' : ''}`);
  if (ctx?.repo?.isRepo) used.push(`${ctx.project} repo`);
  out('');
  out(c.bold(c.cyan('Your cleaned prompt')) + c.dim(`  ·  ${res.title}`));
  out(renderPrompt(res.prompt));
  showThinking(res);
  if (res.changes) out(c.dim(`  What Windex did: ${res.changes}`));
  if (res.goldfish_lookups?.length) out(c.dim(`  Agent will check Goldfish for: ${res.goldfish_lookups.map((l) => `"${l.query}"`).join(', ')}`));
  if (used.length) out(c.dim(`  Used: ${used.join(', ')}  ·  cleaned by ${engine}`));
  out('');
  out(c.bold('What now?'));
  out(`  ${c.green(c.bold('Enter'))}  Send to ${c.bold(AGENT[target])}`);
  out(`  ${c.bold('t')}      Send to ${AGENT[otherTarget(target)]} instead`);
  if (suggestionsIn(res.prompt).length) out(`  ${c.bold('d')}      Drop a [Windex suggestion]`);
  out(`  ${c.bold('e')}      Edit the text yourself`);
  out(`  ${c.bold('r')}      Tell Windex what to change`);
  out(`  ${c.bold('c')}      Copy it and quit ${c.dim('(paste into a session you already have open)')}`);
  out(`  ${c.bold('q')}      Cancel`);
}

async function askQuestions(questions) {
  const answers = [];
  let changed = false;
  err('');
  err(c.bold(c.cyan('Questions that test the idea')) + c.dim(`  ·  ${questions.length}, all optional. Enter accepts the suggestion or skips.`));
  for (const [i, q] of questions.entries()) {
    const label = { goal: 'GOAL', why: 'WHY', tradeoff: 'TRADE-OFF', audience: 'WHO FOR', edge: 'EDGE CASE', failure: 'FAILS IF', avoid: 'AVOID', assumption: 'ASSUMPTION', other: 'DETAIL' }[q.category] || 'DETAIL';
    err(`\n${c.magenta(label)}  ${c.bold(`${i + 1}/${questions.length}  ${q.question}`)}`);
    if (q.why) err(c.dim(`    ${q.why}`));
    q.options.forEach((opt, j) => err(`    ${c.bold(String(j + 1))}  ${opt}${opt === q.default ? c.green('  ← suggested') : ''}`));
    const hint = q.options.length ? 'number, or your own answer' : 'your answer, or Enter to skip';
    const a = (await ask(c.cyan(`    ${hint} › `))).trim();
    let answer = q.default;
    if (/^\d+$/.test(a) && q.options[Number(a) - 1]) answer = q.options[Number(a) - 1];
    else if (a) answer = a;
    if (answer !== q.default) changed = true;
    if (!answer) continue;
    answers.push({ question: q.question, answer });
  }
  return { answers, changed };
}

async function rateRun(id, cfg) {
  if (!cfg.askRating || !process.stdin.isTTY) return;
  err(`\n${c.bold('How did it go?')} ${c.dim('1 = missed the mark … 5 = nailed it. Enter to skip. (This teaches Windex your style.)')}`);
  const k = await readKey(['1', '2', '3', '4', '5', '\r', 'q']);
  if (!/[1-5]/.test(k)) return;
  const rating = Number(k);
  let note = '';
  if (rating <= 3) note = (await ask(c.dim('  what should the prompt have included? (Enter to skip) › '))).trim();
  updateHistory(id, { rating, note: note || undefined, ratedTs: new Date().toISOString() });
  err(c.green(`  Thanks, saved ${rating}/5.`));
}

async function send(target, prompt, cwd, cfg) {
  const [cmd, ...args] = cfg.launch[target] || [target];
  if (!which(cmd)) throw new Error(`${cmd} not found on PATH`);
  copy(prompt);
  err(c.dim(`\nOpening ${AGENT[target]} in ${cwd} (prompt also copied to your clipboard).\n`));
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args, prompt], { cwd, stdio: 'inherit' });
    child.on('error', (e) => { err(c.red(e.message)); resolve(1); });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function getRough(o) {
  if (o._.length) return o._.join(' ');
  if (o.clip) return paste();
  if (!process.stdin.isTTY) return readStdin();
  return readMultiline(`${c.bold(c.cyan('Windex'))}  ${c.dim('rough prompt → clean prompt → your coding agent')}\n\n${c.bold('Type, paste or dictate your rough prompt.')}\n${c.dim('It starts a second after a paste. Typing? Press Enter on an empty line when done.')}\n`);
}

async function runClean(o, cfg) {
  const cwd = path.resolve(o.dir || process.cwd());
  const state = loadState();
  let target = o.target || state.lastTarget || cfg.target;
  if (!['claude', 'codex'].includes(target)) throw new Error(`target must be claude or codex, got "${target}"`);
  if (o.engine && !ENGINES[o.engine]) throw new Error(`unknown engine "${o.engine}"`);

  const rough = (await getRough(o)).trim();
  if (!rough) { err('Nothing to clean.'); return 1; }

  const interactive = !o.print && process.stdin.isTTY && process.stdout.isTTY;
  const ctx = gather({ rough, cwd, cfg, useMemory: o.memory });
  const found = [ctx.memories.length && `${ctx.memories.length} memory note${ctx.memories.length > 1 ? 's' : ''}`, ctx.repo.isRepo && `${ctx.project} repo`].filter(Boolean);
  if (process.stderr.isTTY) err(c.dim(`Reading ${found.join(' + ') || 'your prompt'}…`));
  const spin = spinner('Cleaning your prompt');
  const onTry = (name) => spin.set(`Cleaning your prompt (${name})`);
  let run;
  try { run = await clean({ rough, ctx, cfg, target, engine: o.engine, onTry }); }
  finally { spin.stop(); }
  let res = run.result;
  let engine = run.engine;
  if (run.errors.length && !o.quiet) err(c.yellow(`fell back to ${engine}: ${run.errors.map((e) => truncate(e, 120)).join(' | ')}`));

  const entry = {
    id: newId(), ts: new Date().toISOString(), cwd, project: ctx.project, target, engine, rough,
    title: res.title, kind: res.kind, size: res.size, memory: ctx.memories.map((m) => m.name),
  };

  if (!interactive) {
    appendHistory({ ...entry, cleaned: res.prompt, final: res.prompt, edited: false, sent: false, printed: true });
    out(o.json ? JSON.stringify({ id: entry.id, engine, ...res }, null, 2) : res.prompt);
    return 0;
  }

  let answers = [];
  if (o.questions && res.questions.length) {
    const q = await askQuestions(res.questions);
    answers = q.answers;
    if (q.changed && answers.length) {
      const s = spinner('Updating with your answers');
      try {
        const r2 = await clean({ rough, ctx, cfg, target, engine: o.engine || engine, answers, previous: res.prompt });
        res = { ...r2.result, questions: [] };
        engine = r2.engine;
      } catch (e) { err(c.yellow(`could not rewrite (${truncate(e.message, 140)}); keeping the first version`)); }
      finally { s.stop(); }
    }
  }

  const cleaned = res.prompt;
  let final = cleaned;
  let edited = false;
  const feedback = [];

  for (;;) {
    showResult({ ...res, prompt: final }, engine, target, ctx);
    const k = await readKey(['\r', 't', 'e', 'r', 'c', 'q', 'd']);
    if (k === 'd') {
      const live = suggestionsIn(final);
      if (!live.length) continue;
      const n = live.length === 1 ? 1 : Number((await ask(c.cyan(`\nDrop which suggestion? (1-${live.length}) › `))).trim());
      if (n >= 1 && n <= live.length) { final = dropSuggestion(final, n - 1); edited = true; }
      continue;
    }
    if (k === 't') { target = otherTarget(target); continue; }
    if (k === 'e') {
      const next = editText(final);
      if (next !== final) { final = next; edited = true; }
      continue;
    }
    if (k === 'r') {
      const note = (await ask(c.cyan('\nWhat should change? (e.g. "shorter", "add a test step") › '))).trim();
      if (!note) continue;
      feedback.push(note);
      const s = spinner('Making your changes');
      try {
        const r = await clean({ rough, ctx, cfg, target, engine: o.engine || engine, answers, feedback: note, previous: final });
        res = r.result; engine = r.engine; final = res.prompt;
      } catch (e) { err(c.red(truncate(e.message, 300))); }
      finally { s.stop(); }
      continue;
    }
    const base = { ...entry, target, engine, cleaned, final, edited, answers, feedback, title: res.title };
    if (k === 'q') { appendHistory({ ...base, sent: false }); err(c.dim('Cancelled. Nothing was sent.')); return 0; }
    saveState({ lastTarget: target });
    if (k === 'c') {
      appendHistory({ ...base, sent: true, via: 'clipboard' });
      err(copy(final) ? c.green('Copied. Paste it into your session.') : c.red('No clipboard tool found.'));
      return 0;
    }
    appendHistory({ ...base, sent: true, via: 'launch' });
    await send(target, final, cwd, cfg);
    await rateRun(entry.id, cfg);
    if (learnDue(cfg)) learnInBackground();
    return 0;
  }
}

async function cmdHistory(o) {
  const n = Number(o._[1]) || 15;
  const list = readHistory().slice(-n);
  if (!list.length) return out('No history yet.');
  for (const e of list) {
    const status = e.sent ? (e.rating ? `${e.rating}/5` : 'sent') : e.printed ? 'printed' : 'dropped';
    out(`${c.dim(e.ts.slice(0, 16).replace('T', ' '))}  ${c.dim(e.id)}  ${e.project?.padEnd(16) || ''} ${String(e.target || '').padEnd(6)} ${status.padEnd(7)} ${e.edited ? c.yellow('edited ') : '       '}${truncate(e.title || e.rough, 60)}`);
  }
}

async function cmdRate(o) {
  const last = readHistory().filter((e) => e.sent).at(-1);
  if (!last) { err('No sent prompts yet.'); return 1; }
  const rating = Number(o._[1]);
  if (!(rating >= 1 && rating <= 5)) { err('Usage: windex rate <1-5> [note]'); return 1; }
  updateHistory(last.id, { rating, note: o._.slice(2).join(' ') || last.note, ratedTs: new Date().toISOString() });
  out(`Rated "${truncate(last.title, 50)}" ${rating}/5`);
}

// Used by the /windex skill: the agent prints a prompt with -p --json, the developer approves
// (maybe after changes), and the skill records what was actually sent so learning sees it.
async function cmdMark(o, cfg) {
  const id = o._[1];
  const entry = readHistory().find((e) => e.id === id);
  if (!entry) { err(`No run with id ${id}`); return 1; }
  const final = process.stdin.isTTY ? entry.cleaned : (await readStdin()).trim() || entry.cleaned;
  updateHistory(id, { sent: true, printed: false, via: 'skill', final, edited: final !== entry.cleaned });
  out(`Recorded ${id} as sent${final !== entry.cleaned ? ' (edited)' : ''}.`);
  if (learnDue(cfg)) learnInBackground();
  return 0;
}

async function cmdLearn(o, cfg) {
  const history = readHistory();
  if (history.filter((e) => e.sent).length < 3) { if (!o.quiet) err('Need at least 3 sent prompts to learn from.'); return 0; }
  const system = fs.readFileSync(new URL('../prompts/learn.md', import.meta.url), 'utf8');
  const user = buildLearnInput(history, readProfile());
  const spin = o.quiet ? { stop() {}, set() {} } : spinner('learning from history');
  try {
    const r = await runChain(cfg, { system, user, parse: (raw) => raw, only: o.engine, onTry: (n) => spin.set(`learning with ${n}`) });
    spin.stop();
    const rules = saveProfile(r.result);
    if (!o.quiet) out(`${c.green('Profile updated')} (${rules.length} rules) → ${PATHS.profile}\n${rules.join('\n')}`);
  } catch (e) { spin.stop(); if (!o.quiet) err(c.red(e.message)); return 1; }
  return 0;
}

async function cmdProfile(o) {
  if (o._[1] === 'edit') {
    if (!fs.existsSync(PATHS.profile)) fs.writeFileSync(PATHS.profile, '- \n');
    const editor = process.env.VISUAL || process.env.EDITOR || 'nano';
    spawnSync('/bin/sh', ['-c', `${editor} "$1"`, 'sh', PATHS.profile], { stdio: 'inherit' });
    return 0;
  }
  const p = readProfile();
  out(p || c.dim(`No learned preferences yet. They build up after ${loadConfig().learnEvery} sent prompts, or run "windex learn".`));
}

async function cmdDoctor(cfg) {
  out(c.bold('Engines') + c.dim(' (tried in this order)'));
  const avail = new Set(availableEngines(cfg));
  for (const name of cfg.engines) {
    const e = ENGINES[name];
    if (!e) { out(`  ${c.red('✗')} ${name} (unknown)`); continue; }
    out(`  ${avail.has(name) ? c.green('✓') : c.red('✗')} ${name.padEnd(8)} ${c.dim(e.note)}`);
  }
  out(c.bold('\nAgents'));
  for (const t of ['claude', 'codex']) out(`  ${which(cfg.launch[t][0]) ? c.green('✓') : c.red('✗')} ${t}`);
  out(c.bold('\nMemory'));
  const cwd = process.cwd();
  const mems = loadMemories(cfg.memoryDirs, cwd);
  out(`  ${mems.length} memory files from ${cfg.memoryDirs.join(', ')}`);
  const h = readHistory();
  out(c.bold('\nLearning'));
  out(`  ${h.length} runs, ${h.filter((e) => e.sent).length} sent, ${h.filter((e) => e.rating).length} rated, ${h.filter((e) => e.edited).length} edited`);
  out(`  profile: ${readProfile() ? readProfile().split('\n').length + ' rules' : 'empty'}`);
  out(c.dim(`\n  ${PATHS.config}`));
}

// A rough prompt can start with "learn" or "history", so only treat args as a command when
// they fit that command's exact shape. `windex "learn react hooks"` stays a prompt.
export function isCommand(args) {
  const [sub, a1] = args;
  if (!sub || /\s/.test(sub)) return false;
  if (sub === 'history') return args.length === 1 || (args.length === 2 && /^\d+$/.test(a1));
  if (sub === 'rate') return /^[1-5]$/.test(a1 || '');
  if (sub === 'profile') return args.length === 1 || (args.length === 2 && a1 === 'edit');
  if (sub === 'learn' || sub === 'doctor') return args.length === 1;
  if (sub === 'mark') return args.length === 2 && /^[0-9a-f]{8}$/.test(a1);
  return false;
}

export async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(c.red(e.message)); err('Run windex --help'); return 2; }
  if (o.help) { out(HELP); return 0; }
  if (o.version) { out(VERSION); return 0; }
  const cfg = loadConfig();
  const sub = o._[0];
  if (isCommand(o._)) {
    if (sub === 'history') return (await cmdHistory(o)) ?? 0;
    if (sub === 'rate') return (await cmdRate(o)) ?? 0;
    if (sub === 'learn') return cmdLearn(o, cfg);
    if (sub === 'profile') return (await cmdProfile(o)) ?? 0;
    if (sub === 'doctor') return (await cmdDoctor(cfg)) ?? 0;
    if (sub === 'mark') return cmdMark(o, cfg);
  }
  try { return await runClean(o, cfg); }
  catch (e) { err(c.red(e.message)); return 1; }
}
