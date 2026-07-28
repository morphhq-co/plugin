# Morph agent plugin

Connect your coding agent to your organization's shared
[Morph](https://morphhq.co) brain.

The plugin bundles the Morph MCP server at `https://mcp.dev.morphhq.co`. On
Codex and Claude Code it also reminds the agent to use Morph throughout
substantive work. Your agent host owns OAuth and the MCP connection; the plugin
stores no credentials and runs no background code.

Morph provides organization-scoped brain files, skills, people and Teams, and
a governed software Catalogue. The MCP server tells the agent how to use these
capabilities when the connection starts.

## Install

### Claude Code

```text
/plugin marketplace add morphhq-co/plugin
/plugin install morph@morph
```

Claude Code prompts for Morph authorization when the connection is first used.
Review and trust the bundled lifecycle hooks when prompted.

### Codex

```bash
codex plugin marketplace add morphhq-co/plugin
codex plugin add morph@morph
```

Start a new task after installation. Codex prompts for Morph authorization when
the connection is first used. Review and trust the bundled lifecycle hooks when
prompted.

### Gemini CLI

```bash
gemini extensions install https://github.com/morphhq-co/plugin
```

### GitHub Copilot CLI

Add Morph to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "morph": {
      "url": "https://mcp.dev.morphhq.co"
    }
  }
}
```

### Cursor

Copy [`platforms/cursor/mcp.json`](platforms/cursor/mcp.json) into `.cursor/`
for the project or into `~/.cursor/`.

### Kiro

Merge [`platforms/kiro/mcp.json`](platforms/kiro/mcp.json) into
`.kiro/settings/mcp.json`. Optionally copy
[`platforms/kiro/morph-session-start.kiro.hook`](platforms/kiro/morph-session-start.kiro.hook)
into `.kiro/hooks/` to ask the agent to read shared session guidance through
its host-managed Morph connection.

### OpenCode

Merge [`platforms/opencode/opencode.json`](platforms/opencode/opencode.json)
into your OpenCode configuration.

## Agent guidance

The Codex and Claude Code hooks inject a small, organization-neutral reminder.
The reminder tells the agent to use the host-authenticated Morph MCP;
organization-specific workflows and skills stay in Morph.

Codex and Claude Code receive the reminder at session start, resume, fork,
context compaction, and subagent start. The guidance itself covers final
handoff without forcing another model turn on every response. At task start,
the agent reads `brain/hooks/session-start.md` when it exists, searches for
shared task context, and loads relevant organization skills from Morph.

The hooks never authenticate, store tokens, or call Morph directly. If Morph is
unavailable or no organization guidance exists, the agent continues silently.
Lifecycle reminders require Node.js; when Node is unavailable, the hooks skip
silently and the Morph MCP remains usable.

## Development

```bash
npm test
```

The test suite validates the plugin manifests, marketplace entry, and MCP
configuration without making network requests.
