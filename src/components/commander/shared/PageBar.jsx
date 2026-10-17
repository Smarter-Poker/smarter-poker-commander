/**
 * PageBar - what a Commander page header becomes (Dan, 2026-10-17).
 *
 * A header used to be an icon box, a big title and a sentence describing the
 * page. Dan: "PAGES DON'T NEED TITLES LIKE THIS... ALL THESE WORDS ARE
 * DISTRACTING". Mirrors Club Arena's src/components/help/PageBar.tsx.
 *
 * What survives is what staff act on: live status (counts, venue or
 * tournament name, pills) and the page's own buttons (children) on the left,
 * with the "?" pinned top right holding the explanation and the tutorial. The
 * title stays in the document as a visually hidden h1 for screen readers and
 * the browser outline; nobody sees it.
 *
 * Props:
 *   title      - the page name (hidden h1, and step 0 of the help)
 *   summary    - the words the header used to print; now behind the "?"
 *   steps      - optional curated tutorial steps ({ title, body, target })
 *   status     - optional live line (string or node) shown first on the left
 *   children   - the page's own controls, kept in the bar
 *   className  - extra classes for the bar (background, border, padding)
 *   style      - extra inline styles for the bar
 *   innerClassName - classes for the inner row (e.g. max width + centring)
 *   titleAs    - 'h1' (default) or 'h2' when the page already owns an h1
 *   sticky     - keep the bar pinned to the top while scrolling
 */
import PageHelp from './PageHelp';

export default function PageBar({
  title,
  summary,
  steps,
  status,
  children,
  className = '',
  style,
  innerClassName = '',
  titleAs = 'h1',
  sticky = false,
}) {
  const Heading = titleAs === 'h2' ? 'h2' : 'h1';
  return (
    <header
      className={`cmd-page-bar ${sticky ? 'sticky top-0 z-30' : ''} ${className}`}
      style={style}
      data-page-bar=""
    >
      <div className={`flex items-start justify-between gap-2.5 min-h-[44px] ${innerClassName}`}>
        <Heading className="sr-only">{title}</Heading>
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0 min-h-[44px]">
          {status ? (
            <span className="text-xs font-semibold text-[#B0B3B8] min-w-0" role="status">
              {status}
            </span>
          ) : null}
          {children}
        </div>
        {/* order-last + flex-none keep the "?" in the top right even when the
            live row wraps to a second line on a phone. */}
        <PageHelp title={title} summary={summary} steps={steps} className="order-last" />
      </div>
    </header>
  );
}
