/**
 * Re-export shim for the shared blind/payout structure parsers.
 *
 * The shared module is CommonJS (module.exports = { parseBlindStructure,
 * parsePayoutStructure }). `export *` does NOT forward those keys through
 * Next/webpack's CJS interop, so a named `import { parseBlindStructure }`
 * resolved to undefined at runtime ("parseBlindStructure is not a function",
 * 500 in tournaments/[id]/clock.js). Bind the names explicitly, tolerating
 * both the CJS-default and native-named interop shapes.
 */
import * as _mod from '@smarter-poker/commander-shared/lib/parseBlindStructure';

const _shared = (_mod && _mod.default) ? _mod.default : _mod;

export const parseBlindStructure = _shared.parseBlindStructure;
export const parsePayoutStructure = _shared.parsePayoutStructure;

export default _shared;
