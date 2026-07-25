'use strict';
// Shared configuration for Morph brain hooks. Everything is env-overridable so
// one install can point at any Morph environment (dev/stg/prd) or a local
// server, and so tests can run hermetically.

const os = require('os');
const path = require('path');

const DEFAULT_MCP_URL = 'https://mcp.morphhq.co';
const DEFAULT_HOOKS_DIR = 'brain/hooks';

function getConfig(env = process.env) {
  const url = (env.MORPH_MCP_URL || DEFAULT_MCP_URL).replace(/\/+$/, '');
  const hooksDir = (env.MORPH_BRAIN_HOOKS_DIR || DEFAULT_HOOKS_DIR).replace(/^\/+|\/+$/g, '');
  return {
    url,
    hooksDir,
    staticToken: env.MORPH_MCP_TOKEN || null,
    disabled: env.MORPH_HOOKS_DISABLED === '1' || env.MORPH_HOOKS_DISABLED === 'true',
    credentialsFile:
      env.MORPH_CREDENTIALS_FILE || path.join(os.homedir(), '.morph', 'mcp-credentials.json'),
    cacheDir:
      env.MORPH_HOOKS_CACHE_DIR ||
      path.join(os.tmpdir(), `morph-plugin-${os.userInfo().username}`),
    cacheTtlMs: (parseInt(env.MORPH_HOOKS_CACHE_TTL, 10) || 300) * 1000,
    timeoutMs: parseInt(env.MORPH_HOOKS_TIMEOUT_MS, 10) || 5000,
  };
}

module.exports = { getConfig, DEFAULT_MCP_URL, DEFAULT_HOOKS_DIR };
