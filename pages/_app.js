/**
 * Club Commander - Next.js App Root
 * Loads global CSS (Tailwind + Commander design tokens) for all pages.
 * Was entirely missing, which caused ALL Tailwind classes to produce no output.
 */
import '../styles/globals.css';
import { useRouter } from 'next/router';
import StandaloneGlobalHeader from '../src/components/commander/shared/StandaloneGlobalHeader';

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

  return (
    <>
      {needsAppHeader && <StandaloneGlobalHeader />}
      <Component {...pageProps} />
    </>
  );
}
