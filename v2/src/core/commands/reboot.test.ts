import { describe, expect, it, vi } from 'vitest';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkView,
  mockRebootApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { commandRegistry } from './registry';
import { createBinaryEntries } from '../generation/binaries';
import { asAbsPath, asMachineId, type MachineId } from '../types';
import type { CommandResult, HopChain, NetworkView, RebootApi, Session } from './types';
import type { Directory, FileNode } from '../filesystem/types';
import { reboot } from './reboot';

/**
 * `reboot` cold-boots the machine the active session sits on (own box, or a box
 * you're ssh'd into). It animates a shutdown + BIOS, then consults
 * `canBoot(env.fs.root())` — the CURRENT machine's filesystem (the live own tree,
 * or, on a cross-player hop, A's server-served tree) — to decide the outcome:
 *   - both /boot kernel images present → "System rebooted successfully.";
 *   - /boot/vmlinuz gone              → GRUB "no loaded kernel" halt;
 *   - /boot/initrd.img gone           → kernel panic "unable to mount root fs".
 * The brick copy is byte-identical to the boot screen's, so a box looks the same
 * whether the brick surfaces via reboot or via the victim's next login.
 *
 * Root-only is enforced upstream by the binary gate (`/bin/reboot` is
 * execute:['root']), proven in `availability.test.ts` — `reboot.execute` is only
 * reachable as root in production, so there is no internal root check here.
 *
 * Pacing runs through `env.sleep` (the mock resolves instantly). Side effect on
 * completion: the player is DISCONNECTED from the rebooted machine — every
 * session on that machine is popped, but never the base login.
 */

const NO_FLAGS = new Map<string, string | true>();

const OWN: MachineId = asMachineId('rig-0a0a0a0a');
const REMOTE: MachineId = asMachineId('boxa-0b0b0b0b');

type BootFileName = 'vmlinuz' | 'initrd.img';

/** A top-level tree whose `/boot` holds exactly the named kernel images. */
const bootTree = (files: readonly BootFileName[]): Directory =>
  buildDirectory({
    boot: buildDirectory(
      Object.fromEntries(
        files.map((name) => [name, buildFile('bzImage 5.15.0', { owner: 'root' })]),
      ),
    ),
  });

type RebootEnvOpts = {
  readonly files?: readonly BootFileName[];
  readonly hostname?: string;
  readonly session?: Session;
  readonly hopChain?: HopChain;
  readonly popSession?: () => void;
  readonly evict?: RebootApi['evict'];
  readonly network?: NetworkView;
  readonly extra?: Readonly<Record<string, FileNode>>;
};

const rebootEnv = (opts: RebootEnvOpts = {}) => {
  const session =
    opts.session ?? mockSession({ machineId: OWN, userType: 'root', username: 'root' });
  // Compose the boot dir with any extra top-level nodes (e.g. /bin for the
  // registry path) without losing the /boot the decision reads.
  const base = bootTree(opts.files ?? ['vmlinuz', 'initrd.img']);
  const merged = buildDirectory({
    ...Object.fromEntries(base.entries),
    ...(opts.extra ?? {}),
  });
  return mockCommandEnv({
    session,
    hopChain: opts.hopChain ?? [],
    hostname: opts.hostname ?? 'workstation',
    fs: mockFsViewFromTree(merged, { userType: session.userType, cwd: () => asAbsPath('/') }),
    popSession: opts.popSession ?? (() => undefined),
    // The ordinary case, so the boot-outcome tests above stay about booting. The
    // seam itself is loud when unstubbed — a reboot that silently failed to evict
    // is the one failure this command must never absorb.
    reboot: mockRebootApi({ evict: opts.evict ?? (async () => ({ ok: true })) }),
    ...(opts.network === undefined ? {} : { network: opts.network }),
  });
};

/** Drain an async CommandResult to its rendered line contents + exit code. */
const collect = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly string[]; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async result expected');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { lines, exitCode: await result.exitCode() };
};

describe('reboot — boot outcome', () => {
  it('boots successfully when both /boot kernel images are present', async () => {
    const env = rebootEnv({ files: ['vmlinuz', 'initrd.img'] });

    const { lines, exitCode } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // The boot-result tail is the load-bearing observable — pin it exactly.
    expect(lines.slice(-4)).toEqual([
      'Loading vmlinuz...',
      'Loading initrd.img...',
      '',
      'System rebooted successfully.',
    ]);
    expect(lines).not.toContain('System halted.');
    expect(exitCode).toBe(0);
  });

  it('halts on a GRUB error when /boot/vmlinuz is missing', async () => {
    const env = rebootEnv({ files: ['initrd.img'] });

    const { lines } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // Byte-identical to the boot screen's brick copy (no drift between the two
    // ways a brick surfaces) — pinned exactly, including the blank separators.
    expect(lines.slice(-5)).toEqual([
      '',
      "error: file '/boot/vmlinuz' not found.",
      'GRUB error: no loaded kernel.',
      '',
      'System halted.',
    ]);
    expect(lines).not.toContain('System rebooted successfully.');
  });

  it('panics on root-fs mount when /boot/initrd.img is missing (vmlinuz present)', async () => {
    const env = rebootEnv({ files: ['vmlinuz'] });

    const { lines } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // The kernel loads (vmlinuz present) then panics on the missing root fs.
    expect(lines.slice(-5)).toEqual([
      'Loading vmlinuz...',
      "error: file '/boot/initrd.img' not found.",
      'Kernel panic - not syncing: VFS: Unable to mount root fs',
      '',
      'System halted.',
    ]);
    expect(lines).not.toContain('GRUB error: no loaded kernel.');
    expect(lines).not.toContain('System rebooted successfully.');
  });

  it('addresses the current machine in the shutdown broadcast (uses env.hostname)', async () => {
    const env = rebootEnv({ hostname: 'skylab' });

    const { lines } = await collect(await reboot.execute(env, [], NO_FLAGS));

    expect(lines).toContain('Broadcast message from root@skylab:');
  });
});

describe('reboot — disconnect from the rebooted machine', () => {
  it('stays put when rebooting the own base box (nothing to disconnect)', async () => {
    const popSession = vi.fn();
    const env = rebootEnv({
      session: mockSession({ machineId: OWN, userType: 'root', username: 'root' }),
      hopChain: [],
      popSession,
    });

    await collect(await reboot.execute(env, [], NO_FLAGS));

    expect(popSession).not.toHaveBeenCalled();
  });

  it('drops the su elevation when rebooting your own box', async () => {
    const popSession = vi.fn();
    const env = rebootEnv({
      session: mockSession({ machineId: OWN, userType: 'root', username: 'root', kind: 'su' }),
      hopChain: [mockSession({ machineId: OWN, userType: 'user', username: 'neo', kind: 'ssh' })],
      popSession,
    });

    await collect(await reboot.execute(env, [], NO_FLAGS));

    // The su session is on the rebooted (own) box; the base login is preserved.
    expect(popSession).toHaveBeenCalledTimes(1);
  });

  it('fully disconnects from a remote box, popping both the ssh and su sessions (cross-player brick)', async () => {
    const popSession = vi.fn();
    const env = rebootEnv({
      // B is root on A (su over an ssh hop); A's /boot/vmlinuz was already rm'd.
      files: ['initrd.img'],
      session: mockSession({ machineId: REMOTE, userType: 'root', username: 'root', kind: 'su' }),
      hopChain: [
        mockSession({ machineId: OWN, userType: 'user', username: 'mallory', kind: 'ssh' }),
        mockSession({ machineId: REMOTE, userType: 'guest', username: 'guest', kind: 'ssh' }),
      ],
      popSession,
    });

    const { lines } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // The brick is shown...
    expect(lines).toContain("error: file '/boot/vmlinuz' not found.");
    // ...and B is dropped off A entirely (su + ssh), back to their own base box.
    expect(popSession).toHaveBeenCalledTimes(2);
  });

  it('preserves a session held on a different machine when disconnecting a remote box', async () => {
    const popSession = vi.fn();
    const env = rebootEnv({
      // su root on OWN → ssh to A → su root on A → reboot A: only A's two sessions
      // are popped; the own-box root session beneath them survives.
      session: mockSession({ machineId: REMOTE, userType: 'root', username: 'root', kind: 'su' }),
      hopChain: [
        mockSession({ machineId: OWN, userType: 'user', username: 'mallory', kind: 'ssh' }),
        mockSession({ machineId: OWN, userType: 'root', username: 'root', kind: 'su' }),
        mockSession({ machineId: REMOTE, userType: 'guest', username: 'guest', kind: 'ssh' }),
      ],
      popSession,
    });

    await collect(await reboot.execute(env, [], NO_FLAGS));

    expect(popSession).toHaveBeenCalledTimes(2);
  });
});

describe('reboot — the machine drops its sessions', () => {
  const EVICTION_FAILED =
    'reboot: could not end active sessions — anyone connected may still be on this machine';

  it('drops the sessions at the shutdown beat, before the box is said to be down', async () => {
    const evict = vi.fn<RebootApi['evict']>(async () => ({ ok: true }));
    const env = rebootEnv({
      session: mockSession({ machineId: REMOTE, userType: 'root', username: 'root', kind: 'su' }),
      hopChain: [mockSession({ machineId: OWN, userType: 'user', username: 'mallory' })],
      evict,
    });

    const result = await reboot.execute(env, [], NO_FLAGS);
    if (result.kind !== 'async') throw new Error('async result expected');
    // Walk the animation a line at a time and stop the moment the box has dropped
    // its sessions — the way a Ctrl-C leaves it half-rendered. What the player had
    // been shown by then is the assertion: a real machine drops its sessions while
    // it is shutting down, and once it has, there is nothing left to take back.
    const animation = result.lines[Symbol.asyncIterator]();
    const shown: string[] = [];
    while (evict.mock.calls.length === 0) {
      const step = await animation.next();
      if (step.done === true) break;
      shown.push(step.value.content);
    }

    expect(evict).toHaveBeenCalledWith(REMOTE);
    expect(shown).toEqual([
      'Broadcast message from root@workstation:',
      'The system is going down for reboot NOW!',
      '[ OK ] Stopping system logging...',
      '[ OK ] Reached target Shutdown.',
    ]);
  });

  it('tells the player the eviction did not take, and exits non-zero', async () => {
    const env = rebootEnv({ evict: async () => ({ ok: false, error: 'network_error' }) });

    const { lines, exitCode } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // The box did come up — that part was local and really happened. What the
    // player must not be allowed to believe is that it came up empty.
    expect(lines).toContain('System rebooted successfully.');
    expect(lines).toContain(EVICTION_FAILED);
    expect(exitCode).toBe(1);
  });

  it('says nothing extra and exits zero when the eviction took', async () => {
    const env = rebootEnv({ evict: async () => ({ ok: true }) });

    const { lines, exitCode } = await collect(await reboot.execute(env, [], NO_FLAGS));

    expect(lines).not.toContain(EVICTION_FAILED);
    expect(exitCode).toBe(0);
  });

  it('drops the sessions of a box that cannot boot, which is the whole trade', async () => {
    const evict = vi.fn<RebootApi['evict']>(async () => ({ ok: true }));
    const env = rebootEnv({ files: ['initrd.img'], evict });

    const { lines } = await collect(await reboot.execute(env, [], NO_FLAGS));

    // Rebooting a box whose kernel image is already gone is how a defender pays
    // for the eviction: they get the intruder off, and lose the machine doing it.
    expect(lines).toContain('System halted.');
    expect(evict).toHaveBeenCalledTimes(1);
  });

  it('drops the sessions while the player is not joined to any network', async () => {
    const evict = vi.fn<RebootApi['evict']>(async () => ({ ok: true }));
    const env = rebootEnv({ network: mockNetworkView({ isOnline: () => false }), evict });

    await collect(await reboot.execute(env, [], NO_FLAGS));

    // `nmcli disconnect` then `reboot` is the panic sequence, and it is supposed
    // to work: in-game connectivity says nothing about rebooting your own hardware.
    expect(evict).toHaveBeenCalledTimes(1);
  });
});

describe('reboot — registry wiring', () => {
  it('is registered and cold-boots through the command registry as root', async () => {
    const wired = commandRegistry.get('reboot');
    if (wired === undefined) throw new Error('reboot not registered');

    // The registry path gates on /bin/reboot (root-executable), reboot's linked
    // /lib/libsystemd.so, and /boot presence.
    const env = rebootEnv({
      files: ['vmlinuz', 'initrd.img'],
      extra: {
        bin: buildDirectory(createBinaryEntries(['reboot'])),
        lib: buildDirectory({ 'libsystemd.so': buildFile('\x7fELF-lib', { owner: 'root' }) }),
      },
    });

    const { lines, exitCode } = await collect(await wired.execute(env, [], NO_FLAGS));

    expect(lines).toContain('System rebooted successfully.');
    expect(exitCode).toBe(0);
  });
});
