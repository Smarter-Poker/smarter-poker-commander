/**
 * Table Assignments - Floor Manager Control Center
 * /commander/table-assignments
 *
 * Each physical table gets assigned to:
 *   - Inactive (table not in use)
 *   - Cash Game (game type + stakes)
 *   - Tournament (linked to active tournament)
 *
 * Pulls real tables from commander_tables + commander_games JOIN.
 * Uses x-staff-session header for Commander PIN auth.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  Loader2, RefreshCw, Table2, Trophy, DollarSign,
  Power, X, Check, AlertTriangle, Users
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession, getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const MODE_COLORS = {
  inactive: { bg: '#3A3B3C', border: '#4A4B4C', text: '#B0B3B8', label: 'Inactive', icon: Power },
  cash: { bg: '#31A24C', border: '#28883F', text: '#fff', label: 'Cash Game', icon: DollarSign },
  tournament: { bg: '#F59E0B', border: '#D97706', text: '#fff', label: 'Tournament', icon: Trophy }
};

export default function TableAssignments() {
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-table-assignments'); }, []);
  const router = useRouter();
  const [tables, setTables] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Assignment modal state
  const [selectedTable, setSelectedTable] = useState(null);
  const [assignMode, setAssignMode] = useState('inactive');
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(null);

  // Filter
  const [filterMode, setFilterMode] = useState('all');

  const getHeaders = () => {
return {
      'Content-Type': 'application/json'
    };
  };

  const fetchData = useCallback(async(signal) => {
    try {
      const res = await commanderFetch('/api/commander/table-assignments', { headers: getHeaders() });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setTables(json.data.tables || []);
        setTournaments(json.data.tournaments || []);
      } else {
        const errMsg = typeof json.error === 'object' ? json.error.message : (json.error || 'Failed to load tables');
        setError(errMsg);
      }
    } catch (err) {
      console.warn(err);
      setError('Failed to load table data');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {    const _c = new AbortController();

    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    fetchData();
    return () => _c.abort();
  }, [fetchData, router]);

  // Commander Data Bus - sync when tables are changed from other tabs
  const venueId = (() => { try { return getStaffData().venue_id || ''; } catch { return ''; } })();
  useCommanderSync(venueId, fetchData, { entities: ['tables'] });

  const openAssign = (table) => {
    setSelectedTable(table);
    setAssignMode(table.mode || 'inactive');
    setSelectedTournament(table.tournament_id || null);
    setError(null);
  };

  const saveAssignment = async () => {
    if (!selectedTable) return;
    setSaving(true);
    setError(null);
    try {
      const body = { table_id: selectedTable.id, mode: assignMode };
      if (assignMode === 'tournament' && selectedTournament) {
        body.tournament_id = selectedTournament;
      }

      const res = await commanderFetch('/api/commander/table-assignments', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        broadcastChange('tables');
        setSuccess(`Table ${selectedTable.table_number} → ${assignMode === 'inactive' ? 'Inactive' : assignMode === 'cash' ? 'Cash Game' : 'Tournament'}`);
        setTimeout(() => setSuccess(null), 3000);
        setSelectedTable(null);
        await fetchData();
      } else {
        const errMsg = typeof json.error === 'object' ? json.error.message : (json.error || 'Failed to save assignment');
        setError(errMsg);
      }
    } catch (err) {
      console.warn(err);
      setError('Failed to save assignment');
    }
    finally { setSaving(false); }
  };

  const closeTable = async (table) => {
    // Safety check: warn if players are still seated
    if ((table.active_players || 0) > 0) {
      const confirmed = confirm(`Table ${table.table_number} has ${table.active_players} player${table.active_players !== 1 ? 's' : ''} seated. Close anyway?`);
      if (!confirmed) return;
    }
    setClosing(table.id);
    try {
      const res = await commanderFetch('/api/commander/table-assignments', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ table_id: table.id })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        broadcastChange('tables');
        setSuccess(`Table ${table.table_number} closed`);
        setTimeout(() => setSuccess(null), 3000);
        await fetchData();
      }
    } catch (err) { console.warn(err); setError('Action failed. Please check your connection and try again.'); }
    finally { setClosing(null); }
  };

  // Stats
  const activeCash = tables.filter(t => t.mode === 'cash').length;
  const activeTournament = tables.filter(t => t.mode === 'tournament').length;
  const inactive = tables.filter(t => t.mode === 'inactive' || !t.mode).length;
  const totalPlayers = tables.reduce((s, t) => s + (t.active_players || 0), 0);

  // Filter
  const filteredTables = filterMode === 'all'
    ? tables
    : tables.filter(t => (t.mode || 'inactive') === filterMode);

  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
    </div>
  );

  return (
    <CommanderLayout title="Table Assignments" backHref="/commander/dashboard?card=floor">
      <SEOHead
        title="Commander - Table Assignments"
        description="Assign tables to cash games or tournaments."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Table Assignments</h1>
            <p className="text-xs text-[#B0B3B8]">Assign Tables To Cash Games Or Tournaments</p>
          </div>
          <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* Success/Error toast */}
        {success && (
          <div className="mx-4 mt-3 p-3 bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl flex items-center gap-2">
            <Check className="w-4 h-4 text-[#31A24C] flex-shrink-0" />
            <span className="text-xs text-[#31A24C] font-medium">{success}</span>
          </div>
        )}
        {error && !selectedTable && (
          <div className="mx-4 mt-3 p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
            <span className="text-xs text-[#EF4444] font-medium">{error}</span>
          </div>
        )}

        {/* Summary bar */}
        <div className="px-4 py-3 flex gap-2">
          <div className="flex-1 bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl px-3 py-2 text-center cursor-pointer"
            onClick={() => setFilterMode(filterMode === 'cash' ? 'all' : 'cash')}>
            <p className="text-lg font-bold text-[#31A24C]">{activeCash}</p>
            <p className="text-[10px] text-[#31A24C]/80">Cash</p>
          </div>
          <div className="flex-1 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl px-3 py-2 text-center cursor-pointer"
            onClick={() => setFilterMode(filterMode === 'tournament' ? 'all' : 'tournament')}>
            <p className="text-lg font-bold text-[#F59E0B]">{activeTournament}</p>
            <p className="text-[10px] text-[#F59E0B]/80">Tournament</p>
          </div>
          <div className="flex-1 bg-[#3A3B3C]/50 border border-[#3A3B3C] rounded-xl px-3 py-2 text-center cursor-pointer"
            onClick={() => setFilterMode(filterMode === 'inactive' ? 'all' : 'inactive')}>
            <p className="text-lg font-bold text-[#B0B3B8]">{inactive}</p>
            <p className="text-[10px] text-[#B0B3B8]/80">Inactive</p>
          </div>
          <div className="flex-1 bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl px-3 py-2 text-center cursor-pointer"
            onClick={() => setFilterMode('all')}>
            <p className="text-lg font-bold text-[#1877F2]">{totalPlayers}</p>
            <p className="text-[10px] text-[#1877F2]/80">Players</p>
          </div>
        </div>

        {/* Filter indicator */}
        {filterMode !== 'all' && (
          <div className="mx-4 mb-2 flex items-center justify-between">
            <span className="text-xs text-[#B0B3B8]">
              Showing: <strong className="text-white capitalize">{filterMode}</strong> ({filteredTables.length} tables)
            </span>
            <button onClick={() => setFilterMode('all')} className="text-xs text-[#1877F2]">Show All</button>
          </div>
        )}

        {/* Table Grid */}
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredTables.map(table => {
            const mode = table.mode || 'inactive';
            const mc = MODE_COLORS[mode] || MODE_COLORS.inactive;
            const Icon = mc.icon;
            const isClosing = closing === table.id;

            return (
              <div key={table.id}
                className="rounded-2xl border-2 overflow-hidden transition-all hover:shadow-lg"
                style={{ borderColor: mc.border, background: '#242526' }}>

                {/* Mode badge bar */}
                <div className="px-3 py-1.5 flex items-center gap-1.5"
                  style={{ background: mode === 'inactive' ? '#3A3B3C' : mc.bg + '20' }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: mode === 'inactive' ? '#B0B3B8' : mc.bg }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: mode === 'inactive' ? '#B0B3B8' : mc.bg }}>
                    {mc.label}
                  </span>
                </div>

                {/* Table info */}
                <div className="px-3 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xl font-bold text-white">T{table.table_number}</span>
                    {table.table_name && table.table_name !== `Table ${table.table_number}` && (
                      <span className="text-[10px] text-[#B0B3B8] truncate ml-1">{table.table_name}</span>
                    )}
                  </div>

                  <div className="mb-2 min-h-[28px]">
                    {mode === 'cash' && (
                      <>
                        <p className="text-sm font-semibold text-[#31A24C]">{table.game_type} {table.stakes}</p>
                        <p className="text-[10px] text-[#B0B3B8]">
                          <Users className="w-3 h-3 inline mr-0.5" />
                          {table.active_players || 0}/{table.max_seats} seated
                        </p>
                      </>
                    )}

                    {mode === 'tournament' && (
                      <>
                        <p className="text-xs font-semibold text-[#F59E0B] truncate">
                          {tournaments.find(t => t.id === table.tournament_id)?.name || 'Tournament'}
                        </p>
                        <p className="text-[10px] text-[#B0B3B8]">
                          {table.active_players || 0}/{table.max_seats} seated
                        </p>
                      </>
                    )}

                    {mode === 'inactive' && (
                      <p className="text-[10px] text-[#6A6B6D]">{table.max_seats} seats - Not Assigned</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5">
                    <button onClick={() => openAssign(table)}
                      className="flex-1 py-1.5 rounded-lg bg-[#1877F2] text-white text-[10px] font-semibold flex items-center justify-center gap-1 active:bg-[#1565D8]">
                      <Table2 className="w-3 h-3" /> Assign
                    </button>
                    {mode !== 'inactive' && (
                      <button onClick={() => closeTable(table)} disabled={isClosing}
                        className="py-1.5 px-2 rounded-lg bg-[#EF4444]/10 text-[#EF4444] text-[10px] font-semibold flex items-center gap-1 active:bg-[#EF4444]/20 disabled:opacity-50">
                        {isClosing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {tables.length === 0 && (
            <div className="col-span-full text-center py-16">
              <Table2 className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
              <p className="text-[#B0B3B8]">No Tables Configured</p>
              <p className="text-xs text-[#6A6B6D] mt-1">Add Tables In The Tables Section First</p>
            </div>
          )}
        </div>

        {/* ===== ASSIGNMENT MODAL ===== */}
        {selectedTable && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setSelectedTable(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

              {/* Modal header */}
              <div className="sticky top-0 bg-[#242526] border-b border-[#3A3B3C] px-5 py-4 flex items-center justify-between z-10">
                <div>
                  <h3 className="text-lg font-bold text-white">Assign Table {selectedTable.table_number}</h3>
                  <p className="text-xs text-[#B0B3B8]">{selectedTable.table_name} · {selectedTable.max_seats} seats</p>
                </div>
                <button onClick={() => setSelectedTable(null)} className="p-2 rounded-lg active:bg-[#3A3B3C]">
                  <X className="w-5 h-5 text-[#B0B3B8]" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Warning if players seated */}
                {(selectedTable.active_players || 0) > 0 && selectedTable.mode !== 'inactive' && assignMode !== selectedTable.mode && (
                  <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-[#F59E0B]">
                      {selectedTable.active_players} player{selectedTable.active_players !== 1 ? 's are' : ' is'} currently at this table.
                      Changing mode will affect active sessions.
                    </p>
                  </div>
                )}

                {/* Error in modal */}
                {error && (
                  <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <span className="text-xs text-[#EF4444]">{error}</span>
                  </div>
                )}

                {/* Mode Selection */}
                <div>
                  <p className="text-xs text-[#B0B3B8] mb-2 font-medium uppercase tracking-wider">Table Mode</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { mode: 'inactive', label: 'Inactive', icon: Power, color: '#B0B3B8' },
                      { mode: 'cash', label: 'Cash Game', icon: DollarSign, color: '#31A24C' },
                      { mode: 'tournament', label: 'Tournament', icon: Trophy, color: '#F59E0B' },
                    ].map(opt => (
                      <button key={opt.mode} onClick={() => setAssignMode(opt.mode)}
                        className="py-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all"
                        style={assignMode === opt.mode
                          ? { borderColor: opt.color, background: opt.color + '15' }
                          : { borderColor: '#3A3B3C', background: '#3A3B3C30' }
                        }>
                        <opt.icon className="w-6 h-6" style={{ color: assignMode === opt.mode ? opt.color : '#B0B3B8' }} />
                        <span className="text-xs font-semibold"
                          style={{ color: assignMode === opt.mode ? opt.color : '#B0B3B8' }}>
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tournament Selection */}
                {assignMode === 'tournament' && (
                  <div>
                    <p className="text-xs text-[#B0B3B8] mb-2 font-medium">Link Tournament (Optional)</p>
                    {tournaments.length === 0 ? (
                      <div className="p-4 bg-[#3A3B3C]/30 rounded-xl text-center">
                        <Trophy className="w-8 h-8 text-[#3A3B3C] mx-auto mb-2" />
                        <p className="text-sm text-[#B0B3B8]">No Active Tournaments</p>
                        <p className="text-xs text-[#6A6B6D] mt-1">Table will be marked as tournament-ready</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {tournaments.map(t => (
                          <button key={t.id} onClick={() => setSelectedTournament(t.id)}
                            className="w-full text-left px-4 py-3 rounded-xl border-2 transition-all"
                            style={selectedTournament === t.id
                              ? { borderColor: '#F59E0B', background: '#F59E0B15' }
                              : { borderColor: '#3A3B3C', background: '#3A3B3C30' }
                            }>
                            <p className={`text-sm font-semibold ${selectedTournament === t.id ? 'text-[#F59E0B]' : 'text-white'}`}>
                              {t.name}
                            </p>
                            <p className="text-xs text-[#B0B3B8]">
                              {t.game_type || 'NLH'} - {t.status} - ${t.buyin_amount || 0} buy-in
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Save button */}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setSelectedTable(null); setError(null); }}
                    className="flex-1 py-3.5 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-semibold active:bg-[#4A4B4C]">
                    Cancel
                  </button>
                  <button onClick={saveAssignment} disabled={saving}
                    className="flex-1 py-3.5 rounded-xl bg-[#1877F2] text-white font-semibold active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {saving ? 'Saving...' : 'Save Assignment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{``}</style>
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
