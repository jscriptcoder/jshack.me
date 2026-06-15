import { describe, expect, it } from 'vitest';
import { isCrossPlayerHop, resolveActiveRoot } from './activeRoot';
import { generateHomeLan } from '../core/generation/generateHomeLan';
import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { hostMachineId } from '../core/generation/remoteHostId';
import { computeWorkstationId } from '../core/identity/workstation';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../core/types';
import { buildDirectory } from '../test/factories/filesystem';
import type { Patch } from '../core/filesystem/applyPatches';
import type { Directory, FileEntry, FileNode } from '../core/filesystem/types';
import type { Session } from '../core/commands/types';

/**
 * `resolveActiveRoot` picks the filesystem the active session operates on — your
 * own workstation tree when the session is on your box, or the
 * deterministically-generated tree of the remote host you've ssh'd into — and
 * replays the active machine's patch journal over whichever base it picks, so a
 * write (own OR remote) materializes. The remote host is recovered from its
 * coordinate `machine_id` by regenerating the current LAN, so a session that
 * only carries a `machine_id` still resolves on the live path AND on a refresh.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const OWN_ID = computeWorkstationId('skylab', PUBKEY);
const ownBaseFs = buildDirectory({});

const session = (machineId: string, kind: Session['kind'] = 'su'): Session => ({
  id: 'sess-1',
  playerKey: asPlayerKeyHex(PUBKEY),
  machineId: asMachineId(machineId),
  username: 'root',
  userType: 'root',
  kind,
  createdAt: asEpochMs(0),
});

const args = (over: Partial<Parameters<typeof resolveActiveRoot>[0]>) => ({
  session: session(OWN_ID),
  ownWorkstationId: OWN_ID,
  publicKeyHex: PUBKEY,
  essid: ESSID as string | null,
  ownBaseFs,
  patches: [] as readonly Patch[],
  ...over,
});

const fileAt = (root: Directory, segments: readonly string[]): FileEntry | undefined => {
  let current: FileNode | undefined = root;
  for (const segment of segments) {
    if (current === undefined || current.kind !== 'directory') return undefined;
    current = current.entries.get(segment);
  }
  return current !== undefined && current.kind === 'file' ? current : undefined;
};

const writePatch = (path: string, content: string): Patch => ({
  path,
  content,
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root', 'user', 'guest'] },
});

describe('resolveActiveRoot', () => {
  it('returns the own workstation base for a session on your own box (no patches)', () => {
    expect(resolveActiveRoot(args({ session: session(OWN_ID) }))).toBe(ownBaseFs);
  });

  it('replays the active journal over the own base for a session on your own box', () => {
    const root = resolveActiveRoot(
      args({ session: session(OWN_ID), patches: [writePatch('/home/note.txt', 'mine')] }),
    );

    expect(fileAt(root, ['home', 'note.txt'])?.content).toBe('mine');
  });

  it('returns the remote host tree for an ssh session, recovered from its machine_id', () => {
    const host = generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!;
    const machineId = hostMachineId(host, ESSID);

    const root = resolveActiveRoot(args({ session: session(machineId, 'ssh') }));

    expect(root).toEqual(buildRemoteHostFs(PUBKEY, ESSID, host));
    expect(root).not.toBe(ownBaseFs);
  });

  it('replays the active journal over the REMOTE base for an ssh session (write observability)', () => {
    const host = generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!;
    const machineId = hostMachineId(host, ESSID);

    const root = resolveActiveRoot(
      args({ session: session(machineId, 'ssh'), patches: [writePatch('/tmp/pwned', 'owned')] }),
    );

    // The remote write is visible — and it landed on the REMOTE tree, not the own one.
    expect(fileAt(root, ['tmp', 'pwned'])?.content).toBe('owned');
    expect(fileAt(ownBaseFs, ['tmp', 'pwned'])).toBeUndefined();
  });

  it('falls back to the own base when there is no network to resolve a remote against', () => {
    const machineId = hostMachineId(generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!, ESSID);
    expect(resolveActiveRoot(args({ session: session(machineId, 'ssh'), essid: null }))).toBe(
      ownBaseFs,
    );
  });

  it('falls back to the own base when the machine_id matches no host on the current LAN', () => {
    expect(resolveActiveRoot(args({ session: session('ghost-00000000', 'ssh') }))).toBe(ownBaseFs);
  });
});

describe('isCrossPlayerHop', () => {
  // A foreign workstation id (another identity's box) — never a host on B's own LAN.
  const FOREIGN_ID = computeWorkstationId('skylab', 'b'.repeat(64));

  it('is true for an ssh session on a machine that is not on your LAN', () => {
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'ssh'), ESSID, PUBKEY)).toBe(true);
  });

  it('is false for an ssh session on a host that IS on your own LAN', () => {
    const host = generateHomeLan(PUBKEY, ESSID).hosts.at(-1)!;
    const lanHopId = hostMachineId(host, ESSID);
    expect(isCrossPlayerHop(session(lanHopId, 'ssh'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false for an ssh session on your own workstation', () => {
    expect(isCrossPlayerHop(session(OWN_ID, 'ssh'), ESSID, PUBKEY)).toBe(false);
  });

  it('is true for a su session on a foreign machine (an elevation keeps the box you ssh’d into)', () => {
    // su-elevating on a cross-player box leaves you ON that box — its served tree
    // (now at the root tier) must stay, or reads/`reboot` would wrongly fall back
    // to your own box. The earlier ssh-only rule predated cross-player `su`.
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'su'), ESSID, PUBKEY)).toBe(true);
  });

  it('is false for a su session on your own workstation (still local)', () => {
    expect(isCrossPlayerHop(session(OWN_ID, 'su'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false for a non-shell session kind (nc) even on a foreign machine', () => {
    // Only an interactive FS shell (ssh / su) has a served tree to fetch; a service
    // session (nc/mysql/…) does not, so it is not a cross-player hop.
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'nc'), ESSID, PUBKEY)).toBe(false);
  });

  it('is false when offline (no essid to resolve a LAN against)', () => {
    expect(isCrossPlayerHop(session(FOREIGN_ID, 'ssh'), null, PUBKEY)).toBe(false);
  });
});
