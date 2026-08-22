/**
 * Seed Member Data API
 * POST /api/commander/members/seed-member-data
 * 
 * Populates realistic simulated data (email, phone, address) for all members
 * in a venue that are missing this information. Used for demo/testing purposes.
 * 
 * Body: { venue_id }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Realistic Texas-area seed data pools
const STREETS = [
    '1234 Oak Ridge Dr', '567 Elm Street', '890 Magnolia Blvd', '2345 Cedar Lane',
    '678 Pecan Valley Rd', '1011 Bluebonnet Ave', '3456 Mockingbird Ln', '789 Willow Creek Dr',
    '4567 Live Oak St', '2468 Mesquite Trail', '1357 Cypress Point Dr', '9876 Longhorn Way',
    '5432 Sunset Ridge Rd', '8765 Prairie View Dr', '1122 Westview Ave', '3344 Lakeshore Dr',
    '5566 Highland Park Blvd', '7788 Riverbend Rd', '9900 Cottonwood Ln', '2211 Stone Creek Dr',
    '4433 Harvest Moon Dr', '6655 Silver Spur Rd', '8877 Timber Ridge Ct', '1100 Canyon Lake Dr',
    '3322 Sycamore St', '5544 Redwood Cir', '7766 Hickory Hollow Ln', '9988 Aspen Grove Way',
    '2233 Birch Valley Dr', '4455 Dogwood Ct', '6677 Juniper Hill Rd', '8899 Palmetto Ave',
];

const CITIES_TX = [
    { city: 'Houston', zip: '77001' }, { city: 'Dallas', zip: '75201' },
    { city: 'Austin', zip: '73301' }, { city: 'San Antonio', zip: '78201' },
    { city: 'Fort Worth', zip: '76101' }, { city: 'Plano', zip: '75023' },
    { city: 'Arlington', zip: '76010' }, { city: 'Frisco', zip: '75033' },
    { city: 'McKinney', zip: '75069' }, { city: 'Round Rock', zip: '78664' },
    { city: 'Sugar Land', zip: '77478' }, { city: 'The Woodlands', zip: '77380' },
    { city: 'Katy', zip: '77449' }, { city: 'Pearland', zip: '77581' },
    { city: 'League City', zip: '77573' }, { city: 'Allen', zip: '75002' },
];

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com'];

const ID_STATES = ['TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'CA', 'FL', 'NY', 'LA', 'OK', 'NM', 'CO', 'NV'];

function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomPhone() {
    const area = ['713', '214', '512', '210', '817', '469', '281', '832', '972', '737'][Math.floor(Math.random() * 10)];
    const mid = String(Math.floor(Math.random() * 900) + 100);
    const end = String(Math.floor(Math.random() * 9000) + 1000);
    return `(${area}) ${mid}-${end}`;
}
function randomDOB() {
    const year = 1955 + Math.floor(Math.random() * 45); // Age 26-70
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function randomIdNumber() {
    return String(Math.floor(Math.random() * 90000000) + 10000000);
}
function randomIdExpiry() {
    const year = 2026 + Math.floor(Math.random() * 6);
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function generateEmail(firstName, lastName) {
    const domain = randomPick(EMAIL_DOMAINS);
    const styles = [
        `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
        `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 99)}@${domain}`,
        `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}@${domain}`,
    ];
    return randomPick(styles);
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const _g = await guardWriteStaff(req, res); if (!_g) return;

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { venue_id } = req.body;
      if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id required' });
      }

      try {
          // Get all members for this venue
          const { data: members, error: fetchErr } = await getSupabase()
              .from('commander_members')
              .select('id, first_name, last_name, email, phone, address, date_of_birth, id_type, id_number, id_state, id_expiry, time_balance_minutes, comp_balance')
              .eq('venue_id', venue_id)
                  .limit(100)

          if (fetchErr) throw fetchErr;
          if (!members || members.length === 0) {
              return res.status(200).json({ success: true, data: { seeded: 0, message: 'No members found in this venue' } });
          }

          let seeded = 0;

          for (const m of members) {
              const updates = {};

              // Fill missing email
              if (!m.email && m.first_name && m.last_name) {
                  updates.email = generateEmail(m.first_name, m.last_name);
              }

              // Fill missing phone
              if (!m.phone) {
                  updates.phone = randomPhone();
              }

              // Fill missing address
              if (!m.address || !m.address.street) {
                  const loc = randomPick(CITIES_TX);
                  updates.address = {
                      street: randomPick(STREETS),
                      city: loc.city,
                      state: 'TX',
                      zip: loc.zip,
                  };
              }

              // Fill missing DOB
              if (!m.date_of_birth) {
                  updates.date_of_birth = randomDOB();
              }

              // Fill missing ID info
              if (!m.id_number) {
                  updates.id_type = 'drivers_license';
                  updates.id_number = randomIdNumber();
                  updates.id_state = randomPick(ID_STATES);
                  updates.id_expiry = randomIdExpiry();
              }

              // Fill missing time balance
              if (!m.time_balance_minutes && m.time_balance_minutes !== 0) {
                  updates.time_balance_minutes = Math.floor(Math.random() * 480) + 60; // 1-9 hours
              }

              // Fill missing comp balance
              if (!m.comp_balance && m.comp_balance !== 0) {
                  updates.comp_balance = Math.floor(Math.random() * 15000) / 100; // $0-$150
              }

              if (Object.keys(updates || {}).length > 0) {
                  updates.updated_at = new Date().toISOString();
                  const { error: upErr } = await getSupabase()
                      .from('commander_members')
                      .update(updates)
                      .eq('id', m.id);
                  if (!upErr) seeded++;
              }
          }

          return res.status(200).json({
              success: true,
              data: { seeded, total: members.length, message: `Seeded ${seeded} of ${members.length} members with simulated data` }
          });
      } catch (err) {
          console.warn('Seed member data error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
