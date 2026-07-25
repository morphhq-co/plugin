'use strict';
// Minimal Streamable HTTP MCP client plus OAuth token store for Morph hooks.
// No dependencies; needs Node 18+ (global fetch). The Morph MCP server serves
// the transport at the origin root and authenticates with OAuth 2.1 bearer
// tokens minted by its own authorization server; scripts/morph-login.js
// obtains the initial grant. Refresh tokens rotate on every use, so every
// refresh must be written back atomically under a lock.

const fs = require('fs');
const path = require('path');

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'morph-plugin-hooks', version: '0.1.0' };

class AuthError extends Error {}

function parseSse(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data) last = data;
    }
  }
  return last ? JSON.parse(last) : null;
}

async function post(url, token, message, timeoutMs, sessionId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(`${url}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`MCP auth failed (${res.status})`);
  }
  const nextSessionId = res.headers.get('mcp-session-id') || sessionId;
  if (res.status === 202) return { response: null, sessionId: nextSessionId };
  const body = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${body.slice(0, 200)}`);
  const contentType = res.headers.get('content-type') || '';
  const response = contentType.includes('text/event-stream') ? parseSse(body) : JSON.parse(body);
  return { response, sessionId: nextSessionId };
}

async function callTool(config, token, name, args) {
  const init = await post(
    config.url,
    token,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    },
    config.timeoutMs,
    null
  );
  if (init.response && init.response.error) {
    throw new Error(`initialize: ${init.response.error.message}`);
  }
  const sessionId = init.sessionId;
  try {
    await post(
      config.url,
      token,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      config.timeoutMs,
      sessionId
    );
  } catch (e) {
    // Stateless deployments may reject the bare notification; tools/call decides.
  }
  const call = await post(
    config.url,
    token,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    config.timeoutMs,
    sessionId
  );
  if (!call.response) throw new Error('empty MCP response');
  if (call.response.error) throw new Error(`${name}: ${call.response.error.message}`);
  const result = call.response.result || {};
  const text = (result.content || [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (result.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
  return text;
}

// The brain read tool appends bracketed notices such as
// "[Showing lines 1-42 of 42 ...]" after the file body; drop trailing
// bracket-only lines so they never leak into injected context.
function stripNotices(text) {
  const lines = text.split('\n');
  while (
    lines.length &&
    (lines[lines.length - 1].trim() === '' || /^\[[^\]]*\]$/.test(lines[lines.length - 1].trim()))
  ) {
    lines.pop();
  }
  return lines.join('\n');
}

function readCredentials(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeCredentials(file, creds) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function withLock(file, fn) {
  const lockDir = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      break;
    } catch (e) {
      if (e.code === 'ENOENT') {
        fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
        continue;
      }
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 30_000) {
          fs.rmdirSync(lockDir); // stale lock from a crashed hook
          continue;
        }
      } catch (e2) {
        continue; // lock vanished between checks
      }
      if (Date.now() > deadline) throw new Error('credentials lock timeout');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch (e) {
      // already released
    }
  }
}

async function refreshTokens(config, creds) {
  const res = await fetch(`${creds.url || config.url}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: creds.client_id,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new AuthError(`token refresh failed (${res.status})`);
  const tok = await res.json();
  return {
    ...creds,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || creds.refresh_token,
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
  };
}

function isFresh(creds) {
  return Boolean(creds && creds.access_token && (creds.expires_at || 0) - 60_000 > Date.now());
}

async function getAccessToken(config, { forceRefresh = false } = {}) {
  if (config.staticToken) return config.staticToken;
  const creds = readCredentials(config.credentialsFile);
  if (!creds || !creds.refresh_token) return null;
  if (!forceRefresh && isFresh(creds)) return creds.access_token;
  return withLock(config.credentialsFile, async () => {
    // Another hook may have refreshed while this one waited for the lock.
    const current = readCredentials(config.credentialsFile) || creds;
    if (!forceRefresh && isFresh(current)) return current.access_token;
    const next = await refreshTokens(config, current);
    writeCredentials(config.credentialsFile, next);
    return next.access_token;
  });
}

async function callBrainTool(config, name, args) {
  let token = await getAccessToken(config);
  if (!token) throw new AuthError('no Morph MCP credentials');
  try {
    return await callTool(config, token, name, args);
  } catch (e) {
    if (!(e instanceof AuthError) || config.staticToken) throw e;
    token = await getAccessToken(config, { forceRefresh: true });
    if (!token) throw e;
    return await callTool(config, token, name, args);
  }
}

module.exports = {
  AuthError,
  callBrainTool,
  callTool,
  getAccessToken,
  parseSse,
  readCredentials,
  stripNotices,
  writeCredentials,
};
