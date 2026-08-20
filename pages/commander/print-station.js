/**
 * Floor Print Station
 * /commander/print-station
 *
 * Park this on the tablet or PC sitting next to the receipt printer.
 *
 * WHY IT EXISTS
 * -------------
 * Seat change cards used to print only on the device that performed the break,
 * via window.open() guarded by `if (!pw) return;`. When the popup was blocked,
 * or when the break came from a table tablet or a background level advance, the
 * players were already moved and NOBODY got a card. There was no reprint and no
 * record that a card was owed.
 *
 * Now every break writes a row to commander_print_jobs. This page watches that
 * queue over Supabase Realtime (plus a 15s poll), and with Auto Print on it
 * claims, prints and closes each job the moment it lands. A blocked popup is
 * the one failure mode that matters, so it is handled explicitly: the job goes
 * straight back to `queued` with an error and a red banner tells the floor to
 * allow popups. Cards are never silently lost.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';
import {
  Printer, RefreshCw, Check, X, RotateCcw, AlertTriangle,
  Loader2, Bell, Layers, Zap, ZapOff
} from 'lucide-react';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import { getVenueId } from '../../src/lib/commander/clientAuth';
import { buildJobHtml, printHtml } from '../../src/lib/commander/receiptTemplates';
import { busEmit } from '../../src/engine/EventBus';

/* ─── Realtime client (never constructed during SSG) ─────────── */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const supabase = (typeof window !== 'undefined' && supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const POLL_INTERVAL = 15000;
const AUTO_PRINT_KEY = 'commander_print_station_autoprint';

const JOB_TYPE_LABELS = {
  seat_change: 'Seat Change',
  table_break: 'Table Break',
  buyin: 'Buy-In',
  rebuy: 'Rebuy',
  addon: 'Add-On',
  payout: 'Payout',
  chip_race: 'Chip Race',
  custom: 'Custom'
};

const JOB_TYPE_COLORS = {
  seat_change: '#1877F2',
  table_break: '#1877F2',
  buyin: '#31A24C',
  rebuy: '#F59E0B',
  addon: '#F59E0B',
  payout: '#31A24C',
  chip_race: '#F59E0B',
  custom: '#B0B3B8'
};

const STATUS_COLORS = {
  queued: '#F59E0B',
  printing: '#1877F2',
  printed: '#31A24C',
  voided: '#EF4444'
};

function formatAge(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return 'Just Now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} Minute${mins === 1 ? '' : 's'} Ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} Hour${hours === 1 ? '' : 's'} Ago`;
  const days = Math.round(hours / 24);
  return `${days} Day${days === 1 ? '' : 's'} Ago`;
}

function titleFor(job) {
  if (job?.title) return job.title;
  const type = JOB_TYPE_LABELS[job?.job_type] || 'Receipts';
  const count = Number(job?.receipt_count) || 0;
  return `${type}, ${count.toLocaleString()} Receipt${count === 1 ? '' : 's'}`;
}

export default function PrintStation() {
  useEffect(() => { busEmit.sessionStart('commander-print-station'); }, []);

  const [venueId, setVenueId] = useState(null);
  const [queued, setQueued] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('queue');
  const [toast, setToast] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [flash, setFlash] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  // Jobs already handed to the auto-printer. Without this, a job that is still
  // mid-print when the next poll lands would be claimed and printed twice.
  const attemptedRef = useRef(new Set());
  const autoBusyRef = useRef(false);
  const seenRef = useRef(new Set());
  const seededRef = useRef(false);
  const autoPrintRef = useRef(false);
  const popupBlockedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => { autoPrintRef.current = autoPrint; }, [autoPrint]);
  useEffect(() => { popupBlockedRef.current = popupBlocked; }, [popupBlocked]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ─── Mount: venue + saved Auto Print preference ───────────── */
  useEffect(() => {
    try { setVenueId(getVenueId()); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    try {
      setAutoPrint(localStorage.getItem(AUTO_PRINT_KEY) === 'on');
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  /* ─── Toast auto-dismiss ───────────────────────────────────── */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ─── "New Cards" flash auto-dismiss ───────────────────────── */
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 8000);
    return () => clearTimeout(t);
  }, [flash]);

  /* ─── Re-render once a minute so the ages stay honest ──────── */
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  /* ─── Keep the screen awake: this tablet is unattended ─────── */
  useEffect(() => {
    let wakeLock = null;
    const request = async () => {
      try {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    };
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (wakeLock) wakeLock.release().catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    };
  }, []);

  /* ─── Load the queue ───────────────────────────────────────── */
  const fetchJobs = useCallback(async (signal) => {
    const opts = signal ? { signal } : {};
    try {
      const [queuedRes, allRes] = await Promise.all([
        commanderFetch('/api/commander/print-jobs?status=queued&limit=100', opts),
        commanderFetch('/api/commander/print-jobs?limit=40', opts)
      ]);

      const queuedJson = await queuedRes.json().catch(() => null);
      const allJson = await allRes.json().catch(() => null);

      if (queuedJson?.success) {
        const jobs = Array.isArray(queuedJson.data?.jobs) ? queuedJson.data.jobs : [];
        setQueued(jobs);

        // Flag genuinely new arrivals. The first load only seeds the set, so
        // opening the page on a backlog does not scream "New Cards".
        if (!seededRef.current) {
          jobs.forEach(j => seenRef.current.add(j.id));
          seededRef.current = true;
        } else {
          const fresh = jobs.filter(j => !seenRef.current.has(j.id));
          fresh.forEach(j => seenRef.current.add(j.id));
          if (fresh.length > 0) {
            setFlash({
              count: fresh.reduce((sum, j) => sum + (Number(j.receipt_count) || 0), 0),
              label: titleFor(fresh[0])
            });
            try { busEmit.screenShake('light'); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
          }
        }
      } else if (queuedJson?.error) {
        setToast({ type: 'error', text: queuedJson.error.message || 'Could Not Read The Print Queue.' });
      }

      if (allJson?.success) {
        const jobs = Array.isArray(allJson.data?.jobs) ? allJson.data.jobs : [];
        setRecent(jobs.filter(j => j.status !== 'queued'));
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[print-station] fetch failed:', err?.message || err);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchJobs(controller.signal);
    const poll = setInterval(() => fetchJobs(controller.signal), POLL_INTERVAL);
    return () => { controller.abort(); clearInterval(poll); };
  }, [fetchJobs]);

  /* ─── Supabase Realtime on commander_print_jobs ────────────── */
  useEffect(() => {
    if (!supabase || !venueId) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      const channel = supabase
        .channel(`print-station-${venueId}-${Date.now()}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'commander_print_jobs',
          filter: `venue_id=eq.${venueId}`
        }, () => fetchJobs())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnects = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[print-station] Realtime channel error: ${status}`);
            if (reconnects < MAX_RECONNECT) {
              reconnects++;
              setTimeout(connectChannel, 3000 * reconnects);
            }
          }
        });
      currentChannel = channel;
    }

    connectChannel();
    return () => { if (currentChannel) supabase.removeChannel(currentChannel); };
  }, [venueId, fetchJobs]);

  /* ─── Job state transitions ────────────────────────────────── */
  const act = useCallback(async (jobId, action, extra = {}) => {
    try {
      const res = await commanderFetch(`/api/commander/print-jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        return { ok: false, message: json?.error?.message || 'Print Queue Action Failed.' };
      }
      return { ok: true, job: json.data?.job || null };
    } catch (err) {
      console.warn('[print-station] action failed:', err?.message || err);
      return { ok: false, message: 'Print Queue Action Failed. Check The Network.' };
    }
  }, []);

  /**
   * Claim, render, print, close out. Returns false when nothing reached paper.
   * A blocked popup requeues the job so the cards stay owed rather than lost.
   */
  const printJob = useCallback(async (job, { silent = false } = {}) => {
    const html = buildJobHtml(job);
    if (!html) {
      if (!silent) setToast({ type: 'error', text: 'This Job Has No Receipts To Print.' });
      return false;
    }

    let status = job.status;

    if (status === 'queued') {
      const claim = await act(job.id, 'claim');
      if (!claim.ok) {
        // Another station already took it, or it was voided. Not an error.
        if (!silent) setToast({ type: 'error', text: claim.message });
        await fetchJobs();
        return false;
      }
      status = 'printing';
    }

    const printed = printHtml(html, { title: titleFor(job) });

    if (!printed) {
      setPopupBlocked(true);
      await act(job.id, 'requeue', { error: 'Popup Blocked On The Print Station' });
      setToast({ type: 'error', text: 'Popup Blocked. The Job Was Put Back In The Queue.' });
      await fetchJobs();
      return false;
    }

    if (status === 'printing') {
      const done = await act(job.id, 'printed');
      if (!done.ok && !silent) setToast({ type: 'error', text: done.message });
    }

    await fetchJobs();
    return true;
  }, [act, fetchJobs]);

  /* ─── Auto Print ───────────────────────────────────────────── */
  useEffect(() => {
    if (!autoPrint || popupBlocked) return;
    if (queued.length === 0) return;
    if (autoBusyRef.current) return;

    autoBusyRef.current = true;

    (async () => {
      // Oldest first: the floor hands out cards in the order the breaks happened.
      // The batch captured here is drained to the end. Deliberately NOT aborted
      // on effect cleanup: printJob refreshes the queue, which re-runs this
      // effect, and bailing out there would leave the rest of a multi-job break
      // sitting unprinted until the next poll.
      const ordered = [...queued].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      for (const job of ordered) {
        if (!mountedRef.current || popupBlockedRef.current || !autoPrintRef.current) break;
        if (attemptedRef.current.has(job.id)) continue;
        attemptedRef.current.add(job.id);
        const ok = await printJob(job, { silent: true });
        if (!ok) break; // popup blocked or claim lost: stop and let the floor look
        // Give the browser a beat between print windows.
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      autoBusyRef.current = false;
    })();
  }, [autoPrint, popupBlocked, queued, printJob]);

  const toggleAutoPrint = () => {
    const next = !autoPrint;
    setAutoPrint(next);
    try { localStorage.setItem(AUTO_PRINT_KEY, next ? 'on' : 'off'); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    if (next) {
      // Turning it back on retries anything that was skipped.
      attemptedRef.current = new Set();
      setPopupBlocked(false);
    }
  };

  const resumeAfterPopupFix = () => {
    setPopupBlocked(false);
    attemptedRef.current = new Set();
    setToast({ type: 'success', text: 'Auto Print Resumed.' });
  };

  const runAction = async (job, action) => {
    setBusyId(`${job.id}-${action}`);
    try {
      if (action === 'print') {
        await printJob(job);
        return;
      }
      const result = await act(job.id, action);
      if (result.ok) {
        const msg = {
          printed: 'Marked As Printed.',
          void: 'Job Voided.',
          reprint: 'Reprint Queued.',
          requeue: 'Job Put Back In The Queue.'
        }[action] || 'Done.';
        setToast({ type: 'success', text: msg });
      } else {
        setToast({ type: 'error', text: result.message });
      }
      await fetchJobs();
    } finally {
      setBusyId(null);
    }
  };

  const manualRefresh = () => { setRefreshing(true); fetchJobs(); };

  const totalCards = queued.reduce((sum, j) => sum + (Number(j.receipt_count) || 0), 0);
  const list = tab === 'queue' ? queued : recent;

  /* ─── Render ───────────────────────────────────────────────── */

  const renderJob = (job) => {
    const typeColor = JOB_TYPE_COLORS[job.job_type] || '#B0B3B8';
    const statusColor = STATUS_COLORS[job.status] || '#B0B3B8';
    const count = Number(job.receipt_count) || 0;
    const isQueued = job.status === 'queued';

    return (
      <div
        key={job.id}
        className={`bg-[#242526] border rounded-xl p-4 ${isQueued ? 'border-[#F59E0B]/50' : 'border-[#3A3B3C]'}`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${typeColor}22`, border: `1px solid ${typeColor}55` }}
          >
            <Printer className="w-5 h-5" style={{ color: typeColor }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg"
                style={{ background: `${typeColor}22`, color: typeColor }}
              >
                {JOB_TYPE_LABELS[job.job_type] || 'Receipts'}
              </span>
              <span
                className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg"
                style={{ background: `${statusColor}22`, color: statusColor }}
              >
                {String(job.status || '').replace(/^./, c => c.toUpperCase())}
              </span>
              {job.table_number !== null && job.table_number !== undefined && (
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg bg-[#3A3B3C] text-[#E4E6EB]">
                  Table {job.table_number}
                </span>
              )}
            </div>

            <p className="text-[15px] font-bold text-white leading-snug break-words">{titleFor(job)}</p>

            <p className="text-xs text-[#B0B3B8] mt-1">
              {count.toLocaleString()} Card{count === 1 ? '' : 's'}
              {' '}&middot;{' '}{formatAge(job.created_at)}
              {job.source ? ` · ${String(job.source).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}` : ''}
            </p>

            {job.error && (
              <p className="text-xs text-[#EF4444] mt-1 font-semibold">{job.error}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => runAction(job, 'print')}
            disabled={busyId === `${job.id}-print`}
            className="flex-1 min-w-[110px] min-h-[44px] rounded-xl bg-[#1877F2] text-white text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            {busyId === `${job.id}-print`
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Printer className="w-4 h-4" />}
            Print
          </button>

          {(job.status === 'queued' || job.status === 'printing') && (
            <>
              <button
                onClick={() => runAction(job, 'printed')}
                disabled={busyId === `${job.id}-printed`}
                className="flex-1 min-w-[110px] min-h-[44px] rounded-xl bg-[#31A24C]/15 border border-[#31A24C]/40 text-[#31A24C] text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> Mark Printed
              </button>
              <button
                onClick={() => runAction(job, 'void')}
                disabled={busyId === `${job.id}-void`}
                className="flex-1 min-w-[90px] min-h-[44px] rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Void
              </button>
            </>
          )}

          <button
            onClick={() => runAction(job, 'reprint')}
            disabled={busyId === `${job.id}-reprint`}
            className="flex-1 min-w-[100px] min-h-[44px] rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" /> Reprint
          </button>
        </div>
      </div>
    );
  };

  return (
    <CommanderLayout title="Print Station" backHref="/commander/dashboard">
      <>
        <SEOHead
          title="Commander - Print Station"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        </Head>

        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

          {/* Header */}
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Printer className="w-5 h-5 text-[#1877F2]" /> Print Station
              </h1>
              <p className="text-xs text-[#B0B3B8]">
                {queued.length.toLocaleString()} Job{queued.length === 1 ? '' : 's'} Waiting
                {' '}&middot;{' '}{totalCards.toLocaleString()} Card{totalCards === 1 ? '' : 's'}
              </p>
            </div>
            <button
              onClick={manualRefresh}
              className="w-11 h-11 rounded-xl flex items-center justify-center active:bg-[#3A3B3C] active:scale-[0.98]"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-[#B0B3B8] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="p-4 space-y-3">

            {/* Popup blocked: the one failure that loses paper */}
            {popupBlocked && (
              <div className="bg-[#EF4444]/15 border border-[#EF4444] rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-[#EF4444] shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[#EF4444]">Popups Are Blocked. Cards Cannot Print.</p>
                    <p className="text-xs text-[#E4E6EB] mt-1">
                      Allow Popups For This Site In The Browser Address Bar, Then Resume.
                      Nothing Was Lost, Every Job Is Still In The Queue.
                    </p>
                    <button
                      onClick={resumeAfterPopupFix}
                      className="mt-3 min-h-[44px] px-4 rounded-xl bg-[#EF4444] text-white text-sm font-bold active:scale-[0.98]"
                    >
                      I Allowed Popups, Resume
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* New cards indicator */}
            {flash && (
              <div className="bg-[#31A24C]/15 border border-[#31A24C] rounded-xl p-4 flex items-center gap-3 animate-pulse">
                <Bell className="w-6 h-6 text-[#31A24C] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#31A24C]">
                    New Cards, {Number(flash.count || 0).toLocaleString()} To Collect
                  </p>
                  <p className="text-xs text-[#B0B3B8] truncate">{flash.label}</p>
                </div>
              </div>
            )}

            {/* Auto print toggle */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Auto Print</p>
                <p className="text-xs text-[#B0B3B8] mt-0.5">
                  {autoPrint
                    ? 'New Jobs Print The Moment They Arrive.'
                    : 'Jobs Wait Here Until You Tap Print.'}
                </p>
              </div>
              <button
                onClick={toggleAutoPrint}
                className={`min-h-[44px] px-4 rounded-xl text-sm font-bold flex items-center gap-2 active:scale-[0.98] ${
                  autoPrint
                    ? 'bg-[#31A24C] text-white'
                    : 'bg-[#3A3B3C] text-[#B0B3B8]'
                }`}
              >
                {autoPrint ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
                {autoPrint ? 'On' : 'Off'}
              </button>
            </div>

            {/* Toast */}
            {toast && (
              <div
                className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
                  toast.type === 'success'
                    ? 'bg-[#31A24C]/15 text-[#31A24C] border border-[#31A24C]/40'
                    : 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/40'
                }`}
              >
                {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {toast.text}
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2">
              {[
                { key: 'queue', label: `Queue (${queued.length.toLocaleString()})` },
                { key: 'recent', label: 'Recent' }
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold active:scale-[0.98] ${
                    tab === t.key
                      ? 'bg-[#1877F2] text-white'
                      : 'bg-[#242526] border border-[#3A3B3C] text-[#B0B3B8]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* List */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
              </div>
            ) : list.length === 0 ? (
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-8 text-center">
                <Layers className="w-10 h-10 text-[#3A3B3C] mx-auto mb-3" />
                <p className="text-base font-bold text-white">
                  {tab === 'queue' ? 'No Cards Waiting.' : 'Nothing Printed Yet.'}
                </p>
                <p className="text-sm text-[#B0B3B8] mt-2 leading-relaxed">
                  {tab === 'queue'
                    ? 'Seat Change Cards Will Appear Here Automatically When A Table Breaks.'
                    : 'Printed And Voided Jobs From This Venue Show Up Here.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-tick={nowTick}>
                {list.map(renderJob)}
              </div>
            )}

          </div>
        </div>
      </>
    </CommanderLayout>
  );
}
