import { describe, expect, it } from 'vitest';
import { asAbsPath, type UserType } from '../types';
import type { Directory } from '../filesystem/types';
import type { Command, CommandResult, TerminalLine } from '../commands/types';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockPatchApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { defaultFilePermissions } from '../filesystem/defaultPermissions';
import { buildRemoteHostFs, hostServices } from '../generation/remoteHostFs';
import { generateDeepLayer, type FrontingGateway } from '../generation/generateDeepLayer';
import { buildDeepHostFs } from '../generation/deepHostFs';
import type { LanHost } from '../generation/generateHomeLan';
import { apt } from '../commands/apt';
import { systemctl } from '../commands/systemctl';
import { SERVICE_CATALOG } from './serviceCatalog';
import { readOpenPorts } from './pidfile';

/**
 * A door on a box the WORLD generated, opened and shut.
 *
 * The pieces were each proven alone long before this: `systemctl` removes the
 * pidfile that is the source of truth for a port, `applyPatches` replays a
 * journal over a regenerated base, and a generated host now carries the daemon
 * behind every service it runs. What none of them proves is the whole loop over
 * a box nobody wrote by hand — which is the only box a player ever roots.
 *
 * The distinction is not academic. Every `systemctl` test above builds its own
 * `/var/run` and its own `/usr/sbin`, so it establishes what the command does
 * GIVEN a box in a shape the test chose. A generated box's shape is chosen by a
 * seed: which services it runs, which binaries it therefore holds, and which
 * ports its pidfiles claim are all rolled rather than written down. A door that
 * could only be shut on a hand-built box would pass that whole suite and fail
 * the only time it matters.
 *
 * So these tests stand where the player stands. The tree is regenerated from the
 * ESSID, the commands are the real ones, and each step's patch is REPLAYED onto
 * the tree the next step reads — which is exactly what `resolveActiveRoot` does
 * for a session on a remote box. Nothing here writes a pidfile or a binary by
 * hand; if the generator stopped planting one, these tests stop passing.
 */

const ESSID = 'BEAN-THERE-WIFI';
const SUBNET = '192.168.50';
const NO_FLAGS: ReadonlyMap<string, string | true> = new Map();

const host = (octet: number): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname: `host-${octet}`,
  kind: 'machine',
});

const OCTETS = Array.from({ length: 253 }, (_, index) => index + 2);

/** The first octet on this ESSID whose box RUNS `service`. Read off
 *  `hostServices` rather than off the pidfiles the generator wrote, so a box is
 *  chosen by what it serves rather than by what it happens to have recorded.
 *  Throws rather than skipping: a sample with no such box would make every claim
 *  below vacuously true. */
const servingOctet = (service: string): number => {
  const octet = OCTETS.find((candidate) =>
    hostServices(ESSID, host(candidate)).some(({ spec }) => spec.service === service),
  );
  if (octet === undefined) throw new Error(`no host on ${ESSID} serves ${service}`);
  return octet;
};

/** A generated box that serves `service`, as it stands before anyone touches it. */
const boxServing = (service: string): Directory =>
  buildRemoteHostFs(ESSID, host(servingOctet(service)));

/** A host NAMED for a role, as against the role-less `host-<octet>` above. */
const namedHost = (prefix: string, octet: number): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname: `${prefix}-${octet}`,
  kind: 'machine',
});

/** A generated box called `<prefix>-<octet>` that serves `service`, before anyone
 *  touches it. Some doors have a flat placement of zero and exist only where the
 *  world NAMED a box for them, so no `host-<octet>` box can ever produce one to
 *  shut. Throws rather than skipping, for the reason `servingOctet` does. */
const namedBoxServing = (prefix: string, service: string): Directory => {
  const octet = OCTETS.find((candidate) =>
    hostServices(ESSID, namedHost(prefix, candidate)).some(({ spec }) => spec.service === service),
  );
  if (octet === undefined) throw new Error(`no ${prefix}-* host on ${ESSID} serves ${service}`);
  return buildRemoteHostFs(ESSID, namedHost(prefix, octet));
};

/** One step taken while standing on a box: what the terminal printed, what it
 *  exited with, and the box AS IT NOW IS — the step's own patches replayed over
 *  the tree it read. Returning the next tree rather than mutating one keeps a
 *  sequence of commands honest: a step that wrote nothing hands back a box that
 *  is unchanged by construction. */
type Step = {
  readonly text: string;
  readonly exitCode: number;
  readonly box: Directory;
};

const collect = async (result: CommandResult): Promise<{ text: string; exitCode: number }> => {
  if (result.kind === 'sync') {
    return {
      text: result.lines.map((line: TerminalLine) => line.content).join('\n'),
      exitCode: result.exitCode,
    };
  }
  // Neither verb here opens an overlay, so a mode change is a wrong turn rather
  // than a case to handle — and swallowing it would hide the turn.
  if (result.kind !== 'async') throw new Error(`unexpected ${result.kind} result`);
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

/**
 * Run one real command on a generated box and replay whatever it wrote.
 *
 * The patch API is the live one rather than a spy: a `remove` becomes a deletion
 * marker and a `write` becomes an upsert, both folded onto the tree through the
 * same `applyPatches` a session uses. That is what makes a following `status` or
 * scan able to disagree with the one before it — a spy would leave every step
 * reading the same pristine tree and every assertion below would pass for the
 * wrong reason.
 */
const on = async (
  box: Directory,
  command: Command,
  args: readonly string[],
  options: {
    readonly userType?: UserType;
    /** Parsed flags, as the shell hands them to a command — `apt list` reads
     *  `--installed` from HERE, not from its arguments, so a test that only put
     *  the word in `args` would silently exercise the unfiltered listing. */
    readonly flags?: ReadonlyMap<string, string | true>;
  } = {},
): Promise<Step> => {
  const userType = options.userType ?? 'root';
  const patches: Patch[] = [];
  const env = mockCommandEnv({
    session: mockSession({ userType }),
    fs: mockFsViewFromTree(box, { userType, cwd: () => asAbsPath('/') }),
    network: { ...mockCommandEnv().network, isOnline: () => true },
    patches: {
      ...mockPatchApi(),
      remove: async (path) => {
        patches.push({ path, content: null, owner: 'root' });
        return { ok: true };
      },
      write: async (path, content, writeOptions) => {
        patches.push({
          path,
          content,
          owner: writeOptions?.owner ?? 'root',
          permissions: writeOptions?.permissions ?? defaultFilePermissions('root'),
        });
        return { ok: true };
      },
    },
  });

  const { text, exitCode } = await collect(
    await command.execute(env, args, options.flags ?? NO_FLAGS),
  );
  return { text, exitCode, box: applyPatches(box, patches) };
};

/** A gateway to hang a deep layer behind. Any id will do — what it fronts is
 *  seeded on it, and no claim below depends on which one. */
const SOME_GATEWAY: FrontingGateway = { machineId: 'gw-machine-1', kind: 'router' };

/** The one NPC on the layer behind `gateway`. */
const deepHostBehind = (gateway: FrontingGateway): LanHost =>
  generateDeepLayer(ESSID, gateway).host;

/** A deep NPC that RUNS `service`, found by walking gateway ids until a layer
 *  rolls one. Throws rather than skipping, for the same reason `servingOctet`
 *  does: a claim about a box that was never found is a claim about nothing. */
const deepHostServing = (service: string): LanHost => {
  const found = OCTETS.map((index) =>
    deepHostBehind({ machineId: `gw-machine-${index}`, kind: 'router' }),
  ).find((candidate) => hostServices(ESSID, candidate).some(({ spec }) => spec.service === service));
  if (found === undefined) throw new Error(`no deep host behind any gateway serves ${service}`);
  return found;
};

/** The ports a scan reports for a box — the same reader `nmap`'s display and the
 *  server's scan action both run, so what this sees is what a scanner shows. */
const openPorts = (box: Directory): readonly number[] =>
  readOpenPorts(box).map(({ port }) => port);

describe('a door on a generated box can be shut, and opened again', () => {
  it('closes the web port of a box the world generated, and reopens it', async () => {
    const serving = boxServing(SERVICE_CATALOG.http.service);
    const webPort = readOpenPorts(serving).find(
      ({ service }) => service === SERVICE_CATALOG.http.service,
    )?.port;
    if (webPort === undefined) throw new Error('generated web box advertises no web port');

    const before = await on(serving, systemctl, ['status', 'nginx']);
    expect(before.text).toContain('●');
    expect(before.text).toContain(`active (running) on port ${webPort}`);

    const stopped = await on(before.box, systemctl, ['stop', 'nginx']);
    expect(stopped.exitCode).toBe(0);

    // The port is gone from what a scan reads, not merely from what `systemctl`
    // says. Those are two different files' worth of trust: the unit's answer
    // comes from the pidfile it just removed, the scan's from walking `/var/run`.
    const shut = await on(stopped.box, systemctl, ['status', 'nginx']);
    expect(shut.text).toContain('○');
    expect(shut.text).toContain('inactive (dead)');
    expect(openPorts(stopped.box)).not.toContain(webPort);

    const restarted = await on(stopped.box, systemctl, ['start', 'nginx']);
    expect(restarted.exitCode).toBe(0);
    expect(openPorts(restarted.box)).toContain(SERVICE_CATALOG.http.defaultPort);
  });

  it('leaves every other door on that box exactly where it was', async () => {
    // A stop that took the box's other services with it would read as working
    // from the one port anybody checked. The seeded box runs more than one thing,
    // which is the only reason this claim is testable at all.
    const serving = boxServing(SERVICE_CATALOG.http.service);
    const others = openPorts(serving).filter(
      (port) =>
        port !==
        readOpenPorts(serving).find(({ service }) => service === SERVICE_CATALOG.http.service)
          ?.port,
    );

    const stopped = await on(serving, systemctl, ['stop', 'nginx']);

    expect(openPorts(stopped.box)).toEqual(others);
  });

  it('closes the database port of a generated database box', async () => {
    const serving = boxServing(SERVICE_CATALOG.mysql.service);
    const dbPort = readOpenPorts(serving).find(
      ({ service }) => service === SERVICE_CATALOG.mysql.service,
    )?.port;
    if (dbPort === undefined) throw new Error('generated database box advertises no database port');

    const stopped = await on(serving, systemctl, ['stop', 'mysqld']);
    expect(stopped.exitCode).toBe(0);
    expect(openPorts(stopped.box)).not.toContain(dbPort);

    const shut = await on(stopped.box, systemctl, ['status', 'mysqld']);
    expect(shut.text).toContain('○');
  });

  it('closes the name-service port of a box named for one, and reopens it', async () => {
    // The door a whole network's address plan sits behind, and the reason it must be
    // stoppable like any other: an owner who roots their own name server can take name
    // service off the network without losing the zone, which stays on disk either way.
    const serving = namedBoxServing('ns', SERVICE_CATALOG.dns.service);

    const before = await on(serving, systemctl, ['status', 'named']);
    expect(before.text).toContain('active (running) on port 53');

    const stopped = await on(before.box, systemctl, ['stop', 'named']);
    expect(stopped.exitCode).toBe(0);
    expect(openPorts(stopped.box)).not.toContain(53);

    const restarted = await on(stopped.box, systemctl, ['start', 'named']);
    expect(restarted.exitCode).toBe(0);
    expect(openPorts(restarted.box)).toContain(53);
  });

  it('keeps a door shut across a reboot, because the pidfile is a journal row', async () => {
    // A stop is a deletion marker in the machine's journal and `reboot` never
    // touches the journal — so the proof is that REGENERATING the base and
    // replaying the same row lands on the same closed door. Nothing is
    // remembered here between the two trees except the patch itself.
    const service = SERVICE_CATALOG.http.service;
    const octet = servingOctet(service);
    const serving = buildRemoteHostFs(ESSID, host(octet));
    const webPort = readOpenPorts(serving).find((open) => open.service === service)?.port;
    if (webPort === undefined) throw new Error('generated web box advertises no web port');

    const stopped = await on(serving, systemctl, ['stop', 'nginx']);
    const rebuiltAfterReboot = applyPatches(buildRemoteHostFs(ESSID, host(octet)), [
      { path: `/var/run/${SERVICE_CATALOG.http.pidfile}`, content: null, owner: 'root' },
    ]);

    expect(openPorts(stopped.box)).not.toContain(webPort);
    expect(openPorts(rebuiltAfterReboot)).not.toContain(webPort);
  });

  it('refuses to shut a door for a shell that only talked its way in', async () => {
    // Rooting the box is the price of closing its port. A guest may look.
    const serving = boxServing(SERVICE_CATALOG.http.service);

    const looked = await on(serving, systemctl, ['status', 'nginx'], { userType: 'guest' });
    const tried = await on(serving, systemctl, ['stop', 'nginx'], { userType: 'guest' });

    expect(looked.text).toContain('●');
    expect(tried.text).toContain('must be run as root');
    expect(tried.box).toBe(serving);
  });

  it('names the packages a generated box carries, with no change to apt', async () => {
    const serving = boxServing(SERVICE_CATALOG.mysql.service);

    const listed = await on(serving, apt, ['list'], {
      flags: new Map([['--installed', true]]),
    });

    expect(listed.text).toContain('mysql [installed]');
    // The player's own second front door is not something the world hands out.
    expect(listed.text).not.toContain('apache2');
  });

  it('shuts the forced door of a deep host the same way', async () => {
    // A deep host is the same builder plus a patch that only ADDS `sshd:22`, so
    // the door an intruder arrives through is the one every deep host has —
    // and the daemon behind it is base image, which is why it resolves a unit
    // whether or not the roll gave this box an ssh service of its own.
    const deep = buildDeepHostFs(ESSID, deepHostBehind(SOME_GATEWAY));

    const before = await on(deep, systemctl, ['status', 'sshd']);
    const stopped = await on(before.box, systemctl, ['stop', 'sshd']);

    expect(before.text).toContain('●');
    expect(before.text).toContain(`active (running) on port ${SERVICE_CATALOG.ssh.defaultPort}`);
    expect(stopped.exitCode).toBe(0);
    expect(openPorts(stopped.box)).not.toContain(SERVICE_CATALOG.ssh.defaultPort);
  });

  it('gives a deep host the toolchain for what IT runs, not for what fronts it', async () => {
    // The rule reaches the deep layer through `buildRemoteHostFs` rather than by
    // being told about it, so the thing worth proving is that a deep box which
    // serves the web can have that door shut too — a unit resolves only where its
    // binary is, and nothing in the deep builder plants one.
    const deep = buildDeepHostFs(ESSID, deepHostServing(SERVICE_CATALOG.http.service));
    const webPort = readOpenPorts(deep).find(
      ({ service }) => service === SERVICE_CATALOG.http.service,
    )?.port;
    if (webPort === undefined) throw new Error('deep web box advertises no web port');

    const stopped = await on(deep, systemctl, ['stop', 'nginx']);

    expect(stopped.exitCode).toBe(0);
    expect(openPorts(stopped.box)).not.toContain(webPort);
  });
});
