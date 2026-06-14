import { describe, expect, it, vi } from 'vitest';
import {
  handleResolvePublicScan,
  type RegistryLookup,
  type ResolvePublicScanDeps,
  type RunFileRow,
} from './resolvePublicScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolvePublicScan` is the server-side resolution of one identity's
 * `nmap <public IP>` against ANOTHER identity's registered network (Story 1). It
 * verifies the caller's envelope and looks the target public IP up in the registry
 * written on join. Slice 1a reported existence (host up/down); slice 1b reads the
 * resolved machine's REAL open ports from its persisted `/var/run/*.pid` patch rows
 * — scoped to the registry's owner — so a cross-player scan shows the ports the
 * owner actually started, never a regeneration.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const REGISTERED: RegistryLookup = {
  workstation_machine_id: 'skylab-deadbeef',
  owner_key: 'a'.repeat(64),
};

type LookupResult = { data: RegistryLookup | null; error: unknown };
type RunFilesResult = { data: readonly RunFileRow[] | null; error: unknown };

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: null, error: null }),
  runFiles: () => Promise<RunFilesResult> = async () => ({ data: [], error: null }),
) => {
  const findRegistryByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(lookup);
  const findRunFiles =
    vi.fn<(query: { machine_id: string; owner_key: string }) => Promise<RunFilesResult>>(runFiles);
  const deps: ResolvePublicScanDeps = {
    nonceStore: freshStore,
    findRegistryByPublicIp,
    findRunFiles,
  };
  return { deps, findRegistryByPublicIp, findRunFiles };
};

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  target: string,
  over: Record<string, unknown> = {},
) => signRequest(id, 'resolvePublicScan', { target, ...over });

describe('handleResolvePublicScan', () => {
  it('resolves a registered public IP to a found host', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps(async () => ({ data: REGISTERED, error: null }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: true, ports: [] } });
    expect(findRegistryByPublicIp).toHaveBeenCalledWith(TARGET);
  });

  it('reports an unregistered public IP as not found, with no ports', async () => {
    const id = generateIdentity();
    const { deps, findRunFiles } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleResolvePublicScan(envelope(id, '203.0.113.99'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    // No registry row → no machine to read ports from; the run-files read is skipped.
    expect(findRunFiles).not.toHaveBeenCalled();
  });

  it("reads the resolved machine's open ports from its /var/run pidfile rows, scoped to the owner", async () => {
    const id = generateIdentity();
    const { deps, findRunFiles } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: [{ path: '/var/run/sshd.pid', content: 'sshd:port=22' }], error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
    // The ports come from the OWNER's rows on the resolved workstation, never the
    // caller's — so the scope must carry the registry's owner_key + machine_id.
    expect(findRunFiles).toHaveBeenCalledWith({
      machine_id: REGISTERED.workstation_machine_id,
      owner_key: REGISTERED.owner_key,
    });
  });

  it('reflects a non-default port from the pidfile (the real record, not a hardcoded 22)', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: [{ path: '/var/run/sshd.pid', content: 'sshd:port=2222' }], error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 2222, service: 'ssh' }] },
    });
  });

  it('returns the host up with no ports when the registered machine runs no services', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: [], error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: true, ports: [] } });
  });

  it('degrades a null run-files result (no error) to host-up with no ports', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: null, error: null }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: true, ports: [] } });
  });

  it('skips /var/run rows that are not recognised pidfiles, keeping only real services', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({
        data: [
          { path: '/var/run/sshd.pid', content: 'sshd:port=22' },
          { path: '/var/run/mystery.pid', content: 'whatever' },
        ],
        error: null,
      }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    // The unknown pidfile contributes no port; only the recognised sshd service shows.
    expect(result).toEqual({
      status: 200,
      body: { ok: true, found: true, ports: [{ port: 22, service: 'ssh' }] },
    });
  });

  it('reports a server error when the run-files lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(
      async () => ({ data: REGISTERED, error: null }),
      async () => ({ data: null, error: new Error('db down') }),
    );

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'ports_lookup_failed' } });
  });

  it('rejects a tampered envelope without looking up the registry', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();
    const signed = envelope(id, TARGET);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolvePublicScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(envelope(id, TARGET, { player_key: 'attacker' }), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByPublicIp } = makeDeps();

    const result = await handleResolvePublicScan(signRequest(id, 'resolvePublicScan', {}), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleResolvePublicScan(envelope(id, TARGET), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });
});
