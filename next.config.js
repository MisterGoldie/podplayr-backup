const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // ✅ DISABLE FOR NOW
  transpilePackages: ['@base-org/account', '@base-org/account-ui'],
  // @base-org/account's Node entry pulls @coinbase/cdp-sdk (x402), which webpack
  // cannot resolve. We only use the browser SDK for Sign in with Base.
  serverExternalPackages: ['@coinbase/cdp-sdk'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account$': path.resolve(
        __dirname,
        'node_modules/@base-org/account/dist/index.js'
      ),
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    scrollRestoration: true,
    // Optimize resource loading
    optimizeCss: {
      inlineThreshold: 0,
    },
    // Reduce unnecessary preloads
    optimizeServerReact: false,
  },
  // Configure preload strategy
  onDemandEntries: {
    // Number of pages to keep in memory
    maxInactiveAge: 25 * 1000,
    // Number of pages to cache
    pagesBufferLength: 2,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Allow tunnel domains (ngrok, Cloudflare Tunnel) in development
  allowedDevOrigins: [
    'b252fcf49668.ngrok.app',
    '*.ngrok.app',
    '*.ngrok-free.app',
    '*.trycloudflare.com'
  ],
};

module.exports = nextConfig;