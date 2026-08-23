/**
 * Merge likes/plays onto the media-file mediaKey (same file → one count).
 * Run: node src/scripts/consolidatePlayCounts.mjs
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
    data.nftContract || data.contract || nested.contract,
    data.tokenId ?? nested.tokenId
  );
  if (fromFields) return fromFields;
  const match = String(d.id).match(/^(0x[a-fA-F0-9]{40})-(.+)$/);
  if (match) return mintKey(match[1], match[2]);
  return '';
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

async function mergeCollection(name, countField) {
  const snap = await getDocs(collection(db, name));
  console.log(`${name}: ${snap.size} docs`);
  const { find, union } = createUnion();
  const rows = [];

  for (const d of snap.docs) {
    const data = d.data();
    const asset = assetFromData(data);
    const mint = mintKeyFromDoc(d);
    const content = asset ? contentKey(asset) : '';
    const docLabel = `doc:${d.id}`;
    union(docLabel, content ? `c:${content}` : '');
    union(docLabel, mint ? `m:${mint}` : '');
    union(docLabel, asset ? `a:${asset}` : '');
    rows.push({
      id: d.id,
      data,
      count: Number(data[countField]) || 0,
      asset,
      mint,
      content,
      name: data.name,
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
    group.sort((a, b) => b.count - a.count);
    const keep = group[0];
    const canonical =
      group.find((row) => row.content)?.content || keep.content || keep.mint || '';
    if (!canonical) continue;
    const already = group.length === 1 && group[0].id === canonical;
    if (already) continue;

    const total = group.reduce((sum, row) => sum + row.count, 0);
    const contract = normalizeContract(keep.data.nftContract || keep.data.contract);
    const tokenId = normalizeToken(keep.data.tokenId);
    const payload = {
      ...stripSentinels(keep.data),
      mediaKey: canonical,
      nftContract: contract || keep.data.nftContract,
      contract: contract || keep.data.contract,
      tokenId: tokenId || keep.data.tokenId,
    };
    payload[countField] = total;

    batch.set(doc(db, name, canonical), payload);
    ops += 1;
    merged += 1;
    if (ops >= 400) await flush();

    for (const extra of group) {
      if (extra.id === canonical) continue;
      batch.delete(doc(db, name, extra.id));
      ops += 1;
      deleted += 1;
      if (group.length > 1 && extra.count > 0) {
        console.log(`  ${keep.name}: +${extra.count} from ${extra.id.slice(0, 18)} → ${total}`);
      }
      if (ops >= 400) await flush();
    }
  }
  await flush();
  console.log(`${name} done. merged ${merged} identities, deleted ${deleted} leftover docs`);
}

await mergeCollection('global_plays', 'playCount');
await mergeCollection('top_played', 'playCount');
await mergeCollection('global_likes', 'likeCount');
process.exit(0);
