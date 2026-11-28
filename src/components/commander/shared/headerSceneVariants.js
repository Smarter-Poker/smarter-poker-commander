/**
 * Header scenes that also ship a 640px-wide copy (<art>-scene-640.webp), with
 * the full-size scene's natural width (2026-11-28, staff screen speed).
 *
 * A phone draws the scene about 215 CSS px wide (about 590 device px at 2.75x),
 * but every page downloaded the full scene (up to 1170px, 75-110 KB). With
 * this list CommanderImageHeader offers both through srcSet/sizes, so a phone
 * takes the 640px copy and a desktop the original. Scenes 760px wide or
 * narrower have no copy. Generated from public/images/smarterdesign/headers;
 * tests/unit/headerSceneVariants.law.test.js keeps it in step with the files.
 */
export const HEADER_SCENE_640 = {
  'cashier': 1170,
  'icm': 1080,
  'news': 1012,
  'preflop-achievements': 1080,
  'preflop-leaderboard': 1080,
  'preflop-stats': 1080,
  'preflop-tutorial': 1080,
  'training-aggregate': 1080,
  'training-blind-defense': 1080,
  'training-category-spins': 1080,
  'training-community-leaderboard': 1080,
  'training-custom-solve': 1080,
  'training-daily-challenge': 1080,
  'training-daily-goals': 1080,
  'training-drill-builder': 1080,
  'training-equity-calculator': 1080,
  'training-famous-finals': 1080,
  'training-final-table-sim': 1080,
  'training-focus-timer': 1080,
  'training-glossary': 1080,
  'training-goals': 1080,
  'training-gto-preloader': 1080,
  'training-hand-history-upload': 1080,
  'training-icm-simulator': 1080,
  'training-live-hud-sync': 1080,
  'training-lobby': 1080,
  'training-multi-table': 1080,
  'training-multiway-preflop': 1080,
  'training-my-playbook': 1080,
  'training-player-profiles': 1080,
  'training-position-mastery': 1080,
  'training-progress': 1080,
  'training-rake-solutions': 1080,
  'training-scenario-demo': 1080,
  'training-session-dashboard': 1080,
  'training-session-notes': 1080,
  'training-skill-tree': 1080,
  'training-streaks': 1080,
  'training-study-group': 1080,
  'training-study-group-finder': 1080,
  'training-table-wizard': 1080,
  'training-tilt-guard': 1080,
  'training-tournament-prep': 1080,
  'training-tournaments': 1080,
  'training-training-calendar': 1080,
  'training-training-feed': 1080,
  'training-weakness-scanner': 1080,
};
