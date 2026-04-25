/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    // Match Phase 1.1 of World Hub — exclude heavy deps from lambda traces
    outputFileTracingExcludes: {
      '*': [
        'node_modules/puppeteer/**',
        'node_modules/canvas/**',
        'node_modules/three/examples/**',
      ],
    },
  },
  // Cookie domain — shared with World Hub for cross-subdomain auth
  // Supabase SSR sets cookies with domain=.smarter.poker in prod
  poweredByHeader: false,
};

module.exports = nextConfig;
