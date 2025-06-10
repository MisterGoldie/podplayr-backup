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

  // Primary gateways first, fallbacks after
  private gateways = [
    'https://cloudflare-ipfs.com/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/',
    'https://ipfs.fleek.co/ipfs/',
    'https://gateway.ipfs.io/ipfs/'
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
    setInterval(() => {
      this.checkGateways();
    }, this.checkInterval);
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
    } catch (error) {
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

  public async getWorkingGateway(hash: string): Promise<string> {
    // Try to get a gateway that we know is working
    const workingGateways = this.gateways.filter(gateway => {
      const status = this.gatewayStatuses.get(gateway);
      return status?.isWorking;
    });

    // If we have working gateways, use the one with best response time
    if (workingGateways.length > 0) {
      workingGateways.sort((a, b) => {
        const statusA = this.gatewayStatuses.get(a);
        const statusB = this.gatewayStatuses.get(b);
        return (statusA?.avgResponseTime || Infinity) - (statusB?.avgResponseTime || Infinity);
      });
      return workingGateways[0] + hash;
    }

    // If all gateways are marked as not working, reset their status and try again
    this.gateways.forEach(gateway => {
      const status = this.gatewayStatuses.get(gateway);
      if (status) {
        status.isWorking = true;
        status.failureCount = 0;
        this.gatewayStatuses.set(gateway, status);
      }
    });

    // Return the first gateway as a last resort
    return this.gateways[0] + hash;
  }

  public async resolveIPFSUrl(url: string): Promise<string> {
    try {
      // Extract IPFS hash from URL
      const hash = url.match(/ipfs\/([^/]+)/)?.[1];
      if (!hash) return url; // Not an IPFS URL

      // Get working gateway
      const resolvedUrl = await this.getWorkingGateway(hash);
      return resolvedUrl;
    } catch (error) {
      console.warn('Failed to resolve IPFS URL:', error);
      return url; // Return original URL as fallback
    }
  }
}

export const ipfsGatewayManager = IPFSGatewayManager.getInstance();
