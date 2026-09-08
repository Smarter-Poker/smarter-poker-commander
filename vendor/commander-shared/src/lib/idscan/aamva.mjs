/**
 * AAMVA DL/ID PARSER
 *
 * Turns the raw PDF417 payload on the back of a North American driver's
 * licence or state ID into the fields the member form needs. This is the piece
 * that makes a tablet do what a hardware ID scanner does, and it serves BOTH
 * input paths: a camera capture decoded in the browser, and a keyboard-wedge
 * scanner that types the same payload into a focused field.
 *
 * Pure and dependency-free so it can be unit tested against real-world payload
 * shapes without a browser or a camera.
 *
 * FORMAT (AAMVA DL/ID Card Design Standard)
 *   @ LF RS CR "ANSI " <IIN:6> <AAMVA ver:2> <jurisdiction ver:2> <entries:2>
 *   then one 10-char designator per subfile: <type:2><offset:4><length:4>
 *   then the subfiles, each <type:2> followed by LF-separated elements,
 *   terminated by CR. An element is a 3-character code plus its value.
 *
 * Real scanners and real licences violate this constantly: missing header,
 * CRLF instead of LF, a stray prefix from the wedge, offsets that are wrong by
 * the length of the header. So the header path is tried first and a tolerant
 * line scan backs it up, and the two are merged.
 */

// Element codes worth naming. Everything else is still captured, just unmapped.
export const ELEMENTS = {
    DAQ: 'id_number',            // Customer ID / licence number
    DCS: 'family_name',          // Family name
    DAB: 'family_name_legacy',   // Family name (older versions)
    DAC: 'first_name',           // First name
    DCT: 'given_names',          // Given names, first + middle in one field
    DAD: 'middle_name',
    DBB: 'date_of_birth',
    DBA: 'expiry_date',
    DBD: 'issue_date',
    DBC: 'sex',
    DAG: 'street',
    DAH: 'street_2',
    DAI: 'city',
    DAJ: 'jurisdiction',
    DAK: 'postal_code',
    DCG: 'country',
    DCF: 'document_discriminator',
    DAU: 'height',
    DAY: 'eye_color',
    DDE: 'family_name_truncated',
    DDF: 'first_name_truncated',
    DDG: 'middle_name_truncated',
    DAA: 'full_name_legacy',     // AAMVA v1: "LAST,FIRST,MIDDLE"
};

const SUBFILE_TYPES = /^(DL|ID|EN|DD|Z[A-Z])/;

/** Everything a scanner might prepend, plus the compliance indicator itself. */
function trimToPayload(raw) {
    if (typeof raw !== 'string') return '';
    const at = raw.indexOf('@');
    // A wedge sometimes drops the leading @; only trim when it is plausibly the
    // real start of the record, not a stray character inside an address.
    if (at >= 0 && at < 16) return raw.slice(at);
    return raw;
}

function splitLines(payload) {
    return payload
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * Read the fixed-width header. Returns null when it is absent or malformed,
 * which is common enough that it must not be an error.
 */
export function parseHeader(payload) {
    const idx = payload.indexOf('ANSI ');
    if (idx < 0) return null;
    const after = payload.slice(idx + 5);
    const m = after.match(/^(\d{6})(\d{2})(\d{2})?(\d{2})?/);
    if (!m) return null;

    const iin = m[1];
    const version = parseInt(m[2], 10);
    // Jurisdiction version and entry count only exist from version 2 onward.
    const jurisdictionVersion = version >= 2 && m[3] ? parseInt(m[3], 10) : null;
    const entries = version >= 2 && m[4] ? parseInt(m[4], 10) : (m[3] ? parseInt(m[3], 10) : 1);

    return { iin, version, jurisdictionVersion, entries, headerIndex: idx };
}

/**
 * Collect every 3-character element code and its value.
 *
 * Values may legitimately contain letters, so elements are only ever read at
 * the start of a separator-delimited line. A line that opens with a subfile
 * designator ("DL", "ID", "ZV") has it stripped first, because the designator
 * and the first element share a line with no separator between them.
 */
export function parseElements(raw) {
    const payload = trimToPayload(raw);
    const out = {};

    for (let line of splitLines(payload)) {
        // Drop the header, which sits on the same line as the first subfile.
        const ansi = line.indexOf('ANSI ');
        if (ansi >= 0) {
            // Header is "ANSI " + 12 or more digits, then designators of 10
            // chars each, then the first subfile type. Rather than trust the
            // widths, skip to the first plausible element code after the digits.
            const rest = line.slice(ansi + 5);
            const firstAlpha = rest.search(/[A-Z]{3}[^A-Z0-9]|D[A-Z]{2}/);
            line = firstAlpha >= 0 ? rest.slice(firstAlpha) : '';
            // Designators repeat "<TT><8 digits>"; strip any that survived.
            line = line.replace(/^(?:[A-Z]{2}\d{8})+/, '');
        }
        if (!line) continue;

        // Strip a leading subfile designator when a real element follows it.
        if (SUBFILE_TYPES.test(line) && /^[A-Z]{2}[A-Z]{3}/.test(line)) {
            line = line.slice(2);
        }

        const m = line.match(/^([A-Z]{3})(.*)$/);
        if (!m) continue;
        const code = m[1];
        const value = m[2].trim();
        // First occurrence wins: the DL subfile precedes jurisdiction subfiles,
        // which reuse some codes for their own purposes.
        if (!(code in out)) out[code] = value;
    }

    return out;
}

/**
 * AAMVA dates are MMDDCCYY in the United States and CCYYMMDD in Canada, and
 * the payload does not always say which country it is. Both readings are
 * tested and the plausible one wins; ambiguity is resolved by the country code
 * when present.
 */
export function parseAamvaDate(value, country) {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length !== 8) return null;

    const asUs = { m: digits.slice(0, 2), d: digits.slice(2, 4), y: digits.slice(4, 8) };
    const asCa = { y: digits.slice(0, 4), m: digits.slice(4, 6), d: digits.slice(6, 8) };

    const plausible = (p) => {
        const y = +p.y;
        const m = +p.m;
        const d = +p.d;
        if (m < 1 || m > 12 || d < 1 || d > 31) return false;
        if (y < 1900 || y > 2100) return false;
        return true;
    };

    const usOk = plausible(asUs);
    const caOk = plausible(asCa);

    let chosen = null;
    if (country === 'CAN') chosen = caOk ? asCa : (usOk ? asUs : null);
    else if (country === 'USA') chosen = usOk ? asUs : (caOk ? asCa : null);
    else if (usOk && !caOk) chosen = asUs;
    else if (caOk && !usOk) chosen = asCa;
    else if (usOk && caOk) chosen = asUs; // Both readable: the US form is far more common.

    if (!chosen) return null;
    return `${chosen.y}-${chosen.m}-${chosen.d}`;
}

function splitLegacyName(full) {
    if (!full) return {};
    // "LAST,FIRST,MIDDLE" or "LAST$FIRST$MIDDLE"
    const parts = full.split(/[,$]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return {};
    return { last: parts[0], first: parts[1] || '', middle: parts.slice(2).join(' ') };
}

function titleCaseName(value) {
    if (!value) return '';
    // Licences are encoded in upper case. Staff read these on screen and then
    // hand a membership card to a person, so present them as names.
    return value
        .toLowerCase()
        .replace(/(^|[\s'\-.])([a-z])/g, (_all, sep, ch) => sep + ch.toUpperCase());
}

function formatZip(value) {
    if (!value) return '';
    const digits = value.replace(/\s/g, '');
    if (/^\d{9}$/.test(digits)) {
        return digits.slice(5) === '0000' ? digits.slice(0, 5) : `${digits.slice(0, 5)}-${digits.slice(5)}`;
    }
    if (/^\d{5}$/.test(digits)) return digits;
    return digits.slice(0, 10);
}

/** Was this value cut short by the issuer? 'T' means truncated. */
function truncated(flag) {
    return flag === 'T';
}

/**
 * Parse a raw barcode payload into the shape the member form consumes.
 *
 * @returns {{ok:boolean, reason?:string, fields:object, meta:object, raw:object}}
 *          `fields` uses the AddMemberModal field names so it can be applied
 *          directly. `ok` is false when the payload is not an AAMVA record.
 */
export function parseAamva(raw) {
    const empty = { ok: false, fields: {}, meta: {}, raw: {} };
    if (!raw || typeof raw !== 'string' || raw.length < 20) {
        return { ...empty, reason: 'empty' };
    }

    const payload = trimToPayload(raw);
    const header = parseHeader(payload);
    const el = parseElements(payload);

    const hasAnyName = el.DCS || el.DAB || el.DAC || el.DCT || el.DAA;
    if (!hasAnyName && !el.DAQ) {
        return { ...empty, reason: 'not-aamva' };
    }

    const legacy = splitLegacyName(el.DAA);
    const country = el.DCG || null;

    let first = el.DAC || '';
    let middle = el.DAD || '';
    if (!first && el.DCT) {
        // Given names arrive as one field; the first token is the first name.
        const given = el.DCT.split(/[,\s]+/).filter(Boolean);
        first = given[0] || '';
        if (!middle) middle = given.slice(1).join(' ');
    }
    if (!first) first = legacy.first || '';
    if (!middle) middle = legacy.middle || '';

    const last = el.DCS || el.DAB || legacy.last || '';

    const street = [el.DAG, el.DAH].filter(Boolean).join(' ').trim();
    const isIdCard = /(^|[^A-Z])ID\d{8}/.test(payload) && !/(^|[^A-Z])DL\d{8}/.test(payload);

    const fields = {
        first_name: titleCaseName(first),
        last_name: titleCaseName(last),
        middle_name: titleCaseName(middle),
        date_of_birth: parseAamvaDate(el.DBB, country),
        id_number: el.DAQ || '',
        id_state: (el.DAJ || '').toUpperCase().slice(0, 2),
        id_expiry: parseAamvaDate(el.DBA, country),
        id_type: isIdCard ? 'state_id' : 'drivers_license',
        address_street: titleCaseName(street),
        address_city: titleCaseName(el.DAI || ''),
        address_state: (el.DAJ || '').toUpperCase().slice(0, 2),
        address_zip: formatZip(el.DAK || ''),
    };

    // Drop keys with nothing in them so applying this never blanks a field a
    // member of staff has already typed.
    for (const key of Object.keys(fields)) {
        if (fields[key] === '' || fields[key] === null || fields[key] === undefined) delete fields[key];
    }

    const meta = {
        aamvaVersion: header ? header.version : null,
        iin: header ? header.iin : null,
        country,
        issueDate: parseAamvaDate(el.DBD, country),
        sex: el.DBC === '1' ? 'M' : el.DBC === '2' ? 'F' : null,
        truncatedNames: [
            truncated(el.DDE) ? 'last' : null,
            truncated(el.DDF) ? 'first' : null,
            truncated(el.DDG) ? 'middle' : null,
        ].filter(Boolean),
        documentDiscriminator: el.DCF || null,
    };

    return { ok: true, fields, meta, raw: el };
}

/**
 * Is this string plausibly an AAMVA payload rather than, say, a member QR code
 * or somebody typing into the wrong box? Used to decide whether a keyboard
 * wedge burst should be treated as a scan.
 */
export function looksLikeAamva(value) {
    if (!value || typeof value !== 'string' || value.length < 20) return false;
    if (value.includes('ANSI ')) return true;
    // A wedge can mangle the header; two or more known element codes at the
    // start of separator-delimited lines is enough.
    const el = parseElements(value);
    const known = ['DAQ', 'DCS', 'DAC', 'DBB', 'DBA', 'DAJ', 'DAG', 'DAI'];
    return known.filter((k) => k in el).length >= 2;
}

/**
 * Age in whole years on a given date. Poker rooms need this at the door, and
 * getting it from the barcode is the entire point of scanning one.
 */
export function ageOn(dateOfBirth, on = new Date()) {
    if (!dateOfBirth) return null;
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    if (Number.isNaN(dob.getTime())) return null;
    let age = on.getFullYear() - dob.getFullYear();
    const monthDiff = on.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < dob.getDate())) age -= 1;
    return age;
}

/** True when the document's expiry date has passed. */
export function isExpired(expiryDate, on = new Date()) {
    if (!expiryDate) return false;
    const exp = new Date(`${expiryDate}T23:59:59`);
    if (Number.isNaN(exp.getTime())) return false;
    return exp.getTime() < on.getTime();
}
