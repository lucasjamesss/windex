import fs from 'node:fs';
import path from 'node:path';
import { HOME, claudeMemoryDir } from './config.js';
import { terms, overlap, truncate } from './text.js';

function expandDir(d, cwd) {
  if (d === '{claude:cwd}') return claudeMemoryDir(cwd);
  if (d === '{claude:home}') return claudeMemoryDir(HOME);
  return d.replace(/^~(?=\/|$)/, HOME);
}

// Minimal frontmatter reader: top-level `key: value` lines plus one nested level (metadata.type).
export function parseMemoryFile(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_]+):\s*(.*)$/);
    if (kv && kv[2] !== '') meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].trim() };
}

export function loadMemories(dirs, cwd) {
  const seen = new Set();
  const out = [];
  for (const raw of dirs) {
    const dir = expandDir(raw, cwd);
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    for (const f of fs.readdirSync(real)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      let text;
      try { text = fs.readFileSync(path.join(real, f), 'utf8'); } catch { continue; }
      const { meta, body } = parseMemoryFile(text);
      out.push({
        name: meta.name || f.replace(/\.md$/, ''),
        description: meta.description || '',
        type: meta.type || '',
        isChat: f.startsWith('chat-'),
        body,
        file: path.join(real, f),
      });
    }
  }
  return out;
}

// Rank memories by term overlap with the rough prompt and the project folder name.
// Names and descriptions count triple: they are written to decide relevance.
export function selectMemories(memories, rough, cwd, limit = 6) {
  const q = terms(rough);
  const project = terms(path.basename(cwd));
  const scored = [];
  for (const m of memories) {
    const head = terms(`${m.name} ${m.description}`);
    const body = terms(m.body);
    let score = 3 * overlap(q, head) + Math.min(overlap(q, body), 6) + 2 * overlap(project, head);
    if (m.type === 'feedback' || m.type === 'user') score *= 1.3;
    if (m.isChat) score *= 0.5;
    if (score >= 3) scored.push({ ...m, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function formatMemories(selected) {
  return selected
    .map((m) => `<memory_item name="${m.name}"${m.type ? ` type="${m.type}"` : ''}>\n${m.description ? m.description + '\n' : ''}${truncate(m.body, 900)}\n</memory_item>`)
    .join('\n');
}
