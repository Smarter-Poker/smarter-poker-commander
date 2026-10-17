import { useState, useEffect } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import ArenaLedger from '../../src/components/commander/admin/ArenaLedger';
import PageHelp from '../../src/components/commander/shared/PageHelp';
import { busEmit } from '../../src/engine/EventBus';
import { supabase } from '../../src/lib/supabase';
import { getStaffSession } from '../../src/lib/commander/clientAuth';

const LEDGER_TITLE = 'Arena Ledger';
const LEDGER_SUMMARY =
  'The Immutable Live Record Of Every Table Interaction: Seats, Buy Ins, Cash Outs, Actions And Chat. It Updates In Real Time, With A Refresh Every 15 Seconds If The Live Feed Drops.';
const LEDGER_STEPS = [
  {
    title: 'Search And Filter',
    body: 'Search By Table Or Player, Or Narrow The Stream To Transactions, Gameplay Or Chat.',
    target: '[data-ledger-controls]',
  },
  {
    title: 'The Ledger Stream',
    body: 'Newest Events Arrive At The Top With Time, Table, Actor, Event And Amount. Entries Can Never Be Edited.',
    target: '.thin-scrollbar',
  },
];

export default function ArenaLedgerPage() {
  useEffect(() => { busEmit.sessionStart?.('commander-arena-ledger'); }, []);
  const [clubId, setClubId] = useState(null);

  useEffect(() => {
    try {
      const stored = getStaffSession();
      if (stored) {
        const staff = JSON.parse(stored);
        if (staff.venue_id) setClubId(staff.venue_id);
      }
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  return (
    <CommanderLayout title="Arena Ledger" backHref="/commander/dashboard">
      <SEOHead
        title="Commander - Arena Ledger"
        description="Immutable Live Audit Trail"
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <h1 className="sr-only">{LEDGER_TITLE}</h1>
        {clubId ? (
          <ArenaLedger
            clubId={clubId}
            help={<PageHelp title={LEDGER_TITLE} summary={LEDGER_SUMMARY} steps={LEDGER_STEPS} />}
          />
        ) : (
          <div className="flex items-center justify-center p-20 text-[#64748B]">
            Loading Venue Data...
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}
