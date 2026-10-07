/**
 * firstBoot — what a player's workstation is born running.
 *
 * Every workstation comes up with one to three services already listening, so its
 * owner has something to defend from their first prompt and every other player on
 * their network has something to find. Which ones is drawn from the owner's identity,
 * like everything else on the box: the same owner always gets the same set, and a new
 * game, being a new identity, draws again.
 */

import { installExtraFiles, installNewest, type InstallBox } from '../commands/apt.js';
import { DAEMONS, startDaemon, type Daemon } from '../commands/daemon.js';
import type { CommandEnv } from '../commands/types.js';
import { createFsView } from '../filesystem/fsView.js';
import type { Directory } from '../filesystem/types.js';
import { SERVICE_CONFIG_FILE } from '../generation/baseFs.js';
import { createPrng } from '../generation/prng.js';
import { pidfilePath } from '../services/pidfile.js';
import { asAbsPath } from '../types.js';
import { canBoot } from './bootFiles.js';

export type StartingService = {
  readonly daemon: Daemon;
  /** What `apt install` is asked for to put the daemon on the box. */
  readonly packageName: string;
};

const service = (daemonName: string, packageName: string): StartingService => {
  const daemon = DAEMONS[daemonName];
  if (daemon === undefined) throw new Error(`no daemon named ${daemonName}`);
  return { daemon, packageName };
};

/** The desktop services a box can be born with. Network infrastructure (`snmpd`,
 *  `named`) stays out: nobody's desktop comes up as a name server. The web server is
 *  `nginx` and never `apache2`: this world keeps no release history for apache2, so a
 *  box born with it would serve a door the clock could never open, at no version a
 *  scan could read. */
const POOL: readonly StartingService[] = [
  service('sshd', 'openssh-server'),
  service('vsftpd', 'vsftpd'),
  service('nginx', 'nginx'),
  service('mysqld', 'mysql'),
  service('redis-server', 'redis'),
];

/** Never zero: a box born with nothing would sit outside the loop of finding a door,
 *  getting in, and patching your own. */
const FEWEST = 1;
const MOST = 3;

export const startingServices = (ownerKeyHex: string): readonly StartingService[] => {
  const prng = createPrng(`first-boot-${ownerKeyHex}`);
  const count = prng.nextInt(FEWEST, MOST);
  return prng.pickN(POOL, count);
};

/** The file that says a box has had its first boot, where cloud-init keeps the same
 *  fact on a real machine. */
export const FIRST_BOOT_MARKER = asAbsPath('/var/lib/cloud/instance/boot-finished');

/** A player's own workstation as its first boot sees it: no shell yet, writes going
 *  straight to its journal as root. */
export type FirstBootBox = Pick<CommandEnv, 'identity' | 'hostname' | 'now' | 'patches'> & {
  /** The box as its journal stands right now, or null when the journal could not be
   *  read. Asked again after each service lands, so the next install builds on what the
   *  last one wrote rather than on a copy from before it. */
  readonly readTree: () => Promise<Directory | null>;
};

const installBoxOver = (box: FirstBootBox, tree: Directory): InstallBox => ({
  identity: box.identity,
  hostname: box.hostname,
  now: box.now,
  patches: box.patches,
  fs: createFsView(tree, { userType: 'root', cwd: asAbsPath('/') }),
  // Nobody is watching a terminal for these steps, so nothing waits between them.
  sleep: async () => {},
});

/** Run an install step to its end with nobody reading its lines, for what it returns. */
const finish = async <Result>(steps: AsyncGenerator<unknown, Result>): Promise<Result> => {
  for (;;) {
    const step = await steps.next();
    if (step.done === true) return step.value;
  }
};

const isBorn = (tree: Directory): boolean =>
  createFsView(tree, { userType: 'root' }).stat(FIRST_BOOT_MARKER) !== null;

/**
 * Give a box that has never booted its starting services: each one installed exactly
 * as `apt install` lays it down that day, then started on its own port. The marker goes
 * down last, so a boot that loses a write half way leaves the box unborn and the next
 * boot finishes the job — every step it repeats lands on what the last attempt left.
 *
 * Does nothing to a box already born (whatever its owner has stopped since stays
 * stopped), to one that cannot boot, or when the journal cannot be read: a born box
 * whose history failed to load would look exactly like a new one, and provisioning it
 * again would lay a fresh database over its owner's.
 */
export const runFirstBoot = async (box: FirstBootBox): Promise<void> => {
  let tree = await box.readTree();
  if (tree === null || isBorn(tree) || !canBoot(tree).ok) return;

  for (const { daemon, packageName } of startingServices(box.identity.publicKeyHex)) {
    const onBox = installBoxOver(box, tree);
    const installed = await finish(installNewest(onBox, packageName));
    if (installed !== 0) return;
    // An older box's owner may already run it, on a port of their choosing.
    if (onBox.fs.stat(pidfilePath(daemon.spec)) === null) {
      const started = await startDaemon(onBox, daemon, daemon.spec.defaultPort);
      if (!started.ok) return;
    }
    tree = await box.readTree();
    if (tree === null) return;
  }

  const marker = {
    path: FIRST_BOOT_MARKER,
    content: () => `${new Date(box.now()).toUTCString()} - first boot finished
`,
    permissions: SERVICE_CONFIG_FILE,
  };
  await finish(installExtraFiles(installBoxOver(box, tree), [marker]));
};
