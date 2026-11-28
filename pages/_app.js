/**
 * Club Commander - Next.js App Root
 * Loads global CSS (Tailwind + Commander design tokens) for all pages.
 * Was entirely missing, which caused ALL Tailwind classes to produce no output.
 */
import '../styles/globals.css';
import '../styles/single-field-focus.css';
import '../styles/smarterdesign.css';
import '../styles/commander-smarterdesign.css';
import { installSingleFieldFocus } from '../src/lib/singleFieldFocus.mjs';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Rajdhani } from 'next/font/google';
import StandaloneGlobalHeader from '../src/components/commander/shared/StandaloneGlobalHeader';
import CommanderImageHeader from '../src/components/commander/shared/CommanderImageHeader';
import { PageHelpHost } from '../src/components/commander/shared/PageHelpHost';
import { PageHeaderSlotContext } from '@smarter-poker/commander-shared/components/commander/shared/PageHeaderSlot';
import { installAuthFlowMonitor } from '../src/lib/authFlowMonitor';

// #SMARTERDESIGN title face (World Hub uses the same font as --font-rajdhani).
const rajdhani = Rajdhani({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-rajdhani', display: 'swap' });

// CommanderLayout fills its PageHeaderSlot with the page image header.
const renderPageHeader = ({ title }) => <CommanderImageHeader title={title} />;

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
  '/commander/tournaments/[id]/clock-display',
  '/commander/tournaments/[id]/public',
  '/commander/tournaments/[id]/seating-display',
  '/commander/tournaments/[id]/settings',
  '/commander/tournaments/[id]/structure-display',
  '/commander/waitlist/desk',
  '/commander/waitlist/status/[id]',
]);

export default function CommanderApp({ Component, pageProps }) {
  useEffect(() => installSingleFieldFocus(document), []);
  const router = useRouter();
  const needsAppHeader = COMMANDER_ROUTES_WITHOUT_SHARED_LAYOUT.has(router.pathname);

  // Report auth-flow failures (unhealable 401s, login/SSO completion errors)
  // to the local browser console with stable event names.
  useEffect(() => installAuthFlowMonitor(), []);

  // #SMARTERDESIGN everywhere, including portals (dialogs mount on <body>).
  useEffect(() => {
    document.body.classList.add('smarterdesign', 'cmd-sd', rajdhani.variable);
  }, []);

  return (
    <PageHelpHost>
      <PageHeaderSlotContext.Provider value={renderPageHeader}>
        <div className={`smarterdesign cmd-sd ${rajdhani.variable}`} data-commander-sd="">
          {needsAppHeader && <StandaloneGlobalHeader />}
          {/* Standalone staff routes do not render CommanderLayout, so the
              image header comes from here (no entry = no header). */}
          {needsAppHeader && <CommanderImageHeader />}
          <Component {...pageProps} />
        </div>
      </PageHeaderSlotContext.Provider>
    </PageHelpHost>
  );
}
