'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'morph-brain-hook.js');
const { getConfig } = require('../hooks/morph-config');
const { parseSse, stripNotices } = require('../hooks/morph-mcp-client');
const { encodeContext, encodeStopBlock } = require('../hooks/morph-runtime');

// --- unit ---

test('config defaults and overrides', () => {
  const defaults = getConfig({});
  assert.equal(defaults.url, 'https://mcp.morphhq.co');
  assert.equal(defaults.hooksDir, 'brain/hooks');
  assert.equal(defaults.disabled, false);
  const custom = getConfig({
    MORPH_MCP_URL: 'https://mcp.dev.morphhq.co/',
    MORPH_BRAIN_HOOKS_DIR: '/team/hooks/',
    MORPH_HOOKS_DISABLED: '1',
  });
  assert.equal(custom.url, 'https://mcp.dev.morphhq.co');
  assert.equal(custom.hooksDir, 'team/hooks');
  assert.equal(custom.disabled, true);
});

test('stripNotices drops trailing bracket-only lines', () => {
  const text = 'body line\n- [x] keep this\n\n[Showing lines 1-2 of 2. revision sha256:abc]';
  assert.equal(stripNotices(text), 'body line\n- [x] keep this');
});

test('parseSse returns the last data payload', () => {
  const sse = 'event: message\ndata: {"a":1}\n\ndata: {"b":2}\n\n';
  assert.deepEqual(parseSse(sse), { b: 2 });
});

test('encodeContext per format', () => {
  const claude = JSON.parse(encodeContext('claude', 'SessionStart', 'ctx'));
  assert.equal(claude.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(claude.hookSpecificOutput.additionalContext, 'ctx');
  assert.deepEqual(JSON.parse(encodeContext('copilot', 'SessionStart', 'ctx')), {
    additionalContext: 'ctx',
  });
  assert.deepEqual(JSON.parse(encodeContext('cursor', 'SessionStart', 'ctx')), {
    additional_context: 'ctx',
  });
  assert.equal(encodeContext('claude', 'SessionStart', ''), '');
  assert.deepEqual(JSON.parse(encodeStopBlock('why')), { decision: 'block', reason: 'why' });
});

// --- integration against a mock Morph MCP server ---

function startMockServer(files) {
  const state = { listCalls: 0, readCalls: 0, authHeaders: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      state.authHeaders.push(req.headers.authorization);
      const message = JSON.parse(body);
      if (message.method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      let result;
      if (message.method === 'initialize') {
        result = {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'mock', version: '0' },
        };
      } else if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        let text;
        if (name === 'list') {
          state.listCalls += 1;
          text = Object.keys(files).join('\n');
        } else {
          state.readCalls += 1;
          const fileName = path.basename(args.path);
          text = `${files[fileName]}\n[Showing lines 1-1 of 1. revision sha256:abc]`;
        }
        result = { content: [{ type: 'text', text }], isError: false };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () => server.close(),
      });
    });
  });
}

function runHook(args, env, stdin = '{}') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

function freshEnv(serverUrl) {
  return {
    MORPH_MCP_URL: serverUrl,
    MORPH_MCP_TOKEN: 'test-token',
    MORPH_HOOKS_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'morph-hook-test-')),
    MORPH_HOOKS_TIMEOUT_MS: '3000',
  };
}

test('session-start injects brain content with footer stripped', async () => {
  const server = await startMockServer({ 'session-start.md': 'Hello from the brain.' });
  try {
    const env = freshEnv(server.url);
    const { code, stdout } = await runHook(['session-start'], env);
    assert.equal(code, 0);
    const output = JSON.parse(stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(output.hookSpecificOutput.additionalContext, /Hello from the brain\./);
    assert.match(output.hookSpecificOutput.additionalContext, /brain\/hooks\/session-start\.md/);
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /Showing lines/);
    assert.equal(server.state.authHeaders[0], 'Bearer test-token');
  } finally {
    server.close();
  }
});

test('events without a brain file are silent and cached', async () => {
  const server = await startMockServer({ 'session-start.md': 'x' });
  try {
    const env = freshEnv(server.url);
    const first = await runHook(['pre-tool-use'], env);
    const second = await runHook(['pre-tool-use'], env);
    assert.equal(first.stdout, '');
    assert.equal(second.stdout, '');
    assert.equal(server.state.listCalls, 1);
    assert.equal(server.state.readCalls, 0);
  } finally {
    server.close();
  }
});

test('cursor format emits snake_case additional_context', async () => {
  const server = await startMockServer({ 'session-start.md': 'cursor ctx' });
  try {
    const env = freshEnv(server.url);
    const { stdout } = await runHook(['session-start', '--format', 'cursor'], env);
    const output = JSON.parse(stdout);
    assert.match(output.additional_context, /cursor ctx/);
  } finally {
    server.close();
  }
});

test('--emit overrides the reported hook event name', async () => {
  const server = await startMockServer({ 'user-prompt-submit.md': 'per prompt' });
  try {
    const env = freshEnv(server.url);
    const { stdout } = await runHook(['user-prompt-submit', '--emit', 'BeforeAgent'], env);
    assert.equal(JSON.parse(stdout).hookSpecificOutput.hookEventName, 'BeforeAgent');
  } finally {
    server.close();
  }
});

test('stop blocks once with the brain checklist and respects stop_hook_active', async () => {
  const server = await startMockServer({ 'stop.md': 'Run the tests.' });
  try {
    const env = freshEnv(server.url);
    const blocked = await runHook(['stop'], env);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /Run the tests\./);
    const rerun = await runHook(['stop'], env, '{"stop_hook_active":true}');
    assert.equal(rerun.stdout, '');
  } finally {
    server.close();
  }
});

test('unreachable server and unknown events are silent no-ops', async () => {
  const env = {
    MORPH_MCP_URL: 'http://127.0.0.1:9',
    MORPH_MCP_TOKEN: 'test-token',
    MORPH_HOOKS_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'morph-hook-test-')),
    MORPH_HOOKS_TIMEOUT_MS: '500',
  };
  const offline = await runHook(['session-start'], env);
  assert.equal(offline.code, 0);
  assert.equal(offline.stdout, '');
  const unknown = await runHook(['not-an-event'], env);
  assert.equal(unknown.code, 0);
  assert.equal(unknown.stdout, '');
});

test('missing credentials fall back to instructing the agent on session-start', async () => {
  const env = {
    MORPH_MCP_URL: 'http://127.0.0.1:9',
    MORPH_HOOKS_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'morph-hook-test-')),
    MORPH_CREDENTIALS_FILE: path.join(os.tmpdir(), 'morph-hook-test-none', 'absent.json'),
    MORPH_HOOKS_TIMEOUT_MS: '500',
  };
  const { stdout } = await runHook(['session-start'], env);
  const output = JSON.parse(stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /read tool/);
  assert.match(output.hookSpecificOutput.additionalContext, /session-start\.md/);
  const quiet = await runHook(['pre-tool-use'], env);
  assert.equal(quiet.stdout, '');
});
