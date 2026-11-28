/**
 * PageHelpHost - lets a page's own PageHelp/PageBar hand its title, summary and
 * tutorial steps to the #SMARTERDESIGN image header's painted "?" (2026-11-27),
 * so a page never shows two question marks. Mounted around every page in
 * pages/_app.js. `hasHeader` is decided from the route synchronously, so the
 * page's own "?" never flashes before the header claims it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { pageHeaderFor } from './pageHeaders';

export const PageHelpHostContext = createContext(null);

/** Wraps the whole page so the header and the page's PageHelp can meet. */
export function PageHelpHost({ children }) {
  const router = useRouter();
  const header = pageHeaderFor(router && router.pathname);
  const [registered, setRegistered] = useState(null);
  const pathname = router && router.pathname;
  // A new page starts with its own help, never the previous page's.
  useEffect(() => setRegistered(null), [pathname]);
  const register = useCallback((props) => {
    setRegistered((prev) => {
      if (
        prev &&
        prev.title === props.title &&
        prev.summary === props.summary &&
        prev.steps === props.steps
      ) {
        return prev;
      }
      return props;
    });
  }, []);
  const value = useMemo(
    () => ({ hasHeader: !!header, registered, register }),
    [header, registered, register],
  );
  return <PageHelpHostContext.Provider value={value}>{children}</PageHelpHostContext.Provider>;
}

export function usePageHelpHost() {
  return useContext(PageHelpHostContext);
}

