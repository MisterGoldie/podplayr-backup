import { NextApiRequest, NextApiResponse } from 'next';
import { syncTopPlayedCollection } from '../../../lib/firebase/plays';

/**
 * Admin API endpoint to clean up the top_played collection
 * This ensures it only contains the top 3 most played NFTs
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    console.log('Starting cleanup of top_played collection...');
    
    const result = await syncTopPlayedCollection();
    
    console.log('Cleanup result:', result);
    
    return res.status(200).json({
      success: true,
      message: 'Top played collection updated successfully',
      result
    });
  } catch (error) {
    console.error('Error cleaning up top_played collection:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Error updating top_played collection',
      error: String(error)
    });
  }
}
