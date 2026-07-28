'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MCP_URL = 'https://mcp.dev.morphhq.co';

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
  assert.equal(manifest.hooks, './hooks/hooks.json');
  assert.deepEqual(manifest.interface.capabilities, ['MCP', 'Instructions', 'Lifecycle hooks']);
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

test('Claude and Gemini bundle the same development MCP endpoint', () => {
  const claude = readJson('.claude-plugin/plugin.json');
  const sharedMcp = readJson('.mcp.json');
  const gemini = readJson('gemini-extension.json');

  assert.equal(claude.mcpServers, './.mcp.json');
  assert.equal(claude.hooks, './hooks/hooks.json');
  assert.equal(sharedMcp.mcpServers.morph.url, MCP_URL);
  assert.equal(gemini.mcpServers.morph.httpUrl, MCP_URL);
});

test('manual host templates use the development MCP endpoint', () => {
  const cursor = readJson('platforms/cursor/mcp.json');
  const kiro = readJson('platforms/kiro/mcp.json');
  const openCode = readJson('platforms/opencode/opencode.json');

  assert.equal(cursor.mcpServers.morph.url, MCP_URL);
  assert.equal(kiro.mcpServers.morph.url, MCP_URL);
  assert.equal(openCode.mcp.morph.url, MCP_URL);
});

test('plugin carries Morph guidance without bundling organization skills', () => {
  const canonical = fs.readFileSync(path.join(ROOT, 'MORPH.md'), 'utf8').trim();
  assert.match(canonical, /load any relevant organization skill from Morph/);
  assert.equal(fs.existsSync(path.join(ROOT, 'skills')), false);
});

test('lifecycle hooks inject guidance and run the handoff check once', () => {
  const hookMap = readJson('hooks/hooks.json').hooks;
  const script = path.join(ROOT, 'hooks', 'morph-context.js');
  const scriptSource = fs.readFileSync(script, 'utf8');
  const run = (event, input = {}) => {
    const result = childProcess.spawnSync(process.execPath, [script, event], {
      input: JSON.stringify(input),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  assert.equal(hookMap.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.ok(hookMap.SubagentStart);
  assert.ok(hookMap.Stop);
  assert.doesNotMatch(scriptSource, /\bfetch\s*\(|https?:\/\/|mcp__/);

  const session = run('SessionStart');
  assert.match(session.hookSpecificOutput.additionalContext, /load any relevant organization skill from Morph/);

  const subagent = run('SubagentStart');
  assert.match(subagent.hookSpecificOutput.additionalContext, /return durable findings to the parent agent/);

  assert.equal(run('Stop').decision, 'block');
  assert.deepEqual(run('Stop', { stop_hook_active: true }), {});
});
