/**
 * Re-export shim for the shared blind structure validator.
 *
 * The rules live ONCE, in the shared package, because four surfaces write a
 * blind structure and they must all agree: the tournament settings screen, the
 * shared BlindStructureEditor, the create API and the update API. A second
 * copy of the rules here is how the editor and the server drift apart and the
 * TD gets a 400 for a structure the screen said was fine.
 *
 * Canonical source: vendor/commander-shared/src/lib/commander/structureValidation.js
 * Same pattern as auth.js, pushNotifications.js and commanderFetch.js.
 */
export * from '@smarter-poker/commander-shared/lib/commander/structureValidation';
export { default } from '@smarter-poker/commander-shared/lib/commander/structureValidation';
