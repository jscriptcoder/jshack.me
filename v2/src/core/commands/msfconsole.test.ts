import { describe, expect, it, vi } from 'vitest';
import { msfconsole } from './msfconsole';
import {
  mockCommandEnv,
  mockExploitApi,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity } from '../network/interfaces';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { asPlayerKeyHex } from '../types';
import type { CommandResult, ExploitRunParams, ExploitRunResult, Session } from './types';
import type { ConnectivityState, NetworkInterface } from '../network/interfaces';

/**
 * `msfconsole` decides NOTHING about what a fired CVE opens — the server does, from
 * its own clock and the target's own manifest. So these tests are about what the
 * player is TOLD and where they are LEFT standing.
 *
 * The load-bearing one is the pair of refusals: a service with no live CVE and a
 * port with nothing behind it must read identically, because a bounce that told an
 * attacker WHICH of those it was would turn a failed exploit into a free scan.
 */

const OWNER_KEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const PORT = 22;
const NO_FLAGS = new Map<string, string | true>();

const LAN = generateHomeLan(ESSID);

/** A host off the LAN this ESSID generates — read out of the world rather than
 *  guessed, so the address the command resolves is one the server would resolve too. */
const hostWhere = (predicate: (host: LanHost) => boolean): LanHost => {
  const host = LAN.hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on the generated LAN');
  return host;
};

const TARGET = hostWhere((host) => host.kind === 'machine');
const TARGET_MACHINE_ID = resolveLanHostIdentity(TARGET, ESSID).machineId;

/** An address on the RIGHT network that no host answers to — a plausible typo rather
 *  than an invalid string, and derived from the generated population so no reseeding
 *  can quietly turn it into a real box. */
const vacantAddress = (): string => {
  const taken = new Set(LAN.hosts.map((host) => host.ip));
  for (let octet = 254; octet >= 2; octet -= 1) {
    const candidate = `${LAN.subnet}.${octet}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('the generated LAN has no vacant address');
};

const VACANT_IP = vacantAddress();

const SOURCE_IP = `${LAN.subnet}.50`;

/** A workstation associated with an AP and holding a lease — there is no target to
 *  name until the box the tool runs from is on a network. */
const connectedState = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(OWNER_KEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const connected: NetworkInterface = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: SOURCE_IP,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const GRANTED_FULL: ExploitRunResult = {
  ok: true,
  cve: 'CVE-2026-0184',
  severity: 'critical',
  username: 'root',
  userType: 'root',
  kind: 'exploit',
};

type EnvOpts = {
  readonly result?: ExploitRunResult;
  readonly connectivity?: ConnectivityState;
};

const exploitEnv = (opts: EnvOpts = {}) => {
  const run = vi.fn<(params: ExploitRunParams) => Promise<ExploitRunResult>>(
    async () => opts.result ?? GRANTED_FULL,
  );
  const pushed: Session[] = [];
  const cwds: string[] = [];
  const prompt = vi.fn(async () => '');
  const env = mockCommandEnv({
    identity: { publicKeyHex: asPlayerKeyHex(OWNER_KEY), privateKeyHex: 'b'.repeat(64) },
    session: mockSession(),
    network: mockNetworkViewFromConnectivity(opts.connectivity ?? connectedState()),
    exploit: mockExploitApi({ run }),
    pushSession: (session) => void pushed.push(session),
    setCwd: (path) => void cwds.push(path),
    prompt,
  });
  return { env, run, pushed, cwds, prompt };
};

const drain = async (
  result: CommandResult,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

const syncText = (result: CommandResult): string => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.lines.map((line) => line.content).join('\n');
};

describe('msfconsole', () => {
  it('names the CVE it fired and hands over a full shell as the account the server chose', async () => {
    const { env, pushed, cwds } = exploitEnv();

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(`[*] Targeting ${TARGET.ip}:${PORT}`);
    expect(text).toContain('[*] Sending exploit payload...');
    // The line that stands while the round trip is in flight — the only thing on screen
    // during the wait, so its absence reads as a tool that hung.
    expect(text).toContain('[*] Payload delivered, waiting for callback...');
    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (critical)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain(`[+] Full shell as root@${TARGET.ip}`);
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([
      expect.objectContaining({
        machineId: TARGET_MACHINE_ID,
        username: 'root',
        userType: 'root',
        kind: 'exploit',
      }),
    ]);
    expect(cwds).toEqual(['/root']);
  });

  it('hands over the weaker shell when that is all the effect granted', async () => {
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        cve: 'CVE-2026-0912',
        severity: 'medium',
        username: 'guest',
        userType: 'guest',
        kind: 'exploit_limited',
      },
    });

    const { text } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    // A different sentence for a different door: "Got shell" is what `nc` earns, and
    // a player who reads "Full shell" and then cannot `ssh` onward has been lied to.
    expect(text).toContain(`[+] Got shell as guest@${TARGET.ip}`);
    expect(text).not.toContain('Full shell');
    expect(pushed).toEqual([expect.objectContaining({ kind: 'exploit_limited' })]);
    expect(cwds).toEqual(['/home/guest']);
  });

  it('reads the file it is pointed at and prints its contents, standing the player nowhere', async () => {
    // A read effect is not a foothold: it hands back the bytes and leaves the player
    // where they were, so nothing is pushed and the cwd never moves.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: true, content: 'root:x:0:0:root:/root:/bin/bash\nsvc:x:1000:1000::/home/svc:/bin/sh' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Reading /etc/passwd (as user):');
    expect(text).toContain('root:x:0:0:root:/root:/bin/bash');
    expect(text).toContain('svc:x:1000:1000::/home/svc:/bin/sh');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports permission denied for a path the granted tier cannot read, opening nothing', async () => {
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'medium',
        tier: 'guest',
        read: { ok: false, error: 'permission_denied' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/shadow'], NO_FLAGS),
    );

    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[-] Permission denied (as guest): /etc/shadow');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('asks for a path when a read exploit is fired without one, and reads nothing', async () => {
    // The scan never says a CVE reads rather than lands a shell, so firing bare is how
    // the player learns it. It names the hole and asks for a target — but claims no
    // success, because nothing was read.
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    // Named after the kind of hole it is, not a generic "needs an argument": a read hole
    // and a list hole ask for the same third token but are different doors.
    expect(text).toContain('reads a file');
    expect(text).toContain('msfconsole <host> <port> <path>');
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('names the file failure in the tool\'s own words, not the filesystem\'s code', async () => {
    // The deny map earns its keep only if each failure reads as its own sentence — a
    // missing file and a directory-where-a-file-was-asked-for are different mistakes.
    const notFound = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: false, error: 'not_found' },
      },
    });
    const isDir = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: false, error: 'is_directory' },
      },
    });

    const missing = await drain(
      await msfconsole.execute(notFound.env, [TARGET.ip, String(PORT), '/nope'], NO_FLAGS),
    );
    const dir = await drain(
      await msfconsole.execute(isDir.env, [TARGET.ip, String(PORT), '/etc'], NO_FLAGS),
    );

    expect(missing.text).toContain('[-] No such file (as user): /nope');
    expect(dir.text).toContain('[-] That is a directory, not a file (as user): /etc');
  });

  it('names the directory failure in the tool\'s own words, distinct from a file\'s', async () => {
    const notFound = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: false, error: 'not_found' },
      },
    });
    const notDir = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: false, error: 'not_a_directory' },
      },
    });

    const missing = await drain(
      await msfconsole.execute(notFound.env, [TARGET.ip, String(PORT), '/nope'], NO_FLAGS),
    );
    const file = await drain(
      await msfconsole.execute(notDir.env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS),
    );

    // A missing directory is not "No such file", and a file named where a directory was
    // expected is its own message — the list side keeps its own vocabulary.
    expect(missing.text).toContain('[-] No such directory (as user): /nope');
    expect(file.text).toContain('[-] That is a file, not a directory (as user): /etc/passwd');
  });

  it('forwards the path the player typed to the server', async () => {
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ arg: '/etc/passwd' }));
  });

  it('lists the directory it is pointed at and prints its entries, standing the player nowhere', async () => {
    // The other read effect: it hands back the entries and leaves the player where they
    // were, so nothing is pushed and the cwd never moves.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: true, entries: ['passwd', 'shadow', 'ssh'] },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc'], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Listing /etc (as user):');
    expect(text).toContain('passwd');
    expect(text).toContain('shadow');
    expect(text).toContain('ssh');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports permission denied for a directory the granted tier cannot read, opening nothing', async () => {
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'medium',
        tier: 'guest',
        list: { ok: false, error: 'permission_denied' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/root'], NO_FLAGS),
    );

    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[-] Permission denied (as guest): /root');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('asks for a path when a dir_list exploit is fired without one, and lists nothing', async () => {
    // Reveal-by-firing again — and the request has to name the directory it wants, so a
    // player firing a read hole blind is not told the same thing as one firing a list hole.
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('lists a directory');
    expect(text).toContain('msfconsole <host> <port> <path>');
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('says exactly the same thing about a service with no live CVE and a port with nothing behind it', async () => {
    // One answer, because the server gives one answer. The difference between a
    // patched daemon and a planted listener lives in the DEFENDER's log.
    const patched = exploitEnv({ result: { ok: false, error: 'not_vulnerable' } });
    const listenerOnly = exploitEnv({ result: { ok: false, error: 'not_vulnerable' } });

    const first = await drain(
      await msfconsole.execute(patched.env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );
    const second = await drain(
      await msfconsole.execute(listenerOnly.env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(first.text).toBe(second.text);
    expect(first.text).toContain(`no known vulnerability on ${TARGET.ip}:${PORT}`);
    expect(first.exitCode).toBe(1);
    expect(patched.pushed).toEqual([]);
  });

  it('answers an address its own network has never heard of the way ssh does, without firing', async () => {
    const { env, run, pushed } = exploitEnv();

    const result = await msfconsole.execute(env, [VACANT_IP, String(PORT)], NO_FLAGS);

    expect(syncText(result)).toBe(
      `msfconsole: connect to host ${VACANT_IP} port ${PORT}: No route to host`,
    );
    // The LAN is deterministic, so an address nothing answers to is answerable here.
    // Firing anyway would spend a round trip to be told what the client already knew.
    expect(run).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });

  it('answers a box the server could not reach with the same sentence, and opens nothing', async () => {
    const { env, pushed } = exploitEnv({ result: { ok: false, error: 'host_unreachable' } });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(
      `msfconsole: connect to host ${TARGET.ip} port ${PORT}: No route to host`,
    );
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('reports a broken round trip as a network fault rather than a hardened target', async () => {
    const { env, pushed } = exploitEnv({ result: { ok: false, error: 'network_error' } });

    const { text } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(`msfconsole: connect to host ${TARGET.ip} port ${PORT}: Network error`);
    expect(text).not.toContain('no known vulnerability');
    expect(pushed).toEqual([]);
  });

  it('never asks for a password', async () => {
    // The whole point of this door. A prompt here would mean the shell was bought
    // with a credential, and there would be nothing to distinguish it from `ssh`.
    const { env, prompt } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    expect(prompt).not.toHaveBeenCalled();
  });

  it('fires at the name a scan printed, resolved to its address', async () => {
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.hostname, String(PORT)], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ targetIp: TARGET.ip }));
  });

  it('tells the target which session opened the door and where it came from', async () => {
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        essid: ESSID,
        port: PORT,
        parentSessionId: env.session.id,
        sourceIp: SOURCE_IP,
      }),
    );
  });

  it('refuses without a target, without a port, and on a port that is not one', async () => {
    const usage = 'usage: msfconsole <host> <port>';
    const { env, run } = exploitEnv();

    expect(syncText(await msfconsole.execute(env, [], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip, 'ssh'], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip, '70000'], NO_FLAGS))).toBe(usage);
    expect(run).not.toHaveBeenCalled();
  });

  it('fires at either end of the port range, and at neither address beyond it', async () => {
    // Both ends are real ports somebody can serve on, and both sit one step from a
    // number that is not a port at all — so the bound decides between a door and a
    // usage error, which is exactly where an off-by-one hides.
    const { env, run } = exploitEnv();

    for (const port of ['1', '65535']) {
      const result = await msfconsole.execute(env, [TARGET.ip, port], NO_FLAGS);
      expect(result.kind).toBe('async');
      await drain(result);
    }
    expect(run).toHaveBeenCalledTimes(2);

    for (const port of ['0', '65536']) {
      expect(syncText(await msfconsole.execute(env, [TARGET.ip, port], NO_FLAGS))).toBe(
        'usage: msfconsole <host> <port>',
      );
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('pushes the session the server was asked to mint, under that same id', async () => {
    // The id is the only thing tying the row on the server to the hop on the stack. If
    // they differ, `exit` unwinds something the server never ended and a refresh
    // restores a shell nobody is standing in.
    const { env, run, pushed } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    const asked = run.mock.calls[0]?.[0].sessionId;
    expect(asked).toBeTruthy();
    expect(pushed[0]?.id).toBe(asked);
  });

  it('refuses when the box it is run from is on no network', async () => {
    const { env, run } = exploitEnv({ connectivity: buildColdStartConnectivity(OWNER_KEY) });

    const result = await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS);

    expect(syncText(result)).toBe(
      `msfconsole: connect to host ${TARGET.ip} port ${PORT}: Network is unreachable`,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
