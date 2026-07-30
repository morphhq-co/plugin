# Morph shared context

Morph is the organization's shared brain. Use its host-managed MCP connection to keep work grounded in current company context.

For every substantive task:

1. **Start or resume:** before substantive Brain discovery or writes, call `list_skills`, then call `load_skill` for the current organization-authored `brain-read-write` skill when available; the live Morph package is the source of truth. Then identify the user and organization, read `brain/hooks/session-start.md` when it exists, and search Morph for existing task and repository context.
2. **Work:** consult Morph before making assumptions that shared knowledge may answer. Record durable decisions, discoveries, blockers, and milestones according to the loaded organization guidance.
3. **Checkpoint and handoff:** update the existing shared task context before a handoff or final response so another engineer or agent can resume.

Read existing state before writing and use revision controls when provided. Do not invent organization paths or schemas, create duplicate task records, store secrets, or log routine commands. If Morph is unavailable or no relevant guidance exists, continue silently.
