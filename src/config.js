import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const WINDEX_DIR = process.env.WINDEX_HOME || path.join(HOME, '.windex');
export const PATHS = {
  config: path.join(WINDEX_DIR, 'config.json'),
  history: path.join(WINDEX_DIR, 'history.jsonl'),
  profile: path.join(WINDEX_DIR, 'profile.md'),
  state: path.join(WINDEX_DIR, 'state.json'),
  work: path.join(WINDEX_DIR, 'work'),
};

// Claude Code stores auto-memory per project under ~/.claude/projects/<slug>/memory,
// where the slug is the absolute path with "/" replaced by "-".
export function claudeMemoryDir(dir) {
  return path.join(HOME, '.claude', 'projects', dir.replace(/[/.]/g, '-'), 'memory');
}

export const DEFAULTS = {
  // Agent the cleaned prompt is sent to. Switch per run with `t` or `-t`.
  target: 'claude',
  // Engines that do the cleaning, tried in order. All run on subscriptions or free tiers.
  engines: ['claude', 'codex', 'gemini', 'offline'],
  claude: { model: 'sonnet', stripApiKey: true, timeoutMs: 120000 },
  codex: { model: null, effort: 'low', timeoutMs: 150000 },
  gemini: { model: 'gemini-flash-latest', envFile: path.join(HOME, '.config', 'secrets', 'gemini.env'), timeoutMs: 150000 },
  // Markdown memory folders (frontmatter name/description). {cwd} expands to the current project.
  memoryDirs: [path.join(HOME, '.goldfish', 'memory'), '{claude:cwd}', '{claude:home}'],
  memoryLimit: 6,
  // Commands used to launch the agent with the prompt as its first message.
  launch: { claude: ['claude'], codex: ['codex'] },
  // Standing instructions appended to every prompt (see src/principles.js). Set any to false to drop it.
  principles: { enabled: true, core: true, research: true, visual: true },
  askRating: true,
  learnEvery: 8,
  examplesFromHistory: 2,
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export function ensureDirs() {
  fs.mkdirSync(PATHS.work, { recursive: true });
}

export function loadConfig() {
  ensureDirs();
  let user = {};
  if (fs.existsSync(PATHS.config)) {
    try { user = JSON.parse(fs.readFileSync(PATHS.config, 'utf8')); }
    catch (e) { throw new Error(`Bad JSON in ${PATHS.config}: ${e.message}`); }
  } else {
    fs.writeFileSync(PATHS.config, JSON.stringify({ target: DEFAULTS.target, engines: DEFAULTS.engines }, null, 2) + '\n');
  }
  return merge(DEFAULTS, user);
}

export function loadState() {
  try { return JSON.parse(fs.readFileSync(PATHS.state, 'utf8')); } catch { return {}; }
}

export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  fs.writeFileSync(PATHS.state, JSON.stringify(s, null, 2) + '\n');
  return s;
}
