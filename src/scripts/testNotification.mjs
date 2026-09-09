/**
 * Send a test Farcaster mini-app notification. Does not require going live.
 * Still limited to LIVE_NOTIFY_TEST_FIDS (7472) until that list is emptied.
 *
 *   yarn notify:test
 *   yarn notify:test -- --list
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Redis } from '@upstash/redis';

const TEST_FIDS = [7472];
const TITLE = 'PODPLAYR test ping';
const BODY = 'Notifications work. Tap to open.';
const USER_KEY_PREFIX = 'PODPLAYR:user:';
const FID_SET_KEY = 'PODPLAYR:notify:fids';

function loadEnvFile(name) {
  try {
    const text = readFileSync(resolve(process.cwd(), name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // file optional
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

function appUrl() {
  return (process.env.NEXT_PUBLIC_URL || 'https://podplayr.xyz').replace(/\/$/, '');
}

async function listStoredFids(redis) {
  const members = await redis.smembers(FID_SET_KEY);
  const fromSet = members
    .map((value) => Number(value))
    .filter((fid) => Number.isInteger(fid) && fid > 0);
  if (fromSet.length > 0) return fromSet;

  const scanned = new Set();
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { match: `${USER_KEY_PREFIX}*`, count: 100 });
    const next = Array.isArray(result) ? result[0] : result.cursor;
    const keys = Array.isArray(result) ? result[1] : result.keys;
    cursor = Number(next);
    for (const key of keys ?? []) {
      const fid = Number(String(key).slice(USER_KEY_PREFIX.length));
      if (Number.isInteger(fid) && fid > 0) scanned.add(fid);
    }
  } while (cursor !== 0);
  return [...scanned];
}

async function sendToFid(redis, fid) {
  const details = await redis.get(`${USER_KEY_PREFIX}${fid}`);
  if (!details?.token || !details?.url) {
    return { fid, state: 'no_token' };
  }

  const response = await fetch(details.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notificationId: `test-${fid}-${Date.now()}`.slice(0, 128),
      title: TITLE.slice(0, 32),
      body: BODY.slice(0, 128),
      targetUrl: `${appUrl()}/live`.slice(0, 1024),
      tokens: [details.token],
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (response.status !== 200) {
    return { fid, state: 'error', error: json };
  }
  if (json.result?.rateLimitedTokens?.length) {
    return { fid, state: 'rate_limit' };
  }
  if (json.result?.invalidTokens?.length) {
    return { fid, state: 'invalid_token' };
  }
  return { fid, state: 'success' };
}

async function main() {
  const listOnly = process.argv.includes('--list');
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error('Missing KV_REST_API_URL / KV_REST_API_TOKEN in .env.local');
    process.exit(1);
  }

  const redis = new Redis({ url, token });
  const storedFids = await listStoredFids(redis);
  const targetFids = TEST_FIDS.length > 0 ? TEST_FIDS : storedFids;

  console.log(`Stored notification tokens: ${storedFids.length ? storedFids.join(', ') : '(none)'}`);
  console.log(`Would notify: ${targetFids.join(', ')}`);

  if (listOnly) return;

  if (targetFids.length === 0) {
    console.error('No FIDs to notify.');
    process.exit(1);
  }

  const results = [];
  for (const fid of targetFids) {
    const result = await sendToFid(redis, fid);
    results.push(result);
    console.log(`fid ${fid}: ${result.state}${result.error ? ` ${JSON.stringify(result.error)}` : ''}`);
  }

  if (results.every((result) => result.state === 'no_token')) {
    console.error(
      '\nNo token stored for the test FID. Open PODPLAYR in Farcaster as that user with notifications enabled, then run this again.'
    );
    process.exit(1);
  }

  if (results.some((result) => result.state === 'success')) {
    console.log('\nCheck Farcaster for "PODPLAYR test ping". Tap should open the live player.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
