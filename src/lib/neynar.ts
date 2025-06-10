import { NeynarAPIClient } from '@neynar/nodejs-sdk';

export const neynarClient = new NeynarAPIClient({
  apiKey: process.env.NEYNAR_API_KEY || ''
});