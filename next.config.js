/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // ⚠️  CRITICAL — DO NOT REMOVE. @smarter-poker/commander-shared ships raw
  // JSX source (no pre-compilation). Without this line the build crashes:
  //   "Module parse failed: Unexpected token" on any .jsx in node_modules.
  // See failed deploys 4xJcGVy2N / DWyP5RYRT (April 2026).
  transpilePackages: ['@smarter-poker/commander-shared'],

  // ─── Serverless Bundle Slimming ──────────────────────────────────────────────────
  // 'standalone' output makes Next trace actual require()s and copies ONLY
  // what each API route / page needs into .next/standalone. Cuts the
  // serverless function zipped bundle ~40% and reduces the build tracing
  // phase CPU significantly. Safe for Pages Router.
  // Matches World Hub Phase 1.1 optimisation already shipping in production.
  output: 'standalone',

  // ─── Build Safety ─────────────────────────────────────────────────────────────────
  // Ignore TS errors at build time — prevents failed/retried builds from
  // burning extra Build CPU Minutes when stale type errors are present.
  // Mirrors World Hub behaviour.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Cookie domain — shared with World Hub for cross-subdomain auth.
  // Supabase SSR sets cookies with domain=.smarter.poker in prod.
  poweredByHeader: false,

  experimental: {
    // ─── Parallel webpack workers ──────────────────────────────────────────────
    // Two parallel workers each compile half the pages, cutting wall-clock
    // build time ~50% and reducing Vercel Build Minutes billed.
    // Matches World Hub cpus:2 already in production.
    // Revert to cpus: 1 if Commander deploys OOM.
    cpus: 2,

    // ─── Server External Packages ────────────────────────────────────────────
    // Keep heavy runtime-only packages out of the webpack bundle.
    // These must be require()d at runtime but must NOT be compiled into
    // the serverless function chunk — doing so inflates the webpack
    // analysis phase and cold-start latency.
    // NOTE: In Next.js 14 this lives under experimental; it was promoted
    // to the top-level key `serverExternalPackages` in Next.js 15+.
    serverComponentsExternalPackages: [
      'twilio',
      '@sentry/node',
      'stripe',
      'openai',
    ],

    // ─── Output File Tracing Exclusions ──────────────────────────────────────
    // Explicitly exclude large dev-only packages from the file-system
    // tracer so they are never included in the deployed serverless bundle.
    // Match Phase 1.1 of World Hub.
    outputFileTracingExcludes: {
      '*': [
        'node_modules/puppeteer/**',
        'node_modules/canvas/**',
        'node_modules/three/examples/**',
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // API PATH COMPATIBILITY REWRITE
  // All Commander pages call /api/commander/* (World Hub path convention).
  // In this standalone repo, API files live at /api/* (no commander prefix).
  // This rewrite transparently maps the old paths to the real handlers so
  // all 70+ pages work without modifying a single fetch call.
  // ───────────────────────────────────────────────────────────────────────────────
  async rewrites() {
    return [
      {
        source: '/api/commander/:path*',
        destination: '/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
