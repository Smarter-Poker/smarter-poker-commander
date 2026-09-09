/**
 * READING THE FRONT OF THE CARD, WHEN THE BARCODE WILL NOT SCAN.
 *
 * pdf417.mjs reads the barcode on the back, which is the right answer when it
 * works: the payload is exact and AAMVA-encoded. It stops working on a worn
 * card, and a worn card is the normal case at a poker room desk. A licence
 * lives in a wallet for eight years; the laminate scuffs, the barcode is the
 * first thing to go, and the member is standing there.
 *
 * There was no fallback. The desk typed everything.
 *
 * THE FRONT IS ALSO A STANDARD. AAMVA numbers the fields printed on the face
 * of every compliant US licence, and they are the same numbers in every state:
 *
 *   1   family name              4a  issue date
 *   2   given names              4b  expiry date
 *   3   date of birth            4d  licence number
 *   8   address                  15  sex
 *
 * So this is a grammar, not a guess. It reads those labels, and the spelled
 * out ones next to them (DOB, EXP, ISS, DLN) because plenty of cards print
 * both, and returns the SAME field shape parseAamva returns so everything
 * downstream is unchanged.
 *
 * WHAT IT WILL NOT DO. It never invents a field. A value it cannot read is
 * absent, not blank and not a guess, because a wrong date of birth on an ID
 * check is worse in every direction than an empty box the desk fills in. It
 * reports its own confidence so the caller can decide whether to show the
 * fields as read or as suggestions.
 */

/** Two-letter codes, and the state names printed across the top of a card. */
const STATE_NAMES = {
    ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
    COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
    HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
    KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
    MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
    MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH',
    OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
    VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
    'DISTRICT OF COLUMBIA': 'DC',
};

const STATE_CODES = new Set(Object.values(STATE_NAMES));

/** Trimmed, non-empty lines, original characters kept. */
export function toLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

/**
 * A date printed on a card, as ISO, or null.
 *
 * US cards print MM/DD/YYYY. A two-digit year is refused outright rather than
 * guessed: on a licence the same two digits could be a birth year or an expiry
 * year a century apart, and being wrong about either is worse than being
 * absent.
 */
export function faceDate(value) {
    const text = String(value || '');
    const m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
    if (!m) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The text following a label on the line that carries it.
 *
 * Labels are matched at a word boundary and the AAMVA numerals only when they
 * sit at the start of a line, because "3" appears in an address and "1"
 * appears in a licence number.
 */
function valueFor(lines, labels) {
    for (const label of labels) {
        const numeric = /^\d/.test(label);
        const pattern = numeric
            ? new RegExp(`^\\s*${label}\\b[\\s:.]*(.+)$`, 'i')
            : new RegExp(`\\b${label}\\b[\\s:.#]*(.+)$`, 'i');
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(pattern);
            if (!m) continue;
            const value = m[1].trim();
            if (value) return { value, line: i };
            // Some layouts print the label and its value on separate lines.
            if (i + 1 < lines.length) return { value: lines[i + 1].trim(), line: i + 1 };
        }
    }
    return null;
}

function dateFor(lines, labels) {
    for (const label of labels) {
        const found = valueFor(lines, [label]);
        if (!found) continue;
        const onLine = faceDate(found.value);
        if (onLine) return onLine;
        // "4b EXP" with the date wrapped onto the next line.
        const next = lines[found.line + 1];
        const wrapped = faceDate(next);
        if (wrapped) return wrapped;
    }
    return null;
}

/** "SMITH" -> "Smith", "MARY-JANE" -> "Mary-Jane", "O'BRIEN" -> "O'Brien". */
function titleCaseName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/(^|[\s'-])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase())
        .trim();
}

/** Letters, spaces, hyphens and apostrophes only: a name, not a label. */
function cleanName(value) {
    const name = String(value || '').replace(/[^A-Za-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
    return name.length >= 2 ? name : '';
}

export function findState(lines) {
    const upper = lines.map((l) => l.toUpperCase());
    for (const [name, code] of Object.entries(STATE_NAMES)) {
        const re = new RegExp(`\\b${name}\\b`);
        if (upper.some((l) => re.test(l))) return code;
    }
    for (const line of upper) {
        const withZip = line.match(/,?\s*\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
        if (withZip && STATE_CODES.has(withZip[1])) return withZip[1];
    }
    return null;
}

/**
 * The licence number.
 *
 * Read off its label only. A bare alphanumeric run on a card is as likely to
 * be a document discriminator, an audit number or a restriction code, and a
 * wrong licence number recorded against a member is worse than none.
 */
export function findIdNumber(lines) {
    const found = valueFor(lines, ['4d', 'DLN', 'DL NO', 'DL', 'LIC NO', 'LICENSE NO', 'LICENCE NO', 'ID NO']);
    if (!found) return '';
    // A DATE sitting next to the label is not a licence number, and it is the
    // easy mistake: "DLN 08/15/2029" offered "2029" as an id, because the
    // slashes break the word boundary and a year looks like a short number.
    // The whole value is checked, not the fragment that survived matching.
    if (faceDate(found.value)) return '';
    // Five characters minimum. No US licence number is four, and every
    // shorter match is a fragment of something else.
    const m = found.value.match(/\b([A-Z0-9][A-Z0-9-]{4,19})\b/i);
    if (!m) return '';
    const candidate = m[1].toUpperCase();
    if (/^(19|20)\d{2}$/.test(candidate)) return '';
    return /\d/.test(candidate) ? candidate : '';
}

function findNames(lines) {
    let last = cleanName(valueFor(lines, ['1', 'LN', 'FAMILY NAME', 'LAST NAME', 'SURNAME'])?.value);
    let first = cleanName(valueFor(lines, ['2', 'FN', 'GIVEN NAMES', 'FIRST NAME'])?.value);
    let middle = '';

    // "2 MARY JANE" is a first name and a middle name in one field, which is
    // how the standard defines it.
    if (first.includes(' ')) {
        const parts = first.split(' ');
        first = parts[0];
        middle = parts.slice(1).join(' ');
    }
    if (!middle) middle = cleanName(valueFor(lines, ['MI', 'MIDDLE NAME'])?.value);
    return { first, middle, last };
}

/**
 * Confidence, 0-100, from what was actually found.
 *
 * The identity fields carry the weight, because a read that produced an
 * address and nothing else is not an identification.
 */
function scoreConfidence(fields) {
    let c = 0;
    if (fields.last_name) c += 22;
    if (fields.first_name) c += 22;
    if (fields.date_of_birth) c += 26;
    if (fields.id_number) c += 18;
    if (fields.id_expiry) c += 8;
    if (fields.id_state) c += 4;
    return Math.min(100, c);
}

/**
 * Read the printed face of a licence or state ID.
 *
 * @param {string} text what the on-device OCR engine produced
 * @returns {{ok: boolean, fields: object, meta: object, confidence: number, reason?: string}}
 *          `fields` is the same shape parseAamva returns, so a caller can
 *          apply either without knowing which one read the card.
 */
export function parseLicenceFace(text) {
    const lines = toLines(text);
    if (lines.length === 0) {
        return { ok: false, fields: {}, meta: { source: 'face' }, confidence: 0, reason: 'empty' };
    }

    const { first, middle, last } = findNames(lines);
    const dateOfBirth = dateFor(lines, ['3', 'DOB', 'DATE OF BIRTH', 'BIRTH']);
    const expiry = dateFor(lines, ['4b', 'EXP', 'EXPIRES', 'EXPIRATION']);
    const issued = dateFor(lines, ['4a', 'ISS', 'ISSUED', 'ISSUE DATE']);
    const idNumber = findIdNumber(lines);
    const state = findState(lines);

    const upper = lines.map((l) => l.toUpperCase()).join(' ');
    const isIdCard = /\bIDENTIFICATION CARD\b/.test(upper) && !/\bDRIVER'?S? LICENSE\b/.test(upper);

    const fields = {
        first_name: titleCaseName(first),
        last_name: titleCaseName(last),
        middle_name: titleCaseName(middle),
        date_of_birth: dateOfBirth,
        id_number: idNumber,
        id_state: state || '',
        id_expiry: expiry,
        id_type: isIdCard ? 'state_id' : 'drivers_license',
    };

    // Same rule parseAamva follows: an empty key is dropped, so applying a
    // read can never blank something a member of staff has already typed.
    for (const key of Object.keys(fields)) {
        if (fields[key] === '' || fields[key] === null || fields[key] === undefined) delete fields[key];
    }

    const confidence = scoreConfidence(fields);
    // Two identity fields at minimum. A card that yielded only an expiry date
    // has not been read, and saying so is the point.
    const ok = Boolean(fields.date_of_birth && (fields.last_name || fields.id_number));

    return {
        ok,
        fields,
        meta: { source: 'face', issueDate: issued, state },
        confidence,
        ...(ok ? {} : { reason: 'not-enough-identity' }),
    };
}

/** Does this text look like the face of an ID at all? */
export function looksLikeLicenceFace(text) {
    const lines = toLines(text);
    if (lines.length < 2) return false;
    const upper = lines.join(' ').toUpperCase();
    if (/\bDRIVER'?S? LICENSE\b|\bIDENTIFICATION CARD\b|\bDRIVER LICENSE\b/.test(upper)) return true;
    // Or the AAMVA face labels, which no other document prints together.
    const labels = [/\bDOB\b/, /\bEXP\b/, /\bDLN\b/, /^\s*4d\b/m, /^\s*4b\b/m];
    return labels.filter((re) => re.test(upper)).length >= 2;
}

export default { parseLicenceFace, looksLikeLicenceFace, faceDate, findState, findIdNumber, toLines };

// ---------------------------------------------------------------------------
// THE SEAM. THIS PACKAGE STAYS DEPENDENCY FREE.
// ---------------------------------------------------------------------------

/**
 * An OCR engine is megabytes. pdf417.mjs already solved this problem: the
 * decoder is REGISTERED by the consumer, so the shared package carries no
 * dependency and the download is paid only by an app that needs it, at the
 * moment it first tries. The same seam, for the same reason.
 *
 * @type {null | ((source:*) => Promise<{text:string, confidence?:number}>)}
 */
let faceReader = null;
let faceLoader = null;
let faceLoading = null;

/**
 * Register something that turns an image into text.
 *
 * @param {Function} fn        read(source) -> {text, confidence?}
 * @param {object}   [options]
 * @param {boolean}  [options.lazy] when true, `fn` is a LOADER called once on
 *                   the first attempt and expected to resolve to the reader.
 */
export function registerFaceReader(fn, options = {}) {
    if (typeof fn !== 'function') { faceReader = null; faceLoader = null; faceLoading = null; return; }
    if (options.lazy) { faceLoader = fn; faceReader = null; faceLoading = null; return; }
    faceReader = fn;
    faceLoader = null;
    faceLoading = null;
}

/** Is there anything to read WITH? Registered counts, loaded or not. */
export function hasFaceReader() {
    return Boolean(faceReader || faceLoader);
}

/** Test seam: forget any registration. */
export function resetFaceReaderForTests() {
    faceReader = null;
    faceLoader = null;
    faceLoading = null;
}

async function readerOrNull() {
    if (faceReader) return faceReader;
    if (!faceLoader) return null;
    if (!faceLoading) {
        faceLoading = Promise.resolve()
            .then(() => faceLoader())
            .then((loaded) => {
                faceReader = typeof loaded === 'function' ? loaded : null;
                return faceReader;
            })
            .catch(() => {
                // A failed load must not poison every later attempt: the next
                // card gets a fresh try.
                faceLoading = null;
                return null;
            });
    }
    return faceLoading;
}

/**
 * Read the printed face of a card from an IMAGE.
 *
 * This is what the capture flow calls when the barcode would not scan.
 *
 * @param {*} source anything the registered reader accepts (a canvas, a blob)
 * @returns {Promise<{ok:boolean, fields:object, meta:object, confidence:number, reason?:string}>}
 */
export async function readLicenceFace(source) {
    const empty = { ok: false, fields: {}, meta: { source: 'face' }, confidence: 0 };
    if (!source) return { ...empty, reason: 'no-image' };

    const read = await readerOrNull();
    // No engine registered is not a failure to read; it is nothing to read
    // with, and the difference decides whether anybody should be paged.
    if (!read) return { ...empty, reason: 'no-reader' };

    let text = '';
    let engineConfidence = null;
    try {
        const out = await read(source);
        text = String((out && out.text) || '');
        engineConfidence = Number.isFinite(out && out.confidence) ? out.confidence : null;
    } catch (err) {
        return { ...empty, reason: 'reader-failed', error: err };
    }

    if (!text.trim()) return { ...empty, reason: 'no-text' };

    const parsed = parseLicenceFace(text);
    return { ...parsed, meta: { ...parsed.meta, engineConfidence } };
}
