/**
 * @smarter-poker/commander-shared - entry point
 *
 * The package re-exports nothing by default. Consumers import directly
 * from subpaths:
 *   import { EventBus } from '@smarter-poker/commander-shared/engine/EventBus';
 *   import { useDebounce } from '@smarter-poker/commander-shared/hooks/useDebounce';
 *   import { applyRateLimit } from '@smarter-poker/commander-shared/lib/apiRateLimit';
 *
 * The package.json `exports` field maps these subpaths into src/.
 *
 * This empty index satisfies "main" in package.json without forcing
 * consumers to import the entire bundle.
 */
export {};
