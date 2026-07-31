import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices, WEAK_PASSWORDS } from '../generation/remoteHostFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { WORDLIST_PATH, formatWordlist } from '../wordlist/defaultWordlist';
import { accountsIn } from './passwdAccount';
import { md5 } from '../generation/md5';
import { asAbsPath } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleHydraCrack` decides what a player can crack, and it decides it
 * SERVER-side — the same place `ssh` validates a password, from the same
 * `/etc/passwd`, so the two can never disagree. A hydra that reports a credential
 * `ssh` then rejects would read to the player as a broken game.
 *
 * The gate is the caller's OWN wordlist, read from their own journal rather than
 * taken from the request: a password absent from that file is uncrackable however
 * weak it looks, and one present in it falls however strong it looks. The list is
 * never a client claim.
 *
 * The target must be reachable on the caller's own LAN, bootable, and actually
 * running the service asked for — the same three refusals `ssh` makes, checked in
 * the same order, so a dead box stays dark to every tool.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION = 'skylab';

/** A LAN host that actually runs ssh — the sweep needs a service to attack. */
const sshHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
  );
  if (host === undefined) throw new Error('no ssh-running host on LAN');
  return host;
};

/** A LAN host running NO ssh — the "nothing listening there" refusal. */
const sshlessHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      !hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
  );
  if (host === undefined) throw new Error('every host on LAN runs ssh');
  return host;
};

/** Every account on a generated host draws from this pool, so matching against it
 *  recovers the real plaintexts a test needs to build wordlists from. */
const KNOWN_POOL = WEAK_PASSWORDS;

/** Every account on a host paired with its real plaintext, recovered by matching
 *  the stored md5 against a candidate list — exactly what the handler must do. */
const accountsWithPasswords = (
  host: LanHost,
  candidates: readonly string[],
): readonly { readonly username: string; readonly password: string }[] => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  return accountsIn(baseFs).flatMap((account) => {
    const password = candidates.find((candidate) => md5(candidate) === account.hash);
    return password === undefined ? [] : [{ username: account.username, password }];
  });
};

type DepOverrides = Partial<HydraCrackDeps> & { readonly wordlist?: readonly string[] | null };

const makeDeps = (over: DepOverrides = {}) => {
  const findPatches = vi.fn<
    (query: {
      machine_id: string;
    }) => Promise<{ data: readonly OwnerPatchRow[] | null; error: unknown }>
  >(async () => ({ data: [], error: null }));
  const readWordlist = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({
      data: over.wordlist === null ? null : { content: formatWordlist(over.wordlist ?? []) },
      error: null,
    }),
  );
  const deps: HydraCrackDeps = {
    nonceStore: freshStore,
    findPatches,
    readWordlist,
    ...over,
  };
  return { deps, findPatches, readWordlist };
};

type CrackRequest = {
  readonly essid?: string;
  readonly target_ip: string;
  readonly service?: string;
  readonly username?: string;
  readonly caller_machine_id?: string;
};

const signedCrack = (identity: ReturnType<typeof generateIdentity>, request: CrackRequest) =>
  signRequest(identity, 'hydraCrack', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    service: request.service ?? 'ssh',
    ...(request.username === undefined ? {} : { username: request.username }),
    caller_machine_id:
      request.caller_machine_id ?? computeWorkstationId(WORKSTATION, identity.publicKeyHex),
  });

describe('handleHydraCrack', () => {
  it('reports every account whose password is in the wordlist', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({ wordlist: everything.map((account) => account.password) });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body.cracked).toEqual(everything);
  });

  it('never reports an account whose password is absent from the wordlist', async () => {
    // The whole mechanic: membership in YOUR list is the only gate. Drop one
    // account's password and that account must survive the sweep untouched.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const withheld = everything[0];
    const { deps } = makeDeps({
      wordlist: everything.slice(1).map((account) => account.password),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.body.cracked).toEqual(everything.slice(1));
    expect(response.body.cracked).not.toContainEqual(withheld);
  });

  it('attacks only the named account when a username is given', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const target = everything[0];
    const { deps } = makeDeps({ wordlist: everything.map((account) => account.password) });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, username: target.username }),
      deps,
    );

    expect(response.body.cracked).toEqual([target]);
  });

  it('cracks nothing when the caller has no wordlist', async () => {
    // A deleted wordlist is a real state — it is an ordinary file on the player's
    // own box, and root can remove it.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: null });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cracked: [], wordlistFound: false });
  });

  it('reads the wordlist from the CALLER-s own machine, not the target', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, readWordlist } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(readWordlist).toHaveBeenCalledWith({
      writer_key: identity.publicKeyHex,
      machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
      path: WORDLIST_PATH,
    });
  });

  it("refuses a caller_machine_id that is not the caller's own workstation", async () => {
    // The wordlist is read from whatever machine the caller names, so an unchecked
    // id would let a player read a file off someone else's box.
    const identity = generateIdentity();
    const stranger = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, readWordlist } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, {
        target_ip: host.ip,
        caller_machine_id: computeWorkstationId('victim', stranger.publicKeyHex),
      }),
      deps,
    );

    expect(response).toEqual({ status: 403, body: { error: 'not_own_machine' } });
    expect(readWordlist).not.toHaveBeenCalled();
  });

  it('reports the port the service actually listens on', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const listening = hostServices(ESSID, host).find(({ spec }) => spec === SERVICE_CATALOG.ssh);
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.body.port).toBe(listening?.port);
  });

  it('refuses a target that is not a host on the caller-s LAN', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: '10.99.99.99' }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('refuses a host that is not running the service asked for', async () => {
    const identity = generateIdentity();
    const host = sshlessHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses a bricked host, exactly as ssh does', async () => {
    // A box with its kernel removed is dark to every tool, not just to logins —
    // there is nothing running to attack.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps } = makeDeps({
      wordlist: [],
      findPatches: async () => ({
        data: [
          {
            path: asAbsPath('/boot/vmlinuz'),
            content: null,
            owner: 'root',
            permissions: null,
            node_type: 'file',
            updated_at: '2026-07-31T00:00:00Z',
            writer_key: 'a'.repeat(64),
          } as OwnerPatchRow,
        ],
        error: null,
      }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(machineId).toBeTruthy();
  });

  it('refuses an envelope whose signature does not verify', async () => {
    // The signature is what makes the pubkey a claim about WHO is asking, and
    // everything downstream — whose wordlist, whose machine — hangs off it.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const envelope = signedCrack(identity, { target_ip: host.ip });
    const { deps, readWordlist, findPatches } = makeDeps({ wordlist: [] });

    const response = await handleHydraCrack({ ...envelope, signature: 'f'.repeat(128) }, deps);

    expect(response.status).toBe(401);
    expect(readWordlist).not.toHaveBeenCalled();
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a payload that supplies its own player_key', async () => {
    // The acting player is the verified signer, never a field in the body — a
    // client-supplied key would be an identity claim the signature does not cover.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: [] });
    const envelope = signRequest(identity, 'hydraCrack', {
      essid: ESSID,
      target_ip: host.ip,
      service: 'ssh',
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
      player_key: identity.publicKeyHex,
    });

    const response = await handleHydraCrack(envelope, deps);

    expect(response.status).toBe(400);
  });

  it("reads the TARGET host's journal, keyed by the machine it resolved", async () => {
    // Reading the wrong machine's journal would sweep a passwd belonging to some
    // other box — and report credentials `ssh` would refuse on this one.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, findPatches } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: machineId });
  });

  it('reports that the wordlist was found when a sweep actually ran', async () => {
    // The counterpart to the no-wordlist case: "nothing matched" and "nothing was
    // tried" must stay distinguishable in both directions.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({ wordlist: ['nothing-matches-this'] });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.body).toMatchObject({ cracked: [], wordlistFound: true });
  });

  it('fails closed when the wordlist cannot be read', async () => {
    // A read error must not collapse into "you have no wordlist" — that reads to
    // the player as an empty list rather than a broken lookup, and they would
    // curate a file that was never consulted.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({
      readWordlist: async () => ({ data: null, error: new Error('db down') }),
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response).toEqual({ status: 500, body: { error: 'wordlist_lookup_failed' } });
  });

  it('fails closed when the target journal cannot be read', async () => {
    // Never a false crack, and never a false "nothing here" either.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps } = makeDeps({
      wordlist: [],
      findPatches: async () => ({ data: null, error: new Error('db down') }),
    });

    const response = await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });
});
