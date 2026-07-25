#!/usr/bin/env node
'use strict';
// morph-login — one-time OAuth login for Morph brain hooks.
//
// The Morph MCP server only accepts OAuth 2.1 bearer tokens. This script
// registers a public client (RFC 7591), runs the PKCE authorization-code flow
// with a local loopback redirect (sign-in and organization choice happen in
// the browser), and stores the tokens where the hook scripts can use and
// rotate them (~/.morph/mcp-credentials.json by default).
//
// Usage: node scripts/morph-login.js [--url https://mcp.morphhq.co]

const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { getConfig } = require('../hooks/morph-config');
const { writeCredentials } = require('../hooks/morph-mcp-client');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function openBrowser(url) {
  const commands = { darwin: ['open', [url]], win32: ['cmd', ['/c', 'start', '', url]] };
  const [cmd, args] = commands[process.platform] || ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    // Printing the URL is enough; opening the browser is a convenience.
  }
}

function waitForCallback(server, expectedState) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('login timed out')), LOGIN_TIMEOUT_MS);
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><p>Morph login complete. You can close this tab.</p></body></html>');
      const error = url.searchParams.get('error');
      if (error) {
        clearTimeout(timer);
        reject(new Error(`authorization failed: ${error}`));
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        clearTimeout(timer);
        reject(new Error('state mismatch in OAuth callback'));
        return;
      }
      clearTimeout(timer);
      resolve(url.searchParams.get('code'));
    });
  });
}

async function main() {
  const config = getConfig();
  const urlFlag = process.argv.indexOf('--url');
  const base = (urlFlag > -1 ? process.argv[urlFlag + 1] : config.url).replace(/\/+$/, '');

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const registration = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Morph plugin hooks',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!registration.ok) {
    throw new Error(`client registration failed (${registration.status}): ${await registration.text()}`);
  }
  const client = await registration.json();

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const authorizeUrl = `${base}/authorize?${new URLSearchParams({
    client_id: client.client_id,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })}`;

  process.stdout.write(
    `\nOpen this URL to sign in to Morph and pick an organization:\n\n  ${authorizeUrl}\n\nWaiting for the browser callback...\n`
  );
  openBrowser(authorizeUrl);

  const code = await waitForCallback(server, state);
  server.close();

  const tokenRes = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const tokens = await tokenRes.json();

  writeCredentials(config.credentialsFile, {
    url: base,
    client_id: client.client_id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
  });
  process.stdout.write(
    `\nSaved credentials to ${config.credentialsFile}.\nMorph brain hooks will now fetch shared guidance directly.\n`
  );
}

main().catch((e) => {
  process.stderr.write(`morph-login: ${e.message}\n`);
  process.exit(1);
});
