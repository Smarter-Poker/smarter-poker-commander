/**
 * Commander Leads API
 * POST /api/commander/leads - Capture lead from landing page
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';
// Note: No auth guard - this is a public lead capture form. Protected by IP rate limiting.

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
    }

    // Rate limit: 5 leads per minute per IP (public endpoint)
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`leads:${ip}`, 5, 60000);
    if (!rl.allowed) { return res.status(429).json({ success: false, error: 'Too many requests' }); }


    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
      const { email, source, referrer, plan } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }

      // Check if lead already exists
      const { data: existing } = await getSupabase()
        .from('commander_leads')
        .select('id, email, visit_count')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (existing) {
        // Update existing lead with new activity
        await getSupabase()
          .from('commander_leads')
          .update({
            last_activity: new Date().toISOString(),
            visit_count: (existing.visit_count || 0) + 1
          })
          .eq('id', existing.id);

        return res.status(200).json({
          success: true,
          message: 'Welcome back!',
          lead_id: existing.id
        });
      }

      // Create new lead
      const { data: lead, error } = await getSupabase()
        .from('commander_leads')
        .insert({
          email: email.toLowerCase(),
          source: source || 'landing_page',
          referrer: referrer || req.headers.referer,
          interested_plan: plan || null,
          status: 'new',
          visit_count: 1,
          created_at: new Date().toISOString(),
          last_activity: new Date().toISOString()
        })
        .select()
        .maybeSingle();

      if (error) {
        // Table might not exist, just log and continue
        console.warn('Lead capture error:', error);
        return res.status(200).json({
          success: true,
          message: 'Thanks for your interest!'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Thanks for your interest!',
        lead_id: lead?.id
      });
    } catch (error) {
      console.warn('Leads API error:', error);
      // Don't fail the user experience if lead capture fails
      return res.status(200).json({
        success: true,
        message: 'Thanks for your interest!'
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
