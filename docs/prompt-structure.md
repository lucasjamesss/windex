# The Windex prompt structure

Why Windex prompts look the way they do. Every rule here traces back to vendor guidance for coding agents or to how those agents actually fail.

## What the research says

**Anthropic, Claude Code best practices** (code.claude.com/docs/en/best-practices)
- "Tell Claude what it can't see." The agent reads the repo well, so the prompt's job is information that was never in the repo: decisions, preferences, scope, hidden processes. Before writing something down, ask: could it find this by reading the code, and would it actually look? If both answers are yes, leave it out.
- Be specific: name the file, describe the symptom, say what "fixed" looks like ("write a failing test that reproduces it, then fix it").
- If you prefer one of two reasonable approaches, say so. Claude can't infer the preference from code.
- Scope: Claude reads requests conservatively. "Be ambitious: …" plus a concrete list is how you ask for the full version.
- "Give Claude something it can run that comes back pass or fail", and ask for *evidence* (the commands it ran and their output), not "all tests pass".
- Phrases like "think step by step" or "be thorough" are ordinary text, not switches.
- When an idea is still vague, have the agent interview you or plan before it writes code.

**Anthropic, prompting best practices** (platform.claude.com/docs/en/build-with-claude/prompt-engineering)
- Be clear and direct. The test: would a colleague with no context know what to do?
- Explain the *reason* behind a constraint, because the model generalises from the reason.
- Use numbered steps when order or completeness matters.
- Keep instruction types apart (XML tags or headings).
- Give 3–5 relevant, varied examples.
- Agentic coding pitfalls to prevent: over-engineering, hard-coding to pass tests, and claims about code the agent hasn't opened.

**OpenAI, Codex best practices** (learn.chatgpt.com/guides/best-practices)
- A good task prompt has four parts: **Goal**, **Context** (files, docs, errors), **Constraints** (standards, architecture, safety), and **Done when** (tests pass, the behaviour changes, the bug no longer reproduces).
- Start with the result, not a list of steps.
- Plan first for complex, ambiguous or hard-to-describe work.
- Durable rules belong in AGENTS.md or skills, not in each prompt.
- Codex can check its own work "only if it knows what good looks like", so give it the check commands.

## The structure

```
<Outcome: one or two sentences, what is true when finished>

## Context        why, decisions, preferences, pointers (files, URLs, verbatim errors)
## Task           outcome-level steps; numbered only when order matters
## Constraints    scope and rules, each with its reason
## Done when      checks the agent can run, and the evidence to report back
## Assumptions    defaults Windex chose, so wrong ones get caught
```

Small tasks drop all headings: two to five lines with the outcome, any key constraint and the check. Empty sections are omitted, never written as "N/A".

## Windex's own additions

- **Memory injection, filtered.** Only memory that changes what the agent should do for *this* task gets in, written as a fact, never as "according to memory".
- **Never repeat CLAUDE.md/AGENTS.md.** Windex reads them to understand the project, and the agent reads them itself.
- **Questions with defaults.** At most 3, each with a default that the draft prompt already uses, so skipping them costs nothing.
- **Risk gate.** Large, vague or risky work (production, money, deletion) gets an "investigate → plan → wait for go-ahead" step.
- **No invented facts.** File paths and commands come only from the rough prompt, the repo scan or memory. Anything else is an assumption.
- **Your taste wins.** The learned profile overrides the defaults, except the rules about preserving details, not inventing facts and never leaking secrets.
