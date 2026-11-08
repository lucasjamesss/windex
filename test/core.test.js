import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'windex-test-'));
process.env.WINDEX_HOME = tmp;

const { extractJSON, parseClean } = await import('../src/parse.js');
const { scrub, offlineClean } = await import('../src/offline.js');
const { redact, terms } = await import('../src/text.js');
const { parseMemoryFile, selectMemories } = await import('../src/memory.js');
const { candidateFiles, checkCommands } = await import('../src/context.js');
const { pickExamples, appendHistory, updateHistory, readHistory, saveProfile, readProfile, buildLearnInput } = await import('../src/learn.js');
const { isCommand, parseArgs } = await import('../src/cli.js');
const { buildSystem, buildUser } = await import('../src/clean.js');
const { codexModel } = await import('../src/engines.js');
const X = await import('../src/extras.js');
const { clean } = await import('../src/clean.js');

test('extractJSON handles fences, prose and braces inside strings', () => {
  const raw = 'Sure!\n```json\n{"prompt":"use {curly} and \\"quotes\\"","n":{"a":1}}\n```\ntrailing';
  assert.deepEqual(extractJSON(raw), { prompt: 'use {curly} and "quotes"', n: { a: 1 } });
  assert.throws(() => extractJSON('no json here'));
});

test('parseClean normalises and caps questions', () => {
  const r = parseClean(JSON.stringify({ prompt: ' do it ', kind: 'weird', size: 'huge', questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ question: `q${i}`, options: ['a'], default: 'a' })) }));
  assert.equal(r.prompt, 'do it');
  assert.equal(r.kind, 'other');
  assert.equal(r.size, 'medium');
  assert.equal(r.questions.length, 8);
  assert.equal(r.questions[0].category, 'other');
  assert.throws(() => parseClean('{"title":"x"}'));
});

test('parseClean keeps goldfish lookups and question categories', () => {
  const r = parseClean(JSON.stringify({
    prompt: 'x',
    questions: [{ category: 'avoid', question: 'q', options: [], default: '' }],
    goldfish_lookups: [{ tool: 'goldfish_recall', query: ' exniche rules ', why: 'w' }, { tool: 'bad', query: 'y' }, { query: '' }],
  }));
  assert.equal(r.questions[0].category, 'avoid');
  assert.deepEqual(r.goldfish_lookups.map((l) => [l.tool, l.query]), [['goldfish_recall', 'exniche rules'], ['goldfish_search', 'y']]);
});

test('offline cleaner still interviews', () => {
  assert.equal(offlineClean({ rough: 'fix teh footer' }).questions.length, 1);
  assert.equal(offlineClean({ rough: 'Add login. It should use magic links. Store sessions in the db. Send a welcome email after signup. Also add logout in the header on mobile too.' }).questions.length, 2);
});

test('user prompt includes the goldfish memory index', () => {
  const ctx = { repo: { summary: 's', agentDocText: '' }, memories: [], examples: [], index: ['a-note: about a'] };
  assert.match(buildUser({ rough: 'r', ctx, target: 'claude' }), /<memory_index[^>]*>\na-note: about a/);
});

test('principles: core always, research for builds, visual for 3D work, strip is idempotent', async () => {
  const { pickPrinciples, withPrinciples, stripPrinciples, HEADING } = await import('../src/principles.js');
  const fix = pickPrinciples({ kind: 'fix', size: 'small', rough: 'footer year' });
  assert.equal(fix.length, 3);
  const build = pickPrinciples({ kind: 'build', size: 'medium', rough: 'add login' });
  assert.ok(build.some((x) => /reinventing the wheel/.test(x)));
  assert.ok(build.some((x) => /pond_search/.test(x)));
  assert.ok(!build.some((x) => /GitHub \(code/.test(x)));
  const viz = pickPrinciples({ kind: 'build', size: 'small', rough: 'a cool three.js particle hero animation' });
  assert.ok(viz.some((x) => /Shadertoy/.test(x)) && viz.some((x) => /reinventing/.test(x)));
  assert.equal(pickPrinciples({ kind: 'build', size: 'medium', rough: 'x' }, { enabled: false }).length, 0);
  const once = withPrinciples('Do it.', { kind: 'build', size: 'medium', rough: 'x' });
  assert.ok(once.includes(HEADING));
  assert.equal(withPrinciples(once, { kind: 'build', size: 'medium', rough: 'x' }), once);
  assert.equal(stripPrinciples(once), 'Do it.');
});

test('pastes: extract, restore, collapse, redact', async () => {
  const { extractPastes, restorePastes, collapsePastes } = await import('../src/pastes.js');
  const rough = 'build fails:\nTypeError: x is undefined\n    at foo (/app/a.js:10:5)\n    at bar (/app/b.js:2:1)\nand also ```js\nconst k = "sk_live_abcdefghijklmnop1234";\n```\nfix it';
  const { text, pastes } = extractPastes(rough);
  assert.equal(pastes.length, 2);
  const log = pastes.findIndex((x) => x.kind === 'error_log') + 1;
  const code = pastes.findIndex((x) => x.kind === 'code') + 1;
  assert.ok(log && code);
  assert.match(text, /\[\[PASTE_1\]\]/);
  assert.doesNotMatch(text, /TypeError|sk_live/);
  const draft = `Fix.\n\n## Context\n[[PASTE_${log}]]\n\nSee [[PASTE_${code}]].`;
  const restored = restorePastes(draft, pastes);
  assert.match(restored, new RegExp(`<error_log id="${log}">\\nTypeError: x is undefined`));
  assert.match(restored, new RegExp(`<code id="${code}">`));
  assert.doesNotMatch(restored, /sk_live_abc/);
  assert.equal(restorePastes(collapsePastes(restored, pastes), pastes), restored);
  // dropped placeholder falls back to an appendix
  assert.match(restorePastes('Fix it.', pastes), /## Pasted material/);
  // short snippets are left alone
  assert.equal(extractPastes('the title says Error: oops. fix it').pastes.length, 0);
});

test('scrub fixes dictation noise and typos', () => {
  const s = scrub('um so teh promt is broken full stop i dont know why the the button fails');
  assert.match(s, /^So the prompt is broken\. I don't know why the button fails$/);
});

test('scrub leaves code-like words alone', () => {
  assert.match(scrub('rename getUserId in api_client.ts'), /getUserId in api_client\.ts/);
});

test('offlineClean sizes output and adds checks', () => {
  const small = offlineClean({ rough: 'fix teh footer year', checks: ['npm run test   # vitest'] });
  assert.equal(small.size, 'small');
  assert.match(small.prompt, /`npm run test`/);
  const big = offlineClean({ rough: 'Add login. It should use magic links. Store sessions in the db. Send a welcome email after signup. Also add a logout button in the header and make sure it works on mobile.' });
  assert.match(big.prompt, /## Task/);
  assert.match(big.prompt, /## Done when/);
});

test('redact strips secrets', () => {
  const s = redact('key sk_live_abcdefghijklmnop1234 and api_key=supersecretvalue123 and ghp_abcdefghijklmnopqrstuvwxyz12');
  assert.doesNotMatch(s, /sk_live_abc|supersecret|ghp_abc/);
  assert.match(s, /api_key=\[REDACTED\]/);
});

test('memory frontmatter and selection', () => {
  const m = parseMemoryFile('---\nname: exniche-design\ndescription: exNiche UI rules, purple only on CTAs\nmetadata:\n  type: feedback\n---\nBody text');
  assert.equal(m.meta.name, 'exniche-design');
  assert.equal(m.meta.type, 'feedback');
  assert.equal(m.body, 'Body text');
  const mems = [
    { name: 'exniche-design', description: 'exNiche UI rules, purple only on CTAs', type: 'feedback', body: 'buttons' },
    { name: 'scotch-timesheet', description: 'sailing coaching timesheet', type: 'project', body: 'hours' },
  ];
  const sel = selectMemories(mems, 'make the exniche buttons purple', '/x/exniche');
  assert.equal(sel.length, 1);
  assert.equal(sel[0].name, 'exniche-design');
});

test('candidateFiles matches prompt words to paths', () => {
  const files = ['src/components/Footer.tsx', 'src/pages/about.tsx', 'README.md', 'src/lib/footnotes.ts'];
  assert.deepEqual(candidateFiles(files, 'the footer on the about page').slice(0, 2).sort(), ['src/components/Footer.tsx', 'src/pages/about.tsx']);
});

test('checkCommands reads package scripts with the right package manager', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'repo-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev', test: 'vitest', lint: 'eslint .' } }));
  fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), '');
  const cmds = checkCommands(d);
  assert.equal(cmds.length, 2);
  assert.match(cmds[0], /^pnpm test/);
});

test('history round trip, examples and profile', () => {
  appendHistory({ id: 'a1', rough: 'add stripe checkout to pricing', final: 'Add Stripe Checkout…', cleaned: 'x', edited: true, sent: true, project: 'p' });
  appendHistory({ id: 'a2', rough: 'unrelated sailing thing', final: 'y', sent: true, rating: 5, project: 'q' });
  updateHistory('a1', { rating: 4 });
  assert.equal(readHistory().find((e) => e.id === 'a1').rating, 4);
  const ex = pickExamples(readHistory(), 'stripe checkout for the pro plan', 'p', 2);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].id, 'a1');
  assert.match(buildLearnInput(readHistory(), ''), /<sent_version>Add Stripe Checkout/);
  saveProfile('Here you go:\n- Rule one\n- Rule two\nnot a rule');
  assert.equal(readProfile(), '- Rule one\n- Rule two');
});

test('isCommand keeps prompt-like args as prompts', () => {
  assert.equal(isCommand(['history']), true);
  assert.equal(isCommand(['rate', '4', 'missed', 'tests']), true);
  assert.equal(isCommand(['learn']), true);
  assert.equal(isCommand(['learn', 'react', 'hooks']), false);
  assert.equal(isCommand(['history of the auth module']), false);
  assert.equal(isCommand(['rate', 'limiting']), false);
  assert.equal(isCommand(['mark', 'a1b2c3d4']), true);
  assert.equal(isCommand(['mark', 'the', 'todo', 'done']), false);
});

test('parseArgs', () => {
  const o = parseArgs(['-t', 'codex', '--print', 'fix', 'it']);
  assert.equal(o.target, 'codex');
  assert.equal(o.print, true);
  assert.deepEqual(o._, ['fix', 'it']);
  assert.throws(() => parseArgs(['--nope']));
});

test('system and user prompts carry target, profile and redaction', () => {
  const sys = buildSystem('codex', '- Always add a deploy step');
  assert.match(sys, /OpenAI Codex CLI/);
  assert.match(sys, /Always add a deploy step/);
  assert.doesNotMatch(sys, /\{\{TARGET\}\}/);
  const ctx = { repo: { summary: 'project: x', agentDocText: '', checks: [] }, memories: [], examples: [] };
  const u = buildUser({ rough: 'use key sk_live_abcdefghijklmnop1234', ctx, target: 'claude' });
  assert.match(u, /\[REDACTED\]/);
  assert.match(u, /<rough_prompt>/);
});

test('codexModel prefers small models from the cache', () => {
  const f = path.join(tmp, 'models.json');
  fs.writeFileSync(f, JSON.stringify({ models: [{ slug: 'gpt-reserve' }, { slug: 'gpt-6-big' }, { slug: 'gpt-6-luna' }] }));
  assert.equal(codexModel(f), 'gpt-6-luna');
  assert.equal(codexModel(path.join(tmp, 'missing.json')), null);
});

test('terms stems words and drops stopwords', () => {
  const t = terms('the deployment is deploying');
  assert.ok(t.has('deplo'));
  assert.ok(!t.has('the'));
});

test('small tasks cap at 2 questions', () => {
  const qs = [1, 2, 3, 4].map((i) => ({ question: `q${i}`, default: '' }));
  assert.equal(parseClean(JSON.stringify({ prompt: 'x', size: 'small', questions: qs })).questions.length, 2);
});

test('assumptions rank by impact, accept old string form, and keep new question categories', () => {
  const r = parseClean(JSON.stringify({
    prompt: 'x',
    assumptions: ['plain old', { text: 'low one', impact: 'low' }, { text: 'bad one', impact: 'high', if_wrong: 'wasted run' }],
    questions: [{ category: 'failure', question: 'q', default: '' }, { category: 'bogus', question: 'q2', default: '' }],
  }));
  assert.deepEqual(r.assumptions.map((a) => a.text), ['bad one', 'plain old', 'low one']);
  assert.equal(r.assumptions[0].if_wrong, 'wasted run');
  assert.deepEqual(r.questions.map((q) => q.category), ['failure', 'other']);
});

test('critique and suggestions normalise; old replies without them still parse', () => {
  const old = parseClean(JSON.stringify({ prompt: 'x' }));
  assert.ok(X.critiqueIsEmpty(old.critique));
  assert.deepEqual(old.suggestions, []);
  const r = parseClean(JSON.stringify({
    prompt: 'x',
    critique: { risks: ['a', 'b', 'c'], alternatives: ['s'], right_task: 'fine' },
    suggestions: [{ text: 'do y', inject: true }, { text: 'maybe z', inject: false }, { text: '' }],
  }));
  assert.equal(r.critique.risks.length, 2);
  assert.equal(r.suggestions.length, 2);
});

test('extras render marked suggestions; weak ones stay out; stripExtras is idempotent', () => {
  const res = parseClean(JSON.stringify({
    prompt: 'Do the thing.\n\n## Done when\n- ok',
    assumptions: [{ text: 'A', impact: 'high' }],
    critique: { risks: ['r'], alternatives: ['alt'], right_task: 'rt' },
    suggestions: [{ text: 'strong', inject: true }, { text: 'weak', inject: false }],
  }));
  const out = X.withExtras(res.prompt, res);
  assert.match(out, /## Assumptions\n- \(high\) A/);
  assert.match(out, /## Windex critique[\s\S]*Risk: r[\s\S]*Simpler option: alt[\s\S]*Right task\? rt/);
  assert.match(out, /- \[Windex suggestion\] strong/);
  assert.doesNotMatch(out, /weak/);
  assert.equal(X.stripExtras(out), res.prompt);
  assert.equal(X.withExtras(out, res), out);
});

test('dropping a suggestion removes its line, then the heading when none remain', () => {
  const res = parseClean(JSON.stringify({ prompt: 'Do it.', suggestions: [{ text: 'one' }, { text: 'two' }] }));
  const out = X.withExtras(res.prompt, res);
  assert.deepEqual(X.suggestionsIn(out), ['one', 'two']);
  const d1 = X.dropSuggestion(out, 0);
  assert.deepEqual(X.suggestionsIn(d1), ['two']);
  assert.doesNotMatch(d1, /one/);
  const d2 = X.dropSuggestion(d1, 0);
  assert.equal(d2, 'Do it.');
});

test('drop keeps sections that follow the suggestions', () => {
  const p = 'Do it.\n\n## Suggestions\n- [Windex suggestion] only\n\n## How to work\n- be honest';
  assert.equal(X.dropSuggestion(p, 0), 'Do it.\n\n## How to work\n- be honest');
});

test('system prompt carries the new counts and examples are valid, deep JSON', () => {
  const sys = buildSystem('claude', '');
  assert.match(sys, /6 to 8/);
  assert.doesNotMatch(sys, /Ask 2 to 4 questions/);
  const ex = fs.readFileSync(new URL('../prompts/examples.md', import.meta.url), 'utf8');
  const outs = [...ex.matchAll(/<output>(.*?)<\/output>/gs)].map((m) => parseClean(m[1]));
  assert.ok(outs.length >= 3);
  for (const o of outs) {
    if (o.size === 'small') assert.ok(o.questions.length >= 1 && o.questions.length <= 2);
    else {
      assert.ok(o.questions.length >= 6 && o.questions.length <= 8, o.title);
      assert.ok(o.assumptions.length >= 3 && o.suggestions.length >= 1, o.title);
      assert.ok(o.critique.risks.length && o.critique.alternatives.length && o.critique.right_task, o.title);
    }
  }
});
