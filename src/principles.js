// Standing instructions Windex appends to every cleaned prompt. They are added in code, not by the
// model, so they are always present, identical, and cheap to change in one place.

export const HEADING = '## How to work';

const CORE = [
  'Be straight with me, not agreeable. If my approach is wrong, risky or over-complicated, say so and suggest better before building it. Do not flatter or agree just to please.',
  'Do not guess. If something material is unclear and the repo cannot answer it, ask me before building. If it is minor, state your assumption in one line and continue.',
  'Check facts against the actual code, docs or output before claiming them. Say "I don\'t know" or "I could not verify this" when that is the case.',
];

const RESEARCH = [
  'If a `pond_search` tool is available, search it first: it holds vetted open-source repos, techniques and system designs. If you find something new and worth keeping, save it with `pond_save`.',
  'Research before building. Look for an existing library, pattern or open-source implementation first, and reuse or adapt it instead of reinventing the wheel. Prefer well-maintained, widely used options, and tell me what you found and why you picked it.',
  'Check that any code or asset you borrow has a license that allows our use, and keep the credit or notice it requires.',
];

const VISUAL = [
  'This is visual or animation work, and the open-source community has produced a lot of excellent examples. Search before writing from scratch: GitHub (code and topics), CodePen, Shadertoy, the three.js and react-three-fiber examples and docs, Codrops demos, the Poimandres ecosystem (drei, postprocessing), GSAP and Lottie galleries, and Sketchfab for models. Study the best two or three, then adapt the technique to this project. Report which sources you used.',
];

const VISUAL_WORDS = /\b(3d|three\.?js|r3f|react-three|webgl|webgpu|shader|glsl|render(?:s|ing|er)?|particles?|animat\w*|motion|parallax|scroll[- ]?(?:driven|trigger|animation)|gsap|lottie|canvas|svg animation|hero (?:section|animation|visual)|model viewer|gltf|glb|blender|remotion|three)\b/i;
const BUILD_KINDS = new Set(['build', 'design', 'refactor', 'fix', 'other']);

export function pickPrinciples({ kind, size, rough, prompt }, cfg = {}) {
  const on = { enabled: true, core: true, research: true, visual: true, ...cfg };
  if (!on.enabled) return [];
  const text = `${rough || ''}\n${prompt || ''}`;
  const out = [];
  if (on.core) out.push(...CORE);
  const research = on.research && BUILD_KINDS.has(kind) && size !== 'small' && kind !== 'fix';
  if (research) out.push(...RESEARCH);
  if (on.visual && BUILD_KINDS.has(kind) && VISUAL_WORDS.test(text)) {
    if (!research) out.push(...RESEARCH);
    out.push(...VISUAL);
  }
  return out;
}

export function stripPrinciples(prompt) {
  const i = prompt.indexOf(`\n\n${HEADING}`);
  return (i >= 0 ? prompt.slice(0, i) : prompt).trimEnd();
}

export function withPrinciples(prompt, meta, cfg) {
  const base = stripPrinciples(prompt);
  const items = pickPrinciples({ ...meta, prompt: base }, cfg);
  if (!items.length) return base;
  return `${base}\n\n${HEADING}\n${items.map((x) => `- ${x}`).join('\n')}`;
}
