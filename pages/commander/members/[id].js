/**
 * Member Profile
 * /commander/members/[id]
 * 
 * Detailed staff view of a single member:
 * - Personal info & membership status
 * - Time balance & comp balance
 * - Visit history & play stats
 * - Session history
 * - Staff notes
 * - Quick actions (add time, award comp, suspend)
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Clock, DollarSign, Users, Calendar, Loader2, Plus, Ban, Check } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

export default function MemberProfile() {

  useEffect(() => { busEmit.sessionStart('commander-members-id'); }, []);
  const router = useRouter();
  const { id } = router.query;
  const [member, setMember] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [addTimeAmount, setAddTimeAmount] = useState('');
  const [showAddTime, setShowAddTime] = useState(false);
  const [tournamentResults, setTournamentResults] = useState([]);
  const [tournamentSummary, setTournamentSummary] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const _c = new AbortController();

  if (!router.isReady) return null;

    if (!id) return;
    fetchMember();
    return () => _c.abort();
  }, [id]);

  // Commander Data Bus config will be below fetchMember

  const fetchMember = async (signal) => {
    setLoading(true);
    try {
const venueId = getVenueId();
const headers = { };
      const [memberRes, sessionsRes, tournamentsRes] = await Promise.all([
        commanderFetch(`/api/commander/members/${id}?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ data: null })),
        commanderFetch(`/api/commander/time-billing/sessions?member_id=${id}&venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/tournaments/player-results?member_id=${id}&venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ data: [] }))
      ]);
      // API returns { success, data: { member } } - unwrap the member row itself.
      // Previously the whole data wrapper was stored, so every field read
      // (first_name, time_balance_minutes, ...) was undefined and Add Time
      // overwrote the real balance with just the added minutes.
      if (memberRes.data || memberRes.success) setMember(memberRes.data?.member || memberRes.data || null);
      const sessionsArr = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
      setSessions(sessionsArr);
      // player-results now returns { results, summary }. Older deployments
      // returned a bare array, so both shapes are accepted.
      const tData = tournamentsRes.data;
      const tournamentsArr = Array.isArray(tData) ? tData
        : (Array.isArray(tData?.results) ? tData.results : []);
      setTournamentResults(tournamentsArr);
      setTournamentSummary(Array.isArray(tData) ? null : (tData?.summary || null));
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  // Commander Data Bus - sync member across tabs
  useCommanderSync(getVenueId(), fetchMember, { entities: ['members'] });

  const addTime = async () => {
    const minutes = parseInt(addTimeAmount);
    if (!minutes || minutes <= 0) return;
    try {
const res = await commanderFetch(`/api/commander/members/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time_balance_minutes: (member.time_balance_minutes || 0) + minutes
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setShowAddTime(false);
          setAddTimeAmount('');
          fetchMember();
          broadcastChange('members');
        }
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
  setLoading(false);
  };

  const toggleStatus = async (newStatus) => {
    try {
const res = await commanderFetch(`/api/commander/members/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membership_status: newStatus })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          fetchMember();
          broadcastChange('members');
        }
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
  };

  const m = member;
  const tierColors = { standard: '#B0B3B8', gold: '#F59E0B', platinum: '#A855F7', vip: '#EF4444' };
  const statusColors = { active: '#31A24C', suspended: '#F59E0B', expired: '#B0B3B8', banned: '#EF4444' };
  const tierColor = m ? (tierColors[m.membership_tier] || '#B0B3B8') : '#B0B3B8';
  const statusColor = m ? (statusColors[m.membership_status] || '#B0B3B8') : '#B0B3B8';

  const timeHours = m ? Math.floor((m.time_balance_minutes || 0) / 60) : 0;
  const timeMin = m ? (m.time_balance_minutes || 0) % 60 : 0;

  return (
    <CommanderLayout title={m ? `${m.first_name} ${m.last_name}` : 'Member'} backHref="/commander/dashboard?card=waitlist">
      <>
        <SEOHead
          title="Commander - Details"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        {loading ? (
          <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18191A' }}>
            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
          </div>
        ) : !member ? (
          <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18191A', color: '#fff' }}>
            Member Not Found
          </div>
        ) : (
          <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

            {/* Header */}
            <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <h1 className="text-lg font-bold text-white">{m.first_name} {m.last_name}</h1>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${tierColor}20`, color: tierColor }}>
                    {(m.membership_tier || 'standard').toUpperCase()}
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${statusColor}20`, color: statusColor }}>
                    {m.membership_status || 'active'}
                  </span>
                </div>
              </div>
            </div>

            {/* Member card */}
            <div className="p-4">
              <div className="bg-gradient-to-br from-[#242526] to-[#3A3B3C] border border-[#4A4B4C] rounded-2xl p-5">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-[#1877F2]/20 flex items-center justify-center flex-shrink-0">
                    <Users className="w-8 h-8 text-[#1877F2]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-[#B0B3B8]">Member #{m.member_number}</p>
                    {m.phone && <p className="text-sm text-white mt-1">{m.phone}</p>}
                    {m.email && <p className="text-sm text-[#B0B3B8]">{m.email}</p>}
                    {m.date_of_birth && <p className="text-xs text-[#B0B3B8] mt-1">DOB: {new Date(m.date_of_birth).toLocaleDateString()}</p>}
                  </div>
                </div>

                {/* Balances */}
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="bg-black/20 rounded-xl p-3 text-center">
                    <Clock className="w-5 h-5 text-[#1877F2] mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">{timeHours}h {timeMin}m</p>
                    <p className="text-[10px] text-[#B0B3B8]">Time Balance</p>
                  </div>
                  <div className="bg-black/20 rounded-xl p-3 text-center">
                    <DollarSign className="w-5 h-5 text-[#31A24C] mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">${(m.comp_balance || 0).toFixed(2)}</p>
                    <p className="text-[10px] text-[#B0B3B8]">Comp Balance</p>
                  </div>
                  <div className="bg-black/20 rounded-xl p-3 text-center">
                    <Calendar className="w-5 h-5 text-[#F59E0B] mx-auto mb-1" />
                    <p className="text-lg font-bold text-white">{m.total_visits || 0}</p>
                    <p className="text-[10px] text-[#B0B3B8]">Total Visits</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="px-4 flex gap-2">
              <button onClick={() => setShowAddTime(!showAddTime)}
                className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white text-sm font-semibold flex items-center justify-center gap-1.5 active:bg-[#1565D8]">
                <Plus className="w-4 h-4" /> Add Time
              </button>
              <button onClick={() => router.push(`/commander/comps?member=${id}`)}
                className="flex-1 py-3 rounded-xl bg-[#31A24C] text-white text-sm font-semibold flex items-center justify-center gap-1.5 active:bg-[#28883F]">
                <DollarSign className="w-4 h-4" /> Award Comp
              </button>
              {m.membership_status === 'active' ? (
                <button onClick={() => toggleStatus('suspended')}
                  className="py-3 px-4 rounded-xl bg-[#3A3B3C] text-[#F59E0B] text-sm font-semibold active:bg-[#4A4B4C]">
                  <Ban className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => toggleStatus('active')}
                  className="py-3 px-4 rounded-xl bg-[#3A3B3C] text-[#31A24C] text-sm font-semibold active:bg-[#4A4B4C]">
                  <Check className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Add time panel */}
            {showAddTime && (
              <div className="px-4 mt-3">
                <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-2">Add Time (Minutes)</p>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {[30, 60, 120, 180].map(mins => (
                      <button key={mins} onClick={() => setAddTimeAmount(String(mins))}
                        className={`py-2 rounded-lg text-sm font-medium ${addTimeAmount === String(mins) ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB]'
                          }`}>{mins >= 60 ? `${mins / 60}h` : `${mins}m`}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="number" value={addTimeAmount} onChange={e => setAddTimeAmount(e.target.value)}
                      placeholder="Custom Minutes"
                      className="flex-1 px-3 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm focus:outline-none focus:border-[#1877F2]" />
                    <button onClick={addTime} className="px-4 py-2 bg-[#1877F2] rounded-lg text-white text-sm font-semibold">Add</button>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="mt-4 border-b border-[#3A3B3C] flex px-4">
              {['overview', 'sessions', 'tournaments', 'notes'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-3 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'text-[#1877F2] border-[#1877F2]' : 'text-[#B0B3B8] border-transparent'
                    }`}>{t}</button>
              ))}
            </div>

            <div className="p-4">
              {/* Overview */}
              {tab === 'overview' && (
                <div className="space-y-2">
                  <InfoRow label="Member Since" value={m.created_at ? new Date(m.created_at).toLocaleDateString() : 'N/A'} />
                  <InfoRow label="Last Visit" value={m.last_visit ? new Date(m.last_visit).toLocaleDateString() : 'Never'} />
                  <InfoRow label="Total Hours" value={`${(m.total_hours_played || 0).toFixed(1)}h`} />
                  <InfoRow label="ID Type" value={(m.id_type || 'N/A').replace('_', ' ')} />
                  {m.id_state && <InfoRow label="ID State" value={m.id_state} />}
                  {m.id_expiry && <InfoRow label="ID Expiry" value={new Date(m.id_expiry).toLocaleDateString()} />}
                  {m.membership_expires && <InfoRow label="Membership Expires" value={new Date(m.membership_expires).toLocaleDateString()} />}
                </div>
              )}

              {/* Sessions */}
              {tab === 'sessions' && (
                <div className="space-y-2">
                  {sessions.length === 0 ? (
                    <p className="py-6 text-center text-[#B0B3B8]">No Session History</p>
                  ) : (
                    sessions.slice(0, 20).map((s, i) => (
                      <div key={s.id || i} className="flex items-center justify-between px-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-lg">
                        <div>
                          <p className="text-sm text-white">Table {s.table_number}, Seat {s.seat_number}</p>
                          <p className="text-[10px] text-[#B0B3B8]">
                            {s.started_at ? new Date(s.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-xs font-bold ${s.status === 'active' ? 'text-[#31A24C]' : 'text-[#B0B3B8]'}`}>
                            {s.status}
                          </span>
                          <p className="text-[10px] text-[#B0B3B8]">{s.time_allocated_minutes || 0}m</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tournament History */}
              {tab === 'tournaments' && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Tournament History</h3>

                  {/* Career summary. Only shown when the API supplied one, so an
                      older deployment returning a bare array never renders a
                      row of fabricated zeros. */}
                  {tournamentSummary && (
                    <div className="grid grid-cols-3 gap-2">
                      <StatTile label="Events" value={(tournamentSummary.events_played || 0).toLocaleString()} />
                      <StatTile label="Cashes" value={(tournamentSummary.cashes || 0).toLocaleString()} color="#31A24C" />
                      <StatTile label="ITM Rate" value={`${tournamentSummary.itm_rate || 0}%`} color="#1877F2" />
                      <StatTile label="Winnings" value={`$${(tournamentSummary.total_winnings || 0).toLocaleString()}`} color="#31A24C" />
                      <StatTile
                        label="Net"
                        value={`${(tournamentSummary.net || 0) < 0 ? '-$' : '$'}${Math.abs(tournamentSummary.net || 0).toLocaleString()}`}
                        color={(tournamentSummary.net || 0) < 0 ? '#EF4444' : '#31A24C'}
                      />
                      <StatTile
                        label="Best Finish"
                        value={tournamentSummary.best_finish ? ordinalPlace(tournamentSummary.best_finish) : '--'}
                        color="#F59E0B"
                      />
                    </div>
                  )}

                  {tournamentResults.length === 0 ? (
                    <p className="py-6 text-center text-[#B0B3B8]">No Tournament Results</p>
                  ) : (
                    <div className="space-y-2">
                      {tournamentResults.slice(0, 30).map((t, i) => (
                        <div key={t.id || i} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-lg">
                          <div className="min-w-0">
                            <p className="text-sm text-white truncate">{t.tournament_name || t.name || 'Tournament'}</p>
                            <p className="text-[10px] text-[#B0B3B8]">
                              {t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                              {t.buyin_amount ? `, $${Number(t.buyin_amount).toLocaleString()} Buy-In` : ''}
                              {t.rebuys > 0 ? `, ${t.rebuys}R` : ''}
                              {t.addon ? ', Add-On' : ''}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {t.finish_position ? (
                              <span className={`text-sm font-bold ${t.finish_position <= 3 ? 'text-[#F59E0B]' : 'text-[#B0B3B8]'}`}>
                                {ordinalPlace(t.finish_position)}
                                {t.field_size ? ` Of ${Number(t.field_size).toLocaleString()}` : ''}
                              </span>
                            ) : (
                              <span className="text-xs text-[#B0B3B8] capitalize">{t.status || 'Entered'}</span>
                            )}
                            {t.payout > 0 && (
                              <p className="text-xs text-[#31A24C] font-medium">${Number(t.payout).toLocaleString()}</p>
                            )}
                          </div>
                        </div>
                      ))}
                      {tournamentResults.length > 30 && (
                        <p className="text-[10px] text-[#B0B3B8] text-center pt-1">
                          Showing The 30 Most Recent Of {tournamentResults.length.toLocaleString()} Entries
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {tab === 'notes' && (
                <div>
                  <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
                    <p className="text-sm text-white whitespace-pre-wrap">{m.notes || 'No Notes'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <style>{`
`}</style>
      </>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideUp 0.3s ease',
          display: 'flex', alignItems: 'center', gap: 8,
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

function ordinalPlace(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '--';
  const rem100 = num % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
  const rem10 = num % 10;
  if (rem10 === 1) return `${num}st`;
  if (rem10 === 2) return `${num}nd`;
  if (rem10 === 3) return `${num}rd`;
  return `${num}th`;
}

function StatTile({ label, value, color }) {
  return (
    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
      <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">{label}</p>
      <p className="text-base font-bold" style={{ color: color || '#E4E6EB' }}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-lg">
      <span className="text-sm text-[#B0B3B8]">{label}</span>
      <span className="text-sm font-medium text-white capitalize">{value}</span>
    </div>
  );
}
