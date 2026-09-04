import { describe, expect, it, vi } from 'vitest';
import {
  resolveInnerGatewayTarget,
  type InnerGatewayTargetDeps,
} from './resolveInnerGatewayTarget';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { buildDeepHostFs } from '../generation/deepHostFs';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { hostMachineId } from '../generation/remoteHostId';
import { accountIn } from '../sessions/passwdAccount';
import { formatPidfileContent, pidfilePath, readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { OwnerPatchRow } from './materializeMachineFs';

/**
 * The chain walk replays and boot-gates every GATEWAY hop — it has to, to read the
 * forward table off `rules.v4`. The box at the END of the chain is the one hop whose
 * journal nothing used to read, so it came back exactly as the world generated it: an
 * account added down there could not log in, a box bricked through its own journal still
 * answered, and a daemon moved to another port was unroutable. These are the tests that
 * say the terminal box is now read like every other one.
 *
 * Reachability and liveness are separate questions here. This resolver answers WHICH BOX
 * a forwarded port names; whether the daemon a caller wants is up is the caller's own
 * check, which every door already makes against `reachedPort`. Deciding it here as well
 * would make a stopped daemon indistinguishable from a dark address, and depth would
 * start changing the words a player reads for something they did to their own box.
 */

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A network seeded to EXACTLY `depth` layers. Depth is a per-network roll, so pick
 *  deterministically rather than hoping an arbitrary ESSID lands where a test needs it. */
const networkWithDepth = (depth: number): string => {
  const found = crackableEssidPool.find((essid) => seedNetworkDepth(essid) === depth);
  if (found === undefined) throw new Error(`no network seeds depth ${depth}`);
  return found;
};

const innerRouterOf = (essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find(
    (host) => host.kind === 'router' && octetOf(host) !== 1,
  );
  if (gateway === undefined) throw new Error('no inner gateway on LAN');
  return gateway;
};

// Depth 2: the inner router fronts a layer that itself hangs a child gateway, which is
// what makes both the one-hop and the chained walk sayable against one network.
const ESSID = networkWithDepth(2);
const INNER = innerRouterOf(ESSID);
const INNER_ID = computeInnerGatewayId(ESSID, octetOf(INNER));
const LAYER = generateDeepLayer(ESSID, { machineId: INNER_ID, kind: 'router' });
const DEEP_HOST = LAYER.host;
const DEEP_HOST_ID = hostMachineId(DEEP_HOST, ESSID);

const CHILD = LAYER.childGateway;
if (CHILD === null) throw new Error('the inner router deep layer hangs no child gateway');
const CHILD_ID = computeDeepGatewayId(INNER_ID, octetOf(CHILD));
const CHILD_LAYER = generateDeepLayer(ESSID, { machineId: CHILD_ID, kind: CHILD.kind });
const CHAINED_HOST = CHILD_LAYER.host;
const CHAINED_HOST_ID = hostMachineId(CHAINED_HOST, ESSID);

/** The port the terminal box really listens on for ssh, read off its seeded tree rather
 *  than assumed: a generated host may hold the daemon on an alternate port. */
const sshPortOn = (host: LanHost): number => {
  const open = readOpenPorts(buildDeepHostFs(ESSID, host)).find(
    (candidate) => candidate.service === SERVICE_CATALOG.ssh.service,
  );
  if (open === undefined) throw new Error('the deep host serves no ssh');
  return open.port;
};

const DEEP_SSH_PORT = sshPortOn(DEEP_HOST);
const FORWARD_PORT = 2222;

const patchRow = (path: string, content: string | null): OwnerPatchRow => ({
  path,
  content,
  owner: 'root',
  permissions: null,
  node_type: content === null ? null : 'file',
  updated_at: '2026-08-26T00:00:00.000Z',
  writer_key: 'a'.repeat(64),
});

/** The player's own root `nano /etc/iptables/rules.v4` on the gateway — the opt-in that
 *  exposes the layer at all. */
const forwardTo = (host: LanHost, port: number): OwnerPatchRow =>
  patchRow('/etc/iptables/rules.v4', `forward ${FORWARD_PORT} to ${host.ip}:${port}`);

const BOOT_TOMBSTONE = patchRow('/boot/vmlinuz', null);

/** `/etc/passwd` as it stands on the box, plus one row — what `nano` leaves behind when
 *  a player who rooted the box adds themselves an account. */
const passwdPlus = (host: LanHost, row: string): OwnerPatchRow => {
  const etc = buildDeepHostFs(ESSID, host).entries.get('etc');
  if (etc === undefined || etc.kind !== 'directory') throw new Error('the deep host has no /etc');
  const passwd = etc.entries.get('passwd');
  if (passwd === undefined || passwd.kind !== 'file') throw new Error('the deep host has no passwd');
  return patchRow('/etc/passwd', `${passwd.content}${row}\n`);
};

const GHOST_HASH = 'd41d8cd98f00b204e9800998ecf8427e';
const GHOST_ROW = `ghost:${GHOST_HASH}:1001:1001:Ghost:/home/ghost:/bin/bash`;

type Journals = Readonly<Record<string, readonly OwnerPatchRow[]>>;

const depsFor = (journals: Journals, failFor?: string): InnerGatewayTargetDeps => ({
  findPatches: vi.fn<InnerGatewayTargetDeps['findPatches']>(async ({ machine_id }) =>
    machine_id === failFor
      ? { data: null, error: { message: 'boom' } }
      : { data: journals[machine_id] ?? [], error: null },
  ),
});

const reach = (journals: Journals, failFor?: string) =>
  resolveInnerGatewayTarget(depsFor(journals, failFor), {
    essid: ESSID,
    target: INNER.ip,
    port: FORWARD_PORT,
  });

describe('resolveInnerGatewayTarget, at the end of the chain', () => {
  it('hands back the deep box with its OWN journal replayed over the seeded tree', async () => {
    const resolved = await reach({
      [INNER_ID]: [forwardTo(DEEP_HOST, DEEP_SSH_PORT)],
      [DEEP_HOST_ID]: [passwdPlus(DEEP_HOST, GHOST_ROW)],
    });

    // An account a player added down there after rooting the box. Handed back seeded,
    // this row does not exist and the account cannot log in — which is the defect a
    // player reaches first.
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(accountIn(resolved.target.fs, 'ghost')).toEqual({
      hash: GHOST_HASH,
      userType: 'user',
    });
    expect(resolved.target.machineId).toBe(DEEP_HOST_ID);
  });

  it('refuses a deep box bricked through its own journal', async () => {
    const resolved = await reach({
      [INNER_ID]: [forwardTo(DEEP_HOST, DEEP_SSH_PORT)],
      [DEEP_HOST_ID]: [BOOT_TOMBSTONE],
    });

    // Every gateway on the chain is boot-gated; the box at the end of it was not, so a
    // machine a player killed went on answering.
    expect(resolved).toEqual({ ok: false, status: 404, error: 'host_unreachable' });
  });

  it('routes to a daemon the deep box own journal MOVED to another port', async () => {
    const moved = 2022;
    const resolved = await reach({
      [INNER_ID]: [forwardTo(DEEP_HOST, moved)],
      [DEEP_HOST_ID]: [patchRow(pidfilePath(SERVICE_CATALOG.ssh), formatPidfileContent(SERVICE_CATALOG.ssh, moved))],
    });

    // Routing itself used to read the seeded tree, so a forward to where the daemon
    // actually is was dark while a forward to where it used to be was live.
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.reachedPort).toBe(moved);
    expect(resolved.target.machineId).toBe(DEEP_HOST_ID);
  });

  it('still names the deep box when its daemon was STOPPED, leaving that to the door', async () => {
    const resolved = await reach({
      [INNER_ID]: [forwardTo(DEEP_HOST, DEEP_SSH_PORT)],
      [DEEP_HOST_ID]: [patchRow(pidfilePath(SERVICE_CATALOG.ssh), null)],
    });

    // A forward names a box and a port; whether the daemon behind it is up is a
    // different question, and every door already asks it against `reachedPort`. Refusing
    // here would make a stopped daemon read as a dark address — the same act on the
    // player's own LAN says the service is down.
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.machineId).toBe(DEEP_HOST_ID);
  });

  it('keeps a deep box whose journal could not be READ distinct from one that is dark', async () => {
    const resolved = await reach(
      {
        [INNER_ID]: [forwardTo(DEEP_HOST, DEEP_SSH_PORT)],
        [DEEP_HOST_ID]: [],
      },
      DEEP_HOST_ID,
    );

    // A server fault is not a routing answer. Reporting it as unreachable would tell a
    // player their forward is wrong, and they would go and "fix" a table that is right.
    expect(resolved).toEqual({ ok: false, status: 500, error: 'patches_lookup_failed' });
  });

  it('replays the journal of the box at the end of a MULTI-HOP chain', async () => {
    const chainedSshPort = sshPortOn(CHAINED_HOST);
    const resolved = await reach({
      [INNER_ID]: [forwardTo(CHILD, FORWARD_PORT)],
      [CHILD_ID]: [forwardTo(CHAINED_HOST, chainedSshPort)],
      [CHAINED_HOST_ID]: [passwdPlus(CHAINED_HOST, GHOST_ROW)],
    });

    // Depth does not decide it: the terminal box is the terminal box however many
    // gateways the packet crossed to get there.
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(accountIn(resolved.target.fs, 'ghost')).not.toBeNull();
    expect(resolved.target.machineId).toBe(CHAINED_HOST_ID);
  });
});
