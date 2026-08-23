/**
 * Merge a user's like docs onto the media-file mediaKey (same file → one like).
 * Run: node src/scripts/consolidateLikes.mjs [fid]
 * Default fid: 7472
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  writeBatch,
} from 'firebase/firestore';

function loadEnvLocal() {
  const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

function normalizeContract(c) {
  return (c || '').trim().toLowerCase();
}
function normalizeToken(t) {
  if (t == null || t === '') return '';
  const raw = String(t).trim();
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    try { return BigInt(raw).toString(10); } catch { return raw.toLowerCase(); }
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    try { return BigInt(`0x${raw}`).toString(10); } catch { return raw.toLowerCase(); }
  }
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, '');
  return raw;
}
function mintKey(contract, tokenId) {
  const c = normalizeContract(contract);
  const t = normalizeToken(tokenId);
  if (!c || !t) return '';
  return createHash('sha256').update(`${c}-${t}`).digest('hex').substring(0, 32);
}
function contentKey(asset) {
  return createHash('sha256').update(`media:${asset}`).digest('hex').substring(0, 32);
}

function mediaAssetId(url) {
  if (!url || typeof url !== 'string') return '';
  const s = url.trim().split('?')[0].split('#')[0];
  if (!s || /^(data:|blob:)/i.test(s)) return '';
  const ipfs =
    s.match(/(?:\/ipfs\/|ipfs:\/\/)(bafy[a-z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44,})/i) ||
    s.match(/\b(bafy[a-z0-9]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44,})\b/);
  if (ipfs?.[1]) return `ipfs:${ipfs[1].toLowerCase()}`;
  const ar =
    s.match(/arweave\.net\/([A-Za-z0-9_-]{43,})/i) ||
    s.match(/ar:\/\/([A-Za-z0-9_-]{43,})/);
  if (ar?.[1]) return `ar:${ar[1]}`;
  if (/^https?:\/\//i.test(s) || s.startsWith('ipfs://') || s.startsWith('ar://')) {
    return `url:${s.replace(/^https?:\/\//i, '').toLowerCase()}`;
  }
  return '';
}

function assetFromData(data) {
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const nestedMeta = nested.metadata && typeof nested.metadata === 'object' ? nested.metadata : {};
  const urls = [
    data.audioUrl,
    data.audio,
    data.animationUrl,
    data.videoUrl,
    meta.animation_url,
    nested.audio,
    nested.videoUrl,
    nested.animationUrl,
    nestedMeta.animation_url,
  ];
  let generic = '';
  for (const url of urls) {
    const id = mediaAssetId(url);
    if (!id) continue;
    if (id.startsWith('ipfs:') || id.startsWith('ar:')) return id;
    if (!generic) generic = id;
  }
  return generic;
}

function mintKeyFromDoc(d) {
  const data = d.data();
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  const fromFields = mintKey(
    data.contract || data.nftContract || nested.contract,
    data.tokenId ?? nested.tokenId
  );
  if (fromFields) return fromFields;
  const match = String(d.id).match(/^(0x[a-fA-F0-9]{40})-(.+)$/);
  if (match) return mintKey(match[1], match[2]);
  return '';
}

function likeTime(data) {
  const likedAt = Date.parse(String(data.likedAt || data.timestampISO || '')) || 0;
  const timestamp = typeof data.timestamp === 'number' ? data.timestamp : 0;
  const millis = typeof data.timestamp?.toMillis === 'function' ? data.timestamp.toMillis() : 0;
  const likedTimestamp = typeof data.likedTimestamp === 'number' ? data.likedTimestamp : 0;
  return Math.max(likedAt, timestamp, millis, likedTimestamp);
}

function stripSentinels(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && '_methodName' in value) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function createUnion() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x);
    if (p !== x) parent.set(x, find(p));
    return parent.get(x);
  };
  const union = (a, b) => {
    if (!a || !b) return;
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  return { find, union };
}

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const fid = String(process.argv[2] || '7472');
const snap = await getDocs(collection(db, 'users', fid, 'likes'));
console.log(`fid ${fid}: ${snap.size} like docs`);

const { find, union } = createUnion();
const rows = [];

for (const d of snap.docs) {
  const data = d.data();
  const asset = assetFromData(data);
  const mint = mintKeyFromDoc(d);
  const content = asset ? contentKey(asset) : '';
  const docLabel = `doc:${d.id}`;
  if (content) union(docLabel, `c:${content}`);
  if (mint) union(docLabel, `m:${mint}`);
  if (asset) union(docLabel, `a:${asset}`);
  rows.push({
    id: d.id,
    data,
    name: data.name || data.nft?.name,
    time: likeTime(data),
    asset,
    mint,
    content,
  });
}

const groups = new Map();
for (const row of rows) {
  const key = find(`doc:${row.id}`);
  const group = groups.get(key) || [];
  group.push(row);
  groups.set(key, group);
}

let batch = writeBatch(db);
let ops = 0;
let merged = 0;
let deleted = 0;
const flush = async () => {
  if (ops === 0) return;
  await batch.commit();
  batch = writeBatch(db);
  ops = 0;
};

for (const group of groups.values()) {
  group.sort((a, b) => b.time - a.time);
  const keep = group[0];
  const canonical =
    group.find((row) => row.content)?.content || keep.content || keep.mint || '';
  if (!canonical) continue;
  const already = group.length === 1 && keep.id === canonical && keep.data.mediaKey === canonical;
  if (already) continue;

  const nested = keep.data.nft && typeof keep.data.nft === 'object' ? { ...keep.data.nft } : null;
  const contract = normalizeContract(keep.data.contract || keep.data.nftContract || nested?.contract);
  const tokenId = normalizeToken(keep.data.tokenId ?? nested?.tokenId);
  if (nested) {
    nested.contract = contract || nested.contract;
    nested.tokenId = tokenId || nested.tokenId;
  }
  const originalMs = group.reduce((earliest, row) => {
    if (!row.time) return earliest;
    if (!earliest) return row.time;
    return Math.min(earliest, row.time);
  }, 0);

  batch.set(doc(db, 'users', fid, 'likes', canonical), {
    ...stripSentinels(keep.data),
    mediaKey: canonical,
    contract: contract || keep.data.contract,
    nftContract: contract || keep.data.nftContract,
    tokenId: tokenId || keep.data.tokenId,
    ...(nested ? { nft: nested } : {}),
    ...(originalMs
      ? {
          likedTimestamp: originalMs,
          likedAt: keep.data.likedAt || new Date(originalMs).toISOString(),
        }
      : {}),
  });
  ops += 1;
  merged += 1;
  if (ops >= 400) await flush();

  for (const extra of group) {
    if (extra.id === canonical) continue;
    batch.delete(doc(db, 'users', fid, 'likes', extra.id));
    ops += 1;
    deleted += 1;
    console.log(`  ${keep.name}: ${extra.id.slice(0, 18)} → ${canonical.slice(0, 18)}`);
    if (ops >= 400) await flush();
  }
}

await flush();
console.log(`done. merged ${merged} identities, deleted ${deleted} leftover docs`);
process.exit(0);
