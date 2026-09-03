/**
 * Club Commander - Next.js App Root
 * Loads global CSS (Tailwind + Commander design tokens) for all pages.
 * Was entirely missing, which caused ALL Tailwind classes to produce no output.
 */
import '../styles/globals.css';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import StandaloneGlobalHeader from '../src/components/commander/shared/StandaloneGlobalHeader';
import { installAuthFlowMonitor } from '../src/lib/authFlowMonitor';

// [2026-09-03] Client-side Sentry was never running in Commander. The SDK's
// normal injection of sentry.client.config.js happens through withSentryConfig,
// which this repo does not use (build-memory reasons, same as the World Hub),
// and Next 14 does not auto-load instrumentation-client. So the config file was
// dead code, the production bundle contained no Sentry at all, and
// `completeLogin is not defined` fired on every login for days with nothing
// paging anyone. Importing it here is what actually turns it on. Init is gated
// to production + a DSN inside the config, so dev is unaffected.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line global-require
  require('../sentry.client.config');
}

const COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT = new Set([
  '/commander/admin/pin-entry',
  '/commander/check-in/[code]',
  '/commander/dealer/[tableNumber]',
  '/commander/displays/waitlist',
  '/commander',
  '/commander/kiosk',
  '/commander/lobby',
  '/commander/login',
  '/commander/onboarding',
  '/commander/player/[tableNumber]',
  '/commander/register',
  '/commander/reports/analytics-daily',
  '/commander/reports/player-activity',
  '/commander/reports/table-utilization',
  '/commander/reports/tax-compliance',
  '/commander/reports/waitlist-metrics',
  '/commander/table/[id]',
  '/commander/tablet/[tableNumber]',
  '/commander/tournament-clocks',
  '/commander/tournament-registration',
  '/commander/tournaments/[id]',
  '/commander/tournaments/[id]/break-manager',
  '/commander/tournaments/[id]/clock-display',
  '/commander/tournaments/[id]/public',
  '/commander/tournaments/[id]/seating-display',
  '/commander/tournaments/[id]/settings',
  '/commander/tournaments/[id]/structure-display',
  '/commander/waitlist/desk',
  '/commander/waitlist/status/[id]',
]);

export default function CommanderApp({ Component, pageProps }) {
  const router = useRouter();
  const needsAppHeader = COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT.has(router.pathname);

  // Report auth-flow failures (unhealable 401s, login/SSO completion errors)
  // to Sentry with stable tags so an alert rule can page on them.
  useEffect(() => installAuthFlowMonitor(), []);

  return (
    <>
      {needsAppHeader && <StandaloneGlobalHeader />}
      <Component {...pageProps} />
    </>
  );
}
