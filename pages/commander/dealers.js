/**
 * Staff Dealer Management Page
 * Manage dealers, rotations, and schedules
 * Dark industrial sci-fi gaming theme
 * Per DATABASE_SCHEMA.sql: commander_dealers, commander_dealer_rotations
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Users, Plus, Clock, Search, Loader2, Edit2, RotateCw, Star, Check, X, History, ArrowRight, AlertCircle } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import useDebounce from '../../src/hooks/useDebounce';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const GAME_CERTIFICATIONS = [
  { value: 'nlhe', label: 'No Limit Hold\'em' },
  { value: 'plo', label: 'Pot Limit Omaha' },
  { value: 'mixed', label: 'Mixed Games' },
  { value: 'stud', label: 'Stud' },
  { value: 'limit', label: 'Limit Hold\'em' }
];

function DealerCard({ dealer, onEdit, onRotate }) {
  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
            <Users className="w-6 h-6 text-[#1877F2]" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{dealer.name}</h3>
            <p className="text-sm text-[#B0B3B8]">ID: {dealer.employee_id || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(level => (
            <Star
              key={level}
              className={`w-4 h-4 ${level <= (dealer.skill_level || 3)
                ? 'text-[#F59E0B] fill-[#F59E0B]'
                : 'text-[#3A3B3C]'
                }`}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {(dealer.certified_games || []).map(game => (
          <span
            key={game}
            className="px-2 py-1 bg-[#31A24C]/10 text-[#31A24C] text-xs font-medium rounded"
          >
            {game.toUpperCase()}
          </span>
        ))}
      </div>

      {dealer.current_table && (
        <div className="bg-[#1877F2]/5 rounded-lg p-2 mb-3">
          <p className="text-sm text-[#1877F2] font-medium">
            Currently At Table {dealer.current_table}
          </p>
          <p className="text-xs text-[#B0B3B8]">
            Since {new Date(dealer.rotation_started).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onRotate(dealer)}
          className="flex-1 py-2 cmd-btn cmd-btn-primary text-sm flex items-center justify-center gap-1"
        >
          <RotateCw className="w-4 h-4" />
          Rotate
        </button>
        <button
          onClick={() => onEdit(dealer)}
          className="px-4 py-2 cmd-btn cmd-btn-secondary"
        >
          <Edit2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function AddDealerModal({ onSubmit, onClose, dealer = null }) {
  const [formData, setFormData] = useState({
    name: dealer?.name || '',
    employee_id: dealer?.employee_id || '',
    skill_level: dealer?.skill_level || 3,
    certified_games: dealer?.certified_games || ['nlhe']
  });
  const [loading, setLoading] = useState(false);

  function toggleCertification(game) {
    setFormData(prev => ({
      ...prev,
      certified_games: prev.certified_games.includes(game)
        ? prev.certified_games.filter(g => g !== game)
        : [...prev.certified_games, game]
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.name) return;

    setLoading(true);
    await onSubmit(formData);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md cmd-panel cmd-corner-lights p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">
            {dealer ? 'Edit Dealer' : 'Add Dealer'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3A3B3C] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Dealer Name"
              required
              className="w-full h-12 px-4 cmd-input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Employee ID
            </label>
            <input
              type="text"
              value={formData.employee_id}
              onChange={(e) => setFormData(prev => ({ ...prev, employee_id: e.target.value }))}
              placeholder="Optional"
              className="w-full h-12 px-4 cmd-input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Skill Level
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, skill_level: level }))}
                  className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-colors ${formData.skill_level === level
                    ? 'border-[#F59E0B] bg-[#F59E0B]/10 text-[#F59E0B]'
                    : 'border-[#3A3B3C] text-[#B0B3B8]'
                    }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Certified Games
            </label>
            <div className="flex flex-wrap gap-2">
              {GAME_CERTIFICATIONS.map(cert => (
                <button
                  key={cert.value}
                  type="button"
                  onClick={() => toggleCertification(cert.value)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${formData.certified_games.includes(cert.value)
                    ? 'border-[#31A24C] bg-[#31A24C]/10 text-[#31A24C]'
                    : 'border-[#3A3B3C] text-[#B0B3B8]'
                    }`}
                >
                  {cert.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 cmd-btn cmd-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name}
              className="flex-1 h-12 cmd-btn cmd-btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : dealer ? 'Update' : 'Add Dealer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RotateModal({ dealer, tables, onSubmit, onClose }) {
  const [selectedTable, setSelectedTable] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!selectedTable) return;
    setLoading(true);
    await onSubmit(dealer.id, selectedTable);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md cmd-panel cmd-corner-lights p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Rotate Dealer</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3A3B3C] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-[#B0B3B8]">Moving: <strong className="text-white">{dealer.name}</strong></p>
          {dealer.current_table && (
            <p className="text-sm text-[#3A3B3C]">From Table {dealer.current_table}</p>
          )}
        </div>

        <div className="space-y-2 mb-6">
          <label className="block text-sm font-medium text-white">
            Select New Table
          </label>
          {tables.map(table => (
            <button
              key={table.id}
              onClick={() => setSelectedTable(table.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${selectedTable === table.id
                ? 'border-[#1877F2] bg-[#1877F2]/5'
                : 'border-[#3A3B3C] hover:border-[#1877F2]'
                }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">Table {table.table_number}</p>
                  <p className="text-sm text-[#B0B3B8]">{table.current_game || 'No Game'}</p>
                </div>
                {selectedTable === table.id && (
                  <Check className="w-5 h-5 text-[#1877F2]" />
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-12 cmd-btn cmd-btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !selectedTable}
            className="flex-1 h-12 cmd-btn cmd-btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm Rotation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DealersPage() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-dealers'); }, []);

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dealers, setDealers] = useState([]);
  const [tables, setTables] = useState([]);
  const [rotations, setRotations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDealer, setEditingDealer] = useState(null);
  const [rotatingDealer, setRotatingDealer] = useState(null);
  const [activeTab, setActiveTab] = useState('dealers');

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) {
        router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }
      setStaff(staffData);
      setVenueId(staffData.venue_id);
    } catch {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  useEffect(() => {
    if (venueId) {
      const controller = new AbortController();
      fetchDealers(controller.signal);
      fetchTables(controller.signal);
      fetchRotations(controller.signal);
      return () => controller.abort();
    }
  }, [venueId]);

  // Commander Data Bus - sync dealers and tables across tabs
  useCommanderSync(venueId, () => { fetchDealers(); fetchTables(); fetchRotations(); }, { entities: ['dealers', 'tables'] });

  async function fetchDealers(signal) {
    setLoading(true);
    try {
const res = await commanderFetch(`/api/commander/dealers?venue_id=${venueId}`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Dealers fetch failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        setDealers(Array.isArray(data.data) ? data.data : data.data?.dealers || []);
      }
    } catch (err) {
      console.warn('Fetch dealers failed:', err);
      setDealers([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTables(signal) {
    try {
const res = await commanderFetch(`/api/commander/tables?venue_id=${venueId}`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Tables fetch failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        setTables(Array.isArray(data.data) ? data.data : data.data?.tables || []);
      }
    } catch (err) {
      setLoading(false);
      console.warn('Fetch tables failed:', err);
      setTables([]);
    }
  }

  async function fetchRotations(signal) {
    try {
const res = await commanderFetch(`/api/commander/dealers/rotations?venue_id=${venueId}&limit=50`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Rotations fetch failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        setRotations(Array.isArray(data.data) ? data.data : data.data?.rotations || []);
      }
    } catch (err) {
      console.warn('Fetch rotations failed:', err);
      setRotations([]);
    }
  }

  async function handleAddDealer(data) {
    try {
const res = await commanderFetch('/api/commander/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, ...data })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          setShowAddModal(false);
          fetchDealers();
          broadcastChange('dealers');
        }
      }
    } catch (err) {
      console.warn('Add dealer failed:', err);
      setToast({ type: 'error', text: 'Failed To Add Dealer. Please Try Again.' });
    }
  }

  async function handleEditDealer(data) {
    try {
const res = await commanderFetch(`/api/commander/dealers/${editingDealer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setEditingDealer(null);
          fetchDealers();
          broadcastChange('dealers');
        }
      }
    } catch (err) {
      console.warn('Edit dealer failed:', err);
      setToast({ type: 'error', text: 'Failed To Update Dealer. Please Try Again.' });
    }
  }

  async function handleRotate(dealerId, tableId) {
    try {
const res = await commanderFetch('/api/commander/dealers/rotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealer_id: dealerId, table_id: tableId, venue_id: venueId })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setRotatingDealer(null);
          fetchDealers();
          fetchRotations();
          broadcastChange('dealers');
        }
      }
    } catch (err) {
      console.warn('Rotate dealer failed:', err);
      setToast({ type: 'error', text: 'Failed To Rotate Dealer. Please Try Again.' });
    }
  }

  // commander_dealers has no current_table/rotation_started columns - derive
  // the active table from the open rotation rows (ended_at null) returned by
  // the rotations API, otherwise every dealer always showed as "Available".
  const activeRotationByDealer = {};
  rotations.forEach(r => {
    if (!r.ended_at && activeRotationByDealer[r.dealer_id] === undefined) {
      activeRotationByDealer[r.dealer_id] = r;
    }
  });

  const filteredDealers = dealers
    .map(d => {
      const rot = activeRotationByDealer[d.id];
      return rot ? { ...d, current_table: rot.table_number, rotation_started: rot.started_at } : d;
    })
    .filter(d =>
      (d.name || '').toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      d.employee_id?.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );

  const activeDealers = filteredDealers.filter(d => d.current_table);
  const availableDealers = filteredDealers.filter(d => !d.current_table);

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Dealer Management" backHref="/commander/dashboard?card=floor">
      <div className="cmd-page">
        {/* Action Bar + Tabs */}
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[#B0B3B8]">
            {activeDealers.length} Active, {availableDealers.length} Available
          </p>
          {activeTab === 'dealers' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 cmd-btn cmd-btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Dealer
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="max-w-4xl mx-auto px-4 flex gap-1 border-b border-[#3A3B3C]">
          <button
            onClick={() => setActiveTab('dealers')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dealers'
              ? 'border-[#1877F2] text-[#1877F2]'
              : 'border-transparent text-[#B0B3B8] hover:text-white'
              }`}
          >
            <Users className="w-4 h-4 inline-block mr-2" />
            Dealers
          </button>
          <button
            onClick={() => setActiveTab('rotations')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'rotations'
              ? 'border-[#31A24C] text-[#31A24C]'
              : 'border-transparent text-[#B0B3B8] hover:text-white'
              }`}
          >
            <History className="w-4 h-4 inline-block mr-2" />
            Rotation History
          </button>
        </div>

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {activeTab === 'dealers' ? (
            <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#3A3B3C]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Dealers..."
                  className="w-full h-12 pl-12 pr-4 cmd-input"
                />
              </div>

              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
                </div>
              ) : (
                <>
                  {/* Active Dealers */}
                  {activeDealers.length > 0 && (
                    <section>
                      <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-[#31A24C]" />
                        On Tables ({activeDealers.length})
                      </h2>
                      <div className="grid md:grid-cols-2 gap-4">
                        {activeDealers.map(dealer => (
                          <DealerCard
                            key={dealer.id}
                            dealer={dealer}
                            onEdit={setEditingDealer}
                            onRotate={setRotatingDealer}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Available Dealers */}
                  {availableDealers.length > 0 && (
                    <section>
                      <h2 className="font-semibold text-white mb-3">
                        Available ({availableDealers.length})
                      </h2>
                      <div className="grid md:grid-cols-2 gap-4">
                        {availableDealers.map(dealer => (
                          <DealerCard
                            key={dealer.id}
                            dealer={dealer}
                            onEdit={setEditingDealer}
                            onRotate={setRotatingDealer}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {filteredDealers.length === 0 && (
                    <div className="cmd-panel p-8 text-center">
                      <Users className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                      <p className="text-[#B0B3B8]">No Dealers Found</p>
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="mt-4 px-6 py-2 cmd-btn cmd-btn-primary"
                      >
                        Add First Dealer
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {/* Rotation History */}
              <div className="cmd-panel">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h2 className="font-semibold text-white">Recent Rotations</h2>
                  <span className="text-sm text-[#B0B3B8]">{rotations.length} Total</span>
                </div>

                {rotations.length === 0 ? (
                  <div className="p-8 text-center">
                    <RotateCw className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                    <p className="text-[#B0B3B8]">No Rotation History Yet</p>
                    <p className="text-sm text-[#3A3B3C] mt-1">
                      Rotations Will Appear Here When Dealers Are Moved Between Tables
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#3A3B3C]">
                    {rotations.map((rotation) => {
                      const dealer = dealers.find(d => d.id === rotation.dealer_id);
                      // Rotation rows store table_number/table_id (no from/to columns)
                      const fromTable = null;
                      const toTable = rotation.table_number != null
                        ? { table_number: rotation.table_number }
                        : tables.find(t => t.id === rotation.table_id);

                      return (
                        <div key={rotation.id} className="p-4 flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-[#31A24C]/10 flex items-center justify-center">
                            <RotateCw className="w-5 h-5 text-[#31A24C]" />
                          </div>

                          <div className="flex-1">
                            <p className="font-medium text-white">
                              {dealer?.name || rotation.dealer_name || 'Unknown Dealer'}
                            </p>
                            <div className="flex items-center gap-2 text-sm text-[#B0B3B8]">
                              <span>
                                {fromTable ? `Table ${fromTable.table_number}` : rotation.from_table_id ? 'Previous Table' : 'Off'}
                              </span>
                              <ArrowRight className="w-4 h-4" />
                              <span>
                                {toTable ? `Table ${toTable.table_number}` : rotation.to_table_id ? 'New Table' : 'Off'}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-sm text-white">
                              {new Date(rotation.started_at || rotation.rotated_at || rotation.created_at).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit'
                              })}
                            </p>
                            <p className="text-xs text-[#B0B3B8]">
                              {new Date(rotation.started_at || rotation.rotated_at || rotation.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Rotation Tips */}
              <div className="bg-[#1877F2]/10 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#1877F2] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-[#1877F2]">Rotation Best Practices</p>
                  <ul className="text-sm text-[#B0B3B8] mt-1 space-y-1">
                    <li>Rotate Dealers Every 30 Minutes To Keep Games Fresh</li>
                    <li>Match Dealer Certifications To Game Types</li>
                    <li>Track Down-Time To Ensure Fair Distribution</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </main>

        {/* Modals */}
        {showAddModal && (
          <AddDealerModal
            onSubmit={handleAddDealer}
            onClose={() => setShowAddModal(false)}
          />
        )}

        {editingDealer && (
          <AddDealerModal
            dealer={editingDealer}
            onSubmit={handleEditDealer}
            onClose={() => setEditingDealer(null)}
          />
        )}

        {rotatingDealer && (
          <RotateModal
            dealer={rotatingDealer}
            tables={tables.filter(t => t.current_game)}
            onSubmit={handleRotate}
            onClose={() => setRotatingDealer(null)}
          />
        )}
      </div>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
  );
}
