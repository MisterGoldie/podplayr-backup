/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  // Allow ngrok domains in development
  allowedDevOrigins: [
    'b252fcf49668.ngrok.app',
    '*.ngrok.app',
    '*.ngrok-free.app'
  ],
};

module.exports = nextConfig; 