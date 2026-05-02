import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindActiveSession } from './supabaseFindActive';
import type { FindActiveSessionParams } from './supabaseFindActive';

const params: FindActiveSessionParams = {
  player_key: 'pubkey-hex',
  machine_id: '10.0.0.1',
};

const userCreds = { username: 'alice', userType: 'user' as const };
const rootCreds = { username: 'root', userType: 'root' as const };
const guestCreds = { username: 'guest', userType: 'guest' as const };

describe('createSupabaseFindActiveSession', () => {
  it('returns ok: true with exists: true and credentials when query returns a row', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: '11111111-2222-4333-8444-555555555555', credentials: userCreds }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: true, credentials: userCreds });
  });

  it('returns ok: true with exists: false when query returns an empty array', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: false });
  });

  it('returns ok: true with exists: false when data is null and no error (defensive)', async () => {
    // Guards against SDK shapes where data === null without an error.
    const query = vi.fn().mockResolvedValue({ data: null, error: null });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: true, exists: false });
  });

  it('returns ok: false when supabase returns an error (DB outage / RLS / network)', async () => {
    // Distinct from "no session" — the lookup itself failed. Handler maps
    // this to 500 (server can't determine), not 403 (no session).
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'connection lost' } });
    const find = createSupabaseFindActiveSession(query);

    expect(await find(params)).toEqual({ ok: false });
  });

  it('forwards player_key and machine_id verbatim to the query', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindActiveSession(query);

    await find({ player_key: 'another-key', machine_id: '192.168.50.10' });

    expect(query).toHaveBeenCalledWith({
      player_key: 'another-key',
      machine_id: '192.168.50.10',
    });
  });

  it('surfaces root userType verbatim when the session is rooted', async () => {
    // L2 will key its walker call on the returned userType. A surviving
    // mutant that hardcodes 'user' or strips the field would let a root
    // session degrade to user-level perms (or vice versa).
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: 'sess-1', credentials: rootCreds }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);
    const result = await find(params);
    expect(result).toEqual({ ok: true, exists: true, credentials: rootCreds });
  });

  it('surfaces guest userType verbatim when the session is a guest shell', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: 'sess-2', credentials: guestCreds }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);
    const result = await find(params);
    expect(result).toEqual({ ok: true, exists: true, credentials: guestCreds });
  });

  it('returns ok: false when a row exists but credentials JSONB is malformed', async () => {
    // Defensive: if the stored JSONB is missing username or userType (a
    // class of bug we'd want to fail closed on), treat it as a lookup
    // failure rather than fabricating fields. Handler maps to 500; an
    // attacker can't claim the missing fields client-side.
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: 'sess-3', credentials: { foo: 'bar' } }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);
    expect(await find(params)).toEqual({ ok: false });
  });

  it('returns ok: false when credentials.userType is not in the allowed enum', async () => {
    // Strict zod parse — an attacker who somehow inserted a row with
    // userType='admin' wouldn't be honored.
    const query = vi.fn().mockResolvedValue({
      data: [{ session_id: 'sess-4', credentials: { username: 'mallory', userType: 'admin' } }],
      error: null,
    });
    const find = createSupabaseFindActiveSession(query);
    expect(await find(params)).toEqual({ ok: false });
  });
});
