/**
 * Tax Compliance / W-2G
 * /commander/reports/tax-compliance
 * View tournament wins >= $5K, generate and print W-2G forms
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { FileText, DollarSign, AlertTriangle, CheckCircle2, Loader2, Printer, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

export default function TaxCompliance() {
  useEffect(() => { busEmit.sessionStart('commander-reports-tax-compliance'); }, []);
  const router = useRouter();
  const [staff, setStaff] = useState(null);
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [filter, setFilter] = useState('all'); // all | pending | generated
  const [expandedId, setExpandedId] = useState(null);
  const [generating, setGenerating] = useState(null);
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {    const _c = new AbortController();

    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    return () => _c.abort();
  }, []);

  useEffect(() => {    const _c = new AbortController();

    if (staff?.venue_id) fetchEvents();
    return () => _c.abort();
  }, [staff, year, filter]);

  const fetchEvents = async(signal) => {
    setLoading(true);
    try {
let url = `/api/commander/tax/w2g?venue_id=${staff.venue_id}&year=${year}`;
      if (filter === 'pending') url += '&w2g_generated=false';
      if (filter === 'generated') url += '&w2g_generated=true';
      const res = await fetch(url, {});
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setEvents(json.data.events);
        setSummary(json.data.summary);
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  const handleGenerate = async (eventId) => {
    setGenerating(eventId);
    try {
const res = await commanderFetch('/api/commander/tax/w2g', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_event_id: eventId })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setToast({ type: 'success', msg: 'W-2G generated successfully' });
        // Print the W-2G
        printW2G(json.data.w2g);
        fetchEvents();
      } else {
        setToast({ type: 'error', msg: json.error?.message || 'Failed to generate' });
      }
    } catch (err) {
      setLoading(false);
      setToast({ type: 'error', msg: 'Network error' });
    }
    finally { setGenerating(null); setTimeout(() => setToast(null), 3000); }
  };

  const printW2G = (w2g) => {
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>W-2G Form</title>
      <style>
        @page { size: letter; margin: 0.75in; }
        body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; margin: 0; padding: 20px; }
        .form-box { border: 2px solid #000; padding: 16px; max-width: 680px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
        .header h1 { font-size: 16px; margin: 0 0 4px; }
        .header h2 { font-size: 13px; margin: 0; font-weight: normal; }
        .row { display: flex; border-bottom: 1px solid #999; }
        .box { flex: 1; padding: 8px; border-right: 1px solid #999; }
        .box:last-child { border-right: none; }
        .box-label { font-size: 9px; color: #444; margin-bottom: 2px; text-transform: uppercase; }
        .box-value { font-size: 14px; font-weight: bold; }
        .section-title { background: #eee; padding: 4px 8px; font-weight: bold; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #999; }
        .big-amount { font-size: 22px; font-weight: bold; }
        .footer { margin-top: 16px; text-align: center; font-size: 10px; color: #666; }
        .irs-notice { margin-top: 12px; padding: 8px; border: 1px solid #ccc; font-size: 10px; line-height: 1.4; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <div class="form-box">
        <div class="header">
          <h1>FORM W-2G</h1>
          <h2>Certain Gambling Winnings</h2>
          <div style="font-size:10px; margin-top:4px;">Tax Year ${w2g.tax_year} &nbsp; | &nbsp; Department of the Treasury — Internal Revenue Service</div>
        </div>

        <div class="section-title">Payer Information</div>
        <div class="row">
          <div class="box" style="flex:2">
            <div class="box-label">Payer's Name</div>
            <div class="box-value">${w2g.payer_name}</div>
          </div>
          <div class="box">
            <div class="box-label">Payer's Federal ID (EIN)</div>
            <div class="box-value">${w2g.payer_ein || '___-_______'}</div>
          </div>
        </div>
        <div class="row">
          <div class="box">
            <div class="box-label">Payer's Address</div>
            <div class="box-value" style="font-size:11px">${w2g.payer_address}</div>
          </div>
        </div>

        <div class="section-title">Winner Information</div>
        <div class="row">
          <div class="box" style="flex:2">
            <div class="box-label">Winner's Name</div>
            <div class="box-value">${w2g.winner_name}</div>
          </div>
          <div class="box">
            <div class="box-label">SSN (last 4)</div>
            <div class="box-value">XXX-XX-${w2g.winner_ssn_last4 || '____'}</div>
          </div>
        </div>

        <div class="section-title">Winnings Detail</div>
        <div class="row">
          <div class="box">
            <div class="box-label">Box 1 — Reportable Winnings</div>
            <div class="big-amount">$${parseFloat(w2g.box1_gross_winnings).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="box">
            <div class="box-label">Box 2 — Date Won</div>
            <div class="box-value">${w2g.box2_date_won}</div>
          </div>
        </div>
        <div class="row">
          <div class="box">
            <div class="box-label">Box 3 — Type Of Wager</div>
            <div class="box-value">${w2g.box3_wager_type}</div>
          </div>
          <div class="box">
            <div class="box-label">Box 4 — Federal Tax Withheld</div>
            <div class="box-value" style="color:#c00">$${parseFloat(w2g.box4_federal_withheld).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
        <div class="row">
          <div class="box">
            <div class="box-label">Box 5 — Transaction</div>
            <div class="box-value" style="font-size:11px">${w2g.box5_transaction}</div>
          </div>
          <div class="box">
            <div class="box-label">Box 7 — Winnings From Identical Wagers</div>
            <div class="box-value">$${parseFloat(w2g.box7_identical_winnings).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>

        <div class="irs-notice">
          <strong>Important:</strong> This is an informational copy. The payer must file Copy A with the IRS.
          Federal withholding rate: 24%. Poker tournament winnings of $5,000 or more (reduced by wager/buy-in)
          are subject to reporting on Form W-2G per IRS regulations.
        </div>

        <div class="footer">
          Generated: ${new Date().toLocaleString()} &nbsp; | &nbsp; SMARTER.POKER — Club Commander
        </div>
      </div></body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 600);
  };

  const reprintW2G = async (evt) => {
    // Rebuild W-2G data from event for reprint
    const w2g = {
      box1_gross_winnings: evt.gross_amount,
      box2_date_won: evt.event_date,
      box3_wager_type: 'Poker Tournament',
      box4_federal_withheld: evt.withholding_amount || 0,
      box5_transaction: `Tournament - Buy-in: $${parseFloat(evt.buy_in || 0).toFixed(2)}`,
      box7_identical_winnings: parseFloat(evt.net_amount || 0),
      payer_name: staff?.venue_name || 'Venue',
      payer_ein: '',
      payer_address: '',
      winner_name: evt.player_name || 'Unknown',
      winner_ssn_last4: evt.player_ssn_last4 || '',
      tax_year: new Date(evt.event_date).getFullYear()
    };
    printW2G(w2g);
  };

  const formatMoney = (v) => `$${parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <SEOHead
        title="Commander — Tax Compliance"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div style={{ minHeight: '100vh', background: '#F0F2F5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* Header */}
        <div style={{ background: '#1877F2', color: 'white', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/commander/reports')} style={{ background: 'white', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>
            <ArrowLeft size={20} color="#1877F2" />
          </button>
          <FileText size={22} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Tax Compliance / W-2G</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Tournament Wins Reporting And Withholding</div>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{ margin: 12, padding: '10px 14px', borderRadius: 8, background: toast.type === 'success' ? '#DEF7EC' : '#FEE2E2', color: toast.type === 'success' ? '#03543F' : '#991B1B', fontSize: 14, fontWeight: 600 }}>
            {toast.msg}
          </div>
        )}

        <div style={{ padding: 16, maxWidth: 700, margin: '0 auto' }}>
          {/* Year + Filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              style={{ padding: '8px 12px', border: '2px solid #CED0D4', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {['all', 'pending', 'generated'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '8px 14px', border: '2px solid', borderColor: filter === f ? '#1877F2' : '#CED0D4', borderRadius: 8, background: filter === f ? '#EBF5FF' : 'white', color: filter === f ? '#1877F2' : '#1C2526', fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                {f}
              </button>
            ))}
          </div>

          {/* Summary Cards */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Total Events', val: summary.total_events, color: '#1877F2', icon: FileText },
                { label: 'Gross Winnings', val: formatMoney(summary.total_gross), color: '#31A24C', icon: DollarSign },
                { label: 'Total Withholding', val: formatMoney(summary.total_withholding), color: '#EF4444', icon: DollarSign },
                { label: 'W-2G Pending', val: summary.w2g_pending_count, color: '#F59E0B', icon: AlertTriangle }
              ].map(c => (
                <div key={c.label} style={{ background: 'white', borderRadius: 10, padding: 14, border: '2px solid #E4E6EB' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <c.icon size={14} color={c.color} />
                    <span style={{ fontSize: 12, color: '#65676B', fontWeight: 600 }}>{c.label}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1C2526' }}>{c.val}</div>
                </div>
              ))}
            </div>
          )}

          {/* IRS Notice */}
          <div style={{ background: '#FEF3C7', border: '2px solid #F59E0B', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
            <strong>IRS Requirement:</strong> Form W-2G must be issued for poker tournament winnings of $5,000 or more (net of buy-in).
            Federal withholding rate is 24%. The venue must file Copy A with the IRS and provide Copy B to the winner.
          </div>

          {/* Events List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={28} color="#1877F2" className="spin" /></div>
          ) : events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#65676B', background: 'white', borderRadius: 12 }}>
              No taxable events for {year}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {events.map(evt => {
                const isExpanded = expandedId === evt.id;
                const isPending = !evt.w2g_generated && evt.withholding_required;
                return (
                  <>
                    <div key={evt.id} style={{ background: 'white', borderRadius: 10, border: isPending ? '2px solid #F59E0B' : '2px solid #E4E6EB', overflow: 'hidden' }}>
                      <button onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                        style={{ width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: evt.w2g_generated ? '#DEF7EC' : '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {evt.w2g_generated ? <CheckCircle2 size={18} color="#03543F" /> : <AlertTriangle size={18} color="#D97706" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1C2526' }}>{evt.player_name}</div>
                          <div style={{ fontSize: 12, color: '#65676B' }}>{evt.event_date} — {evt.event_type}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 16, color: '#31A24C' }}>{formatMoney(evt.gross_amount)}</div>
                          <div style={{ fontSize: 11, color: evt.w2g_generated ? '#03543F' : '#D97706', fontWeight: 600 }}>
                            {evt.w2g_generated ? 'W-2G FILED' : 'PENDING'}
                          </div>
                        </div>
                        {isExpanded ? <ChevronUp size={16} color="#65676B" /> : <ChevronDown size={16} color="#65676B" />}
                      </button>

                      {isExpanded && (
                        <div style={{ padding: '0 14px 14px', borderTop: '2px solid #E4E6EB' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
                            <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                              <div style={{ fontSize: 11, color: '#65676B', fontWeight: 600 }}>GROSS</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: '#1C2526' }}>{formatMoney(evt.gross_amount)}</div>
                            </div>
                            <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                              <div style={{ fontSize: 11, color: '#65676B', fontWeight: 600 }}>Buy-In</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: '#1C2526' }}>{formatMoney(evt.buy_in)}</div>
                            </div>
                            <div style={{ padding: 10, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                              <div style={{ fontSize: 11, color: '#65676B', fontWeight: 600 }}>NET</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: '#31A24C' }}>{formatMoney(evt.net_amount)}</div>
                            </div>
                          </div>

                          {evt.withholding_amount > 0 && (
                            <div style={{ marginTop: 10, padding: 10, background: '#FEF2F2', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#991B1B' }}>Federal Withholding (24%)</span>
                              <span style={{ fontSize: 16, fontWeight: 800, color: '#EF4444' }}>{formatMoney(evt.withholding_amount)}</span>
                            </div>
                          )}

                          {evt.player_ssn_last4 && (
                            <div style={{ marginTop: 8, fontSize: 13, color: '#65676B' }}>SSN: XXX-XX-{evt.player_ssn_last4}</div>
                          )}
                          {evt.notes && (
                            <div style={{ marginTop: 8, fontSize: 13, color: '#444' }}>Notes: {evt.notes}</div>
                          )}

                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            {!evt.w2g_generated ? (
                              <button onClick={() => handleGenerate(evt.id)} disabled={generating === evt.id}
                                style={{ flex: 1, background: '#1877F2', color: 'white', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: generating === evt.id ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: generating === evt.id ? 0.7 : 1 }}>
                                {generating === evt.id ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
                                Generate W-2G
                              </button>
                            ) : (
                              <button onClick={() => reprintW2G(evt)}
                                style={{ flex: 1, background: '#31A24C', color: 'white', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <Printer size={16} /> Reprint W-2G
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
