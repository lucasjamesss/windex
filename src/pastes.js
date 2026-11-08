import { redact } from './text.js';

// Logs, stack traces and code pasted into a rough prompt are data, not instructions. Windex lifts
// them out before the model sees the prompt (so they are never reworded or dropped) and puts them
// back afterwards in labeled XML tags, which is how Claude and Codex tell data from instructions.

const LOGLINE = /^\s+at\s|^\s*(?:[A-Za-z]*(?:Error|Exception)\b|Traceback|FAIL|ERR!|warning:|error:)|^\d{4}-\d\d-\d\d[T ]|^\[\d\d:\d\d|^\s*[│├└┌]|^[\w@./-]+\.\w+:\d+(?::\d+)?\b|^\s{4,}\S|^\s*[$>] \S/;

export function extractPastes(rough) {
  const pastes = [];
  const keep = (body, kind) => { pastes.push({ kind, body: body.replace(/\s+$/, '') }); return `[[PASTE_${pastes.length}]]`; };

  // 1. fenced blocks
  let text = rough.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, body) => keep(body, LOGLINE.test(body.split('\n')[0] || '') || /Error|Traceback/.test(body.slice(0, 200)) ? 'error_log' : 'code'));

  // 2. runs of 3+ log-looking lines
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j < lines.length && LOGLINE.test(lines[j]) && !/^\[\[PASTE_\d+\]\]$/.test(lines[j].trim())) j++;
    if (j - i >= 3) {
      let start = i;
      // include a preceding "TypeError: …" style header line when it is just above the run
      out.push(keep(lines.slice(start, j).join('\n'), 'error_log'));
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return { text: out.join('\n'), pastes };
}

export function restorePastes(prompt, pastes) {
  if (!pastes.length) return prompt;
  let out = prompt;
  const missing = [];
  pastes.forEach((p, idx) => {
    const n = idx + 1;
    const block = `<${p.kind} id="${n}">\n${redact(p.body)}\n</${p.kind}>`;
    const re = new RegExp(`\\[\\[PASTE_${n}\\]\\]`, 'g');
    if (re.test(out)) out = out.replace(re, () => `\n\n${block}\n\n`);
    else missing.push(block);
  });
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  if (missing.length) out += `\n\n## Pasted material\n${missing.join('\n\n')}`;
  return out;
}

// For revisions: turn restored tags back into placeholders so the model never re-types them.
export function collapsePastes(prompt, pastes) {
  if (!pastes.length) return prompt;
  return prompt.replace(/<(error_log|code) id="(\d+)">[\s\S]*?<\/\1>/g, (m, _k, n) => (pastes[Number(n) - 1] ? `[[PASTE_${n}]]` : m));
}
