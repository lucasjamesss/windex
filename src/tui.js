import readline from 'node:readline';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const c = {
  bold: wrap(1, 22), dim: wrap(2, 22), cyan: wrap(36, 39), green: wrap(32, 39),
  yellow: wrap(33, 39), red: wrap(31, 39), magenta: wrap(35, 39), inverse: wrap(7, 27),
};

export const err = (s) => process.stderr.write(s + '\n');
export const out = (s = '') => process.stdout.write(s + '\n');

export function spinner(label) {
  if (!process.stderr.isTTY) return { set() {}, stop() {} };
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0, text = label;
  const start = Date.now();
  const t = setInterval(() => {
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    process.stderr.write(`\r\x1b[2K${c.cyan(frames[i++ % frames.length])} ${text} ${c.dim(secs + 's')}`);
  }, 90);
  return {
    set(l) { text = l; },
    stop() { clearInterval(t); process.stderr.write('\r\x1b[2K'); },
  };
}

export function ask(question, { prefill = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
    rl.on('SIGINT', () => { rl.close(); process.stderr.write('\n'); process.exit(130); });
    rl.question(question, (a) => { rl.close(); resolve(a); });
    if (prefill) rl.write(prefill);
  });
}

// Rough prompts are often multi-line pastes or dictation. An empty line typed by hand (or Ctrl-D)
// ends input; empty lines inside a paste arrive within milliseconds of the previous line and are kept.
export function readMultiline(hint) {
  return new Promise((resolve) => {
    err(hint);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY, prompt: c.cyan('› ') });
    const lines = [];
    let timer = null;
    rl.prompt();
    rl.on('line', (line) => {
      clearTimeout(timer);
      if (line.trim() === '' && lines.some((l) => l.trim())) {
        // A blank line ends input unless more text follows within 300ms (a blank line inside a paste).
        lines.push(line);
        timer = setTimeout(() => rl.close(), 300);
        return;
      }
      lines.push(line);
      // A long line is a paste or dictation: if nothing follows for 1s, treat it as done.
      if (line.trim().length >= 40) { timer = setTimeout(() => rl.close(), 1000); return; }
      rl.prompt();
    });
    rl.on('SIGINT', () => { rl.close(); err(''); process.exit(130); });
    rl.on('close', () => resolve(lines.join('\n').trim()));
  });
}

// Single keypress, no Enter needed. Returns the key as a string ('\r' for Enter).
export function readKey(valid) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      ask('').then((a) => resolve(a.trim()[0] || '\r'));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf) => {
      const k = buf.toString();
      if (k === '\u0003') { stdin.setRawMode(false); err(''); process.exit(130); }
      const key = k === '\n' ? '\r' : k.toLowerCase();
      if (valid && !valid.includes(key)) return;
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(key);
    };
    stdin.on('data', onData);
  });
}

function wrapLine(line, width) {
  if (line.length <= width) return [line];
  const indent = (line.match(/^(\s*(?:[-*]|\d+\.)?\s*(?:\[[ x]\]\s*)?)/) || [''])[0].replace(/\S/g, ' ');
  const words = line.split(' ');
  const res = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) { res.push(cur); cur = indent + w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) res.push(cur);
  return res;
}

export function renderPrompt(text) {
  const width = Math.min((process.stdout.columns || 100) - 4, 110);
  let inCode = false;
  const lines = [];
  for (const raw of text.split('\n')) {
    if (raw.startsWith('```')) { inCode = !inCode; lines.push(c.dim(raw)); continue; }
    if (inCode) { lines.push(c.dim(raw)); continue; }
    for (const l of wrapLine(raw, width)) {
      if (/^#{1,6}\s/.test(l)) lines.push(c.bold(c.cyan(l)));
      else lines.push(l.replace(/`([^`]+)`/g, (_, x) => c.yellow(x)));
    }
  }
  return lines.map((l) => c.dim('│ ') + l).join('\n');
}
