# Brain hook files

The plugin turns a directory of markdown files in the organization's Morph brain — `brain/hooks/` by default — into live lifecycle context for every teammate's agent. This page is for the people who write those files.

## The contract

- One file per lifecycle event, named after the event in kebab-case (`session-start.md`, `pre-tool-use.md`, ...).
- A file that exists is injected verbatim at that moment of the agent lifecycle, prefixed with its brain path so the agent knows the provenance.
- A file that doesn't exist is a silent no-op. Create only the files you want firing.
- Changes take effect on teammates' machines within the hook cache TTL (5 minutes by default) — no plugin release, no reinstall.

| File | Fires | Injection channel |
| --- | --- | --- |
| `session-start.md` | once per session (start, resume, clear, compact) | additional context |
| `user-prompt-submit.md` | every user prompt | additional context |
| `pre-tool-use.md` | before every tool call | additional context |
| `post-tool-use.md` | after every tool call | additional context |
| `subagent-start.md` | when a subagent spawns | additional context |
| `stop.md` | when the agent is about to finish a turn | blocks once with the file as the reason; the agent addresses it, then finishes |
| `subagent-stop.md` | when a subagent is about to finish | same as `stop.md` |

## Authoring guidance

- **Keep files short and imperative.** They are injected into every matching moment for everyone in the organization; every line costs context window across the whole org.
- **`session-start.md`** is the workhorse: working agreements, current priorities, links to deeper brain paths the agent should read on demand (`runbooks/...`, `decisions/...`).
- **`user-prompt-submit.md`, `pre-tool-use.md`, `post-tool-use.md`** fire very often. Prefer not to create them unless you have a genuinely per-prompt or per-tool rule; when you do, keep them to a few lines.
- **`stop.md`** is a completion checklist ("tests ran? diff minimal? conventional commit?"). The agent receives it exactly once per turn (loop-guarded), so phrase it as verifiable checks, and end with "if every point is satisfied, finish normally."
- Write plain instructions, not prose about the org. The reader is an agent mid-task.

## Editing

Edit the files like any other brain files: in the Morph app, or through the Morph MCP server (`read`, `write`, `edit` tools) from any connected agent. The directory's permissions are governed by the brain's normal `.morph/` policies — restrict write access to the people who should steer every agent in the org.
