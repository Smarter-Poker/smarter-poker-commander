/**
 * Commander Receipt Templates
 *
 * ONE place that knows what a printed card looks like.
 *
 * WHY THIS EXISTS
 * ---------------
 * The seat-change card was copy-pasted into four screens
 * (td/[tournamentId]/tables.js, players.js, clock.js and
 * tournaments/[id]/break-manager.js). They drifted: three printed a 15px
 * "Dealer's Copy" card with a venue logo, the fourth printed an 12px card with
 * no logo but WITH the from-table and chip count. Every payload carries
 * from_table, from_seat and chips, and three of the four screens threw that
 * data away. A moving player also only ever got a dealer card, never one of
 * their own.
 *
 * Everything here is PURE: these functions build HTML strings and touch no
 * browser API, so the print station, the TD screens and any future server-side
 * renderer all produce byte-identical paper. `printHtml` is the only function
 * that talks to `window`, and it RETURNS FALSE when the popup is blocked so a
 * caller can requeue instead of silently losing the cards.
 */

/* ── Escaping ─────────────────────────────────────────────────── */

/**
 * Receipt payloads carry player-supplied names. They are interpolated into a
 * document we then execute, so every value gets escaped.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only allow image sources we are willing to load into the print window. */
function safeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!/^(https?:\/\/|\/|data:image\/)/i.test(raw)) return '';
  return escapeHtml(raw);
}

/* ── Formatting ───────────────────────────────────────────────── */

function fmtDate(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString();
}

function fmtMoney(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return '$ 0.00';
  return `$ ${num.toFixed(2)}`;
}

function htmlDoc(title, css, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
${css}
</style></head><body>
${body}
</body></html>`;
}

/* ── Seat Change Card ─────────────────────────────────────────── */

/**
 * Canonical 80mm seat-change card. Look is the tables.js card (the largest,
 * most legible of the four), extended with the moved-from line and the chip
 * count that every payload already carried.
 */
const SEAT_CHANGE_CSS = `
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; font-size: 15px; }
.card { width: 72mm; margin: 0 auto; padding: 7mm 5mm 9mm; border-bottom: 2px dashed #000; page-break-after: always; }
.card:last-child { page-break-after: avoid; border-bottom: none; }
.logo-wrap { text-align: center; margin-bottom: 3mm; }
.logo-wrap img { max-width: 36mm; max-height: 20mm; object-fit: contain; }
.venue-name { text-align: center; font-size: 24px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; line-height: 1.1; margin-bottom: 1mm; }
.venue-location { text-align: center; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #444; margin-bottom: 2mm; }
.receipt-type { text-align: center; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1.5mm; }
.tourn-name { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4mm; }
.divider { border-top: 1px solid #000; margin: 4mm 0; }
.field-row { display: flex; align-items: baseline; margin: 4mm 0; font-size: 15px; }
.field-label { font-weight: bold; min-width: 20mm; }
.field-val { font-size: 17px; font-weight: bold; text-transform: uppercase; }
.boxes { display: flex; gap: 8mm; justify-content: center; margin: 7mm 0; }
.box-wrap { text-align: center; width: 90px; }
.box-title { font-size: 14px; font-weight: bold; margin-bottom: 1.5mm; }
.box-num { border: 2.5px solid #000; font-size: 30px; font-weight: 900; padding: 3mm 0; width: 90px; display: block; text-align: center; line-height: 1.1; }
.moved-from { text-align: center; font-size: 13px; font-weight: bold; margin-top: -3mm; margin-bottom: 2mm; }
.info-row { display: flex; justify-content: space-between; font-size: 14px; margin: 2mm 0; }
.footer-line { font-size: 13px; margin: 1.5mm 0; }
.customer-copy { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 1px; margin-top: 4mm; }
`.trim();

/** One physical card for one move. */
function seatChangeCardFragment(r, copyLabel) {
  const receipt = r || {};
  const logo = safeImageUrl(receipt.venue_logo_url);
  const location = [receipt.venue_city, receipt.venue_state].filter(Boolean).join(', ');
  const buyin = Number(receipt.buyin_amount);
  const hasFrom = receipt.from_table !== null && receipt.from_table !== undefined && receipt.from_table !== '';
  const chips = fmtNumber(receipt.chips);

  return `<div class="card">
  ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${escapeHtml(receipt.venue_name || 'Club')}" loading="lazy" /></div>` : ''}
  <div class="venue-name">${escapeHtml(receipt.venue_name || 'Club')}</div>
  ${location ? `<div class="venue-location">${escapeHtml(location)}</div>` : ''}
  <div class="receipt-type">Tournament Seat Change Card</div>
  <div class="tourn-name">${escapeHtml(receipt.tournament_name || 'Tournament')}${Number.isFinite(buyin) && buyin > 0 ? ` - $${buyin.toLocaleString()}` : ''}</div>
  <div class="divider"></div>
  <div class="field-row"><span class="field-label">Name:</span><span class="field-val">&nbsp;${escapeHtml(receipt.player_name || 'Player')}</span></div>
  <div class="divider"></div>
  <div class="boxes">
    <div class="box-wrap"><div class="box-title">Table</div><span class="box-num">${escapeHtml(receipt.to_table)}</span></div>
    <div class="box-wrap"><div class="box-title">Seat</div><span class="box-num">${escapeHtml(receipt.to_seat)}</span></div>
  </div>
  ${hasFrom ? `<div class="moved-from">Moved From Table ${escapeHtml(receipt.from_table)}, Seat ${escapeHtml(receipt.from_seat)}</div>` : ''}
  ${chips ? `<div class="divider"></div><div class="info-row"><span>Chip Count:</span><span><b>${chips}</b></span></div>` : ''}
  <div class="divider"></div>
  <div class="footer-line">${escapeHtml(fmtDate(receipt.timestamp))}&nbsp;&nbsp;${escapeHtml(fmtTime(receipt.timestamp))}</div>
  <div class="customer-copy">${escapeHtml(copyLabel)}</div>
</div>`;
}

/**
 * Build the full print document for a set of seat-change receipts.
 * TWO cards per move: one for the dealer at the destination table and one the
 * player carries with them. Pass { copies: ["Dealer's Copy"] } to print one.
 *
 * @param {Array} receipts
 * @param {object} [options]
 * @param {string[]} [options.copies]
 * @param {string} [options.title]
 * @returns {string} HTML document
 */
export function buildSeatChangeCardsHtml(receipts, options = {}) {
  const list = Array.isArray(receipts) ? receipts : [];
  const copies = Array.isArray(options.copies) && options.copies.length > 0
    ? options.copies
    : ["Dealer's Copy", "Player's Copy"];

  const body = list
    .map(r => copies.map(label => seatChangeCardFragment(r, label)).join('\n'))
    .join('\n');

  return htmlDoc(options.title || 'Seat Change Cards', SEAT_CHANGE_CSS, body);
}

/* ── Tournament Buy-In Receipt ────────────────────────────────── */

const BUYIN_CSS = `
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Times New Roman', Georgia, serif; margin: 0; padding: 0; color: #000; -webkit-print-color-adjust: exact; }
.receipt { width: 72mm; padding: 5mm 4mm; margin: 0 auto; page-break-after: always; }
.receipt:last-child { page-break-after: avoid; }
.center { text-align: center; }
.venue-name { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 1mm; line-height: 1.2; }
.venue-sub { font-size: 15px; letter-spacing: 3px; text-transform: uppercase; color: #333; }
.receipt-title { font-size: 20px; font-weight: bold; margin: 3mm 0 1mm; text-transform: uppercase; }
.event-name { font-size: 17px; margin: 1mm 0; }
.event-date { font-size: 17px; margin: 2mm 0; }
.event-date-label { font-weight: bold; }
.player-name { font-size: 17px; font-weight: bold; margin: 2mm 0 0; }
.player-name-label { font-weight: bold; }
.player-id { font-size: 16px; margin: 0 0 2mm; padding-left: 2mm; }
.fin-row { display: flex; justify-content: flex-end; align-items: baseline; font-size: 16px; line-height: 1.8; }
.fin-label { font-weight: bold; text-align: right; margin-right: 2mm; }
.fin-value { min-width: 24mm; text-align: right; font-weight: bold; }
.fin-total-row { display: flex; justify-content: flex-end; align-items: baseline; font-size: 18px; line-height: 2; font-weight: bold; }
.fin-total-label { font-weight: bold; text-align: right; margin-right: 2mm; }
.fin-total-value { min-width: 24mm; text-align: right; font-weight: bold; }
.divider { border-top: 1px solid #000; margin: 2.5mm 0; }
.seat-grid { display: flex; justify-content: center; gap: 8mm; margin: 3mm 0; }
.seat-box { text-align: center; }
.seat-box-label { font-size: 17px; font-weight: bold; margin-bottom: 1mm; }
.seat-box-value { border: 2.5px solid #000; font-size: 42px; font-weight: bold; min-width: 24mm; min-height: 18mm; display: flex; align-items: center; justify-content: center; padding: 2mm 5mm; }
.received { font-size: 16px; margin: 2mm 0; }
.received-label { font-weight: bold; }
.receipt-num { font-size: 22px; font-weight: bold; margin: 2mm 0; }
.legal { font-size: 11px; color: #333; line-height: 1.3; margin: 2mm 2mm; text-align: center; }
.copy-label { font-size: 15px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-top: 2mm; }
`.trim();

const COPY_LABEL_MAP = {
  'PLAYER COPY': 'CUSTOMER COPY',
  'DEALER COPY': 'DEALER COPY',
  'CASHIER COPY': 'CAGE COPY'
};

function resolveCopyLabel(copyLabel) {
  const raw = String(copyLabel || 'CUSTOMER COPY');
  return COPY_LABEL_MAP[raw] || raw;
}

function buyinReceiptFragment(receipt, copyLabel) {
  const r = receipt || {};
  const buyinAmount = Number(r.buyinAmount ?? r.buyin_amount ?? 0) || 0;
  const buyinFee = Number(r.buyinFee ?? r.buyin_fee ?? 0) || 0;
  const total = buyinAmount + buyinFee;

  const scheduledStart = r.scheduledStart ?? r.scheduled_start ?? null;
  const tournDate = scheduledStart
    ? new Date(scheduledStart).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '';
  const tournTime = scheduledStart
    ? new Date(scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    : '';

  const now = r.timestamp ? new Date(r.timestamp) : new Date();
  const stamp = Number.isNaN(now.getTime()) ? new Date() : now;
  const receivedDate = stamp.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const receivedTime = stamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

  const venueName = r.venueName ?? r.venue_name ?? '';
  const venueCity = r.venueCity ?? r.venue_city ?? '';
  const venueState = r.venueState ?? r.venue_state ?? '';
  const location = [venueCity, venueState].filter(Boolean).join(', ');
  const playerName = r.playerName ?? r.player_name ?? '';
  const playerId = r.playerId ?? r.player_id ?? '';
  const tournamentName = r.tournamentName ?? r.tournament_name ?? '';
  const staffName = r.staffName ?? r.staff_name ?? '';
  const tableNumber = r.tableNumber ?? r.table_number ?? '';
  const seatNumber = r.seatNumber ?? r.seat_number ?? '';
  const receiptNum = r.receiptNum ?? r.receipt_num ?? '';
  const displayCopy = resolveCopyLabel(copyLabel ?? r.copyLabel);

  return `<div class="receipt">

<div class="center venue-name">${escapeHtml(venueName || 'POKER ROOM')}</div>
${location ? `<div class="center venue-sub">${escapeHtml(location)}</div>` : ''}

<div class="center receipt-title">TOURNAMENT BUY-IN RECEIPT</div>

<div class="event-name">${escapeHtml(tournamentName)}</div>

${scheduledStart ? `<div class="event-date"><span class="event-date-label">Tournament Date:</span>  ${escapeHtml(tournDate)}    ${escapeHtml(tournTime)}</div>` : ''}

<div class="player-name"><span class="player-name-label">Name:</span>  ${escapeHtml(String(playerName).toUpperCase())}</div>
${playerId ? `<div class="player-id">${escapeHtml(String(playerId).slice(-7))}</div>` : ''}

<div class="divider"></div>
${buyinAmount > 0 ? `<div class="fin-row"><span class="fin-label">Buy In:</span><span class="fin-value">${escapeHtml(fmtMoney(buyinAmount))}</span></div>` : ''}
${buyinFee > 0 ? `<div class="fin-row"><span class="fin-label">Entry Fee:</span><span class="fin-value">${escapeHtml(fmtMoney(buyinFee))}</span></div>` : ''}
${total > 0 ? `<div class="fin-total-row"><span class="fin-total-label">Total Buy In Amount:</span><span class="fin-total-value">${escapeHtml(fmtMoney(total))}</span></div>` : ''}

<div class="divider"></div>
<div class="seat-grid">
  <div class="seat-box">
    <div class="seat-box-label">Table</div>
    <div class="seat-box-value">${escapeHtml(tableNumber || '--')}</div>
  </div>
  <div class="seat-box">
    <div class="seat-box-label">Seat</div>
    <div class="seat-box-value">${escapeHtml(seatNumber || '--')}</div>
  </div>
</div>

<div class="received"><span class="received-label">Received By:</span>  ${escapeHtml(staffName)}</div>
<div class="received">${escapeHtml(receivedDate)}   ${escapeHtml(receivedTime)}</div>

<div class="divider"></div>
<div class="center receipt-num">${escapeHtml(receiptNum)}</div>

<div class="legal">Management reserves the right to modify, suspend, or cancel this promotion at its sole discretion and without prior notice.</div>

<div class="center copy-label">${escapeHtml(displayCopy)}</div>

</div>`;
}

/**
 * Single tournament buy-in receipt document (one copy).
 * Accepts camelCase (registration screen) or snake_case (queued payload) keys.
 *
 * @param {object} receipt
 * @param {string} copyLabel  'PLAYER COPY' | 'DEALER COPY' | 'CASHIER COPY' | any label
 * @returns {string} HTML document
 */
export function buildBuyinReceiptHtml(receipt, copyLabel) {
  const label = resolveCopyLabel(copyLabel ?? receipt?.copyLabel);
  return htmlDoc(label, BUYIN_CSS, buyinReceiptFragment(receipt, copyLabel));
}

/**
 * Several buy-in receipts (or several copies) in one document. Used by the
 * floor print station, which prints a whole queued job in one shot.
 */
export function buildBuyinReceiptsHtml(receipts, options = {}) {
  const list = Array.isArray(receipts) ? receipts : [];
  const copies = Array.isArray(options.copies) && options.copies.length > 0
    ? options.copies
    : ['CUSTOMER COPY'];
  const body = list
    .map(r => copies.map(label => buyinReceiptFragment(r, r?.copyLabel || label)).join('\n'))
    .join('\n');
  return htmlDoc(options.title || 'Buy-In Receipts', BUYIN_CSS, body);
}

/* ── Action Receipt (rebuy, add-on, payout, chip race, custom) ── */

const ACTION_CSS = `
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', monospace; margin: 0; color: #000; -webkit-print-color-adjust: exact; }
.r { width: 72mm; padding: 4mm; margin: 0 auto; page-break-after: always; border-bottom: 1px dashed #000; }
.r:last-child { page-break-after: avoid; border-bottom: none; }
.c { text-align: center; }
.b { font-weight: bold; }
.lg { font-size: 20px; }
.md { font-size: 14px; }
.sm { font-size: 11px; }
.d { border-top: 1px dashed #000; margin: 3mm 0; }
.rw { display: flex; justify-content: space-between; }
`.trim();

function actionReceiptFragment(receipt) {
  const r = receipt || {};
  const tournamentName = r.tournamentName ?? r.tournament_name ?? 'Tournament';
  const actionType = String(r.actionType ?? r.action_type ?? 'Receipt');
  const playerName = r.playerName ?? r.player_name ?? 'Player';
  const cost = r.cost ?? r.amount ?? null;
  const chips = r.chips ?? r.chips_added ?? null;
  const stampSource = r.timestamp ? new Date(r.timestamp) : new Date();
  const stamp = Number.isNaN(stampSource.getTime()) ? new Date() : stampSource;
  const costNum = Number(cost);
  const chipsNum = Number(chips);
  const extraLines = Array.isArray(r.lines) ? r.lines : [];

  return `<div class="r">
  <div class="c b md">${escapeHtml(tournamentName)}</div>
  <div class="c sm">${escapeHtml(actionType.toUpperCase())} RECEIPT</div><div class="d"></div>
  <div class="c b lg" style="margin:2mm 0">${escapeHtml(playerName)}</div><div class="d"></div>
  ${Number.isFinite(costNum) && costNum > 0 ? `<div class="rw md"><span>Cost:</span><span class="b">$${escapeHtml(costNum.toLocaleString())}</span></div>` : ''}
  ${Number.isFinite(chipsNum) && chipsNum > 0 ? `<div class="rw md"><span>Chips Added:</span><span class="b">${escapeHtml(chipsNum.toLocaleString())}</span></div>` : ''}
  ${extraLines.map(line => `<div class="rw md"><span>${escapeHtml(line?.label ?? '')}</span><span class="b">${escapeHtml(line?.value ?? line ?? '')}</span></div>`).join('')}
  <div class="d"></div>
  <div class="c sm" style="margin-top:2mm;opacity:.6">${escapeHtml(stamp.toLocaleTimeString())}</div>
  <div class="c sm" style="opacity:.4;margin-top:1mm">Smarter.Poker</div>
</div>`;
}

/**
 * Rebuy / add-on / payout / chip-race / custom card. This is the old
 * printBluetoothReceipt body, now shared.
 */
export function buildActionReceiptsHtml(receipts, options = {}) {
  const list = Array.isArray(receipts) ? receipts : [receipts].filter(Boolean);
  const title = options.title || 'Receipts';
  return htmlDoc(title, ACTION_CSS, list.map(actionReceiptFragment).join('\n'));
}

/* ── Tournament Final Results Sheet ───────────────────────────── */

const RESULTS_CSS = `
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', monospace; background: #fff; color: #000; -webkit-print-color-adjust: exact; }
.sheet { width: 72mm; padding: 5mm 4mm 8mm; margin: 0 auto; page-break-after: always; }
.sheet:last-child { page-break-after: avoid; }
.c { text-align: center; }
.b { font-weight: bold; }
.venue { text-align: center; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; line-height: 1.2; }
.venue-sub { text-align: center; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #333; margin-bottom: 2mm; }
.title { text-align: center; font-size: 13px; font-weight: bold; text-transform: uppercase; margin: 2mm 0 1mm; }
.tourn { text-align: center; font-size: 15px; font-weight: bold; margin-bottom: 1mm; }
.when { text-align: center; font-size: 11px; color: #333; margin-bottom: 2mm; }
.d { border-top: 1px dashed #000; margin: 2.5mm 0; }
.rw { display: flex; justify-content: space-between; font-size: 12px; line-height: 1.7; }
.winner { text-align: center; margin: 3mm 0; }
.winner-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
.winner-name { font-size: 20px; font-weight: bold; text-transform: uppercase; line-height: 1.15; margin-top: 1mm; }
.winner-prize { font-size: 15px; font-weight: bold; margin-top: 1mm; }
.res { display: flex; align-items: baseline; font-size: 12px; line-height: 1.8; }
.res-pos { width: 9mm; font-weight: bold; }
.res-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 2mm; }
.res-amt { font-weight: bold; text-align: right; min-width: 18mm; }
.foot { text-align: center; font-size: 10px; color: #333; margin-top: 3mm; line-height: 1.5; }
`.trim();

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  const rem100 = num % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
  const rem10 = num % 10;
  if (rem10 === 1) return `${num}st`;
  if (rem10 === 2) return `${num}nd`;
  if (rem10 === 3) return `${num}rd`;
  return `${num}th`;
}

function fmtDollars(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return '';
  return `$${Math.round(num).toLocaleString()}`;
}

function resultsSheetFragment(receipt) {
  const r = receipt || {};
  const results = Array.isArray(r.results) ? r.results : [];
  const location = [r.venue_city ?? r.venueCity, r.venue_state ?? r.venueState]
    .filter(Boolean).join(', ');
  const tournamentName = r.tournament_name ?? r.tournamentName ?? 'Tournament';
  const startedAt = r.started_at ?? r.startedAt ?? null;
  const endedAt = r.ended_at ?? r.endedAt ?? null;
  const winner = results.find(x => Number(x?.position) === 1) || null;

  // Summary rows are only printed when the value is actually known, so a
  // sheet never asserts a zero prize pool that nobody entered.
  const summaryRows = [
    ['Entries', r.total_entries, v => Number(v).toLocaleString()],
    ['Rebuys', r.total_rebuys, v => Number(v).toLocaleString()],
    ['Add-Ons', r.total_addons, v => Number(v).toLocaleString()],
    ['Prize Pool', r.prize_pool, fmtDollars],
    ['Total Paid', r.total_paid, fmtDollars],
    ['Overlay', r.overlay, fmtDollars]
  ]
    .filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(([label, value, fmt]) => `<div class="rw"><span>${escapeHtml(label)}:</span><span class="b">${escapeHtml(fmt(value))}</span></div>`)
    .join('');

  return `<div class="sheet">
  <div class="venue">${escapeHtml(r.venue_name ?? r.venueName ?? 'Poker Room')}</div>
  ${location ? `<div class="venue-sub">${escapeHtml(location)}</div>` : ''}
  <div class="title">Official Final Results</div>
  <div class="tourn">${escapeHtml(tournamentName)}</div>
  <div class="when">${escapeHtml(fmtDate(startedAt || endedAt))}${endedAt ? ` &nbsp; Ended ${escapeHtml(fmtTime(endedAt))}` : ''}</div>
  <div class="d"></div>
  ${winner ? `<div class="winner">
    <div class="winner-label">Champion</div>
    <div class="winner-name">${escapeHtml(winner.player_name || 'Player')}</div>
    ${Number(winner.amount) > 0 ? `<div class="winner-prize">${escapeHtml(fmtDollars(winner.amount))}</div>` : ''}
  </div><div class="d"></div>` : ''}
  ${results.length > 0 ? results.map(row => `<div class="res">
    <span class="res-pos">${escapeHtml(ordinal(row?.position))}</span>
    <span class="res-name">${escapeHtml(row?.player_name || 'Player')}</span>
    <span class="res-amt">${Number(row?.amount) > 0 ? escapeHtml(fmtDollars(row.amount)) : '--'}</span>
  </div>`).join('') : '<div class="c">No Finishing Order Recorded</div>'}
  ${summaryRows ? `<div class="d"></div>${summaryRows}` : ''}
  <div class="d"></div>
  <div class="foot">Printed ${escapeHtml(fmtDate(r.timestamp))} ${escapeHtml(fmtTime(r.timestamp))}</div>
  <div class="foot">Smarter.Poker</div>
</div>`;
}

/**
 * Full tournament results sheet. One `receipt` describes one tournament and
 * carries a `results` array of { position, player_name, amount }.
 *
 * @param {object|object[]} receipt
 * @param {object} [options]
 * @returns {string} HTML document
 */
export function buildResultsHtml(receipt, options = {}) {
  const list = Array.isArray(receipt) ? receipt : [receipt].filter(Boolean);
  const title = options.title
    || list[0]?.tournament_name
    || list[0]?.tournamentName
    || 'Tournament Results';
  return htmlDoc(title, RESULTS_CSS, list.map(resultsSheetFragment).join('\n'));
}

/** A payout job is a results sheet only when it carries a finishing order. */
function isResultsReceipt(receipt) {
  if (!receipt) return false;
  if (receipt.receipt_kind === 'tournament_results') return true;
  return Array.isArray(receipt.results);
}

/* ── Job Dispatcher ───────────────────────────────────────────── */

const JOB_TYPE_LABELS = {
  seat_change: 'Seat Change Cards',
  table_break: 'Seat Change Cards',
  buyin: 'Buy-In Receipts',
  rebuy: 'Rebuy Receipts',
  addon: 'Add-On Receipts',
  payout: 'Payout Receipts',
  chip_race: 'Chip Race Receipts',
  custom: 'Receipts'
};

const RESULTS_JOB_TITLE = 'Tournament Results';

/**
 * Render a queued `commander_print_jobs` row into a single print document.
 * Returns '' when the job carries no receipts.
 *
 * @param {object} job  a commander_print_jobs row
 * @returns {string} HTML document (or empty string)
 */
export function buildJobHtml(job) {
  const receipts = Array.isArray(job?.payload?.receipts) ? job.payload.receipts : [];
  if (receipts.length === 0) return '';
  const title = job?.title || JOB_TYPE_LABELS[job?.job_type] || 'Receipts';

  switch (job?.job_type) {
    case 'seat_change':
    case 'table_break':
      return buildSeatChangeCardsHtml(receipts, { title });
    case 'buyin':
      return buildBuyinReceiptsHtml(receipts, { title });
    case 'payout':
      // A payout job is either a stack of per-player payout cards (the cage
      // hands one to each finisher) or the single end-of-event results sheet.
      // Only the second shape carries a `results` array, so the two never
      // collide and the older per-player cards keep printing as before.
      if (receipts.some(isResultsReceipt)) {
        return buildResultsHtml(
          receipts.filter(isResultsReceipt),
          { title: job?.title || RESULTS_JOB_TITLE }
        );
      }
      return buildActionReceiptsHtml(
        receipts.map(r => ({ actionType: 'payout', ...r })),
        { title }
      );
    default:
      return buildActionReceiptsHtml(
        receipts.map(r => ({ actionType: job?.job_type || 'custom', ...r })),
        { title }
      );
  }
}

/* ── The one browser-side helper ──────────────────────────────── */

/**
 * Open a print window, write `html` into it, print, close.
 *
 * RETURNS FALSE when the popup was blocked (or the document could not be
 * written). Callers MUST react: the old code did `if (!pw) return;` and the
 * cards were lost with no warning and no record.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {number} [opts.delayMs]  ms to wait before print() so images load
 * @returns {boolean} true if the window opened and the print was dispatched
 */
export function printHtml(html, opts = {}) {
  if (typeof window === 'undefined') return false;
  if (!html) return false;

  let pw = null;
  try {
    pw = window.open('', '_blank', 'width=420,height=700');
  } catch (err) {
    console.warn('[receiptTemplates] window.open threw:', err?.message || err);
    return false;
  }
  if (!pw || pw.closed || typeof pw.document === 'undefined') return false;

  try {
    pw.document.open();
    pw.document.write(html);
    pw.document.close();
    if (opts.title) {
      try { pw.document.title = opts.title; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }
    const delay = Number.isFinite(Number(opts.delayMs)) ? Number(opts.delayMs) : 500;
    setTimeout(() => {
      try { pw.print(); pw.close(); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }, delay);
    return true;
  } catch (err) {
    console.warn('[receiptTemplates] print window write failed:', err?.message || err);
    try { pw.close(); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    return false;
  }
}

/**
 * Convenience used by the TD screens: print the seat-change cards for an
 * auto-break result. Returns false when nothing printed (no receipts, or the
 * popup was blocked) so the caller can warn the floor.
 */
export function printSeatChangeCards(receipts, options = {}) {
  const list = Array.isArray(receipts) ? receipts : [];
  if (list.length === 0) return false;
  return printHtml(buildSeatChangeCardsHtml(list, options), { title: options.title || 'Seat Change Cards' });
}
