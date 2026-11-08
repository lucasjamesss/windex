---
name: windex
description: Clean a rough, dictated or typo-heavy prompt into a structured coding-agent prompt with Windex, review it with the user, then carry it out in this session. Use when the user types /windex, or says "windex this", "clean this prompt", or "run this through windex".
argument-hint: <rough prompt>
---

# /windex

The user's rough prompt is: $ARGUMENTS

If that is empty, ask the user for their rough prompt and stop until they reply.

## 1. Clean it

Run Windex from the current project directory. Pass the rough prompt on stdin with a quoted heredoc, exactly as the user wrote it (typos included), so no shell quoting can break it. Use `-t claude` if you are Claude Code and `-t codex` if you are Codex. Allow up to 4 minutes.

```sh
windex -p --json -t claude <<'WINDEX_ROUGH'
<the rough prompt, verbatim>
WINDEX_ROUGH
```

The output is JSON: `id`, `title`, `prompt`, `questions`, `assumptions` (ranked, with impact), `critique` (risks, alternatives, right_task), `suggestions`, `memory_used`, `changes`, `engine`. If `windex` is missing or exits non-zero, tell the user the error line and stop. Do not clean the prompt yourself instead, because the user wants Windex's memory, profile and learning in the loop.

## 2. Ask its questions (only if `questions` is non-empty)

Medium and large tasks have 6 to 8 questions; small ones 1 or 2. Ask every question in one go, with its options and a default the draft already assumes. Use your multiple-choice question tool if you have one. Otherwise send a short numbered list and say that replying "ok" keeps the defaults. If an answer differs from the default, update the prompt text to match. Change only what the answer affects.

## 3. Show it and get approval

Show the user:
- the title,
- the full prompt in a fenced `markdown` block, unchanged,
- one line saying which memory was used and what Windex changed,
- the critique (risks, simpler option, right task?) as three short lines when present, and the ranked assumptions, one line each.

The prompt may contain lines tagged `[Windex suggestion]`. List them numbered and say the user can drop any; if they do, delete exactly those lines (and the `## Suggestions` heading when empty). The critique never blocks: the user can always run the prompt as it is.

Then ask: **run it, change something, or cancel?** Wait for the reply. Never start the task before the user approves.
- **change**: apply their changes to the prompt, show it again, and ask again.
- **cancel**: stop. The run stays in history unsent.

## 4. Record and run

When the user approves, record the final text (with any changes) so Windex learns from it:

```sh
windex mark <id> <<'WINDEX_FINAL'
<final prompt, verbatim>
WINDEX_FINAL
```

Then carry out the final prompt in this session as the user's actual request, following it exactly as if they had typed it. Its "Done when" section is your definition of done.

When you finish, remind the user in one line that they can rate the result with `windex rate <1-5> [note]`.
