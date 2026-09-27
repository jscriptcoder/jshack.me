/**
 * `/root` on a generated box: the stock dotfiles, a few notes the admin kept, and the
 * shell history of whoever ran the machine — the reward for escalating.
 *
 * Half of that history is the admin's habits, drawn from a pool. The other half is the
 * box itself: the daemons it runs (`systemctl` against each), the configs it keeps, the
 * logs it writes, the notes beside the history, and — on the home LAN — neighbours that
 * really answer, spelled the way the game's own commands take them. So a player who
 * replays any line finds it true. A deep-layer box knows no neighbours and names none,
 * and its tree is the same whether or not its layer hangs a child.
 *
 * Root-only throughout, which is why this history may name accounts: a player who reads
 * it has already taken the box. Everything draws from the box's own `root-content`
 * stream, so no other concern's draws move.
 */

import type { Directory, FileNode } from '../filesystem/types';
import { dir, file, ROOT_DIR, ROOT_FILE } from './baseFs';
import { isOnHomeLan, type LanHost } from './generateHomeLan';
import { daemonName } from '../services/pidfile';
import type { HostService } from './remoteHostFs';
import type { DrawnRole } from './machineRole';
import { networkPersona } from './persona';
import { fillSlots, networkLines, pastDate } from './npcHome';
import { createPrng, type Prng } from './prng';
import { WEEKDAYS } from './pools/homeNotes';
import {
  DEBIAN_ROOT_BASHRC,
  DEBIAN_ROOT_PROFILE,
  ROLE_ROOT_HISTORY,
  ROOT_HISTORY,
  ROOT_NOTE_TEMPLATES,
} from './pools/rootContent';

const buildNotes = (options: {
  readonly prng: Prng;
  readonly hostname: string;
  readonly place: string;
}): ReadonlyMap<string, string> => {
  const { prng, hostname, place } = options;
  const chosen = prng.pickN(ROOT_NOTE_TEMPLATES, prng.nextInt(0, 2));
  return new Map(
    chosen.map((template) => [
      template.file,
      fillSlots(template.body, {
        hostname,
        place,
        date: pastDate(prng),
        day: prng.pick(WEEKDAYS),
        count: String(prng.nextInt(2, 9)),
      }),
    ]),
  );
};

/** The lines that come from the box itself rather than from habit. */
const boxLines = (options: {
  readonly prng: Prng;
  readonly services: readonly HostService[];
  readonly configPaths: readonly string[];
  readonly logPaths: readonly string[];
  readonly notePaths: readonly string[];
}): readonly string[] => {
  const { prng, services, configPaths, logPaths, notePaths } = options;
  const serviceLines = services.map(
    ({ spec }) => `systemctl ${prng.pick(['status', 'restart', 'start'])} ${daemonName(spec)}`,
  );
  const configLines = configPaths
    .filter(() => prng.next() < 0.6)
    .map((path) => `${prng.pick(['cat', 'vim', 'nano', 'less'])} ${path}`);
  const logLines = prng
    .pickN(logPaths, prng.nextInt(1, 2))
    .map((path) => `${prng.pick(['tail', 'tail -f', 'less', 'grep -i error'])} ${path}`);
  const noteLines = notePaths
    .filter(() => prng.next() < 0.5)
    .map((path) => `${prng.pick(['cat', 'vim'])} ${path}`);
  return [...serviceLines, ...configLines, ...logLines, ...noteLines];
};

export const buildRootHome = (options: {
  readonly essid: string;
  readonly host: LanHost;
  readonly role: DrawnRole | undefined;
  readonly services: readonly HostService[];
  /** Absolute paths of the configs this box keeps for what it is and what it runs. */
  readonly configPaths: readonly string[];
  /** Absolute paths of the logs this box writes. */
  readonly logPaths: readonly string[];
  /** Root's `.ssh/`, or null where root has reached nobody. */
  readonly sshDirectory: Directory | null;
}): Directory => {
  const { essid, host, role, services, configPaths, logPaths, sshDirectory } = options;
  const prng = createPrng(`root-content-${essid}-${host.ip}`);
  const notes = buildNotes({ prng, hostname: host.hostname, place: networkPersona(essid).place });

  const habits = [
    ...prng.pickN(ROOT_HISTORY, prng.nextInt(8, 14)),
    ...(role === undefined ? [] : prng.pickN(ROLE_ROOT_HISTORY[role], prng.nextInt(1, 3))),
  ];
  const ownLines = boxLines({
    prng,
    services,
    configPaths,
    logPaths,
    notePaths: [...notes.keys()].map((name) => `/root/${name}`),
  });
  const network = isOnHomeLan(essid, host) ? networkLines(prng, essid, host) : [];
  const history = prng.shuffle([...habits, ...ownLines, ...network]);

  const noteEntries: Record<string, FileNode> = Object.fromEntries(
    [...notes].map(([name, body]) => [name, file(body, ROOT_FILE)]),
  );
  return dir(
    {
      '.bashrc': file(DEBIAN_ROOT_BASHRC, ROOT_FILE),
      '.profile': file(DEBIAN_ROOT_PROFILE, ROOT_FILE),
      '.bash_history': file(`${history.join('\n')}\n`, ROOT_FILE),
      ...noteEntries,
      ...(sshDirectory === null ? {} : { '.ssh': sshDirectory }),
    },
    ROOT_DIR,
  );
};
