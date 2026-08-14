interface GatewayStatus {
  gateway: string;
  lastChecked: number;
  isWorking: boolean;
  failureCount: number;
  avgResponseTime: number;
}

class IPFSGatewayManager {
  private static instance: IPFSGatewayManager;
  private gatewayStatuses: Map<string, GatewayStatus> = new Map();
  private readonly checkInterval = 5 * 60 * 1000; // 5 minutes
  private readonly maxFailures = 3;
  private readonly timeout = 5000; // 5 seconds timeout

  // Prefer pinata/dweb — cloudflare-ipfs.com DNS is dead; ipfs.io often 504s
  private gateways = [
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/',
    'https://nftstorage.link/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://w3s.link/ipfs/',
    'https://gateway.ipfs.io/ipfs/',
  ];

  private constructor() {
    this.initializeGateways();
    this.startPeriodicCheck();
  }

  public static getInstance(): IPFSGatewayManager {
    if (!IPFSGatewayManager.instance) {
      IPFSGatewayManager.instance = new IPFSGatewayManager();
    }
    return IPFSGatewayManager.instance;
  }

  private initializeGateways() {
    this.gateways.forEach(gateway => {
      this.gatewayStatuses.set(gateway, {
        gateway,
        lastChecked: 0,
        isWorking: true,
        failureCount: 0,
        avgResponseTime: 0
      });
    });
  }

  private startPeriodicCheck() {
    // Health-check fetches hit CORS and steal bandwidth from playback. Skip them.
  }

  private async checkGateway(gateway: string): Promise<boolean> {
    try {
      const start = Date.now();
      const response = await Promise.race([
        fetch(gateway + 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/readme'),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.timeout)
        )
      ]);

      const responseTime = Date.now() - start;
      const status = this.gatewayStatuses.get(gateway);

      if ((response as Response).ok && status) {
        status.isWorking = true;
        status.failureCount = 0;
        status.avgResponseTime = (status.avgResponseTime + responseTime) / 2;
        status.lastChecked = Date.now();
        this.gatewayStatuses.set(gateway, status);
        return true;
      }
    } catch {
      const status = this.gatewayStatuses.get(gateway);
      if (status) {
        status.failureCount++;
        status.isWorking = status.failureCount < this.maxFailures;
        status.lastChecked = Date.now();
        this.gatewayStatuses.set(gateway, status);
      }
    }
    return false;
  }

  private async checkGateways() {
    for (const gateway of this.gateways) {
      await this.checkGateway(gateway);
    }
  }

  private extractPath(url: string): string | null {
    if (!url) return null;
    if (url.startsWith('ipfs://')) {
      return url.replace(/^ipfs:\/\//, '').replace(/^\/+/, '') || null;
    }
    const match = url.match(/\/ipfs\/(.+)$/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]+)(\/.*)?$/i.test(url)) {
      return url;
    }
    return null;
  }

  public async getWorkingGateway(path: string): Promise<string> {
    const workingGateways = this.gateways.filter(gateway => {
      const status = this.gatewayStatuses.get(gateway);
      return status?.isWorking;
    });

    if (workingGateways.length > 0) {
      workingGateways.sort((a, b) => {
        const statusA = this.gatewayStatuses.get(a);
        const statusB = this.gatewayStatuses.get(b);
        return (statusA?.avgResponseTime || Infinity) - (statusB?.avgResponseTime || Infinity);
      });
      return workingGateways[0] + path;
    }

    this.gateways.forEach(gateway => {
      const status = this.gatewayStatuses.get(gateway);
      if (status) {
        status.isWorking = true;
        status.failureCount = 0;
        this.gatewayStatuses.set(gateway, status);
      }
    });

    return this.gateways[0] + path;
  }

  public async resolveIPFSUrl(url: string): Promise<string> {
    try {
      const path = this.extractPath(url);
      if (!path) return url;
      return await this.getWorkingGateway(path);
    } catch (error) {
      console.warn('Failed to resolve IPFS URL:', error);
      return url;
    }
  }
}

export const ipfsGatewayManager = IPFSGatewayManager.getInstance();
