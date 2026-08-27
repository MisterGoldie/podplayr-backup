import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_HOST: process.env.NEXT_PUBLIC_HOST || 'http://localhost:3000',
    NEXT_PUBLIC_ALCHEMY_API_KEY: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  },
  transpilePackages: ['@base-org/account', '@base-org/account-ui'],
  // Required for Frames to work properly
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
