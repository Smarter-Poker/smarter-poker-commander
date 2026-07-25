import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else {
      if (!applyRateLimit(req, res, LIMITS.read)) return;
    }

    try {
    // NOTE: these are platform-admin endpoints; guardManager plus the PIN
    // middleware protect them.
    const _g = await guardManager(req, res); if (!_g) return;

    if (req.method === 'GET') {
      // 2026-07-25 audit fix: demo requests land in commander_onboarding_leads
      // while landing-page signups land in commander_leads — query BOTH and
      // merge, tagging each row with source 'landing' | 'onboarding'.
      const { status } = req.query;

      let onboardingQuery = getSupabase().from('commander_onboarding_leads').select('*').order('created_at', { ascending: false });
      let landingQuery = getSupabase().from('commander_leads').select('*').order('created_at', { ascending: false });
      if (status && status !== 'all') {
        onboardingQuery = onboardingQuery.eq('status', status);
        landingQuery = landingQuery.eq('status', status);
      }

      const [onboardingRes, landingRes] = await Promise.all([onboardingQuery, landingQuery]);
      if (onboardingRes.error && landingRes.error) {
        return res.status(500).json({ success: false, error: onboardingRes.error.message });
      }
      if (onboardingRes.error) console.warn('[Admin Leads] onboarding query error:', onboardingRes.error.message);
      if (landingRes.error) console.warn('[Admin Leads] landing query error:', landingRes.error.message);

      const leads = [
        ...(onboardingRes.data || []).map(l => ({ ...l, source: 'onboarding' })),
        ...(landingRes.data || []).map(l => ({ ...l, original_source: l.source, source: 'landing' })),
      ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      return res.json({ success: true, data: { leads } });
    }

    if (req.method === 'PATCH') {
      // 2026-07-25 audit fix: update the table the lead actually lives in,
      // selected by body.source ('landing' | 'onboarding', default onboarding).
      const { id, status, notes, source } = req.body;
      if (!id) return res.status(400).json({ success: false, error: 'id required' });
      const table = source === 'landing' ? 'commander_leads' : 'commander_onboarding_leads';
      const updates = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No updates provided' });
      }
      const { data, error } = await getSupabase().from(table).update(updates).eq('id', id).select().maybeSingle();
      if (error || !data) return res.status(404).json({ success: false, error: 'Lead not found' });
      return res.json({ success: true, data: { lead: data } });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('[pages/api/commander/admin/leads.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
