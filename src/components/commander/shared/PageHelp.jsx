/**
 * PAGE HELP - THE "?" IN THE TOP RIGHT OF EVERY COMMANDER PAGE (Dan, 2026-10-17)
 *
 * Dan, verbatim: "PAGES DON'T NEED TITLES LIKE THIS... REMOVE ALL DESCRIPTIONS
 * THAT EXIST LIKE THIS ON ANY AND ALL PAGES. ADD A ? MARK ICON INSTEAD IN THE
 * UPPER RIGHT CORNER OF THE PAGES THAT CAN EXPLAIN ANYTHING AND ALSO LAUNCH A
 * TUTORIAL AT THE BOTTOM WHEN CLICKED. ALL THESE WORDS ARE DISTRACTING AND
 * MAKES IT HARDER TO USE THE SITE, WE NEED TO SIMPLY PAGES."
 *
 * Mirrors Club Arena's src/components/help/PageHelp.tsx in behaviour, in the
 * Commander palette (accent #1877F2, surface #242526, border #3A3B3C).
 *
 * Every page header used to print a giant title and a sentence describing the
 * page. The words moved in here: step 0 ("About This Page") is the page title
 * plus that explanation, and "Start Tutorial" walks the rest. A step may name
 * a `target` (CSS selector or element); while that step shows, the element is
 * scrolled into view and lit through the data-tutorial-focus attribute (the
 * outline lives in styles/globals.css).
 *
 * Steps come from, in order: the `steps` prop, or a tour built from the page
 * itself - the remaining sentences of the summary, then up to six visible
 * section headings (h2/h3).
 *
 * Copy rules: Title Case on every word, no em dashes, no emoji.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';

export const FOCUS_ATTR = 'data-tutorial-focus';
const MAX_SECTION_STEPS = 6;

const DONE_STEP = {
  title: 'You Are All Set',
  body: 'Tap The Question Mark In The Top Right Any Time To See This Again.',
};

/** House capitalisation: every word starts with a capital, no em dashes. */
export function titleCase(text) {
  return String(text || '')
    .replace(/\u2014/g, '-')
    .split(/(\s+)/)
    .map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join('');
}

export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

const SKIP_HEADING =
  'li, [role="dialog"], [aria-modal="true"], [data-page-help], [data-page-bar], [data-artwork="approved-global-header"]';

/**
 * A tour built from the page in front of the user: its section headings, in
 * reading order. Headings inside a list row, a dialog, the global header or
 * the help itself are row labels, not sections, and are skipped.
 */
export function sectionSteps(root, pageTitle) {
  if (!root) return [];
  const seen = new Set([String(pageTitle || '').trim().toLowerCase()]);
  const steps = [];
  for (const heading of Array.from(root.querySelectorAll('h2, h3'))) {
    if (steps.length >= MAX_SECTION_STEPS) break;
    if (heading.closest(SKIP_HEADING)) continue;
    if (!isVisible(heading)) continue;
    const text = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 48) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const section = heading.closest('section, article, [class*="section"], [class*="panel"]');
    const lead = section ? section.querySelector('p') : null;
    const leadText = ((lead && lead.textContent) || '').replace(/\s+/g, ' ').trim();
    const body =
      leadText.length >= 20 && leadText.length <= 200
        ? leadText
        : `This Is Where You Find ${titleCase(text)}.`;

    steps.push({ title: titleCase(text), body: titleCase(body), target: heading });
  }
  return steps;
}

export function resolveTarget(target) {
  if (!target) return null;
  if (typeof target !== 'string') return target.isConnected ? target : null;
  try {
    return Array.from(document.querySelectorAll(target)).find(isVisible) || null;
  } catch {
    return null;
  }
}

/** The page the help belongs to: an explicit root, else the app root. */
function pageRoot(button) {
  if (!button) return null;
  return (
    button.closest('[data-page-root]') ||
    document.getElementById('__next') ||
    document.body
  );
}

export function clearTutorialFocus() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`[${FOCUS_ATTR}]`).forEach((el) => el.removeAttribute(FOCUS_ATTR));
}

export default function PageHelp({ title, summary, steps, className = '' }) {
  const router = useRouter();
  const panelId = useId();
  const titleId = useId();
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [tour, setTour] = useState([]);

  const pageTitle = titleCase(title);

  /* The first step is always the explanation the header used to print. */
  const intro = useMemo(() => {
    const sentences = splitSentences(summary);
    return {
      title: pageTitle,
      body: titleCase(sentences[0] || `Here Is How ${pageTitle} Works.`),
    };
  }, [pageTitle, summary]);

  const buildTour = useCallback(() => {
    let body;
    if (Array.isArray(steps) && steps.length > 0) {
      body = steps;
    } else {
      const rest = splitSentences(summary)
        .slice(1)
        .map((sentence) => ({ title: pageTitle, body: titleCase(sentence) }));
      body = [...rest, ...sectionSteps(pageRoot(buttonRef.current), pageTitle)];
    }
    return [intro, ...body, DONE_STEP];
  }, [intro, pageTitle, steps, summary]);

  const close = useCallback(() => {
    clearTutorialFocus();
    setOpen(false);
    setIndex(0);
    if (buttonRef.current) buttonRef.current.focus({ preventScroll: true });
  }, []);

  const openHelp = useCallback(() => {
    setTour(buildTour());
    setIndex(0);
    setOpen(true);
  }, [buildTour]);

  /* Light the step's part of the page, and bring it into view. */
  useEffect(() => {
    if (!open) return;
    clearTutorialFocus();
    const el = resolveTarget(tour[index] && tour[index].target);
    if (!el) return;
    el.setAttribute(FOCUS_ATTR, '');
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [open, index, tour]);

  /* Escape closes; the panel takes focus so a keyboard can drive it. */
  useEffect(() => {
    if (!open) return undefined;
    if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  /* Leaving the page ends the tour and never leaves a lit element behind. */
  useEffect(() => {
    const events = router && router.events;
    if (!events) return undefined;
    const onRoute = () => {
      clearTutorialFocus();
      setOpen(false);
      setIndex(0);
    };
    events.on('routeChangeStart', onRoute);
    return () => events.off('routeChangeStart', onRoute);
  }, [router]);
  useEffect(() => clearTutorialFocus, []);

  const step = tour[index];
  const last = index >= tour.length - 1;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`cmd-page-help inline-flex flex-none items-center justify-center w-11 h-11 rounded-full bg-[#242526] border-2 border-[#1877F2] text-[#E4E6EB] text-lg font-bold leading-none cursor-pointer select-none active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#18191A] ${className}`}
        aria-label="Page Help"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : openHelp())}
        data-page-help=""
      >
        <span aria-hidden="true">?</span>
      </button>
      {open &&
        step &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={panelId}
            ref={panelRef}
            className="cmd-tutorial-panel fixed mx-auto max-w-[560px] rounded-2xl border border-[#3A3B3C] bg-[#242526] text-[#E4E6EB] shadow-2xl outline-none font-['Inter']"
            style={{
              left: 'max(12px, env(safe-area-inset-left))',
              right: 'max(12px, env(safe-area-inset-right))',
              bottom: 'max(12px, env(safe-area-inset-bottom))',
              zIndex: 10050,
              padding: '16px 18px 17px',
            }}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
            data-page-help=""
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#1877F2]">
                {index === 0 ? 'About This Page' : `Step ${index} Of ${tour.length - 1}`}
              </span>
              <button
                type="button"
                className="min-h-[32px] rounded-lg px-3 text-xs font-semibold text-[#B0B3B8] hover:text-white active:bg-[#3A3B3C]"
                aria-label="Close Help"
                onClick={close}
              >
                Close
              </button>
            </div>
            <h2 id={titleId} className="mt-2 text-lg font-extrabold leading-tight text-[#E4E6EB]">
              {step.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#B0B3B8]">{step.body}</p>
            <div className="mt-3.5 flex flex-wrap gap-1.5" aria-hidden="true">
              {tour.map((s, i) => (
                <span
                  key={`${s.title}-${i}`}
                  className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-[#1877F2]' : 'bg-[#B0B3B8] opacity-40'}`}
                />
              ))}
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              {index > 0 ? (
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl bg-[#3A3B3C] text-sm font-semibold text-[#E4E6EB] active:bg-[#4E4F50]"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl bg-[#3A3B3C] text-sm font-semibold text-[#E4E6EB] active:bg-[#4E4F50]"
                  onClick={close}
                >
                  Got It
                </button>
              )}
              {last ? (
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl bg-[#1877F2] text-sm font-semibold text-white active:bg-[#1664D9]"
                  onClick={close}
                >
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl bg-[#1877F2] text-sm font-semibold text-white active:bg-[#1664D9]"
                  onClick={() => setIndex((i) => Math.min(tour.length - 1, i + 1))}
                >
                  {index === 0 ? 'Start Tutorial' : 'Next'}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
