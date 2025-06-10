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
  // Optimize font loading (moved to root level as it's a standard option)
  fontLoaders: [
    { loader: '@next/font/google', options: { subsets: ['latin'] } },
  ],
  experimental: {
    scrollRestoration: true,
    // Optimize resource loading
    optimizeCss: true,
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
};

module.exports = nextConfig; 