/**
 * Export Jobs API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * GET /api/commander/exports - List export jobs
 * POST /api/commander/exports - Create export job
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { withRateLimit } from '../../../src/lib/commander/rateLimit';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

async function handler(req, res) {
  const _g = await guardWriteStaff(req, res); if (!_g) return;

  if (req.method === 'GET') {
    return listExports(req, res);
  }

  if (req.method === 'POST') {
    return createExport(req, res);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function listExports(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { venue_id, status, limit: rawLimit = '20' } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 20, 100);

    let query = getSupabase()
      .from('commander_export_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (venue_id) {
      // Check if staff
      const { data: staff } = await getSupabase()
        .from('commander_staff')
        .select('id, role')
        .eq('venue_id', venue_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!staff || !['owner', 'manager'].includes(staff.role)) {
        return res.status(403).json({ error: 'Manager access required' });
      }

      query = query.eq('venue_id', venue_id);
    } else {
      query = query.eq('requested_by', user.id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({ exports: data });
  } catch (error) {
    try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('List exports error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createExport(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const {
      venue_id,
      export_type,
      date_from,
      date_to,
      filters = {},
      format = 'csv'
    } = req.body;

    if (!venue_id || !export_type) {
      return res.status(400).json({ error: 'Venue ID and export type required' });
    }

    // Check if staff
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staff || !['owner', 'manager'].includes(staff.role)) {
      return res.status(403).json({ error: 'Manager access required to export data' });
    }

    // Create export job
    const { data: exportJob, error } = await getSupabase()
      .from('commander_export_jobs')
      .insert({
        venue_id: venue_id,
        requested_by: user.id,
        export_type,
        date_from: date_from || null,
        date_to: date_to || null,
        filters,
        format,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Log audit
    await logAction(AuditActions.EXPORT_REQUEST, {
      venueId: venue_id,
      userId: user.id,
      staffId: staff.id,
      actorType: 'staff',
      targetType: 'export',
      targetId: exportJob.id,
      metadata: { export_type, format },
      req
    });

    // Process export immediately for small datasets
    // In production, this would be a background job
    await processExport(exportJob.id);

    // Get updated job
    const { data: updatedJob } = await getSupabase()
      .from('commander_export_jobs')
      .select('*')
      .eq('id', exportJob.id)
      .maybeSingle();

    return res.status(201).json({
      export: updatedJob,
      message: 'Export job created'
    });
  } catch (error) {
    try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Create export error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function processExport(exportId) {
  try {
    // Update status to processing
    await getSupabase()
      .from('commander_export_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', exportId);

    // Get export job
    const { data: job } = await getSupabase()
      .from('commander_export_jobs')
      .select('*')
      .eq('id', exportId)
      .maybeSingle();

    if (!job) return;

    let data = [];
    let query;

    // Build query based on export type
    switch (job.export_type) {
      case 'players':
        query = getSupabase()
          .from('commander_player_stats')
          .select('*, profiles:player_id(display_name, email)')
          .eq('venue_id', job.venue_id);
        break;

      case 'sessions':
        query = getSupabase()
          .from('commander_player_sessions')
          .select('*, profiles:player_id(display_name)')
          .eq('venue_id', job.venue_id)
          .eq('status', 'completed');
        // 2026-07-25 audit fix: column is check_in_at (check_in_time does not exist).
        if (job.date_from) query = query.gte('check_in_at', job.date_from);
        if (job.date_to) query = query.lte('check_in_at', job.date_to + 'T23:59:59');
        break;

      case 'tournaments':
        query = getSupabase()
          .from('commander_tournaments')
          .select('*, commander_tournament_entries(*)')
          .eq('venue_id', job.venue_id);
        if (job.date_from) query = query.gte('scheduled_start', job.date_from);
        if (job.date_to) query = query.lte('scheduled_start', job.date_to + 'T23:59:59');
        break;

      case 'analytics':
        query = getSupabase()
          .from('commander_analytics_daily')
          .select('*')
          .eq('venue_id', job.venue_id);
        if (job.date_from) query = query.gte('date', job.date_from);
        if (job.date_to) query = query.lte('date', job.date_to);
        break;

      case 'comps':
        query = getSupabase()
          .from('commander_member_comp_log')
          .select('*, commander_members:member_id(first_name, last_name)')
          .eq('venue_id', job.venue_id);
        if (job.date_from) query = query.gte('created_at', job.date_from);
        if (job.date_to) query = query.lte('created_at', job.date_to + 'T23:59:59');
        break;

      case 'audit_logs':
        query = getSupabase()
          .from('commander_audit_logs')
          .select('*')
          .eq('venue_id', job.venue_id);
        if (job.date_from) query = query.gte('created_at', job.date_from);
        if (job.date_to) query = query.lte('created_at', job.date_to + 'T23:59:59');
        break;

      default:
        throw new Error(`Unknown export type: ${job.export_type}`);
    }

    const { data: exportData, error } = await query.order('created_at', { ascending: false })
      .limit(10000);

    if (error) throw error;

    data = exportData || [];

    // Convert to format
    let fileContent;
    if (job.format === 'json') {
      fileContent = JSON.stringify(data, null, 2);
    } else {
      // CSV format
      fileContent = convertToCSV(data);
    }

    // In production, upload to storage and get URL
    // For now, store as base64 in metadata
    const fileUrl = `data:text/${job.format};base64,${Buffer.from(fileContent).toString('base64')}`;

    // Update job as completed
    await getSupabase()
      .from('commander_export_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        file_url: fileUrl,
        file_size: fileContent.length,
        row_count: data.length,
        progress: 100
      })
      .eq('id', exportId);

  } catch (error) {
    try { reportApiError(error); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Process export error:', error);
    await getSupabase()
      .from('commander_export_jobs')
      .update({
        status: 'failed',
        error_message: error.message
      })
      .eq('id', exportId);
  }
}

function convertToCSV(data) {
  if (!data || data.length === 0) return '';

  // Flatten nested objects
  const flatData = data.map(row => flattenObject(row));

  // Get all unique keys
  const allKeys = [...new Set(flatData.flatMap(row => Object.keys(row || {})))];

  // Create header row
  const header = allKeys.join(',');

  // Create data rows
  const rows = flatData.map(row => {
    return allKeys.map(key => {
      const value = row[key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') {
        // 2026-07-25 audit fix: guard leading =,+,-,@ against spreadsheet formula injection.
        let v = value;
        if (/^[=+\-@]/.test(v)) v = `'${v}`;
        if (v.includes(',') || v.includes('"') || v.includes('\n') || v !== value) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      }
      return value;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

function flattenObject(obj, prefix = '') {
  const result = {};
  for (const key in obj) {
    const newKey = prefix ? `${prefix}_${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(result, flattenObject(obj[key], newKey));
    } else if (Array.isArray(obj[key])) {
      result[newKey] = JSON.stringify(obj[key]);
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
}

export default withRateLimit(handler, 'export');
