/**
 * Parse blind_structure from Supabase REST response.
 *
 * Supabase returns JSONB columns as JSON *strings* (not parsed arrays) via
 * the REST / PostgREST API. This utility normalises the value so that every
 * consumer can safely iterate over an array of blind-level objects.
 */

function parseBlindStructure(raw) {
  if (Array.isArray(raw) && raw.length > 0) return raw;

  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* not JSON — fall through */
    }
  }

  return [];
}

function parsePayoutStructure(raw) {
  if (Array.isArray(raw) && raw.length > 0) return raw;

  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* not JSON */
    }
  }

  return [];
}

module.exports = { parseBlindStructure, parsePayoutStructure };
