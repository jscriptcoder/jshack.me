import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { ALL_GENERATED_PASSWORDS } from '../generation/passwordPools';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { WORDLIST_PATH, formatWordlist } from '../wordlist/defaultWordlist';
import { accountsIn } from './passwdAccount';
import { md5 } from '../generation/md5';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asAbsPath, asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { PatchRow } from '../patches/upsertPatch';
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
// 2026-08-09 11:04:07 UTC — the server clock every trace line in these tests is
// stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const ATTACKER_IP = '192.168.1.50';

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
const KNOWN_POOL = ALL_GENERATED_PASSWORDS;

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
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: HydraCrackDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches,
    readWordlist,
    readAuthLog,
    upsertPatch,
    ...over,
  };
  return { deps, findPatches, readWordlist, readAuthLog, upsertPatch };
};

type CrackRequest = {
  readonly essid?: string;
  readonly target_ip: string;
  readonly service?: string;
  readonly username?: string;
  readonly caller_machine_id?: string;
  readonly source_ip?: string | null;
};

const signedCrack = (identity: ReturnType<typeof generateIdentity>, request: CrackRequest) =>
  signRequest(identity, 'hydraCrack', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    service: request.service ?? 'ssh',
    ...(request.username === undefined ? {} : { username: request.username }),
    caller_machine_id:
      request.caller_machine_id ?? computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    source_ip: request.source_ip === undefined ? ATTACKER_IP : request.source_ip,
  });

/** One line the sweep is expected to leave on the target's auth.log. */
const traceLine = (
  outcome: 'success' | 'failure',
  user: string,
  host: LanHost,
  fromIp = ATTACKER_IP,
): string =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp,
    hostname: host.hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

/** The lines a sweep actually wrote, in order — the content of the single patch
 *  the handler upserts, minus the trailing newline the appender adds. */
const writtenLines = (upsertPatch: { readonly mock: { readonly calls: readonly PatchRow[][] } }) => {
  const row = upsertPatch.mock.calls[0]?.[0];
  return (row?.content ?? '').split('\n').filter((line) => line.length > 0);
};

/** Every account on a host, in `/etc/passwd` order — the order a sweep attacks
 *  them in, and so the order their trace lines must appear in. */
const accountNamesOn = (host: LanHost): readonly string[] =>
  accountsIn(resolveLanHostIdentity(host, ESSID).baseFs).map((account) => account.username);

/** An account whose password no OTHER account on the box shares, so a wordlist
 *  holding it cracks exactly one account and the expected trace stays exact. */
const soleHolderOf = (
  accounts: readonly { readonly username: string; readonly password: string }[],
): { readonly username: string; readonly password: string } => {
  const sole = accounts.find(
    (account) => accounts.filter((other) => other.password === account.password).length === 1,
  );
  if (sole === undefined) throw new Error('every password on this host is shared');
  return sole;
};

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

    // Named, not just refused: `hydra` reports the server's reason to the player,
    // and a nameless refusal reaches them as a generic network error.
    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(readWordlist).not.toHaveBeenCalled();
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a payload that names no target', async () => {
    // The payload is a trust boundary: an absent target must be rejected as a
    // malformed request, not resolved into "no such host" further down.
    const identity = generateIdentity();
    const { deps, findPatches } = makeDeps({ wordlist: [] });
    const envelope = signRequest(identity, 'hydraCrack', {
      essid: ESSID,
      service: 'ssh',
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    });

    const response = await handleHydraCrack(envelope, deps);

    expect(response).toEqual({ status: 400, body: { error: 'payload_invalid' } });
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

/**
 * The defender's half. A sweep is the noisiest thing a player can do to a box, and
 * until now it was the only thing that left no mark — `ssh` logged every attempt
 * while hydra tried a whole wordlist against every account in silence.
 *
 * The trace is per PASSWORD TRIED, not per account, because the volume IS the
 * behaviour: a sweep must read as a sweep in the log, and that visible cost is what
 * an offline cracker later buys its way out of. An attempt that stopped early —
 * the word matched — records only the words that came before it.
 *
 * Nothing is written for a sweep that never touched the box. An unreachable, dead
 * or serviceless host must not be probeable through its own log.
 */
describe('the trace a hydra sweep leaves on its target', () => {
  it('records every password tried against an account that held', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const words = ['no-such-word', 'nor-this-one'];
    const { deps, upsertPatch } = makeDeps({ wordlist: words });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).flatMap((name) => words.map(() => traceLine('failure', name, host))),
    );
    // One sweep is one append: a line-by-line write would re-read and re-upsert the
    // whole log for every password tried.
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('records the account that fell as Accepted, after only the words tried before it', async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const target = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    // The match sits in the MIDDLE of the list: a sweep that carried on past it
    // would record the trailing word too, and the defender would read attempts the
    // attacker never made.
    const { deps, upsertPatch } = makeDeps({
      wordlist: ['no-such-word', target.password, 'never-reached'],
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).flatMap((name) =>
        name === target.username
          ? [traceLine('failure', name, host), traceLine('success', name, host)]
          : [
              traceLine('failure', name, host),
              traceLine('failure', name, host),
              traceLine('failure', name, host),
            ],
      ),
    );
  });

  it('traces only the named account when a username is given', async () => {
    // A sweep that never attacked an account must not fabricate attempts against
    // it — the log is the defender's evidence of what actually happened.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const target = soleHolderOf(accountsWithPasswords(host, KNOWN_POOL));
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, username: target.username }),
      deps,
    );

    expect(writtenLines(upsertPatch)).toEqual([traceLine('failure', target.username, host)]);
  });

  it("records the address the attacker's machine connected from", async () => {
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const elsewhere = '192.168.1.77';
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(
      signedCrack(identity, { target_ip: host.ip, source_ip: elsewhere }),
      deps,
    );

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).map((name) => traceLine('failure', name, host, elsewhere)),
    );
  });

  it('records an unknown source when the attempt carried no address', async () => {
    // A missing address is not a reason to drop the trace: the defender still
    // learns their box was swept, exactly as `ssh` reports an unknown origin.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip, source_ip: null }), deps);

    expect(writtenLines(upsertPatch)).toEqual(
      accountNamesOn(host).map((name) => traceLine('failure', name, host, 'unknown')),
    );
  });

  it("lands on the TARGET's auth.log, root-owned and readable by every tier", async () => {
    // World-readable is the whole point: a guest-tier occupant must be able to
    // `cat` the attack. Root-write keeps it a system write, not a player one.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: ['no-such-word'] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: identity.publicKeyHex,
        machine_id: machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        node_type: 'file',
      }),
    );
  });

  it('appends to what the log already holds', async () => {
    // A sweep after an ssh login must not erase the login — and a second sweep
    // must not erase the first.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const earlier = 'Aug  9 10:00:00 box sshd[100]: Accepted password for guest from 192.168.1.9\n';
    const { deps, upsertPatch } = makeDeps({
      wordlist: ['no-such-word'],
      readAuthLog: async () => ({ data: { content: earlier }, error: null }),
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch.mock.calls[0]?.[0].content).toBe(
      `${earlier}${accountNamesOn(host)
        .map((name) => traceLine('failure', name, host))
        .join('\n')}\n`,
    );
  });

  it('writes nothing when the sweep never reached the box', async () => {
    // Unreachable, serviceless and bricked all refuse before anything is attacked.
    // A log line would tell an attacker the box exists, and tell its owner they
    // were attacked when they were not.
    const identity = generateIdentity();
    const unreachable = makeDeps({ wordlist: ['no-such-word'] });
    const serviceless = makeDeps({ wordlist: ['no-such-word'] });
    const bricked = makeDeps({
      wordlist: ['no-such-word'],
      findPatches: async () => ({
        data: [
          {
            path: asAbsPath('/boot/vmlinuz'),
            content: null,
            owner: 'root',
            permissions: null,
            node_type: 'file',
            updated_at: '2026-08-09T00:00:00Z',
            writer_key: 'a'.repeat(64),
          } as OwnerPatchRow,
        ],
        error: null,
      }),
    });

    await handleHydraCrack(signedCrack(identity, { target_ip: '10.99.99.99' }), unreachable.deps);
    await handleHydraCrack(
      signedCrack(identity, { target_ip: sshlessHostOn(ESSID).ip }),
      serviceless.deps,
    );
    await handleHydraCrack(signedCrack(identity, { target_ip: sshHostOn(ESSID).ip }), bricked.deps);

    expect(unreachable.upsertPatch).not.toHaveBeenCalled();
    expect(serviceless.upsertPatch).not.toHaveBeenCalled();
    expect(bricked.upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the caller has no wordlist to try', async () => {
    // No list, no attempt — a trace here would report a sweep that never ran.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: null });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the wordlist is empty', async () => {
    // The file exists but holds no words: the sweep found the list and tried
    // nothing, which is still nothing to record.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({ wordlist: [] });

    await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still reports the cracked credentials when the log write fails', async () => {
    // Logging is best-effort: a broken journal must never swallow the result of an
    // attack that really happened.
    const identity = generateIdentity();
    const host = sshHostOn(ESSID);
    const everything = accountsWithPasswords(host, KNOWN_POOL);
    const { deps } = makeDeps({
      wordlist: everything.map((account) => account.password),
      upsertPatch: async () => {
        throw new Error('journal down');
      },
    });

    const response = await handleHydraCrack(signedCrack(identity, { target_ip: host.ip }), deps);

    expect(response.status).toBe(200);
    expect(response.body.cracked).toEqual(everything);
  });
});
