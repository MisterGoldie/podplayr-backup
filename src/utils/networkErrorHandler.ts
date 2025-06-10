import { processMediaUrl } from './media';

/**
 * This utility intercepts and fixes any direct ar:// and ipfs:// URL requests at the browser level
 * by patching the global fetch and XMLHttpRequest objects.
 */
export function setupArweaveUrlInterceptor() {
  if (typeof window === 'undefined') return;

  // Store original fetch
  const originalFetch = window.fetch;

  // Override fetch to intercept ar:// and ipfs:// URLs
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === 'string') {
      if (input.startsWith('ar://') || input.startsWith('ipfs://')) {
        console.log(`Intercepted ${input.substring(0, 6)} URL in fetch:`, input);
        const fixedUrl = processMediaUrl(input);
        console.log('Converted to:', fixedUrl);
        return originalFetch(fixedUrl, init);
      }
    }
    return originalFetch(input, init);
  };

  // Patch XMLHttpRequest to handle ar:// and ipfs:// URLs
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string, async: boolean = true, username?: string, password?: string): void {
    if (url && typeof url === 'string') {
      if (url.startsWith('ar://') || url.startsWith('ipfs://')) {
        console.log(`Intercepted ${url.substring(0, 6)} URL in XMLHttpRequest:`, url);
        const fixedUrl = processMediaUrl(url);
        console.log('Converted to:', fixedUrl);
        return originalOpen.call(this, method, fixedUrl, async, username, password);
      }
    }
    return originalOpen.call(this, method, url, async, username, password);
  };

  // Patch image loading
  try {
    const originalImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (originalImageSrc && originalImageSrc.set) {
      const originalSet = originalImageSrc.set;
      
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(url: string) {
          if (url && typeof url === 'string') {
            if (url.startsWith('ar://') || url.startsWith('ipfs://')) {
              console.log(`Intercepted ${url.substring(0, 6)} URL in image src:`, url);
              const fixedUrl = processMediaUrl(url);
              console.log('Converted to:', fixedUrl);
              originalSet.call(this, fixedUrl);
            } else {
              originalSet.call(this, url);
            }
          } else {
            originalSet.call(this, url);
          }
        },
        get: originalImageSrc.get
      });
    }
  } catch (error) {
    console.error('Failed to patch HTMLImageElement.src:', error);
  }

  console.log('Arweave URL interceptor set up successfully');
} 