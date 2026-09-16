/**
 * Club Logo Upload API
 * POST /api/commander/settings/logo - Upload club logo to Supabase Storage
 * DELETE /api/commander/settings/logo - Remove club logo
 * 
 * Uses base64 JSON body instead of multipart for simplicity.
 * Client sends: { data: "base64string...", filename: "logo.png", contentType: "image/png" }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Increase body size limit for base64 uploads (5MB file → ~7MB base64)
export const config = {
    api: { bodyParser: { sizeLimit: '8mb' } }
};

const BUCKET = 'club-logos';

// Ensure bucket exists (idempotent)
async function ensureBucket() {
    try {
        const { data: buckets } = await getSupabase().storage.listBuckets();
        const exists = buckets?.some(b => b.name === BUCKET);
        if (!exists) {
            await getSupabase().storage.createBucket(BUCKET, { public: true });
        }
    } catch (err) {
        console.warn('Bucket check error:', err);
    }
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const staff = await guardManager(req, res);
      if (!staff) return;

      try {
          // ── DELETE: Remove logo ──────────────────────────────────────
          if (req.method === 'DELETE') {
              const { data: settings } = await getSupabase()
                  .from('commander_venue_settings')
                  .select('club_logo_url')
                  .eq('venue_id', staff.venue_id)
                  .maybeSingle();

              if (settings?.club_logo_url) {
                  const urlParts = settings.club_logo_url.split(`/${BUCKET}/`);
                  if (urlParts[1]) {
                      await getSupabase().storage.from(BUCKET).remove([urlParts[1]]);
                  }
              }

              const { error } = await getSupabase()
                  .from('commander_venue_settings')
                  .upsert({
                      venue_id: staff.venue_id,
                      club_logo_url: null,
                      updated_at: new Date().toISOString(),
                      updated_by: staff.id
                  }, { onConflict: 'venue_id' });

              if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
              return res.status(200).json({ success: true, data: { club_logo_url: null } });
          }

          // ── POST: Upload logo (base64 JSON body) ─────────────────────
          if (req.method === 'POST') {
              const { data: base64Data, filename, contentType } = req.body || {};

              if (!base64Data || !contentType) {
                  return res.status(400).json({ success: false, error: 'Missing logo data. Send { data, filename, contentType }.' });
              }

              // Validate content type
              const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
              if (!allowedTypes.includes(contentType)) {
                  return res.status(400).json({ success: false, error: 'Invalid file type. Use PNG, JPG, WebP, SVG, or GIF.' });
              }

              // Decode base64 to buffer
              const buffer = Buffer.from(base64Data, 'base64');

              // Max 5MB
              if (buffer.length > 5 * 1024 * 1024) {
                  return res.status(400).json({ success: false, error: 'File too large. Maximum 5MB.' });
              }

              // Ensure bucket exists
              await ensureBucket();

              const ext = (filename || 'logo.png').split('.').pop() || 'png';
              const storagePath = `${staff.venue_id}/logo-${Date.now()}.${ext}`;

              // Delete old logo if exists
              const { data: existingSettings } = await getSupabase()
                  .from('commander_venue_settings')
                  .select('club_logo_url')
                  .eq('venue_id', staff.venue_id)
                  .maybeSingle();

              if (existingSettings?.club_logo_url) {
                  const urlParts = existingSettings.club_logo_url.split(`/${BUCKET}/`);
                  if (urlParts[1]) {
                      await getSupabase().storage.from(BUCKET).remove([urlParts[1]]);
                  }
              }

              // Upload
              const { error: uploadError } = await getSupabase().storage
                  .from(BUCKET)
                  .upload(storagePath, buffer, {
                      contentType,
                      cacheControl: '3600',
                      upsert: true
                  });

              if (uploadError) {
                  console.warn('Logo upload error:', uploadError);
                  return res.status(500).json({ success: false, error: `Upload failed: ${uploadError.message}` });
              }

              // Get public URL
              const { data: publicUrlData } = getSupabase().storage
                  .from(BUCKET)
                  .getPublicUrl(storagePath);

              const logoUrl = publicUrlData.publicUrl;

              // Save URL to settings
              const { error: saveError } = await getSupabase()
                  .from('commander_venue_settings')
                  .upsert({
                      venue_id: staff.venue_id,
                      club_logo_url: logoUrl,
                      updated_at: new Date().toISOString(),
                      updated_by: staff.id
                  }, { onConflict: 'venue_id' });

              if (saveError) {
                  return res.status(500).json({ success: false, error: saveError.message });
              }

              return res.status(200).json({
                  success: true,
                  data: { club_logo_url: logoUrl }
              });
          }

          return res.status(405).json({ success: false, error: 'Method not allowed' });
      } catch (err) {
          console.warn('Logo API error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
