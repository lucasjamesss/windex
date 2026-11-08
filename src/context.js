import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { terms, truncate } from './text.js';

function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000, maxBuffer: 8 << 20 }).trim();
  } catch { return ''; }
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function packageManager(dir) {
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

const CHECK_SCRIPT = /^(test|tests|lint|typecheck|type-check|check|build|e2e|test:.*|lint:.*|format:check)$/;

// Commands the agent can run to verify its work. These feed the "Done when" section.
export function checkCommands(dir) {
  const cmds = [];
  const pkg = readJSON(path.join(dir, 'package.json'));
  if (pkg?.scripts) {
    const pm = packageManager(dir);
    for (const [name, body] of Object.entries(pkg.scripts)) {
      if (CHECK_SCRIPT.test(name)) cmds.push(`${pm === 'npm' ? 'npm run' : pm} ${name}   # ${truncate(body, 60)}`);
    }
  }
  if (fs.existsSync(path.join(dir, 'Makefile'))) {
    const targets = (fs.readFileSync(path.join(dir, 'Makefile'), 'utf8').match(/^(test|lint|check|build|typecheck):/gm) || []).map((t) => `make ${t.slice(0, -1)}`);
    cmds.push(...targets);
  }
  if (fs.existsSync(path.join(dir, 'pyproject.toml'))) {
    const py = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
    if (/pytest/.test(py)) cmds.push('pytest');
    if (/ruff/.test(py)) cmds.push('ruff check .');
  }
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) cmds.push('cargo test', 'cargo clippy');
  if (fs.existsSync(path.join(dir, 'go.mod'))) cmds.push('go test ./...', 'go vet ./...');
  return cmds;
}

// Files whose path matches words in the rough prompt ("the footer" → components/Footer.tsx).
export function candidateFiles(files, rough, limit = 8) {
  const q = [...terms(rough)].filter((t) => t.length >= 4);
  if (!q.length) return [];
  const scored = [];
  for (const f of files) {
    const base = path.basename(f).toLowerCase();
    const full = f.toLowerCase();
    let s = 0;
    for (const t of q) {
      if (base.includes(t)) s += 3;
      else if (full.includes(t)) s += 1;
    }
    if (s >= 3) scored.push([s, f]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length);
  return scored.slice(0, limit).map(([, f]) => f);
}

export function gatherRepo(cwd, rough) {
  const root = run('git', ['rev-parse', '--show-toplevel'], cwd) || cwd;
  const lines = [`project: ${path.basename(root)} (${root})`];
  if (root !== cwd) lines.push(`working dir: ${path.relative(root, cwd)}`);

  const branch = run('git', ['branch', '--show-current'], root);
  if (branch) {
    const dirty = run('git', ['status', '--porcelain'], root).split('\n').filter(Boolean).length;
    lines.push(`git: branch ${branch}, ${dirty} uncommitted file(s)`);
    const log = run('git', ['log', '-5', '--format=%s'], root);
    if (log) lines.push(`recent commits:\n${log.split('\n').map((l) => `  - ${truncate(l, 90)}`).join('\n')}`);
  }

  const pkg = readJSON(path.join(root, 'package.json'));
  if (pkg) {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const notable = deps.filter((d) => /^(next|react|vue|svelte|@sveltejs\/kit|astro|express|fastify|hono|@supabase\/supabase-js|stripe|prisma|drizzle-orm|tailwindcss|vite|vitest|jest|playwright|@playwright\/test|remotion|typescript|electron|expo|react-native)$/.test(d));
    lines.push(`stack: ${notable.join(', ') || 'node'} (${packageManager(root)})`);
  }

  const checks = checkCommands(root);
  if (checks.length) lines.push(`check commands:\n${checks.map((c) => `  - ${c}`).join('\n')}`);

  const agentDocs = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md'].filter((f) => fs.existsSync(path.join(root, f)));
  if (agentDocs.length) lines.push(`agent docs present (the agent reads these itself, do not repeat them): ${agentDocs.join(', ')}`);

  let files = run('git', ['ls-files'], root).split('\n').filter(Boolean);
  if (!files.length) {
    try { files = fs.readdirSync(root).filter((f) => !f.startsWith('.')); } catch { files = []; }
  }
  const top = [...new Set(files.map((f) => f.split('/')[0] + (f.includes('/') ? '/' : '')))].slice(0, 40);
  if (top.length) lines.push(`top level: ${top.join(' ')}`);
  const cands = candidateFiles(files, rough);
  if (cands.length) lines.push(`files matching words in the prompt (maybe relevant, unverified):\n${cands.map((c) => `  - ${c}`).join('\n')}`);

  let agentDocText = '';
  for (const f of agentDocs) agentDocText += `--- ${f} ---\n${truncate(fs.readFileSync(path.join(root, f), 'utf8'), 2500)}\n`;

  return { root, isRepo: Boolean(branch), summary: lines.join('\n'), agentDocText, checks };
}
