/**
 * Club Commander - Next.js App Root
 * Loads global CSS (Tailwind + Commander design tokens) for all pages.
 * Was entirely missing, which caused ALL Tailwind classes to produce no output.
 */
import '../styles/globals.css';
import '../vendor/commander-shared/src/components/club-buttons/club-buttons.css';

export default function CommanderApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
