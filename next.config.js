/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // ⚠️  CRITICAL — DO NOT REMOVE. @smarter-poker/commander-shared ships raw
  // JSX source (no pre-compilation). Without this line the build crashes:
  //   "Module parse failed: Unexpected token" on any .jsx in node_modules.
  // See failed deploys 4xJcGVy2N / DWyP5RYRT (April 2026).
  transpilePackages: ['@smarter-poker/commander-shared'],

  // ─── Assets must load from THIS origin, even when the page is proxied ───────
  // The World Hub rewrites smarter.poker/commander/* to this app. Without an
  // absolute assetPrefix the proxied HTML references /_next/static/... and the
  // browser fetches them from smarter.poker - the HUB's Next build - which
  // 404s every chunk ("Refused to execute script ... MIME type text/plain").
  // Every Commander page opened through the hub origin therefore rendered an
  // infinite spinner, and the same-origin SSO path the login design relies on
  // never executed. commander.smarter.poker already answers _next/static and
  // _next/data with Access-Control-Allow-Origin: *, so pinning the prefix in
  // production makes the proxied pages run. Previews keep relative assets so
  // their chunk hashes stay self-consistent with their own build.
  // (2026-09-03)
  assetPrefix: process.env.VERCEL_ENV === 'production' ? 'https://commander.smarter.poker' : undefined,

  // ─── Serverless Bundle Slimming ────────────────────────────────────────────────────
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
    // ─── Parallel webpack workers ──────────────────────────────────────────────────
    // Two parallel workers each compile half the pages, cutting wall-clock
    // build time ~50% and reducing Vercel Build Minutes billed.
    // Matches World Hub cpus:2 already in production.
    // Revert to cpus: 1 if Commander deploys OOM.
    cpus: 2,

    // ─── Server External Packages ──────────────────────────────────────────────
    // Keep heavy runtime-only packages out of the webpack bundle.
    // These must be require()d at runtime but must NOT be compiled into
    // the serverless function chunk — doing so inflates the webpack
    // analysis phase and cold-start latency.
    // NOTE: In Next.js 14 this lives under experimental; it was promoted
    // to the top-level key `serverExternalPackages` in Next.js 15+.
    serverComponentsExternalPackages: [
      'twilio',
      'stripe',
      'openai',
    ],

    // ─── Output File Tracing Exclusions ────────────────────────────────────────
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
      // ── 2026-07-25 audit: cross-app API forwarding ────────────────────────
      // Several Commander pages (and commander-shared components) call World
      // Hub APIs with bare paths (/api/promo/*, /api/social/*, ...). Those
      // routes only exist on smarter.poker, so on the commander origin they
      // 404'd (register promo codes, promotions Promo Codes tab, club-page
      // detection, social posting, /hub profile data). Forward them
      // server-side to the main origin — no CORS involved, headers pass
      // through.
      { source: '/api/promo/:path*', destination: 'https://smarter.poker/api/promo/:path*' },
      { source: '/api/social/:path*', destination: 'https://smarter.poker/api/social/:path*' },
      { source: '/api/friends', destination: 'https://smarter.poker/api/friends' },
      { source: '/api/friends/:path*', destination: 'https://smarter.poker/api/friends/:path*' },
      { source: '/api/hub/:path*', destination: 'https://smarter.poker/api/hub/:path*' },
      { source: '/api/public/:path*', destination: 'https://smarter.poker/api/public/:path*' },
      { source: '/api/vip/:path*', destination: 'https://smarter.poker/api/vip/:path*' },
      { source: '/api/training/:path*', destination: 'https://smarter.poker/api/training/:path*' },
      { source: '/api/club-arena/:path*', destination: 'https://smarter.poker/api/club-arena/:path*' },
    ];
  },
  async redirects() {
    return [
      // 2026-09-04: the root of the commander origin was a scaffold stub
      // ("Status: scaffolded, migration in progress"). Nothing links to it -
      // smarter.poker/commander rewrites to /commander since hub #1344 - but
      // a typed URL or an old bookmark landed on it. Send it to the real
      // landing page. A redirect, on this origin only, from a path the hub
      // never rewrites to, so it cannot loop with the hub.
      {
        source: '/',
        destination: '/commander',
        permanent: false,
      },
      // 2026-07-25 audit: /hub/* pages only exist on smarter.poker — staff
      // clicking "Back To Hub" (or any club-page link) on the commander
      // origin previously hit a 404. Send them to the real origin.
      {
        source: '/hub',
        destination: 'https://smarter.poker/hub',
        permanent: false,
      },
      {
        source: '/hub/:path*',
        destination: 'https://smarter.poker/hub/:path*',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
