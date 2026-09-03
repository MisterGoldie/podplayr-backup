import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/** Same "Music Mondays" bug pattern: tokenId contains a doubled 0x prefix,
 *  OR the hex tokenId (single-prefixed) matches the first 4 bytes of the
 *  contract address — a sign the contract address leaked into the tokenId. */
function isMalformed(contract: string | undefined, tokenId: string | undefined): string | null {
  if (!tokenId) return null;
  const t = String(tokenId);

  if (/0x0x/i.test(t)) return 'double-0x-prefix';

  if (contract && /^0x[0-9a-fA-F]+$/.test(t)) {
    const tHex = t.slice(2).toLowerCase();
    const contractPrefix = contract.slice(2, 2 + tHex.length).toLowerCase();
    if (tHex.length >= 6 && tHex === contractPrefix) {
      return 'matches-contract-prefix';
    }
  }

  return null;
}

async function scanCollection(path: string, label: string) {
  console.log(`\nScanning ${label} (${path})...`);
  const snap = await getDocs(collection(db, path));
  let hits = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const contract = data.contract || data.nftContract;
    const tokenId = data.tokenId;
    const reason = isMalformed(contract, tokenId);
    if (reason) {
      hits++;
      console.log(`  ⚠️  [${reason}] doc=${docSnap.id} contract=${contract} tokenId=${tokenId} name=${data.name || '(no name)'}`);
    }
  }
  console.log(`  Scanned ${snap.docs.length} docs, found ${hits} malformed.`);
  return hits;
}

async function scanUserLikes() {
  console.log(`\nScanning users/*/likes subcollections...`);
  const usersSnap = await getDocs(collection(db, 'users'));
  let totalHits = 0;
  let usersScanned = 0;
  for (const userDoc of usersSnap.docs) {
    const likesSnap = await getDocs(collection(db, 'users', userDoc.id, 'likes'));
    usersScanned++;
    for (const likeDoc of likesSnap.docs) {
      const data = likeDoc.data();
      const contract = data.contract || data.nftContract;
      const tokenId = data.tokenId;
      const reason = isMalformed(contract, tokenId);
      if (reason) {
        totalHits++;
        console.log(
          `  ⚠️  [${reason}] fid=${userDoc.id} doc=${likeDoc.id} contract=${contract} tokenId=${tokenId} name=${data.name || '(no name)'}`
        );
      }
    }
  }
  console.log(`  Scanned ${usersScanned} users' like subcollections, found ${totalHits} malformed.`);
  return totalHits;
}

async function main() {
  console.log('🔍 Scanning Firebase for malformed tokenIds (Music Mondays-style bug)...');
  let total = 0;
  total += await scanCollection('global_likes', 'global_likes');
  total += await scanCollection('global_plays', 'global_plays');
  total += await scanCollection('top_played', 'top_played');
  total += await scanUserLikes();
  console.log(`\n✅ Done. Total malformed tokenIds found: ${total}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
