#!/usr/bin/env node
'use strict';
// morph — lifecycle hook entry point.
//
// Usage: node morph-brain-hook.js <event> [--format claude|cursor|copilot] [--emit <HookEventName>]
//
//   <event>    kebab-case brain hook name; selects the brain file
//              (<hooks dir>/<event>.md, e.g. brain/hooks/session-start.md).
//   --format   output encoding when the host cannot be env-detected.
//   --emit     hookEventName to report in the output JSON, for hosts whose
//              event names differ (e.g. Gemini's BeforeAgent).
//
// The hook reads the matching markdown file from the organization's shared
// Morph brain through the Morph MCP server and injects it as context. A
// directory listing is cached briefly so per-tool-call hooks stay local and
// cheap when no brain file exists for their event. Missing files, missing
// credentials, and network failures are silent: a hook must never break the
// host session. When credentials are missing entirely, the session-start hook
// instead asks the agent to read the brain file through its own (already
// authenticated) Morph MCP connection.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./morph-config');
const { AuthError, callBrainTool, stripNotices } = require('./morph-mcp-client');
const { detectFormat, encodeContext, encodeStopBlock, writeStdout } = require('./morph-runtime');

const EVENTS = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'subagent-start': 'SubagentStart',
  stop: 'Stop',
  'subagent-stop': 'SubagentStop',
};

function parseArgs(argv) {
  const args = { event: (argv[2] || '').toLowerCase(), format: null, emit: null };
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === '--format') args.format = argv[i + 1];
    if (argv[i] === '--emit') args.emit = argv[i + 1];
  }
  return args;
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    return {};
  }
}

function manifestFile(config) {
  const key = crypto
    .createHash('sha256')
    .update(`${config.url}\n${config.hooksDir}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(config.cacheDir, `manifest-${key}.json`);
}

function readManifest(config) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile(config), 'utf8'));
    if (Date.now() - manifest.ts < config.cacheTtlMs) return manifest;
  } catch (e) {
    // absent or unreadable — refetch
  }
  return null;
}

function writeManifest(config, manifest) {
  try {
    fs.mkdirSync(config.cacheDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(manifestFile(config), JSON.stringify({ ts: Date.now(), ...manifest }));
  } catch (e) {
    // cache is best-effort
  }
}

async function loadManifest(config) {
  const cached = readManifest(config);
  if (cached) return cached;
  try {
    const listing = await callBrainTool(config, 'list', { path: config.hooksDir });
    const files = listing
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name && !name.endsWith('/') && !name.startsWith('('));
    const manifest = { files, noCredentials: false };
    writeManifest(config, manifest);
    return manifest;
  } catch (e) {
    // Unknown state: offline, hooks dir absent, or no credentials. Cache the
    // failure so frequent hooks stay quiet and cheap until the TTL passes.
    const manifest = { files: null, noCredentials: e instanceof AuthError };
    writeManifest(config, manifest);
    return manifest;
  }
}

function fallbackContext(config) {
  const loginScript = path.join(__dirname, '..', 'scripts', 'morph-login.js');
  return (
    'Morph brain hooks are installed but have no stored Morph MCP credentials, ' +
    'so shared guidance could not be fetched directly. If a Morph MCP server is ' +
    `connected in this session, call its read tool with path "${config.hooksDir}/session-start.md" ` +
    'now and follow that guidance; if the file does not exist, continue silently. ' +
    'To let these hooks fetch guidance themselves, the user can run: ' +
    `node "${loginScript}"`
  );
}

async function main() {
  const { event, format: formatArg, emit } = parseArgs(process.argv);
  const eventName = emit || EVENTS[event];
  if (!eventName) return;
  const config = getConfig();
  if (config.disabled) return;
  const format = formatArg || detectFormat();
  const payload = readPayload();
  const isStop = event === 'stop' || event === 'subagent-stop';
  if (isStop && payload.stop_hook_active) return;

  const manifest = await loadManifest(config);
  const fileName = `${event}.md`;

  if (!manifest.files) {
    if (event === 'session-start' && manifest.noCredentials) {
      writeStdout(encodeContext(format, eventName, fallbackContext(config)));
    }
    return;
  }
  if (!manifest.files.includes(fileName)) return;

  const source = `${config.hooksDir}/${fileName}`;
  let content;
  try {
    content = stripNotices(await callBrainTool(config, 'read', { path: source })).trim();
  } catch (e) {
    if (event === 'session-start' && e instanceof AuthError) {
      writeStdout(encodeContext(format, eventName, fallbackContext(config)));
    }
    return;
  }
  if (!content) return;

  if (isStop) {
    writeStdout(
      encodeStopBlock(
        `Morph shared brain checklist (${source}) — verify before finishing; ` +
          `if every point is already satisfied, finish normally:\n\n${content}`
      )
    );
    return;
  }
  writeStdout(encodeContext(format, eventName, `Morph shared brain (${source}):\n\n${content}`));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
