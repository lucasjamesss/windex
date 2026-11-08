import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PATHS, loadState, saveState } from './config.js';
import { terms, overlap, truncate } from './text.js';

export function readHistory() {
  if (!fs.existsSync(PATHS.history)) return [];
  const out = [];
  for (const line of fs.readFileSync(PATHS.history, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function writeHistory(entries) {
  const tmp = PATHS.history + '.tmp';
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.renameSync(tmp, PATHS.history);
}

export function newId() {
  return crypto.randomBytes(4).toString('hex');
}

export function appendHistory(entry) {
  fs.appendFileSync(PATHS.history, JSON.stringify(entry) + '\n');
}

export function updateHistory(id, patch) {
  const all = readHistory();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  writeHistory(all);
  return all[i];
}

export function readProfile() {
  try { return fs.readFileSync(PATHS.profile, 'utf8').trim(); } catch { return ''; }
}

// Past runs the developer edited or rated well, most similar to the new rough prompt.
// They teach the cleaner this developer's taste better than generic examples.
export function pickExamples(history, rough, project, n = 2) {
  if (n <= 0) return [];
  const q = terms(rough);
  const good = history.filter((e) => e.final && e.sent && (e.rating >= 4 || (e.edited && !(e.rating <= 2))));
  return good
    .map((e) => ({ e, s: overlap(q, terms(e.rough)) + (e.project === project ? 2 : 0) + (e.edited ? 1 : 0) + (e.rating >= 4 ? 1 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ e }) => e);
}

export function formatExamples(list) {
  return list.map((e) => `<past_example>\n<rough>${truncate(e.rough, 1200)}</rough>\n<what_they_sent>${truncate(e.final, 2500)}</what_they_sent>\n</past_example>`).join('\n');
}

export function learnDue(cfg) {
  const st = loadState();
  const total = readHistory().filter((e) => e.sent).length;
  return total - (st.learnedAt || 0) >= cfg.learnEvery;
}

export function buildLearnInput(history, profile) {
  const recent = history.filter((e) => e.sent).slice(-30);
  const items = recent.map((e, i) => {
    const parts = [`<entry n="${i + 1}" project="${e.project || ''}" target="${e.target || ''}">`, `<rough>${truncate(e.rough, 800)}</rough>`];
    if (e.edited) parts.push(`<windex_version>${truncate(e.cleaned, 1500)}</windex_version>`, `<sent_version>${truncate(e.final, 1500)}</sent_version>`);
    else parts.push(`<sent_version_unedited>${truncate(e.final, 800)}</sent_version_unedited>`);
    if (e.rating) parts.push(`<rating>${e.rating}/5</rating>`);
    if (e.note) parts.push(`<note>${truncate(e.note, 400)}</note>`);
    parts.push('</entry>');
    return parts.join('\n');
  });
  return `<current_profile>\n${profile || '(empty)'}\n</current_profile>\n\n<history>\n${items.join('\n')}\n</history>`;
}

export function saveProfile(text) {
  const clean = text.replace(/```(?:markdown|md)?/g, '').trim();
  const lines = clean.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).slice(0, 15);
  if (!lines.length) throw new Error('learn: model returned no rules');
  fs.writeFileSync(PATHS.profile, lines.join('\n') + '\n');
  saveState({ learnedAt: readHistory().filter((e) => e.sent).length, learnedTs: new Date().toISOString() });
  return lines;
}

// Distil the profile in a detached process so the developer never waits for it.
export function learnInBackground() {
  const bin = fileURLToPath(new URL('../bin/windex.js', import.meta.url));
  const child = spawn(process.execPath, [bin, 'learn', '--quiet'], { detached: true, stdio: 'ignore' });
  child.unref();
}
