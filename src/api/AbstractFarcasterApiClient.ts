import { prioritizeVideoPlayback } from '../utils/networkPrioritizer';

export abstract class AbstractFarcasterApiClient {
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return prioritizeVideoPlayback(
      () => fetch(url, options),
      { isEssential: url.includes('/essential-endpoint/') }
    );
  }
}