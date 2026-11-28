/**
 * apiShape - read a Commander API answer without trusting its shape
 * (2026-11-28).
 *
 * Staff pages used to read `json.data.entries || []` straight off the
 * response. An API can legitimately answer with an error body, an empty
 * object, `data: null` or `data: []`, and every one of those white-screened a
 * page: `null.entries` throws, and on an array `[].entries` is
 * Array.prototype.entries - a FUNCTION, which `|| []` keeps and React then
 * calls as a state updater ("Cannot convert undefined or null to object").
 * Nine pages crashed that way (scripts/check-api-resilience.mjs found them).
 *
 * Read the payload once, here, and give every field a default of its kind:
 *   apiData(json)            the `data` object, or {} when it is not a plain object
 *   asArray(v)               v when it is an array, else []
 *   asObject(v)              v when it is a plain object, else {}
 *   asNumber(v, fallback)    a finite number, else fallback
 *   apiFailed(res, json)     true for a non-2xx answer or an error body
 *   apiError(res, json, what) "Could Not Load <what>" with the server's reason
 */

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function asObject(v) {
  return isPlainObject(v) ? v : {};
}

export function asArray(v) {
  return Array.isArray(v) ? v : [];
}

export function asNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function apiData(json) {
  return isPlainObject(json) ? asObject(json.data) : {};
}

export function apiFailed(res, json) {
  if (res && res.ok === false) return true;
  if (!isPlainObject(json)) return true;
  return json.success === false || (json.error != null && json.success !== true);
}

export function apiError(res, json, what = 'This Page') {
  const reason = isPlainObject(json) && typeof json.error === 'string' && json.error.trim() ? json.error.trim() : '';
  const status = res && res.status && !res.ok ? ` (${res.status})` : '';
  return `Could Not Load ${what}${status}${reason ? `: ${reason}` : ''}`;
}

/** res.json() that never throws: a broken or empty body reads as null. */
export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
