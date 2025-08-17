import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  writeBatch, 
  increment, 
  setDoc, 
  serverTimestamp 
} from 'firebase/firestore';

// Standalone Firebase configuration (Firestore only)
const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'podplayr2',
};

// Initialize Firebase app and Firestore
const app = initializeApp(firebaseConfig, 'follower-sync-script');
const db = getFirestore(app);

const PODPLAYR_FID = 1014485;
const PODPLAYR_USERNAME = 'podplayr';
const PODPLAYR_DISPLAY_NAME = 'PODPLAYR';
const PODPLAYR_PFP_URL = 'https://i.imgur.com/m6AuNqy.png';

// Standalone implementation of ensurePodplayrFollow
const ensurePodplayrFollow = async (userFid: number): Promise<void> => {
  try {
    if (!userFid || userFid === PODPLAYR_FID) {
      return;
    }

    // Check if user already follows PODPlayr
    const followingRef = doc(db, 'users', userFid.toString(), 'following', PODPLAYR_FID.toString());
    const followingDoc = await getDoc(followingRef);
    
    if (followingDoc.exists()) {
      console.log(`✅ User ${userFid} already follows PODPlayr`);
      return;
    }

    console.log(`➕ Adding PODPlayr follow for user ${userFid}`);
    
    const batch = writeBatch(db);
    
    // Add to user's following collection
    batch.set(followingRef, {
      fid: PODPLAYR_FID,
      username: PODPLAYR_USERNAME,
      display_name: PODPLAYR_DISPLAY_NAME,
      pfp_url: PODPLAYR_PFP_URL,
      followed_at: serverTimestamp()
    });
    
    // Add to PODPlayr's followers collection
    const followerRef = doc(db, 'users', PODPLAYR_FID.toString(), 'followers', userFid.toString());
    batch.set(followerRef, {
      fid: userFid,
      followed_at: serverTimestamp()
    });
    
    // Update user's following count
    const userRef = doc(db, 'users', userFid.toString());
    batch.update(userRef, {
      following_count: increment(1)
    });
    
    // Update PODPlayr's follower count
    const podplayrRef = doc(db, 'users', PODPLAYR_FID.toString());
    batch.update(podplayrRef, {
      follower_count: increment(1)
    });
    
    await batch.commit();
    console.log(`✅ Successfully added PODPlayr follow for user ${userFid}`);
    
  } catch (error) {
    console.error(`❌ Error in ensurePodplayrFollow for user ${userFid}:`, error);
    throw error;
  }
};

// Standalone implementation of updatePodplayrFollowerCount
const updatePodplayrFollowerCount = async (): Promise<number> => {
  try {
    const followersRef = collection(db, 'users', PODPLAYR_FID.toString(), 'followers');
    const followersSnapshot = await getDocs(followersRef);
    const followerCount = followersSnapshot.size;
    
    // Update PODPlayr's follower count
    const podplayrRef = doc(db, 'users', PODPLAYR_FID.toString());
    await setDoc(podplayrRef, {
      follower_count: followerCount
    }, { merge: true });
    
    console.log(`🔄 Updated PODPlayr follower count to: ${followerCount}`);
    return followerCount;
  } catch (error) {
    console.error('❌ Error updating PODPlayr follower count:', error);
    throw error;
  }
};

// Ensure all existing users follow PODPlayr
export const ensureAllUsersFollowPodplayr = async () => {
  try {
    console.log('🚀 Starting script to ensure all users follow PODPlayr...');
    
    // Get all users from the 'users' collection
    console.log('📋 Fetching all users from Firebase...');
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    
    console.log(`📊 Found ${usersSnapshot.size} total users in the system`);
    
    let processedCount = 0;
    let alreadyFollowingCount = 0;
    let newFollowersCount = 0;
    let errorCount = 0;
    
    // Process each user
    for (const userDoc of usersSnapshot.docs) {
      const userFid = parseInt(userDoc.id);
      
      // Skip PODPlayr account itself
      if (userFid === PODPLAYR_FID) {
        console.log('⏭️  Skipping PODPlayr account itself');
        continue;
      }
      
      try {
        console.log(`🔍 Processing user FID: ${userFid}`);
        
        // Check if user already follows PODPlayr
        const followingRef = doc(db, 'users', userFid.toString(), 'following', PODPLAYR_FID.toString());
        const followingDoc = await getDoc(followingRef);
        
        if (followingDoc.exists()) {
          console.log(`✅ User ${userFid} already follows PODPlayr`);
          alreadyFollowingCount++;
        } else {
          console.log(`➕ Adding PODPlayr follow for user ${userFid}`);
          await ensurePodplayrFollow(userFid);
          newFollowersCount++;
          
          // Add a small delay to avoid overwhelming Firebase
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        processedCount++;
        
        // Log progress every 10 users
        if (processedCount % 10 === 0) {
          console.log(`📈 Progress: ${processedCount}/${usersSnapshot.size - 1} users processed`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing user ${userFid}:`, error);
        errorCount++;
      }
    }
    
    // Update the final PODPlayr follower count
    console.log('🔄 Updating final PODPlayr follower count...');
    const finalCount = await updatePodplayrFollowerCount();
    
    // Summary
    console.log('\n🎉 Script completed!');
    console.log('📊 Summary:');
    console.log(`   • Total users processed: ${processedCount}`);
    console.log(`   • Already following PODPlayr: ${alreadyFollowingCount}`);
    console.log(`   • New followers added: ${newFollowersCount}`);
    console.log(`   • Errors encountered: ${errorCount}`);
    console.log(`   • Final PODPlayr follower count: ${finalCount}`);
    
    return {
      processedCount,
      alreadyFollowingCount,
      newFollowersCount,
      errorCount,
      finalCount
    };
    
  } catch (error) {
    console.error('💥 Fatal error in ensureAllUsersFollowPodplayr:', error);
    throw error;
  }
};

// Also check searchedusers collection for additional FIDs
export const ensureSearchedUsersFollowPodplayr = async () => {
  try {
    console.log('🔍 Checking searchedusers collection for additional users...');
    
    const searchedUsersRef = collection(db, 'searchedusers');
    const searchedUsersSnapshot = await getDocs(searchedUsersRef);
    
    console.log(`📊 Found ${searchedUsersSnapshot.size} searched users`);
    
    let processedCount = 0;
    let alreadyFollowingCount = 0;
    let newFollowersCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const userDoc of searchedUsersSnapshot.docs) {
      const userData = userDoc.data();
      const userFid = userData.fid;
      
      // Skip if no FID, if it's PODPlayr, or if it's an ENS user (synthetic FID)
      if (!userFid || userFid === PODPLAYR_FID || userFid < 0) {
        skippedCount++;
        continue;
      }
      
      try {
        // Check if this user exists in the main users collection
        const userRef = doc(db, 'users', userFid.toString());
        const userSnapshot = await getDoc(userRef);
        
        if (!userSnapshot.exists()) {
          console.log(`⏭️  Skipping searched user ${userFid} - not a registered user`);
          skippedCount++;
          continue; // Skip users that don't exist in main collection
        }
        
        // Only process users that exist in the main users collection
        console.log(`🔍 Processing registered searched user ${userFid}`);
        
        // Check if they already follow PODPlayr
        const followingRef = doc(db, 'users', userFid.toString(), 'following', PODPLAYR_FID.toString());
        const followingDoc = await getDoc(followingRef);
        
        if (followingDoc.exists()) {
          console.log(`✅ User ${userFid} already follows PODPlayr`);
          alreadyFollowingCount++;
        } else {
          console.log(`➕ Adding PODPlayr follow for user ${userFid}`);
          await ensurePodplayrFollow(userFid);
          newFollowersCount++;
          
          // Add a small delay
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        processedCount++;
        
      } catch (error) {
        console.error(`❌ Error processing searched user ${userFid}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n📊 Searched users summary:');
    console.log(`   • Total searched users found: ${searchedUsersSnapshot.size}`);
    console.log(`   • Registered users processed: ${processedCount}`);
    console.log(`   • Already following PODPlayr: ${alreadyFollowingCount}`);
    console.log(`   • New followers added: ${newFollowersCount}`);
    console.log(`   • Skipped (not registered/ENS/invalid): ${skippedCount}`);
    console.log(`   • Errors encountered: ${errorCount}`);
    
    return {
      processedCount,
      alreadyFollowingCount,
      newFollowersCount,
      skippedCount,
      errorCount
    };
    
  } catch (error) {
    console.error('💥 Fatal error in ensureSearchedUsersFollowPodplayr:', error);
    throw error;
  }
};

// Run both checks and update final count
export const runCompleteFollowerSync = async () => {
  try {
    console.log('🎯 Starting complete follower synchronization...');
    
    // First, ensure all main users follow PODPlayr
    const mainUsersResult = await ensureAllUsersFollowPodplayr();
    
    // Then, check searched users for any additional FIDs
    const searchedUsersResult = await ensureSearchedUsersFollowPodplayr();
    
    // Final update of PODPlayr follower count
    console.log('🔄 Final update of PODPlayr follower count...');
    const finalCount = await updatePodplayrFollowerCount();
    
    console.log('\n🎉 Complete synchronization finished!');
    console.log(`🎯 Final PODPlayr follower count: ${finalCount}`);
    
    return {
      mainUsers: mainUsersResult,
      searchedUsers: searchedUsersResult,
      finalCount
    };
    
  } catch (error) {
    console.error('💥 Fatal error in runCompleteFollowerSync:', error);
    throw error;
  }
};

// Run the script if called directly
if (require.main === module) {
  runCompleteFollowerSync()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}