# Morph agent plugin

Connect your coding agent to your organization's shared
[Morph](https://morphhq.co) brain.

The plugin bundles the Morph MCP server at `https://mcp.dev.morphhq.co`. Your agent
host owns OAuth and the MCP connection; the plugin stores no credentials and
runs no background code.

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

### Codex

```bash
codex plugin marketplace add morphhq-co/plugin
codex plugin add morph@morph
```

Start a new task after installation. Codex prompts for Morph authorization when
the connection is first used.

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

## Shared session guidance

Until portable host-authenticated lifecycle hooks are available, ask the agent
to load organization guidance through its Morph connection:

> Use the Morph `read` tool for `brain/hooks/session-start.md` and follow the
> guidance if the file exists. Otherwise continue silently.

This keeps OAuth inside the agent host. Automatic organization guidance at
precise lifecycle events is being designed separately.

## Development

```bash
npm test
```

The test suite validates the plugin manifests, marketplace entry, and MCP
configuration without making network requests.
