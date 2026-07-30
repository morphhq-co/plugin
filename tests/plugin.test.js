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
  assert.equal(manifest.version, '0.1.1');
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
  // hooks/hooks.json is auto-loaded by Claude Code; listing it in the
  // manifest again is rejected as a duplicate and the plugin fails to load.
  assert.equal(claude.hooks, undefined);
  assert.ok(fs.existsSync(path.join(ROOT, 'hooks', 'hooks.json')));
  assert.equal(sharedMcp.mcpServers.morph.url, MCP_URL);
  assert.equal(gemini.mcpServers.morph.httpUrl, MCP_URL);
});

test('plugin distribution versions stay aligned', () => {
  const version = readJson('package.json').version;

  assert.equal(version, '0.1.1');
  assert.equal(readJson('.codex-plugin/plugin.json').version, version);
  assert.equal(readJson('.claude-plugin/plugin.json').version, version);
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
  assert.match(canonical, /before substantive Brain discovery or writes, call `list_skills`/);
  assert.match(canonical, /call `load_skill` for the current organization-authored `brain-read-write` skill when available/);
  assert.match(canonical, /live Morph package is the source of truth/);
  assert.equal(fs.existsSync(path.join(ROOT, 'skills')), false);
});

test('lifecycle hooks inject guidance without adding a Stop model turn', () => {
  const hookMap = readJson('hooks/hooks.json').hooks;
  const script = path.join(ROOT, 'hooks', 'morph-context.js');
  const scriptSource = fs.readFileSync(script, 'utf8');
  const run = (event) => {
    const result = childProcess.spawnSync(process.execPath, [script, event], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  };

  assert.equal(hookMap.SessionStart[0].matcher, 'startup|resume|clear|compact|fork');
  assert.ok(hookMap.SubagentStart);
  assert.equal('Stop' in hookMap, false);
  assert.doesNotMatch(scriptSource, /\bfetch\s*\(|https?:\/\/|mcp__/);
  assert.doesNotMatch(scriptSource, /readFileSync\s*\(\s*0|decision:\s*['"]block/);

  const session = run('SessionStart');
  assert.match(session.hookSpecificOutput.additionalContext, /before substantive Brain discovery or writes, call `list_skills`/);
  assert.match(session.hookSpecificOutput.additionalContext, /call `load_skill` for the current organization-authored `brain-read-write` skill when available/);
  assert.match(session.hookSpecificOutput.additionalContext, /live Morph package is the source of truth/);

  const subagent = run('SubagentStart');
  assert.match(subagent.hookSpecificOutput.additionalContext, /return durable findings to the parent agent/);

  assert.equal(run('Stop'), undefined);
});

test('hooks fail open without Node on POSIX and never wait for stdin EOF', async () => {
  const hookMap = readJson('hooks/hooks.json').hooks;
  const script = path.join(ROOT, 'hooks', 'morph-context.js');

  if (process.platform !== 'win32') {
    for (const entries of Object.values(hookMap)) {
      for (const hook of entries.flatMap((entry) => entry.hooks)) {
        const result = childProcess.spawnSync('/bin/sh', ['-c', hook.command], {
          encoding: 'utf8',
          env: { CLAUDE_PLUGIN_ROOT: ROOT, PATH: '/node-is-not-installed' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, '');
        assert.match(hook.command, /command -v node/);
        assert.match(hook.commandWindows, /Get-Command node/);
      }
    }
  }

  const child = childProcess.spawn(process.execPath, [script, 'SessionStart'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('hook waited for stdin EOF'));
    }, 3000);
    child.on('exit', (code) => {
      clearTimeout(guard);
      assert.equal(code, 0);
      resolve();
    });
    child.on('error', reject);
  });
});
