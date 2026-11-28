/**
 * InlineStyle - the one way a Commander page writes a <style> element
 * (2026-11-28, React hydration errors #425 / #423 / #418).
 *
 * `<style>{`...css...`}</style>` hands React the CSS as a TEXT child. On the
 * server React escapes text, so `font-family: 'Inter'` and `a > b` leave as
 * `&#x27;Inter&#x27;` and `a &gt; b`; the browser parses <style> as raw text
 * and keeps those entities literally. On hydration the client's text
 * (`'Inter'`) no longer matches the server's (`&#x27;Inter&#x27;`), React throws
 * #425 ("Text content does not match server-rendered HTML") then #423 and
 * re-renders the whole root on the client. On main that happened on 52 of 108
 * Commander routes (every page whose CSS has a quote, `>` or `&`).
 *
 * Writing the CSS as inner HTML sends the same bytes from server and client,
 * so there is nothing to mismatch. `</style` is neutralised so CSS that ever
 * interpolates data cannot close the element early.
 *
 * Law: tests/unit/hydrationSafeRender.law.test.js forbids `<style>{` in pages/
 * and src/.
 */
import { createElement } from 'react';

export function safeCss(css) {
  return String(css ?? '').replace(/<\/(style)/gi, '<\\/$1');
}

export default function InlineStyle({ css, ...rest }) {
  return createElement('style', { ...rest, dangerouslySetInnerHTML: { __html: safeCss(css) } });
}
