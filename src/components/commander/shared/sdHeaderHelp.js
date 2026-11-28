/**
 * THE IMAGE-HEADER "?" (#SMARTERDESIGN, Dan 2026-11-27)
 *
 * Dan, verbatim: "MAKE SURE THAT EVERY SINGLE IMAGE DISPLAY HEADER IS USING
 * THIS SAME DYNAMIC QUESTION MARK ICON AS SEEN IN THE FIRST ATTACHED, AND
 * NEVER ANY OTHER ONE ... THEY SHOULD ALL ALWAYS BE TUCKED INTO THE UPPER
 * RIGHT CORNER AS CLOSE TO THE EDGES AS POSSIBLE WITHOUT TOUCHING THE FRAMES."
 *
 * The first attachment was the Club Arena Cashier header, whose "?" is the
 * painted chrome ring (Club Arena `public/images/header-help-v4.png`). This is
 * the same art, derived at 144px from this repo's full-size master
 * `public/images/header-help-v4.png`, so it stays crisp at 36px on a 4x screen
 * without shipping a 300KB file for an icon.
 *
 * Every image header renders this icon inside `.sd-header-help`
 * (styles/smarterdesign.css), which owns the corner geometry. A text "?", a
 * CSS circle or an icon-font glyph is the thing Dan rejected and is refused by
 * __tests__/image-header-help-icon.law.test.mjs.
 *
 * Render the control with `data-focus-custom=""`: .sd-header-help draws its
 * own focus ring hugging the icon, and that attribute is how the training
 * world's square page-stage ring (src/styles/worlds/training.css) is told to
 * stand down, so it never boxes the icon over the frame.
 */
export const SD_HEADER_HELP_ICON = '/images/smarterdesign/header-help.webp';
