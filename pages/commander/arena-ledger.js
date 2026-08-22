import { useState, useEffect } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import ArenaLedger from '../../src/components/commander/admin/ArenaLedger';
import { busEmit } from '../../src/engine/EventBus';
import { supabase } from '../../src/lib/supabase';
import { getStaffSession } from '../../src/lib/commander/clientAuth';

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
        {clubId ? (
          <ArenaLedger clubId={clubId} />
        ) : (
          <div className="flex items-center justify-center p-20 text-[#64748B]">
            Loading Venue Data...
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}
