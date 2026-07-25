# Morph agent plugin

Wire your coding agent into your organization's shared [Morph](https://morphhq.co) brain.

The plugin does two things:

1. **Bundles the Morph MCP server** (`https://mcp.morphhq.co`) so the agent can read, search, and edit organization brain files, load skills, and use the directory and Catalogue tools.
2. **Installs lifecycle hooks** that fetch shared guidance from the brain at the matching moment of the agent's lifecycle and inject it as context. Each hook event maps to one markdown file in the brain:

| Event | Brain file | What it's for |
| --- | --- | --- |
| Session start | `brain/hooks/session-start.md` | Org-wide working agreements, current priorities |
| User prompt submit | `brain/hooks/user-prompt-submit.md` | Per-prompt reminders |
| Pre tool use | `brain/hooks/pre-tool-use.md` | Guardrails before tool calls |
| Post tool use | `brain/hooks/post-tool-use.md` | Follow-ups after tool calls |
| Subagent start | `brain/hooks/subagent-start.md` | Context for spawned subagents |
| Stop | `brain/hooks/stop.md` | Completion checklist (agent gets it once before finishing) |
| Subagent stop | `brain/hooks/subagent-stop.md` | Completion checklist for subagents |

Files that don't exist are silent no-ops, so an organization opts into exactly the events it wants by creating files. Edit the files in the Morph app or through the MCP `write`/`edit` tools, and every teammate's next session picks them up — no plugin release needed. See [docs/brain-hooks.md](docs/brain-hooks.md) for authoring guidance.

## How the hooks reach the brain

Hook scripts are dependency-free Node (>= 18). On each event, `hooks/morph-brain-hook.js`:

1. Lists `brain/hooks/` through the Morph MCP server (Streamable HTTP, OAuth 2.1 bearer) and caches the listing for 5 minutes, so frequent events like tool use stay local and cheap when no brain file exists for them.
2. Reads the event's file with the MCP `read` tool and emits it in the host's hook-output format (`hookSpecificOutput.additionalContext` for Claude Code / Codex / Gemini / Qoder, `additionalContext` for Copilot, `additional_context` for Cursor).
3. Never breaks the session: missing files, missing credentials, offline, and timeouts are all silent.

### Authentication

The Morph MCP server only accepts OAuth 2.1 tokens (there are no API keys). Two ways the hooks get guidance:

- **Direct (recommended):** run the bundled login helper once. It walks the same browser sign-in + organization-choice flow the agent host uses, then stores rotating tokens in `~/.morph/mcp-credentials.json` (0600) that the hooks refresh themselves:

  ```bash
  node scripts/morph-login.js            # add --url https://mcp.dev.morphhq.co for dev
  ```

- **Fallback (zero setup):** without stored credentials, the session-start hook injects an instruction asking the agent to read `brain/hooks/session-start.md` through its own already-authenticated Morph MCP connection. Other events stay silent.

## Install

### Claude Code

```
/plugin marketplace add morphhq-co/plugin
/plugin install morph@morph
```

The plugin registers the `morph` MCP server (OAuth happens in Claude Code on first use) and all hooks from `hooks/claude-codex-hooks.json`.

### Codex CLI

Clone this repo, then load the hooks from a trusted project or your user config, and add the MCP server:

```bash
codex mcp add morph --url https://mcp.morphhq.co
cp hooks/claude-codex-hooks.json ~/.codex/hooks.json   # or merge into an existing hooks.json
```

Codex accepts the same hook JSON shape as Claude Code. Set `MORPH_PLUGIN_DIR`-style absolute paths in the copied file (replace `${CLAUDE_PLUGIN_ROOT}` with your checkout path).

### Gemini CLI

This repo is a Gemini extension (`gemini-extension.json` + `hooks/hooks.json` with Gemini event names):

```bash
gemini extensions install https://github.com/morphhq-co/plugin
```

### GitHub Copilot CLI

`.github/plugin/plugin.json` wires `hooks/copilot-hooks.json` (session start + post tool use). Add the MCP server to `~/.copilot/mcp-config.json`:

```json
{ "mcpServers": { "morph": { "url": "https://mcp.morphhq.co" } } }
```

### Cursor

Copy the templates from [`platforms/cursor/`](platforms/cursor) into `.cursor/` (project or `~/.cursor/`), replacing `MORPH_PLUGIN_DIR` with the path to this checkout. Cursor hooks require the direct-credentials setup (`morph-login.js`), since its hook output cannot instruct the agent.

### Kiro

Copy [`platforms/kiro/morph-session-start.kiro.hook`](platforms/kiro) into `.kiro/hooks/` and merge `platforms/kiro/mcp.json` into `.kiro/settings/mcp.json`. Kiro hooks are agent-prompt actions, so the agent itself performs the MCP read — no login helper needed.

### Qoder

Merge [`hooks/qoder-hooks.json`](hooks/qoder-hooks.json) into your Qoder settings and register the MCP server in Qoder's MCP settings.

### OpenCode

OpenCode can use the Morph MCP server ([`platforms/opencode/opencode.json`](platforms/opencode)) but its plugin API has no general context-injection hook yet, so brain hook files are not auto-injected there.

### Windsurf

Not supported: Windsurf hooks cannot inject context into the session.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MORPH_MCP_URL` | `https://mcp.morphhq.co` | Morph MCP server (use `mcp.dev.morphhq.co` / `mcp.stg.morphhq.co` for other environments) |
| `MORPH_BRAIN_HOOKS_DIR` | `brain/hooks` | Brain directory holding the hook files |
| `MORPH_MCP_TOKEN` | — | Static bearer token override (skips the credentials file) |
| `MORPH_CREDENTIALS_FILE` | `~/.morph/mcp-credentials.json` | Token store written by `morph-login.js` |
| `MORPH_HOOKS_CACHE_TTL` | `300` | Seconds to cache the `brain/hooks/` listing |
| `MORPH_HOOKS_TIMEOUT_MS` | `5000` | Per-request network timeout |
| `MORPH_HOOKS_DISABLED` | — | Set to `1` to disable all hooks |

## Development

```bash
npm test   # node --test, hermetic (mock MCP server)
```

No runtime dependencies. Hook scripts live in `hooks/`, the OAuth login helper in `scripts/`.
