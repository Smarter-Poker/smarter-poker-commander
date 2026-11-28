/**
 * Membership Plans - /commander/membership-plans
 *
 * One steel-rimmed surface with a row per plan (Daily, Weekly, Monthly,
 * Yearly): live price, Edit Price opens the inline editor, Save writes the
 * plan's price field through the existing API (#SMARTERDESIGN, 2026-11-27).
 */
import { useState, useEffect } from 'react';
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

  // Commander Data Bus - sync plans
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
      if (!res.ok) throw new Error('Request Failed');
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

  const editingPlan = editingId ? plans.find(p => p.id === editingId) : null;

  function startEdit(plan) {
    setEditingId(plan.id);
    setEditingTier(plan.tier);
    const price = getPlanPrice(plan);
    setEditPrice(price != null ? String(Number(price)) : '');
    setError(null);
  }

  // #SMARTERDESIGN (Dan, 2026-11-27): this page used to BE a painted mockup
  // image (membership-plans-bg-user-clean.jpg) with prices floated over it and
  // clicks mapped to Y-percent zones. Same plans, same price editor and save,
  // now real cards on the steel-rim surface with live, selectable text.
  return (
    <CommanderLayout title="Membership Plans" backHref="/commander/dashboard">
      <SEOHead
        title="Commander - Membership Plans"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="mp-page">
        {success && <div className="mp-toast ok" role="status">{success}</div>}
        {error && !editingId && <div className="mp-toast err" role="alert">{error}</div>}

        {loading ? (
          <div className="mp-loading"><Loader2 size={32} className="animate-spin" aria-label="Loading Plans" /></div>
        ) : (
          <section className="sd-panel mp-plans" aria-label="Membership Plans">
            {PLAN_ORDER.map((tier) => {
              const plan = planByTier[tier];
              if (!plan) return null;
              const price = getPlanPrice(plan);
              const editing = editingId === plan.id;
              return (
                <article key={tier} className="mp-plan" data-tier={tier}>
                  <div className="mp-plan__copy">
                    <h2 className="mp-plan__name">{PLAN_LABELS[tier]}</h2>
                    {plan.is_active === false ? <span className="mp-plan__state">Inactive</span> : null}
                  </div>
                  {editing ? (
                    <div className="mp-plan__edit">
                      <label className="mp-plan__field">
                        <span className="sr-only">{PLAN_LABELS[tier]} Price</span>
                        <span className="mp-plan__pfx" aria-hidden="true">$</span>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          inputMode="decimal"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') savePrice(plan);
                            if (e.key === 'Escape') closeEditor();
                          }}
                        />
                      </label>
                      <button type="button" className="sd-button" onClick={closeEditor}>Cancel</button>
                      <button type="button" className="sd-button sd-primary" disabled={saving === plan.id} onClick={() => savePrice(plan)}>
                        {saving === plan.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />} Save
                      </button>
                      {error ? <p className="mp-plan__error" role="alert">{error}</p> : null}
                    </div>
                  ) : (
                    <>
                      <p className="mp-plan__price">
                        {price == null ? 'Not Set' : <>${Number(price)}<span>{PRICE_SUFFIX[tier]}</span></>}
                      </p>
                      <button type="button" className="sd-button" onClick={() => startEdit(plan)} aria-label={`Edit ${PLAN_LABELS[tier]} Price`}>
                        Edit Price
                      </button>
                    </>
                  )}
                </article>
              );
            })}
            {PLAN_ORDER.every((t) => !planByTier[t]) ? (
              <p className="mp-empty">No Membership Plans Are Set Up For This Venue Yet.</p>
            ) : null}
          </section>
        )}
      </div>
      <style>{`
        .mp-page { max-width: 880px; margin: 0 auto; padding: 4px clamp(8px, 2vw, 24px) 96px; }
        .mp-loading { display: flex; justify-content: center; padding: 80px 0; color: #86DAFF; }
        .mp-plans { display: grid; gap: 0; }
        .mp-plan { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 14px; padding: 14px 4px; border-bottom: 1px solid #1d3550; }
        .mp-plan:last-of-type { border-bottom: 0; }
        .mp-plan__name { margin: 0; color: #F2F7FF; font: 700 clamp(1.25rem, 3vw, 1.6rem)/1.1 var(--sd-type); }
        .mp-plan__state { display: inline-block; margin-top: 4px; color: #BDD0E2; font-size: .8rem; font-weight: 700; }
        .mp-plan__price { margin: 0; color: #F2F7FF; font: 700 clamp(1.3rem, 3.4vw, 1.75rem)/1 var(--sd-type); font-variant-numeric: tabular-nums; text-align: right; }
        .mp-plan__price span { margin-left: 6px; color: #BDD0E2; font-size: .62em; font-weight: 600; }
        .mp-plan__edit { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
        .mp-plan__field { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 10px; border: 1px solid #445E77; background: #071420; border-radius: 8px; }
        .mp-plan__field input { width: 7.5rem; border: 0 !important; background: transparent !important; box-shadow: none !important; color: #F2F7FF; font: 700 1.2rem var(--sd-type); font-variant-numeric: tabular-nums; }
        .mp-plan__pfx { color: #BDD0E2; font-weight: 700; }
        .mp-plan__error { flex-basis: 100%; margin: 0; color: #F87171; font-size: .82rem; font-weight: 600; text-align: right; }
        .mp-empty { margin: 0; padding: 24px 8px; color: #BDD0E2; text-align: center; }
        .mp-toast { position: fixed; top: 84px; left: 50%; transform: translateX(-50%); z-index: 60; padding: 10px 18px; border-radius: 10px; font-weight: 700; color: #fff; }
        .mp-toast.ok { background: #166534; }
        .mp-toast.err { background: #991B1B; }
        @media (max-width: 560px) {
          .mp-plan { grid-template-columns: minmax(0, 1fr) auto; }
          .mp-plan > .sd-button { grid-column: 1 / -1; }
          .mp-plan__edit { grid-column: 1 / -1; justify-content: stretch; }
        }
      `}</style>
    </CommanderLayout>
  );
}
