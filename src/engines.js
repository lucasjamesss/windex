import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { PATHS } from './config.js';
import { offlineClean } from './offline.js';

export function which(bin) {
  try { return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

function runProc(cmd, args, { input, env, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${(err || out).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

// The config.toml default model may not be available on a ChatGPT plan, so pick one the account
// lists in Codex's own model cache, preferring small fast ones ("luna"/"mini").
export function codexModel(cacheFile = path.join(os.homedir(), '.codex', 'models_cache.json')) {
  let slugs = [];
  try {
    const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const list = Array.isArray(d) ? d : d.models || [];
    slugs = list.map((m) => m.slug || m.id).filter((x) => typeof x === 'string' && !/review|reserve/.test(x));
  } catch { return null; }
  return slugs.find((x) => /luna|mini|flash/.test(x)) || slugs[0] || null;
}

function loadEnvFile(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {}
  return env;
}

// Each engine takes { system, user } and resolves to the model's raw text reply.
// Every engine runs from an empty work dir so no project CLAUDE.md/AGENTS.md leaks in.
export const ENGINES = {
  claude: {
    bin: 'claude',
    note: 'Claude subscription (claude -p)',
    async run({ system, user }, cfg) {
      const env = { ...process.env };
      // Without an API key the CLI uses the logged-in subscription, so cleaning costs $0 extra.
      if (cfg.claude.stripApiKey) delete env.ANTHROPIC_API_KEY;
      const args = ['-p', '--model', cfg.claude.model, '--system-prompt', system, '--setting-sources', 'local',
        '--strict-mcp-config', '--tools', '', '--no-session-persistence', '--output-format', 'json'];
      const raw = await runProc('claude', args, { input: user, env, timeoutMs: cfg.claude.timeoutMs, cwd: PATHS.work });
      let res;
      try { res = JSON.parse(raw); } catch { return raw; }
      if (res.is_error) throw new Error(`claude: ${res.result || res.subtype}`);
      return res.result ?? '';
    },
  },
  codex: {
    bin: 'codex',
    note: 'ChatGPT subscription (codex exec)',
    async run({ system, user }, cfg) {
      const outFile = path.join(PATHS.work, `codex-${process.pid}-${Date.now()}.txt`);
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', PATHS.work, '-o', outFile,
        '-c', `model_reasoning_effort=${cfg.codex.effort}`];
      const model = cfg.codex.model || codexModel();
      if (model) args.push('-m', model);
      const input = `${system}\n\nIgnore any other style or persona instructions you were given; reply only in the JSON format above.\n\n${user}`;
      try {
        await runProc('codex', args, { input, env: process.env, timeoutMs: cfg.codex.timeoutMs, cwd: PATHS.work });
        return fs.readFileSync(outFile, 'utf8');
      } finally { fs.rmSync(outFile, { force: true }); }
    },
  },
  gemini: {
    bin: 'gemini',
    note: 'Gemini CLI free tier',
    async run({ system, user }, cfg) {
      const env = { ...process.env, ...loadEnvFile(cfg.gemini.envFile), GEMINI_CLI_TRUST_WORKSPACE: 'true' };
      if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) throw new Error('gemini: no GEMINI_API_KEY');
      const args = ['-m', cfg.gemini.model, '-p', `${system}\n\n${user}`];
      return runProc('gemini', args, { input: '', env, timeoutMs: cfg.gemini.timeoutMs, cwd: PATHS.work });
    },
  },
  offline: {
    bin: null,
    note: 'rule-based, no model',
    offline: true,
  },
};

export function availableEngines(cfg, only) {
  const list = only ? [only] : cfg.engines;
  return list.filter((name) => ENGINES[name] && (ENGINES[name].offline || which(ENGINES[name].bin)));
}

// Try engines in order; the first that returns parseable JSON wins.
// `parse` turns raw text into an object or throws; `offlineInput` feeds the rule-based fallback.
export async function runChain(cfg, { system, user, parse, offlineInput, only, onTry }) {
  const errors = [];
  for (const name of availableEngines(cfg, only)) {
    onTry?.(name);
    try {
      if (ENGINES[name].offline) {
        if (!offlineInput) continue;
        return { engine: name, result: offlineClean(offlineInput), errors };
      }
      const raw = await ENGINES[name].run({ system, user }, cfg);
      return { engine: name, result: parse(raw), errors };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`All engines failed:\n  ${errors.join('\n  ') || 'none available'}`);
}
