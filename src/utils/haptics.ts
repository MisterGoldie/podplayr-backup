import sdk from '@farcaster/miniapp-sdk';
import { logger } from './logger';

// Haptic feedback utility
export const triggerHaptic = async (intensity: 'light' | 'medium' | 'heavy' = 'medium', context?: string) => {
  const logContext = context ? `[${context}]` : '';
  
  logger.debug(`${logContext} Haptic trigger attempt:`, { 
    sdkAvailable: !!sdk, 
    hapticsAvailable: !!sdk?.haptics?.impactOccurred,
    intensity,
    timestamp: new Date().toISOString()
  });
  
  try {
    if (sdk?.haptics?.impactOccurred) {
      logger.debug(`${logContext} Calling haptic with intensity:`, intensity);
      await sdk.haptics.impactOccurred(intensity);
      logger.debug(`${logContext} Haptic call completed successfully`);
    } else {
      logger.warn(`${logContext} Haptics API not available on SDK`);
    }
  } catch (error) {
    logger.error(`${logContext} Haptic feedback failed:`, error);
  }
};