import { firebaseLogger } from './config';

/**
 * Utility function to delay execution
 */
export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with retry functionality for API calls
 */
export const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      firebaseLogger.debug(`Attempt ${attempt} of ${maxRetries} for fetching URL:`, url);
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const statusText = response.statusText;
        const responseText = await response.text();
        throw new Error(`HTTP error ${response.status} (${statusText}): ${responseText}`);
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      firebaseLogger.warn(`Fetch attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 10000);
        firebaseLogger.debug(`Retrying after ${backoffTime}ms`);
        await delay(backoffTime);
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
};
