'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MCP_URL = 'https://mcp.morphhq.co';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

test('Codex plugin bundles Morph through host-managed MCP', () => {
  const manifest = readJson('.codex-plugin/plugin.json');

  assert.equal(manifest.name, 'morph');
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(manifest.mcpServers, {
    morph: { type: 'http', url: MCP_URL },
  });
  assert.equal('hooks' in manifest, false);
  assert.deepEqual(manifest.interface.capabilities, ['MCP']);
  assert.ok(manifest.interface.defaultPrompt.length > 0);
});

test('Codex marketplace installs the plugin from the repository root', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');
  const plugin = marketplace.plugins.find((entry) => entry.name === 'morph');

  assert.ok(plugin);
  assert.equal(plugin.source.source, 'local');
  assert.equal(plugin.source.path, './');
  assert.equal(plugin.policy.installation, 'AVAILABLE');
  assert.equal(plugin.policy.authentication, 'ON_INSTALL');
  assert.ok(fs.existsSync(path.join(ROOT, plugin.source.path, '.codex-plugin', 'plugin.json')));
});

test('Claude and Gemini bundle the same production MCP endpoint', () => {
  const claude = readJson('.claude-plugin/plugin.json');
  const sharedMcp = readJson('.mcp.json');
  const gemini = readJson('gemini-extension.json');

  assert.equal(claude.mcpServers, './.mcp.json');
  assert.equal('hooks' in claude, false);
  assert.equal(sharedMcp.mcpServers.morph.url, MCP_URL);
  assert.equal(gemini.mcpServers.morph.httpUrl, MCP_URL);
});

test('manual host templates use the production MCP endpoint', () => {
  const cursor = readJson('platforms/cursor/mcp.json');
  const kiro = readJson('platforms/kiro/mcp.json');
  const openCode = readJson('platforms/opencode/opencode.json');

  assert.equal(cursor.mcpServers.morph.url, MCP_URL);
  assert.equal(kiro.mcpServers.morph.url, MCP_URL);
  assert.equal(openCode.mcp.morph.url, MCP_URL);
});
