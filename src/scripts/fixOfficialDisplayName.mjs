/**
 * One-shot: set official account display_name to PODPLAYR in Firestore.
 * Run: node src/scripts/fixOfficialDisplayName.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
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

const FID = '1014485';
const DISPLAY = 'PODPLAYR';
const NAME_KEYS = ['display_name', 'searchedDisplayName', 'displayName'];

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);

function patchFromData(data) {
  if (!data) return null;
  const next = {};
  for (const key of NAME_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && value !== DISPLAY && /podplayr/i.test(value)) {
      next[key] = DISPLAY;
    }
  }
  return Object.keys(next).length ? next : null;
}

async function patchDoc(pathParts) {
  const ref = doc(db, ...pathParts);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.log(`skip missing ${pathParts.join('/')}`);
    return false;
  }
  const patch = patchFromData(snap.data());
  if (!patch) {
    const current = snap.data()?.display_name;
    if (current !== DISPLAY) {
      await updateDoc(ref, { display_name: DISPLAY });
      console.log(`set display_name on ${pathParts.join('/')} (was ${JSON.stringify(current)})`);
      return true;
    }
    console.log(`ok ${pathParts.join('/')} already ${DISPLAY}`);
    return false;
  }
  await updateDoc(ref, patch);
  console.log(`updated ${pathParts.join('/')}`, patch);
  return true;
}

async function commitPatches(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      batch.update(op.ref, op.patch);
    }
    await batch.commit();
  }
}

const changed = [];
changed.push(await patchDoc(['users', FID]));
changed.push(await patchDoc(['searchedusers', FID]));

const usersSnap = await getDocs(collection(db, 'users'));
const followOps = [];
for (const userDoc of usersSnap.docs) {
  const followRef = doc(db, 'users', userDoc.id, 'following', FID);
  const followSnap = await getDoc(followRef);
  if (!followSnap.exists()) continue;
  const data = followSnap.data();
  const patch = patchFromData(data) || (data.display_name !== DISPLAY ? { display_name: DISPLAY } : null);
  if (!patch) continue;
  followOps.push({ ref: followRef, patch });
}
if (followOps.length) {
  await commitPatches(followOps);
  console.log(`updated ${followOps.length} following/${FID} copies`);
} else {
  console.log(`no following/${FID} copies needed updates`);
}

const searchedSnap = await getDocs(collection(db, 'searchedusers'));
const searchedOps = [];
for (const userDoc of searchedSnap.docs) {
  const data = userDoc.data();
  const isOfficial =
    String(userDoc.id) === FID ||
    data.fid === 1014485 ||
    data.username === 'podplayr';
  if (!isOfficial) continue;
  const patch = patchFromData(data) || (data.display_name !== DISPLAY ? { display_name: DISPLAY } : null);
  if (!patch) continue;
  searchedOps.push({ ref: userDoc.ref, patch });
}
if (searchedOps.length) {
  await commitPatches(searchedOps);
  console.log(`updated ${searchedOps.length} searchedusers official docs`);
}

console.log('done');
process.exit(0);
