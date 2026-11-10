import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SIGNUP_NETWORK_REFUSED,
  SIGNUP_NETWORK_UNCHECKED,
  signupClientAddress,
  signupNetworkRefusal,
} from '../../src/lib/commander/signupNetwork';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const client = (reply) => ({ rpc: vi.fn(async () => reply) });
const EDGE = { 'x-real-ip': '198.51.100.7' };

describe('a Commander registration asks the banned-network rule', () => {
  it('reads only the address Vercel sets, never a client x-forwarded-for', () => {
    expect(signupClientAddress({ 'x-real-ip': '198.51.100.7' })).toBe('198.51.100.7');
    expect(signupClientAddress({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' })).toBe(
      '203.0.113.9'
    );
    expect(signupClientAddress({ 'x-forwarded-for': '192.0.2.1' })).toBeNull();
  });

  it('refuses with 403 when the rule refuses, passing the edge address', async () => {
    const supabase = client({ data: { error: { http_code: 403, message: 'x' } }, error: null });
    expect(await signupNetworkRefusal(supabase, EDGE)).toEqual({
      status: 403,
      body: SIGNUP_NETWORK_REFUSED,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('fn_a_banned_network_cannot_create_an_account', {
      event: { metadata: { ip_address: '198.51.100.7' } },
    });
  });

  it('allows the account when the rule answers {}', async () => {
    expect(await signupNetworkRefusal(client({ data: {}, error: null }), EDGE)).toBeNull();
  });

  it('fails closed when the rule cannot be asked', async () => {
    const closed = { status: 503, body: SIGNUP_NETWORK_UNCHECKED };
    expect(await signupNetworkRefusal(client({ data: {} }), {})).toEqual(closed);
    expect(
      await signupNetworkRefusal(client({ data: null, error: { message: 'permission denied' } }), EDGE)
    ).toEqual(closed);
    const throwing = { rpc: vi.fn(async () => { throw new Error('network'); }) };
    expect(await signupNetworkRefusal(throwing, EDGE)).toEqual(closed);
  });

  it('runs before the only admin.createUser in registration', () => {
    const src = readFileSync(join(ROOT, 'pages/api/create-subscription.js'), 'utf8');
    const check = src.indexOf('await signupNetworkRefusal(getSupabase(), req.headers)');
    const create = src.indexOf('auth.admin.createUser(');
    expect(check).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(check);
    expect(src.indexOf('auth.admin.createUser(', create + 1)).toBe(-1);
  });
});
