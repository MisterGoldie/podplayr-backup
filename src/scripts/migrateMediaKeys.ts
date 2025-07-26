import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { generateNewMediaKey, validateMediaKey } from '../utils/media';

const firebaseConfig = {
  // Your Firebase config
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

interface MigrationStats {
  globalLikesMigrated: number;
  globalPlaysMigrated: number;
  userLikesMigrated: number;
  errors: string[];
}

/**
 * Migrate global_likes collection from contract-tokenId keys to UUID keys
 */
async function migrateGlobalLikes(): Promise<{ migrated: number; errors: string[] }> {
  const stats = { migrated: 0, errors: [] };
  
  try {
    const globalLikesRef = collection(db, 'global_likes');
    const snapshot = await getDocs(globalLikesRef);
    
    const batch = writeBatch(db);
    let batchCount = 0;
    
    for (const docSnap of snapshot.docs) {
      const oldMediaKey = docSnap.id;
      const data = docSnap.data();
      
      // Skip if already using UUID format
      if (validateMediaKey(oldMediaKey)) {
        continue;
      }
      
      // Generate new UUID-based mediaKey
      const newMediaKey = generateNewMediaKey();
      
      // Create new document with UUID key
      const newDocRef = doc(db, 'global_likes', newMediaKey);
      batch.set(newDocRef, {
        ...data,
        oldMediaKey, // Keep reference to old key for debugging
        migratedAt: new Date()
      });
      
      // Delete old document
      batch.delete(docSnap.ref);
      
      batchCount++;
      stats.migrated++;
      
      // Commit batch every 500 operations
      if (batchCount >= 500) {
        await batch.commit();
        batchCount = 0;
      }
    }
    
    // Commit remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }
    
  } catch (error) {
    (stats.errors as string[]).push(`Global likes migration error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return stats;
}

/**
 * Migrate global_plays collection from contract-tokenId keys to UUID keys
 */
async function migrateGlobalPlays(): Promise<{ migrated: number; errors: string[] }> {
  const stats = { migrated: 0, errors: [] };
  
  try {
    const globalPlaysRef = collection(db, 'global_plays');
    const snapshot = await getDocs(globalPlaysRef);
    
    const batch = writeBatch(db);
    let batchCount = 0;
    
    for (const docSnap of snapshot.docs) {
      const oldMediaKey = docSnap.id;
      const data = docSnap.data();
      
      // Skip if already using UUID format
      if (validateMediaKey(oldMediaKey)) {
        continue;
      }
      
      // Generate new UUID-based mediaKey
      const newMediaKey = generateNewMediaKey();
      
      // Create new document with UUID key
      const newDocRef = doc(db, 'global_plays', newMediaKey);
      batch.set(newDocRef, {
        ...data,
        oldMediaKey, // Keep reference to old key for debugging
        migratedAt: new Date()
      });
      
      // Delete old document
      batch.delete(docSnap.ref);
      
      batchCount++;
      stats.migrated++;
      
      // Commit batch every 500 operations
      if (batchCount >= 500) {
        await batch.commit();
        batchCount = 0;
      }
    }
    
    // Commit remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }
    
  } catch (error) {
    (stats.errors as string[]).push(`Global plays migration error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return stats;
}

/**
 * Main migration function
 */
export async function runMediaKeyMigration(): Promise<MigrationStats> {
  console.log('🚀 Starting mediaKey migration...');
  
  const stats: MigrationStats = {
    globalLikesMigrated: 0,
    globalPlaysMigrated: 0,
    userLikesMigrated: 0,
    errors: []
  };
  
  // Migrate global_likes
  console.log('📊 Migrating global_likes...');
  const likesResult = await migrateGlobalLikes();
  stats.globalLikesMigrated = likesResult.migrated;
  stats.errors.push(...likesResult.errors);
  
  // Migrate global_plays
  console.log('🎵 Migrating global_plays...');
  const playsResult = await migrateGlobalPlays();
  stats.globalPlaysMigrated = playsResult.migrated;
  stats.errors.push(...playsResult.errors);
  
  console.log('✅ Migration completed!', stats);
  return stats;
}

// Run migration if called directly
if (require.main === module) {
  runMediaKeyMigration()
    .then(stats => {
      console.log('Migration completed:', stats);
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}