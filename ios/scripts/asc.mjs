#!/usr/bin/env node
// The App Store Connect API from this Mac, with the team API key (ios/AppStore.md).
//
//   node ios/scripts/asc.mjs                                   # GET /v1/apps — is the key alive?
//   node ios/scripts/asc.mjs GET '/v1/bundleIds?filter[identifier]=info.meridi.app'
//   node ios/scripts/asc.mjs POST /v1/bundleIds @body.json --write
//
// Anything but GET needs --write: reading is free, changing App Store Connect is a decision.
// ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH come from the environment or from
// ~/.appstoreconnect/meridian.env (outside the repo, KEY=VALUE lines). The key never leaves this
// Mac: every call signs its own 20-minute ES256 token locally.

import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENV_FILE = path.join(os.homedir(), '.appstoreconnect', 'meridian.env');

/** The key's settings: the environment wins over the file. */
export function credentials() {
  const file = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      file[match[1]] = match[2].replace(/^["']|["']$/g, '').replace(/^~(?=\/)/, os.homedir()).replaceAll('$HOME', os.homedir());
    }
  }
  const value = (name) => process.env[name] || file[name];
  const keyId = value('ASC_KEY_ID');
  const issuerId = value('ASC_ISSUER_ID');
  const keyPath = value('ASC_KEY_PATH');
  if (!keyId || !issuerId || !keyPath) {
    throw new Error(`ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH are needed (environment or ${ENV_FILE})`);
  }
  if (!existsSync(keyPath)) throw new Error(`no key at ${keyPath}`);
  return { keyId, issuerId, keyPath };
}

const base64url = (data) => Buffer.from(data).toString('base64url');

/** A short-lived token for the App Store Connect API (ES256, audience appstoreconnect-v1). */
export function token({ keyId, issuerId, keyPath }) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))}.${base64url(
    JSON.stringify({ iss: issuerId, iat: now, exp: now + 20 * 60, aud: 'appstoreconnect-v1' }),
  )}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: createPrivateKey(readFileSync(keyPath)),
    dsaEncoding: 'ieee-p1363', // JOSE wants r‖s, not DER
  });
  return `${input}.${base64url(signature)}`;
}

/** One API call; returns { status, body }. */
export async function call(method, route, body) {
  const response = await fetch('https://api.appstoreconnect.apple.com' + route, {
    method,
    headers: { Authorization: `Bearer ${token(credentials())}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON — keep the text
  }
  return { status: response.status, body: parsed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const [method = 'GET', route = '/v1/apps', payload] = args.filter((a) => a !== '--write');
  if (method.toUpperCase() !== 'GET' && !write) {
    console.error(`${method} changes App Store Connect — add --write when that is intended`);
    process.exit(2);
  }
  try {
    const body = payload?.startsWith('@') ? readFileSync(payload.slice(1), 'utf8') : payload;
    const { status, body: result } = await call(method.toUpperCase(), route, body);
    console.log(status);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    process.exitCode = status >= 200 && status < 300 ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
