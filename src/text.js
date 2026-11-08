const STOP = new Set(`a an and are as at be but by can could do does for from get go got has have i if in into is it its just like make me my no not of on or our so some that the their them then there these this to too up us use want was we were what when where which who will with would you your yeah ok okay um uh pls please need needs also all any want wanna gonna thing things stuff really basically actually maybe should shall one way new now how why im dont cant ill ive lets let`.split(/\s+/));

// Lowercase word stems used for cheap relevance matching. Five-letter prefixes make
// "deploying"/"deployment" and many typos ("deplyment" no, but "deplo…" yes) line up.
export function terms(text) {
  const out = new Set();
  for (const raw of String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || []) {
    for (const w of raw.split(/[-_]/)) {
      if (w.length < 3 || STOP.has(w)) continue;
      out.add(w.length > 5 ? w.slice(0, 5) : w);
    }
  }
  return out;
}

export function overlap(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

const SECRET_PATTERNS = [
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/g,
  /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*)["']?[^\s"']{8,}/gi,
];

// Context sent to a cleaning engine never carries secrets, even though engines are local CLIs.
export function redact(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, g1) => (typeof g1 === 'string' && /[:=]\s*$/.test(g1) ? g1 + '[REDACTED]' : '[REDACTED]'));
  }
  return out;
}
