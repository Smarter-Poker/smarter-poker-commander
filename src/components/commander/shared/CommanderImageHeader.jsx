/**
 * CommanderImageHeader - the #SMARTERDESIGN page image header for every Club
 * Commander staff page (Dan, 2026-11-27).
 *
 * The same composition as World Hub's BankrollImageHeader and the Club Arena
 * Cashier reference (docs/SMARTERDESIGN.md in World Hub): one continuous steel
 * rim, a page-specific seal in a circular chrome frame on the left, the page
 * name in bold solid white beside it, a realistic scene blending in on the
 * right, and the one painted chrome "?" in the upper-right corner holding the
 * page's help and tutorial. No return link inside the frame.
 *
 * Rendered once per page: by CommanderLayout through PageHeaderSlot, or by
 * pages/_app.js on the standalone staff routes. The art and title come from
 * the route registry (pageHeaders.js). The help is the page's own PageHelp
 * content: any PageHelp/PageBar on the page hands its title, summary and steps
 * to this header (PageHelpHost) instead of drawing a second "?".
 */
import { useRouter } from 'next/router';
import PageHelp from './PageHelp';
import { usePageHelpHost } from './PageHelpHost';
import { pageHeaderFor, cleanLayoutTitle } from './pageHeaders';
import { HEADER_SCENE_640 } from './headerSceneVariants';

// The scene is 57-58% of the header, which is at most the viewport wide.
const SCENE_SIZES = '(max-width: 640px) 58vw, 57vw';

export default function CommanderImageHeader({ title: layoutTitle }) {
  const router = useRouter();
  const host = usePageHelpHost();
  const entry = pageHeaderFor(router && router.pathname);
  if (!entry) return null;

  const dynamicTitle = entry.useLayoutTitle ? cleanLayoutTitle(layoutTitle) : '';
  const title = dynamicTitle || entry.title;
  const asset = `/images/smarterdesign/headers/${entry.art}`;
  const help = (host && host.registered) || {};
  const sceneWidth = HEADER_SCENE_640[entry.art];
  const sceneSrcSet = sceneWidth ? `${asset}-scene-640.webp 640w, ${asset}-scene.webp ${sceneWidth}w` : undefined;

  return (
    <div className="cmd-sd-header-wrap" data-page-image-header="">
      <header className="sd-masthead cmd-sd-header" data-header-art={entry.art}>
        <img
          className="cmd-sd-header__scene"
          src={`${asset}-scene.webp`}
          srcSet={sceneSrcSet}
          sizes={sceneSrcSet ? SCENE_SIZES : undefined}
          alt=""
          width="1200"
          height="240"
          fetchpriority="high"
          decoding="async"
          aria-hidden="true"
        />
        <span className="cmd-sd-header__seal" aria-hidden="true">
          <img src={`${asset}-seal.webp`} alt="" width="176" height="176" />
        </span>
        <div className="cmd-sd-header__copy">
          {entry.parent ? <div className="cmd-sd-header__parent">{entry.parent}</div> : null}
          <h1 className="cmd-sd-header__title">{title}</h1>
        </div>
        <PageHelp embedded title={help.title || title} summary={help.summary} steps={help.steps} />
      </header>
    </div>
  );
}
