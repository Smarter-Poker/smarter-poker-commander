/**
 * Tournament Director - Color Up / Chip Race Helper
 * /commander/td/[tournamentId]/color-up
 * Floor helper for racing off a denomination at a break.
 * The TD types the denomination being raced and how many of those chips each
 * player holds. The screen computes total value raced, higher-denom chips owed
 * per player, the odd-chip remainders, and the race order.
 * This assists the floor. It does not run the race.
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { busEmit } from '../../../../src/engine/EventBus';
import {
  Trophy, Users, DollarSign, LayoutGrid, Monitor, FileText,
  Loader2, RefreshCw, AlertTriangle, Layers, Printer, Plus, X, Coins,
  CheckCircle2, XCircle, Zap
} from 'lucide-react';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { getStaffData } from '../../../../src/lib/commander/clientAuth';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';

const NAV_ITEMS = [
  { key: 'control', icon: Trophy, label: 'Control', path: '' },
  { key: 'tables', icon: LayoutGrid, label: 'Tables', path: '/tables' },
  { key: 'players', icon: Users, label: 'Players', path: '/players' },
  { key: 'payouts', icon: DollarSign, label: 'Payouts', path: '/payouts' },
  { key: 'reports', icon: FileText, label: 'Reports', path: '/reports' },
  { key: 'clock', icon: Monitor, label: 'Clock', path: '/clock' },
];

const DEFAULT_DENOMS = [25, 100, 500, 1000, 5000];

// Matches the ceiling enforced by
// pages/api/tournaments/[id]/entries/[entryId]/chips.js (MAX_CHIPS).
const MAX_CHIPS = 2000000000;

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 10);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function TDColorUp() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-color-up'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;

  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [raceDenomRaw, setRaceDenomRaw] = useState('25');
  const [denomsRaw, setDenomsRaw] = useState(DEFAULT_DENOMS.map(String));
  // entry_id -> raw count string of raced-off chips held
  const [held, setHeld] = useState({});

  // ── Apply Chip Race ──
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });
  // entry_id -> { ok: boolean, message: string }
  const [applyResults, setApplyResults] = useState({});
  // entry_id -> signature of the race that was already written for that player.
  // Guards the double-subtract: once a stack is updated, floor-view refreshes
  // with the NEW current_chips, so re-sending the same race would take the
  // raced value off a second time.
  const [appliedSignature, setAppliedSignature] = useState({});
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchFloor = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      const res = await commanderFetch(
        `/api/commander/tournaments/${tournamentId}/floor-view`,
        { ...(signal ? { signal } : {}) }
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setFloor(json.data);
        setError(null);
      } else {
        setError(json.error || 'Failed To Load Tournament Data');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Failed To Load Tournament Data');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => {
    const controller = new AbortController();
    fetchFloor(controller.signal);
    return () => controller.abort();
  }, [fetchFloor]);

  const denoms = useMemo(
    () => denomsRaw.map(d => Number(d)).filter(d => Number.isFinite(d) && d > 0).sort((a, b) => a - b),
    [denomsRaw]
  );

  const raceDenom = useMemo(() => {
    const n = Number(raceDenomRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [raceDenomRaw]);

  const nextDenom = useMemo(
    () => denoms.find(d => d > raceDenom) || 0,
    [denoms, raceDenom]
  );

  const players = useMemo(() => {
    const out = [];
    (floor?.tables || []).forEach(t => {
      (t.players || []).forEach(p => out.push({ ...p, table_number: t.table_number }));
    });
    return out.sort((a, b) =>
      (a.table_number - b.table_number) || ((a.seat_number || 0) - (b.seat_number || 0))
    );
  }, [floor]);

  const rows = useMemo(() => {
    return players.map(p => {
      const raw = held[p.entry_id];
      const count = raw ? Number(raw) : 0;
      const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
      const value = safeCount * raceDenom;
      const received = nextDenom > 0 ? Math.floor(value / nextDenom) : 0;
      const remainderValue = value - (received * nextDenom);
      const remainderChips = raceDenom > 0 ? Math.round(remainderValue / raceDenom) : 0;
      return { ...p, count: safeCount, value, received, remainderValue, remainderChips };
    });
  }, [players, held, raceDenom, nextDenom]);

  const totals = useMemo(() => {
    const totalChips = rows.reduce((s, r) => s + r.count, 0);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalReceived = rows.reduce((s, r) => s + r.received, 0);
    const totalRemainderValue = rows.reduce((s, r) => s + r.remainderValue, 0);
    const chipsToAward = nextDenom > 0 ? Math.floor(totalRemainderValue / nextDenom) : 0;
    return { totalChips, totalValue, totalReceived, totalRemainderValue, chipsToAward };
  }, [rows, nextDenom]);

  const raceOrder = useMemo(
    () => rows
      .filter(r => r.remainderChips > 0)
      .sort((a, b) =>
        (b.remainderChips - a.remainderChips) ||
        (b.remainderValue - a.remainderValue) ||
        (a.table_number - b.table_number) ||
        ((a.seat_number || 0) - (b.seat_number || 0))
      ),
    [rows]
  );

  const summaryRows = useMemo(() => rows.filter(r => r.count > 0), [rows]);

  // ── Post-race stacks ────────────────────────────────────────────────────
  // The screen used to stop at "here is what everyone is owed". These rows
  // carry the actual stack each player finishes the race with, which is what
  // gets written back through the chips endpoint.
  //   post = current - (chips raced off) + (higher-denom chips handed over)
  //          + (one more chip if they win the odd-chip race)
  const raceRows = useMemo(() => {
    const winners = new Set(raceOrder.slice(0, totals.chipsToAward).map(r => r.entry_id));
    return rows.map(r => {
      const wonRaceChip = winners.has(r.entry_id);
      const delta = (r.received * nextDenom) + (wonRaceChip ? nextDenom : 0) - r.value;
      const current = Number(r.current_chips) || 0;
      return { ...r, wonRaceChip, chipDelta: delta, postRaceChips: current + delta };
    });
  }, [rows, raceOrder, totals.chipsToAward, nextDenom]);

  // Signature of one player's slice of the race. Changing the denomination or
  // that player's chip count produces a new signature, so a genuinely new race
  // is applied while the same race is never applied twice.
  const raceSignature = useCallback(
    (r) => `${raceDenom}:${nextDenom}:${r.count}:${r.wonRaceChip ? 1 : 0}`,
    [raceDenom, nextDenom]
  );

  // Only players who actually handed chips in are written back, and never the
  // same race twice for the same player.
  const applyRows = useMemo(
    () => raceRows.filter(r => r.count > 0 && appliedSignature[r.entry_id] !== raceSignature(r)),
    [raceRows, appliedSignature, raceSignature]
  );

  // Hard guards. The TD is refused, not warned, when any of these hold.
  const applyBlockers = useMemo(() => {
    const blockers = [];
    if (raceDenom <= 0) blockers.push('Enter The Denomination Being Raced Off.');
    if (nextDenom <= 0) blockers.push('Add A Higher Denomination Before Applying.');

    const seen = new Set();
    let duplicate = false;
    denoms.forEach(d => { if (seen.has(d)) duplicate = true; seen.add(d); });
    if (duplicate) blockers.push('Remove Duplicate Denominations.');

    if (raceDenom > 0 && !denoms.includes(raceDenom)) {
      blockers.push('The Raced Denomination Is Not In The Denominations In Play List.');
    }
    if (raceDenom > 0 && nextDenom > 0 && nextDenom % raceDenom !== 0) {
      blockers.push(`Denominations Are Inconsistent: ${raceDenom.toLocaleString()} Does Not Divide Evenly Into ${nextDenom.toLocaleString()}.`);
    }
    if (applyRows.length === 0) {
      blockers.push(summaryRows.length > 0
        ? 'This Race Has Already Been Applied. Change A Count Or Press Clear All To Start A New Race.'
        : 'Enter Chip Counts Before Applying.');
    }

    const negative = applyRows.filter(r => r.postRaceChips < 0);
    if (negative.length > 0) {
      blockers.push(
        `${negative.length} Player${negative.length === 1 ? '' : 's'} Would Finish With A Negative Stack: ` +
        negative.slice(0, 4).map(r => r.player_name || 'Player').join(', ') +
        (negative.length > 4 ? ', And More' : '') +
        '. Update Their Chip Counts First.'
      );
    }
    const tooBig = applyRows.filter(r => r.postRaceChips > MAX_CHIPS);
    if (tooBig.length > 0) {
      blockers.push(`${tooBig.length} Player Stack(s) Exceed The Maximum Of ${MAX_CHIPS.toLocaleString()}.`);
    }
    const notWhole = applyRows.filter(r => !Number.isInteger(r.postRaceChips));
    if (notWhole.length > 0) {
      blockers.push('Computed Stacks Must Be Whole Numbers. Check The Denominations.');
    }
    return blockers;
  }, [raceDenom, nextDenom, denoms, applyRows, summaryRows]);

  const canApply = applyBlockers.length === 0;

  // Paper record of the race for the floor: one summary card plus one card per
  // player. Rendered by buildActionReceiptsHtml at /commander/print-station.
  const queueChipRaceReceipt = async (appliedRows) => {
    let staff = {};
    try { staff = getStaffData() || {}; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    let venue = {};
    try { venue = JSON.parse(localStorage.getItem('commander_venue') || '{}') || {}; }
    catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    const venueName = staff.venue_name || venue.name || '';
    const tournamentName = floor?.tournament?.name || 'Tournament';
    const timestamp = new Date().toISOString();

    const receipts = [{
      action_type: 'Chip Race',
      tournament_name: tournamentName,
      player_name: 'Floor Summary',
      timestamp,
      lines: [
        { label: 'Venue', value: venueName || 'Poker Room' },
        { label: 'Raced Off', value: raceDenom.toLocaleString() },
        { label: 'Into', value: nextDenom.toLocaleString() },
        { label: 'Chips Raced', value: totals.totalChips.toLocaleString() },
        { label: 'Total Value', value: totals.totalValue.toLocaleString() },
        { label: 'Chips Handed Out', value: totals.totalReceived.toLocaleString() },
        { label: 'Race Chips Awarded', value: totals.chipsToAward.toLocaleString() },
        { label: 'Players Updated', value: String(appliedRows.length) }
      ]
    }];

    appliedRows.forEach(r => {
      receipts.push({
        action_type: 'Chip Race',
        tournament_name: tournamentName,
        player_name: r.player_name || 'Player',
        chips: (r.received * nextDenom) + (r.wonRaceChip ? nextDenom : 0),
        timestamp,
        lines: [
          { label: 'Seat', value: `T${r.table_number}-S${r.seat_number ?? '-'}` },
          { label: `${raceDenom.toLocaleString()} Chips In`, value: r.count.toLocaleString() },
          { label: 'Value Raced', value: r.value.toLocaleString() },
          { label: `${nextDenom.toLocaleString()} Chips Out`, value: r.received.toLocaleString() },
          { label: 'Odd Chips', value: r.remainderChips.toLocaleString() },
          { label: 'Won Race Chip', value: r.wonRaceChip ? 'Yes' : 'No' },
          { label: 'New Stack', value: r.postRaceChips.toLocaleString() }
        ]
      });
    });

    try {
      const res = await commanderFetch('/api/commander/print-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_type: 'chip_race',
          tournament_id: tournamentId,
          receipts,
          title: `Chip Race, ${raceDenom.toLocaleString()} Into ${nextDenom.toLocaleString()}`,
          source: 'td_color_up'
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        console.warn('[td/color-up] chip race print job failed:', json?.error?.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[td/color-up] chip race print job failed:', err?.message || err);
      return false;
    }
  };

  // Sequential writes: PUT is the only method the chips route accepts, and the
  // route is rate limited, so a parallel burst would 429 half the field.
  const handleApplyRace = async () => {
    if (!canApply || applying) return;
    const targets = applyRows;
    setApplying(true);
    setApplyProgress({ done: 0, total: targets.length });

    // Keep prior successes on screen (they are already excluded from targets),
    // drop prior failures so a retry reports fresh.
    const results = Object.fromEntries(
      Object.entries(applyResults).filter(([, v]) => v?.ok)
    );
    setApplyResults(results);
    const priorCount = Object.keys(results).length;
    const signatures = { ...appliedSignature };
    const applied = [];
    let failedCount = 0;

    for (const r of targets) {
      let settled = false;
      for (let attempt = 1; attempt <= 3 && !settled; attempt++) {
        try {
          const res = await commanderFetch(
            `/api/commander/tournaments/${tournamentId}/entries/${r.entry_id}/chips`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chips: r.postRaceChips })
            }
          );

          if (res.status === 429 && attempt < 3) {
            const retryAfter = Number(res.headers.get('Retry-After'));
            await sleep(Math.min(15, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000);
            continue;
          }

          const json = await res.json().catch(() => null);
          if (res.ok && json?.success) {
            results[r.entry_id] = { ok: true, message: `${r.postRaceChips.toLocaleString()} Chips` };
            signatures[r.entry_id] = raceSignature(r);
            applied.push(r);
          } else {
            results[r.entry_id] = {
              ok: false,
              message: json?.error?.message || json?.message || `Failed (${res.status})`
            };
            failedCount++;
          }
          settled = true;
        } catch (err) {
          if (attempt >= 3) {
            results[r.entry_id] = { ok: false, message: 'Network Error' };
            failedCount++;
            settled = true;
          } else {
            await sleep(500);
          }
        }
      }

      setApplyResults({ ...results });
      setAppliedSignature({ ...signatures });
      setApplyProgress({ done: Object.keys(results).length - priorCount, total: targets.length });
      await sleep(120);
    }

    let queued = false;
    if (applied.length > 0) {
      queued = await queueChipRaceReceipt(applied);
      broadcastChange('tournaments');
    }

    setApplying(false);
    setToast({
      type: failedCount === 0 ? 'success' : 'error',
      text: failedCount === 0
        ? `Chip Race Applied. ${applied.length} Stack${applied.length === 1 ? '' : 's'} Updated.${queued ? ' Receipt Queued At The Print Station.' : ''}`
        : `${applied.length} Updated, ${failedCount} Failed. Fix The Failed Rows And Re-Apply Them.`
    });

    await fetchFloor();
  };

  const handleHeld = (entryId, raw) => {
    setHeld(prev => ({ ...prev, [entryId]: digitsOnly(raw) }));
  };

  const handleDenom = (index, raw) => {
    setDenomsRaw(prev => prev.map((d, i) => (i === index ? digitsOnly(raw) : d)));
  };

  const handleRemoveDenom = (index) => {
    setDenomsRaw(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddDenom = () => {
    setDenomsRaw(prev => [...prev, '']);
  };

  const handleResetDenoms = () => {
    setDenomsRaw(DEFAULT_DENOMS.map(String));
  };

  const handleClearCounts = () => {
    setHeld({});
    setApplyResults({});
    setAppliedSignature({});
  };

  const handlePrint = () => {
    if (summaryRows.length === 0) return;
    const pw = window.open('', '_blank', 'width=760,height=900');
    if (!pw) return;
    const tName = floor?.tournament?.name || 'Tournament';
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    pw.document.write(`<!DOCTYPE html><html><head><title>Color Up Summary</title>
<style>
@page { margin: 12mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 13px; }
h1 { font-size: 20px; margin-bottom: 2mm; }
h2 { font-size: 14px; margin: 6mm 0 2mm; }
.meta { font-size: 12px; color: #444; margin-bottom: 4mm; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 2mm 3mm; text-align: left; }
th { background: #eee; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
td.num, th.num { text-align: right; }
</style></head><body>
<h1>Color Up Summary</h1>
<div class="meta">${esc(tName)}<br/>Racing Off ${raceDenom.toLocaleString()} Into ${nextDenom.toLocaleString()}<br/>${new Date().toLocaleString()}</div>
<table>
<thead><tr><th class="num">Table</th><th class="num">Seat</th><th>Player</th><th class="num">Chips Held</th><th class="num">Value</th><th class="num">Chips Received</th><th class="num">Odd Chips</th></tr></thead>
<tbody>
${summaryRows.map(r => `<tr>
<td class="num">${esc(r.table_number)}</td>
<td class="num">${esc(r.seat_number ?? '')}</td>
<td>${esc(r.player_name)}</td>
<td class="num">${r.count.toLocaleString()}</td>
<td class="num">${r.value.toLocaleString()}</td>
<td class="num">${r.received.toLocaleString()}</td>
<td class="num">${r.remainderChips.toLocaleString()}</td>
</tr>`).join('')}
</tbody>
</table>
<h2>Race Order, Highest Remainder First</h2>
<table>
<thead><tr><th class="num">Rank</th><th class="num">Table</th><th class="num">Seat</th><th>Player</th><th class="num">Odd Chips</th><th class="num">Odd Value</th></tr></thead>
<tbody>
${raceOrder.map((r, i) => `<tr>
<td class="num">${i + 1}</td>
<td class="num">${esc(r.table_number)}</td>
<td class="num">${esc(r.seat_number ?? '')}</td>
<td>${esc(r.player_name)}</td>
<td class="num">${r.remainderChips.toLocaleString()}</td>
<td class="num">${r.remainderValue.toLocaleString()}</td>
</tr>`).join('')}
</tbody>
</table>
<h2>Chips Available To Award: ${totals.chipsToAward.toLocaleString()} At ${nextDenom.toLocaleString()}</h2>
</body></html>`);
    pw.document.close();
    setTimeout(() => { pw.print(); pw.close(); }, 400);
  };

  const navigateTo = (path) => {
    const base = `/commander/td/${tournamentId}`;
    router.push(path ? `${base}${path}` : base);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
      </div>
    );
  }

  if (error || !floor) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-4">
        <div className="bg-[#242526] rounded-xl p-6 text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-[#F59E0B] mx-auto mb-3" />
          <p className="text-[#E4E6EB] text-lg mb-4">{error || 'Tournament Not Found'}</p>
          <button onClick={() => navigateTo('')}
            className="px-6 py-3 bg-[#1877F2] text-white rounded-lg text-base font-medium">
            Back To Control Center
          </button>
        </div>
      </div>
    );
  }

  return (
    <CommanderLayout title="Commander - Color Up" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Color Up"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-24 font-['Inter']">

        {/* ===== HEADER ===== */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Color Up Helper</h1>
            <p className="text-xs text-[#B0B3B8]">
              {players.length} Player{players.length === 1 ? '' : 's'} Live, Floor Helper Only
            </p>
          </div>
          <button onClick={() => fetchFloor()} className="p-2 rounded-lg active:bg-[#3A3B3C]" title="Refresh">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== RACE SETUP ===== */}
        <div className="px-4 pt-3 space-y-3">
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Denomination Being Raced Off
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={raceDenomRaw}
              onChange={e => setRaceDenomRaw(digitsOnly(e.target.value))}
              onFocus={e => e.target.select()}
              aria-label="Denomination Being Raced Off"
              className="w-full h-14 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-4 text-2xl font-bold text-white focus:outline-none focus:border-[#1877F2]"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[#B0B3B8]">Next Denomination Up</span>
              <span className={`text-sm font-bold ${nextDenom > 0 ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>
                {nextDenom > 0 ? nextDenom.toLocaleString() : 'None Available'}
              </span>
            </div>
            {nextDenom === 0 && (
              <p className="mt-2 text-xs text-[#EF4444]">
                Add A Higher Denomination To The List Below Before Racing.
              </p>
            )}
          </div>

          {/* ===== DENOMINATIONS IN PLAY ===== */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Denominations In Play
              </span>
              <button onClick={handleResetDenoms}
                className="text-xs text-[#1877F2] font-semibold px-2 py-1 rounded-lg active:bg-[#3A3B3C]">
                Reset
              </button>
            </div>
            <div className="space-y-2">
              {denomsRaw.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={d}
                    onChange={e => handleDenom(i, e.target.value)}
                    onFocus={e => e.target.select()}
                    aria-label={`Denomination ${i + 1}`}
                    className="flex-1 h-12 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-4 text-base font-semibold text-white focus:outline-none focus:border-[#1877F2]"
                  />
                  <button onClick={() => handleRemoveDenom(i)}
                    className="w-12 h-12 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] flex-shrink-0"
                    title="Remove Denomination">
                    <X className="w-4 h-4 text-[#EF4444]" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={handleAddDenom}
              className="mt-3 w-full h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C]">
              <Plus className="w-4 h-4" /> Add Denomination
            </button>
          </div>

          {/* ===== RACE TOTALS ===== */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Race Totals
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold text-white">{totals.totalChips.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips Being Raced</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{totals.totalValue.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Total Value Raced</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#31A24C]">{totals.totalReceived.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips Handed Out</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#F59E0B]">{totals.chipsToAward.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips To Award By Race</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#3A3B3C] flex items-center justify-between">
              <span className="text-xs text-[#B0B3B8]">Total Odd Chip Value</span>
              <span className="text-sm font-bold text-white">{totals.totalRemainderValue.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ===== PLAYER ENTRY ===== */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
              Chips Held Per Player
            </h2>
            <button onClick={handleClearCounts}
              className="text-xs text-[#1877F2] font-semibold px-2 py-1 rounded-lg active:bg-[#3A3B3C]">
              Clear All
            </button>
          </div>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] divide-y divide-[#3A3B3C] overflow-hidden">
            {raceRows.map(r => (
              <div key={r.entry_id} className="px-4 py-3 flex items-center gap-3">
                <span className="w-14 text-[11px] text-[#B0B3B8] font-mono flex-shrink-0">
                  T{r.table_number}-S{r.seat_number ?? '-'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#E4E6EB] truncate">{r.player_name}</p>
                  <p className="text-[11px] text-[#B0B3B8]">
                    Value {r.value.toLocaleString()}, Receives {r.received.toLocaleString()}, Odd {r.remainderChips.toLocaleString()}
                  </p>
                  {/* Hidden once this player's slice of the race is written:
                      current_chips has moved, so recomputing would show a
                      second subtraction that will never happen. */}
                  {r.count > 0 && appliedSignature[r.entry_id] !== raceSignature(r) && (
                    <p className={`text-[11px] font-semibold ${r.postRaceChips < 0 ? 'text-[#EF4444]' : 'text-[#31A24C]'}`}>
                      New Stack {r.postRaceChips.toLocaleString()}
                      {r.wonRaceChip ? ', Wins Race Chip' : ''}
                    </p>
                  )}
                  {applyResults[r.entry_id] && (
                    <p className={`text-[11px] font-semibold flex items-center gap-1 ${applyResults[r.entry_id].ok ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>
                      {applyResults[r.entry_id].ok
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <XCircle className="w-3 h-3" />}
                      {applyResults[r.entry_id].message}
                    </p>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={held[r.entry_id] ?? ''}
                  placeholder="0"
                  onChange={e => handleHeld(r.entry_id, e.target.value)}
                  onFocus={e => e.target.select()}
                  aria-label={`Raced Chips Held By ${r.player_name}`}
                  className="w-24 h-14 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-3 text-right text-xl font-bold text-white placeholder-[#B0B3B8]/40 focus:outline-none focus:border-[#1877F2] flex-shrink-0"
                />
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[#B0B3B8]">No Live Players</div>
            )}
          </div>
        </div>

        {/* ===== RACE ORDER ===== */}
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Race Order, Highest Remainder First
          </h2>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <p className="text-xs text-[#B0B3B8] mb-3">
              {totals.chipsToAward.toLocaleString()} Chip{totals.chipsToAward === 1 ? '' : 's'} At {nextDenom > 0 ? nextDenom.toLocaleString() : '--'} Available To Award. One Chip Per Player Down The List.
            </p>
            <div className="divide-y divide-[#3A3B3C]">
              {raceOrder.map((r, i) => (
                <div key={r.entry_id} className="py-2.5 flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i < totals.chipsToAward
                    ? 'bg-[#31A24C]/20 text-[#31A24C]'
                    : 'bg-[#3A3B3C] text-[#B0B3B8]'
                    }`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#E4E6EB] truncate">{r.player_name}</p>
                    <p className="text-[11px] text-[#B0B3B8] font-mono">T{r.table_number}-S{r.seat_number ?? '-'}</p>
                  </div>
                  <span className="text-sm font-bold text-[#F59E0B] flex-shrink-0">
                    {r.remainderChips.toLocaleString()} Odd
                  </span>
                </div>
              ))}
              {raceOrder.length === 0 && (
                <p className="py-4 text-center text-sm text-[#B0B3B8]">No Odd Chips To Race</p>
              )}
            </div>
          </div>
        </div>

        {/* ===== APPLY CHIP RACE ===== */}
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Apply Chip Race
          </h2>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <p className="text-xs text-[#B0B3B8] mb-3">
              Writes Each Player&apos;s Post-Race Stack Back To The Tournament And Queues A Paper Record At The Print Station.
            </p>

            {applyBlockers.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {applyBlockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-[#EF4444] leading-snug">{b}</span>
                  </div>
                ))}
              </div>
            )}

            {applying && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-[11px] text-[#B0B3B8] mb-1.5">
                  <span>Updating Stacks</span>
                  <span className="font-mono">{applyProgress.done} / {applyProgress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-[#3A3B3C] overflow-hidden">
                  <div className="h-full bg-[#1877F2] transition-all"
                    style={{ width: `${applyProgress.total > 0 ? Math.round((applyProgress.done / applyProgress.total) * 100) : 0}%` }} />
                </div>
              </div>
            )}

            <button
              onClick={() => setShowApplyConfirm(true)}
              disabled={!canApply || applying}
              className="w-full h-14 rounded-xl bg-[#31A24C] text-white text-base font-bold flex items-center justify-center gap-2 active:bg-[#28883F] disabled:opacity-40 disabled:active:bg-[#31A24C]"
            >
              {applying
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Applying Chip Race...</>
                : <><Zap className="w-5 h-5" /> Apply Chip Race ({applyRows.length} Player{applyRows.length === 1 ? '' : 's'})</>
              }
            </button>
          </div>
        </div>

        {/* ===== PRINT / DISPLAY SUMMARY ===== */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
              Print / Display Summary
            </h2>
            <button onClick={handlePrint} disabled={summaryRows.length === 0}
              className="px-3 h-9 rounded-lg bg-[#1877F2] text-white text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-40">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <p className="text-sm font-bold text-white">{floor.tournament?.name}</p>
            <p className="text-xs text-[#B0B3B8] mb-3">
              Racing Off {raceDenom.toLocaleString()} Into {nextDenom > 0 ? nextDenom.toLocaleString() : '--'}
            </p>
            <div className="grid grid-cols-[2.5rem_2.5rem_1fr_4.5rem] gap-x-2 gap-y-1.5 text-xs">
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Table</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Seat</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Name</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider text-right">Received</span>
              {summaryRows.map(r => (
                <div key={r.entry_id} className="contents">
                  <span className="text-[#E4E6EB] font-mono">{r.table_number}</span>
                  <span className="text-[#E4E6EB] font-mono">{r.seat_number ?? '-'}</span>
                  <span className="text-[#E4E6EB] truncate">{r.player_name}</span>
                  <span className="text-[#31A24C] font-bold text-right">{r.received.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {summaryRows.length === 0 && (
              <p className="text-sm text-[#B0B3B8] text-center py-4">Enter Chip Counts To Build The Summary</p>
            )}
          </div>
        </div>

        {/* ===== APPLY CONFIRMATION ===== */}
        {showApplyConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center px-4"
            onClick={() => setShowApplyConfirm(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 border border-[#3A3B3C]"
              onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center bg-[#31A24C]/20">
                  <Zap className="w-7 h-7 text-[#31A24C]" />
                </div>
                <h3 className="text-lg font-bold text-white">Apply Chip Race?</h3>
                <p className="text-sm text-[#B0B3B8] mt-1">
                  {applyRows.length} Player{applyRows.length === 1 ? '' : 's'} Will Have Their Stack Overwritten With The Post-Race Total.
                  Racing Off {raceDenom.toLocaleString()} Into {nextDenom.toLocaleString()}. This Cannot Be Undone Automatically.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowApplyConfirm(false)}
                  className="flex-1 h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">
                  Cancel
                </button>
                <button
                  onClick={async () => { setShowApplyConfirm(false); await handleApplyRace(); }}
                  className="flex-1 h-12 rounded-xl bg-[#31A24C] text-white font-bold active:opacity-80">
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== TOAST ===== */}
        {toast && (
          <div style={{
            position: 'fixed', bottom: 88, left: 16, right: 16, zIndex: 70,
            padding: '12px 16px', borderRadius: 12,
            background: toast.type === 'success' ? '#31A24C' : '#EF4444',
            color: '#fff', fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', gap: 8,
            maxWidth: 560, marginLeft: 'auto', marginRight: 'auto',
          }}>
            <span style={{ flex: 1 }}>{toast.text}</span>
            <button onClick={() => setToast(null)} style={{
              background: 'none', border: 'none', color: '#fff',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
            }} aria-label="Dismiss">&times;</button>
          </div>
        )}

        {/* ===== BOTTOM NAV BAR ===== */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
          <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.key} onClick={() => navigateTo(item.path)}
                  className="flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg text-[#B0B3B8] active:text-[#E4E6EB]">
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </CommanderLayout>
  );
}
