/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // ⚠️  CRITICAL — DO NOT REMOVE. @smarter-poker/commander-shared ships raw
  // JSX source (no pre-compilation). Without this line the build crashes:
  //   "Module parse failed: Unexpected token" on any .jsx in node_modules.
  // See failed deploys 4xJcGVy2N / DWyP5RYRT (April 2026).
  transpilePackages: ['@smarter-poker/commander-shared'],
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
