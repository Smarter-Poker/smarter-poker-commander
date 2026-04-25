/**
 * Membership Plans — Image-Based Layout with JS Click Detection
 * /commander/membership-plans
 *
 * Uses the exact mockup image as the page.
 * Clicks anywhere on the image are detected via JS — the Y position
 * relative to the image determines which plan card was tapped.
 * The edit popover appears directly on top of the clicked card.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { Loader2, Check } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import SEOHead from '../../src/components/seo/SEOHead';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const PLAN_ORDER = ['daily', 'weekly', 'monthly', 'yearly'];
const PLAN_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const PRICE_SUFFIX = { daily: ' Per Day', weekly: ' Per Week', monthly: ' Per Month', yearly: ' Per Year' };
// Y% positioning: centered within each card zone (measured from background image)
const PRICE_TEXT_Y = { daily: 32.5, weekly: 45, monthly: 58, yearly: 71 };

// Card zones in the source image — measured as percentage of image height
// Each entry: [topPercent, bottomPercent]
const CARD_ZONES = {
  daily: [27, 38],
  weekly: [39, 51],
  monthly: [52, 64],
  yearly: [65, 77] };

function getPlanPrice(plan) {
  if (plan.tier === 'daily') return plan.price_daily;
  if (plan.tier === 'weekly') return plan.price_weekly;
  if (plan.tier === 'monthly') return plan.price_monthly;
  if (plan.tier === 'yearly') return plan.price_yearly;
  return null;
}

function getPriceField(tier) {
  return tier === 'daily' ? 'price_daily'
    : tier === 'weekly' ? 'price_weekly'
      : tier === 'monthly' ? 'price_monthly'
        : 'price_yearly';
}

export default function MembershipPlansPage() {
  useEffect(() => { busEmit.sessionStart('commander-membership-plans'); }, []);
  const router = useRouter();
  const imgRef = useRef(null);
  const [venueId, setVenueId] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTier, setEditingTier] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const s = getStaffSession();
    if (!s) return router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    try {
      const sd = JSON.parse(s);
      if (!sd.venue_id) return router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      setVenueId(sd.venue_id);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  useEffect(() => { if (venueId) { const _c = new AbortController(); fetchPlans(_c.signal); return () => _c.abort(); } }, [venueId]);

  // Commander Data Bus — sync plans
  useCommanderSync(venueId, fetchPlans, { entities: ['settings'] });

  async function fetchPlans(signal) {
    setLoading(true);
    try {
const data = await commanderFetchJSON(`/api/commander/membership-plans?venue_id=${venueId}&include_inactive=true`);
      if (data.success) {
        const p = data.data.plans || [];
        p.sort((a, b) => PLAN_ORDER.indexOf(a.tier) - PLAN_ORDER.indexOf(b.tier));
        setPlans(p);
      }
    } catch { setError('Failed To Load Plans'); }
    setLoading(false);
  }

  // Map plans by tier
  const planByTier = {};
  plans.forEach(p => { planByTier[p.tier] = p; });

  // JS click detection: calculate Y% relative to image, map to card zone
  const handleImageClick = useCallback((e) => {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const yPercent = (clickY / rect.height) * 100;

    // Find which card zone was clicked
    for (const [tier, [top, bottom]] of Object.entries(CARD_ZONES || {})) {
      if (yPercent >= top && yPercent <= bottom) {
        const plan = planByTier[tier];
        if (plan) {
          setEditingId(plan.id);
          setEditingTier(tier);
          const price = getPlanPrice(plan);
          setEditPrice(price != null ? String(Number(price)) : '');
          setError(null);
        }
        return;
      }
    }
    // Click was outside any card zone — do nothing
  }, [planByTier]);

  function closeEditor() {
    setEditingId(null);
    setEditingTier(null);
    setError(null);
  }

  async function savePrice(plan) {
    setSaving(plan.id);
    setError(null);
    try {
      const price = parseFloat(editPrice);
      if (isNaN(price) || price < 0) { setError('Enter A Valid Price'); setSaving(null); return; }
      const field = getPriceField(plan.tier);
const res = await commanderFetch(`/api/commander/membership-plans?venue_id=${venueId}&id=${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' || '' },
        body: JSON.stringify({ [field]: price })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccess('Price Updated!');
      setTimeout(() => setSuccess(null), 3000);
      closeEditor();
      fetchPlans();
      broadcastChange('settings');
    } catch (err) { setError(err.message || 'Failed To Save'); }
    setSaving(null);
  }

  // Calculate the popover position based on the card zone
  const editingPlan = editingId ? plans.find(p => p.id === editingId) : null;
  const editingZone = editingTier ? CARD_ZONES[editingTier] : null;

  return (
    <CommanderLayout title="Membership Plans" backHref="/commander/dashboard">
      <SEOHead
              title="Commander — Membership Plans"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        .mp-page {
          min-height: 100vh;
          background: #0f0f0f;
          font-family: 'Inter', sans-serif;
          padding: 0;
          margin: 0;
        }
        .mp-container {
          position: relative;
          width: 100%;
        }
        .mp-bg-img {
          width: 100%;
          display: block;
          cursor: pointer;
        }
        /* Inline edit popover — positioned absolutely over the card */
        .mp-edit-popover {
          position: absolute;
          left: 8%;
          right: 8%;
          z-index: 300;
          background: linear-gradient(135deg, rgba(20,20,30,0.97) 0%, rgba(14,14,18,0.97) 100%);
          border: 2px solid #4a4aff;
          border-radius: 16px;
          padding: 16px 18px;
          box-shadow: 0 8px 32px rgba(74,74,255,0.25), 0 0 60px rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          gap: 14px;
          backdrop-filter: blur(12px);
          animation: mp-popIn 0.2s ease-out;
        }
        @keyframes mp-popIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        .mp-edit-label {
          font-size: 14px;
          font-weight: 700;
          color: #ccc;
          white-space: nowrap;
          min-width: 60px;
        }
        .mp-edit-label strong {
          display: block;
          font-size: 16px;
          color: #fff;
          margin-bottom: 2px;
        }
        .mp-edit-inline-input-wrap {
          position: relative;
          flex: 0 0 auto;
          width: 110px;
        }
        .mp-edit-inline-input-wrap .pfx {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 20px;
          font-weight: 800;
          color: #666;
          pointer-events: none;
        }
        .mp-edit-inline-input {
          width: 100%;
          background: #111;
          border: 2px solid #444;
          border-radius: 10px;
          padding: 10px 12px 10px 32px;
          color: #fff;
          font-size: 22px;
          font-weight: 900;
          outline: none;
          text-align: center;
          transition: border-color 0.2s;
        }
        .mp-edit-inline-input:focus { border-color: #4a4aff; }
        .mp-edit-inline-btns {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        .mp-btn-save {
          background: linear-gradient(135deg, #31A24C, #1e7a34);
          border: none;
          border-radius: 10px;
          padding: 10px 18px;
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          box-shadow: 0 2px 8px rgba(49,162,76,0.3);
          transition: opacity 0.2s;
          white-space: nowrap;
        }
        .mp-btn-save:hover { opacity: 0.9; }
        .mp-btn-cancel {
          background: rgba(255,255,255,0.07);
          border: 1px solid #444;
          border-radius: 10px;
          padding: 10px 14px;
          color: #999;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .mp-btn-cancel:hover { border-color: #666; color: #fff; }
        /* Dynamic price overlay — white text centered in the right-side gap of each card */
        .mp-price-overlay {
          position: absolute;
          left: 72%;
          transform: translate(-50%, -50%);
          display: flex;
          justify-content: center;
          text-align: center;
          align-items: center;
          pointer-events: none;
          z-index: 10;
          font-family: 'Inter', -apple-system, sans-serif;
          font-size: clamp(16px, 2.8vw, 28px);
          font-weight: 700;
          color: #ffffff;
          letter-spacing: 0.5px;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.4);
          background: none;
        }
        /* Scrim behind popover to catch dismiss clicks */
        .mp-scrim {
          position: fixed;
          inset: 0;
          z-index: 299;
          background: rgba(0,0,0,0.45);
        }
        .mp-toast {
          position: fixed;
          top: 70px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 400;
          padding: 12px 24px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 700;
        }
        .mp-toast.ok { background: rgba(49,162,76,0.95); color: #fff; box-shadow: 0 4px 16px rgba(49,162,76,0.4); }
        .mp-toast.err { background: rgba(239,68,68,0.95); color: #fff; box-shadow: 0 4px 16px rgba(239,68,68,0.4); }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Responsive: stack vertically on narrow screens */
        @media (max-width: 480px) {
          .mp-edit-popover {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            left: 5%;
            right: 5%;
            padding: 14px;
          }
          .mp-edit-label {
            text-align: center;
          }
          .mp-edit-inline-input-wrap {
            width: 100%;
          }
          .mp-edit-inline-btns {
            justify-content: center;
            margin-left: 0;
          }
        }
      `}</style>

      <div className="mp-page">
        {/* Toasts */}
        {success && <div className="mp-toast ok">✓ {success}</div>}
        {error && !editingId && <div className="mp-toast err">⚠ {error}</div>}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#1877F2' }} />
          </div>
        ) : (
          <div className="mp-container">
            {/* Scrim to dismiss popover when clicking outside */}
            {editingId && <div className="mp-scrim" onClick={closeEditor} />}

            {/* Full-width background image — click detection via JS */}
            <img
              ref={imgRef}
              src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/commander/membership-plans-bg-user-clean.jpg`}
              alt="Membership Plans"
              className="mp-bg-img"
              draggable={false}
              onClick={handleImageClick}
             loading="lazy" />

            {/* Dynamic price overlays — positioned on each card zone */}
            {PLAN_ORDER.map(tier => {
              const plan = planByTier[tier];
              if (!plan) return null;
              const price = getPlanPrice(plan);
              if (price == null) return null;
              const yPct = PRICE_TEXT_Y[tier];
              return (
                <div
                  key={tier}
                  className="mp-price-overlay"
                  style={{ top: `${yPct}%` }}
                >
                  ${Number(price)}{PRICE_SUFFIX[tier]}
                </div>
              );
            })}

            {/* Inline edit popover — anchored directly over the clicked card */}
            {editingPlan && editingZone && (() => {
              const [topPct, bottomPct] = editingZone;
              const midPct = (topPct + bottomPct) / 2;
              const heightPct = bottomPct - topPct;
              const meta = PLAN_LABELS[editingPlan.tier] || editingPlan.tier;
              return (
                <div
                  className="mp-edit-popover"
                  style={{
                    top: `${midPct}%`,
                    transform: 'translateY(-50%)',
                    minHeight: `${heightPct}%` }}
                >
                  <div className="mp-edit-label">
                    <strong>{meta}</strong>
                    Price
                  </div>
                  <div className="mp-edit-inline-input-wrap">
                    <span className="pfx">$</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      className="mp-edit-inline-input"
                      value={editPrice}
                      onChange={e => setEditPrice(e.target.value)}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') savePrice(editingPlan);
                        if (e.key === 'Escape') closeEditor();
                      }}
                    />
                  </div>
                  {error && <div style={{ color: '#EF4444', fontSize: 12, fontWeight: 600 }}>⚠ {error}</div>}
                  <div className="mp-edit-inline-btns">
                    <button className="mp-btn-cancel" onClick={closeEditor}>✕</button>
                    <button className="mp-btn-save" disabled={saving === editingPlan.id} onClick={() => savePrice(editingPlan)}>
                      {saving === editingPlan.id
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Check size={14} />}
                      Save
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}
