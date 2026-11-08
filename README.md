# Windex

Rough prompt in, clean prompt out, straight into your coding agent.

Type, paste or dictate a messy prompt. Windex fixes the typos and dictation noise, works out what you mean, adds what the agent can't see for itself (your intent, past decisions, preferences, a checkable definition of done), acts as a thinking partner: lists and ranks its assumptions, critiques the idea (risks, simpler options, is it the right task), adds strong improvements as droppable `[Windex suggestion]` lines, and asks 6 to 8 probing questions on medium and large tasks (1 or 2 on small ones), all skippable, and opens Claude Code or Codex with the result. It learns from your edits and ratings, so each prompt fits your style better than the last.

It costs $0 per prompt. Cleaning runs on CLIs you already pay for or use on free tiers, never a metered API key.

## Install

```sh
git clone <repo> ~/Developer/windex
ln -s ~/Developer/windex/bin/windex.js ~/.local/bin/windex   # or: npm link
windex doctor
```

Requires Node 20+ and at least one of `claude` (Claude Code), `codex` (Codex CLI) or `gemini` (Gemini CLI). If none can be reached, an offline rule-based cleaner still runs.

## Use

```sh
cd my-project
windex                                  # type or dictate; press Enter on an empty line to finish
windex "the footer year is wrong"       # pass the prompt as an argument
pbpaste | windex                        # read the prompt from stdin
windex --clip                           # clean whatever is on the clipboard
windex -p "…"                           # print the cleaned prompt only (for scripts)
```

Review keys:

| key | action |
| --- | --- |
| `enter` | send: opens the agent in this folder with the prompt (also copied to the clipboard) |
| `t` | switch between Claude Code and Codex |
| `e` | edit in `$EDITOR` |
| `r` | revise: type a note ("shorter", "add a migration step"), Windex rewrites |
| `c` | copy to the clipboard and quit (for a session you already have open) |
| `q` | quit without sending |

When the agent session ends, Windex asks for a 1–5 rating, plus a short note if the score is 3 or lower. Press Enter to skip.

### Inside Claude Code or Codex: `/windex`

```
/windex the footer year is wrong on the about page fix it
```

The agent runs Windex, asks you its questions, and shows the cleaned prompt. Once you approve (or ask for changes), it records the final version with `windex mark` and does the task in the same session. Install the skill:

```sh
ln -s ~/Developer/windex/integrations/skill ~/.claude/skills/windex   # Claude Code
ln -s ~/Developer/windex/integrations/skill ~/.agents/skills/windex   # Codex
```

## How a prompt is built

1. **Context gathering (local, instant).** Git branch and recent commits, the stack, the project's check commands (test/lint/typecheck/build), files whose names match words in your prompt, `CLAUDE.md`/`AGENTS.md` (read so their contents are not repeated), and your memory files ranked by relevance.
2. **Cleaning (model).** A system prompt ([`prompts/cleaner.md`](prompts/cleaner.md)) built on Anthropic's and OpenAI's published guidance for coding agents: outcome first, context the agent can't find itself, constraints with their reasons, a checkable "done when", stated assumptions, and a length matched to the task. See [`docs/prompt-structure.md`](docs/prompt-structure.md).
3. **Questions.** At most 3, each with a default the prompt already assumes, so you can always press Enter through them.
4. **Learning.** Every run is logged to `~/.windex/history.jsonl` with the rough prompt, Windex's version, what you actually sent and your rating. Past prompts you edited or rated well are fed back as examples, and every 8 sent prompts a background job distils your edits and ratings into `~/.windex/profile.md`, a short list of rules the cleaner follows.

Secrets (API keys, tokens, passwords) are redacted before any context reaches a cleaning engine.

## Engines

Tried in order until one works (set the order in `~/.windex/config.json`):

| engine | runs on | notes |
| --- | --- | --- |
| `claude` | Claude Pro/Max subscription via `claude -p` | default; `ANTHROPIC_API_KEY` is removed for this call so usage stays on the subscription |
| `codex` | ChatGPT subscription via `codex exec` | picks a small model your plan supports |
| `gemini` | Gemini CLI free tier | reads `GEMINI_API_KEY` from `~/.config/secrets/gemini.env` |
| `offline` | nothing | typo and dictation clean-up plus basic structure |

Force one with `-e codex` and so on.

## Commands

```
windex history [n]         recent runs
windex rate <1-5> [note]   rate the last sent prompt
windex learn               rebuild the style profile now
windex profile [edit]      show or edit learned rules
windex doctor              check engines, agents, memory and learning stats
```

## Config

`~/.windex/config.json` overrides any default in [`src/config.js`](src/config.js). For example:

```json
{
  "target": "claude",
  "engines": ["claude", "gemini", "offline"],
  "claude": { "model": "haiku" },
  "memoryDirs": ["~/.goldfish/memory", "{claude:cwd}"],
  "learnEvery": 5
}
```

`{claude:cwd}` is Claude Code's auto-memory folder for the current project, and `{claude:home}` is the one for your home directory. Any folder of markdown files with `name`/`description` frontmatter works as memory.

## Tests

```sh
npm test
```

## Thinking partner

Per prompt Windex returns ranked `assumptions` (impact + what breaks), a `critique` (`risks`, `alternatives`, `right_task`), `suggestions` and `questions`. Code renders them into the cleaned prompt (`## Assumptions`, `## Windex critique`, `## Suggestions`; see `src/extras.js`). In the review screen press `d` to drop a `[Windex suggestion]`. Critique never blocks sending. Small tasks stay short.
