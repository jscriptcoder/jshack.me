import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { crackableEssidPool } from './generateWifi';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { networkPersona } from './persona';
import { DEBIAN_BASHRC, DEBIAN_BASH_LOGOUT, DEBIAN_PROFILE } from './pools/homeSkeleton';
import { createFsView } from '../filesystem/fsView';
import { lanZoneName, resolveLanName } from '../network/resolveName';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { listenerPidfileName } from '../services/pidfile';
import {
  ALL_ESSIDS,
  deepBoxes,
  falsehoodIn,
  filesUnder,
  lanBoxes,
  serialise,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';

/**
 * What any generated box admits to whoever lands on it: a guest gets a real home, anyone
 * can read an `/etc` that names the box and its true neighbours, and root finds the
 * history of whoever ran it. Read the way a player reads it: through the box's own tree,
 * at the tier the player holds.
 */

const etcFileOf = (tree: Directory, name: string): string => {
  const result = createFsView(tree, { userType: 'guest' }).read(asAbsPath(`/etc/${name}`));
  if (!result.ok) throw new Error(`/etc/${name}: ${result.error}`);
  return result.content;
};

/** The lines of a config that say something: no comments, no blanks. */
const statedLines = (content: string): readonly string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

/** The `/etc/hosts` lines naming some other machine than the box itself. */
const neighbourEntries = (hosts: string): readonly string[] =>
  statedLines(hosts).filter((line) => /^\d/.test(line) && !line.startsWith('127.'));

const existsOn = (tree: Directory, path: string): boolean =>
  createFsView(tree, { userType: 'root' }).stat(asAbsPath(path)) !== null;

const NEW_ETC_FILES = ['hostname', 'hosts', 'resolv.conf', 'motd', 'fstab', 'crontab'];

const subnetOf = (ip: string): string => ip.split('.').slice(0, 3).join('.');

describe('a guest who lands on a generated box', () => {
  it('lands in a home of their own, holding the stock dotfiles and nothing else', () => {
    lanBoxes(crackableEssidPool.slice(0, 5)).forEach(({ essid, host }) => {
      const guest = createFsView(buildRemoteHostFs(essid, host), { userType: 'guest' });

      const listing = guest.list(asAbsPath('/home/guest'));
      expect(listing.ok).toBe(true);
      expect(guest.read(asAbsPath('/home/guest/.bashrc'))).toEqual({
        ok: true,
        content: DEBIAN_BASHRC,
      });
      expect(guest.read(asAbsPath('/home/guest/.profile'))).toEqual({
        ok: true,
        content: DEBIAN_PROFILE,
      });
      expect(guest.read(asAbsPath('/home/guest/.bash_logout'))).toEqual({
        ok: true,
        content: DEBIAN_BASH_LOGOUT,
      });
      expect(guest.canWrite(asAbsPath('/home/guest/.bashrc')).allowed).toBe(true);
      expect(guest.canWrite(asAbsPath('/home/guest/notes.txt')).allowed).toBe(true);
    });
  });
});

describe('the /etc anyone on a generated box can read', () => {
  it('names the box, its resolver, its disks, its jobs and its greeting, for any tier to read', () => {
    lanBoxes(crackableEssidPool.slice(0, 5)).forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const etc = tree.entries.get('etc');
      if (etc?.kind !== 'directory') throw new Error('no /etc');
      const user = createFsView(tree, { userType: 'user' });

      NEW_ETC_FILES.forEach((name) => {
        const node = etc.entries.get(name);
        expect(node?.kind).toBe('file');
        expect(node?.owner).toBe('root');
        expect(etcFileOf(tree, name)).not.toBe('');
        expect(user.canWrite(asAbsPath(`/etc/${name}`)).allowed).toBe(false);
      });
      expect(etcFileOf(tree, 'hostname')).toBe(`${host.hostname}\n`);
    });
  });

  it('lists in /etc/hosts only neighbouring machines that are really there, at their real address', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const hosts = etcFileOf(buildRemoteHostFs(essid, host), 'hosts');
      const lines = statedLines(hosts);
      expect(lines).toContain('127.0.0.1\tlocalhost');
      expect(lines).toContain(`127.0.1.1\t${host.hostname}.${lanZoneName(essid)} ${host.hostname}`);

      neighbourEntries(hosts).forEach((line) => {
        const [address, qualified, bare] = line.split(/\s+/);
        expect(resolveLanName(essid, bare ?? '')).toEqual({ fqdn: qualified, ip: address });
        expect(address).not.toBe(host.ip);
        const neighbour = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === address);
        expect(neighbour?.kind).toBe('machine');
      });
    });
  });

  it('lists anywhere from none to three neighbours, never more', () => {
    const counts = lanBoxes(ALL_ESSIDS).map(
      ({ essid, host }) => neighbourEntries(etcFileOf(buildRemoteHostFs(essid, host), 'hosts')).length,
    );
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(3);
  });

  it('resolves through the network’s own gateway, and searches the network’s own zone', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      expect(etcFileOf(buildRemoteHostFs(essid, host), 'resolv.conf')).toBe(
        `search ${lanZoneName(essid)}\nnameserver ${subnetOf(host.ip)}.1\n`,
      );
    });
  });

  it('mounts only places the box has', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const mounts = statedLines(etcFileOf(tree, 'fstab'));
      expect(mounts.some((line) => line.split(/\s+/)[1] === '/')).toBe(true);
      mounts.forEach((line) => {
        const [device, mountPoint, type] = line.split(/\s+/);
        expect(device).toMatch(
          /^UUID=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        if (type === 'swap') expect(mountPoint).toBe('none');
        else expect(existsOn(tree, mountPoint ?? '')).toBe(true);
      });
    });
  });

  it('runs every scheduled job as root, on paths the box has', () => {
    const jobCounts = lanBoxes(ALL_ESSIDS).map(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const jobs = statedLines(etcFileOf(tree, 'crontab')).filter(
        (line) => !/^[A-Z]+=/.test(line),
      );
      jobs.forEach((job) => {
        const fields = job.split(/\s+/);
        expect(fields[5], `${host.hostname}: ${job}`).toBe('root');
        fields
          .slice(6)
          .filter((word) => word.startsWith('/'))
          .forEach((path) => {
            expect(existsOn(tree, path), `${host.hostname}: ${job}`).toBe(true);
          });
      });
      return jobs.length;
    });
    expect(Math.min(...jobCounts)).toBeGreaterThan(0);
  });

  it('never gives away the account a player has to earn', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const username = npcUsername(essid, host);
      NEW_ETC_FILES.forEach((name) => {
        const content = etcFileOf(tree, name);
        expect(content).not.toContain(`/home/${username}`);
        expect(content).not.toContain(`${username}@`);
      });
    });
  });

  it('greets whoever logs in with the name of the place and of the box', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const motd = etcFileOf(buildRemoteHostFs(essid, host), 'motd');
      expect(motd).toContain(networkPersona(essid).place);
      expect(motd).toContain(host.hostname);
    });
  });
});

describe('the /etc of a box on a deep layer', () => {
  it('names only itself, and resolves through the gateway in front of it', () => {
    const boxes = deepBoxes(crackableEssidPool);
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach(({ essid, host }) => {
      const tree = buildDeepHostFs(essid, host);
      expect(statedLines(etcFileOf(tree, 'hosts')).filter((line) => /^\d/.test(line))).toEqual([
        '127.0.0.1\tlocalhost',
        `127.0.1.1\t${host.hostname}`,
      ]);
      expect(etcFileOf(tree, 'resolv.conf')).toBe(`nameserver ${subnetOf(host.ip)}.1\n`);
    });
  });

  it('is the same box whether or not its layer hangs another gateway', () => {
    deepBoxes(crackableEssidPool).forEach(({ essid, gateway }) => {
      const terminal = generateDeepLayer(essid, gateway, { hangsChild: false }).host;
      const fronting = generateDeepLayer(essid, gateway, { hangsChild: true }).host;
      expect(serialise(buildDeepHostFs(essid, fronting))).toEqual(
        serialise(buildDeepHostFs(essid, terminal)),
      );
    });
  });
});

/** Every file root keeps in `/root`, keyed by its path under it. */
const rootFilesOf = (tree: Directory): ReadonlyMap<string, string> => {
  const root = tree.entries.get('root');
  if (root?.kind !== 'directory') throw new Error('no /root');
  return filesUnder(root);
};

const ROOT_DOTFILES = ['.bashrc', '.profile', '.bash_history'];

/** Root's notes: every file in `/root` that is not a dotfile or under `.ssh/`. */
const rootNotesOf = (files: ReadonlyMap<string, string>): readonly string[] =>
  [...files]
    .filter(([path]) => !path.startsWith('.'))
    .map(([, content]) => content);

/** The start of a planted listener's pidfile name (`nc-4444.pid`): a door somebody left,
 *  not a service the box's admin looks after. */
const LISTENER_PIDFILE_START = listenerPidfileName(0).slice(0, -'0.pid'.length);

/** The services a box is running, as a player finds them: one pidfile each in `/var/run`,
 *  leaving out any listener planted on it. */
const daemonsRunningOn = (tree: Directory): readonly string[] => {
  const run = createFsView(tree, { userType: 'root' }).list(asAbsPath('/var/run'));
  if (!run.ok) return [];
  return run.entries
    .filter((name) => name.endsWith('.pid') && !name.startsWith(LISTENER_PIDFILE_START))
    .map((name) => name.slice(0, -'.pid'.length));
};

const historyLines = (history: string): readonly string[] =>
  history.split('\n').filter((line) => line !== '');

const everyBox = () => [
  ...lanBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
    box: { essid, host },
    tree: buildRemoteHostFs(essid, host),
  })),
  ...deepBoxes(crackableEssidPool).map(({ essid, host }) => ({
    box: { essid, host },
    tree: buildDeepHostFs(essid, host),
  })),
];

describe('what root keeps in /root', () => {
  it('holds root’s dotfiles and shell history, which nobody but root can read', () => {
    lanBoxes(crackableEssidPool.slice(0, 5)).forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const files = rootFilesOf(tree);
      ROOT_DOTFILES.forEach((name) => {
        expect(files.get(name) ?? '').not.toBe('');
        expect(createFsView(tree, { userType: 'root' }).stat(asAbsPath(`/root/${name}`))?.owner).toBe(
          'root',
        );
      });
      (['user', 'guest'] as const).forEach((userType) => {
        expect(createFsView(tree, { userType }).list(asAbsPath('/root'))).toEqual({
          ok: false,
          error: 'permission_denied',
        });
      });
    });
  });

  it('keeps anywhere from none to two notes', () => {
    const counts = lanBoxes(ALL_ESSIDS).map(
      ({ essid, host }) => rootNotesOf(rootFilesOf(buildRemoteHostFs(essid, host))).length,
    );
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(2);
  });

  it('remembers only commands that would work on this box today', () => {
    const falsehoods = everyBox().flatMap(({ box, tree }) => {
      const daemons = daemonsRunningOn(tree);
      return historyLines(rootFilesOf(tree).get('.bash_history') ?? '').flatMap((line) => {
        const words = line.split(' ');
        const unit = words[0] === 'systemctl' ? (words[2] ?? '') : null;
        const why =
          unit !== null && !daemons.includes(unit)
            ? `${unit} does not run here`
            : falsehoodIn({ line, box, tree, home: '/root' });
        return why === null ? [] : [`${box.essid} ${box.host.hostname}: "${line}" ${why}`];
      });
    });
    expect(falsehoods).toEqual([]);
  });

  it('shows root looking after a service the box runs, on every box that runs one', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const tree = buildRemoteHostFs(essid, host);
      const daemons = daemonsRunningOn(tree);
      if (daemons.length === 0) return;
      const history = rootFilesOf(tree).get('.bash_history') ?? '';
      expect(
        daemons.some((daemon) => new RegExp(`^systemctl \\w+ ${daemon}$`, 'm').test(history)),
        `${host.hostname}`,
      ).toBe(true);
    });
  });

  it('shows root reading the config the box keeps for what it is', () => {
    const readsConfig = lanBoxes(ALL_ESSIDS).filter(({ essid, host }) =>
      /^(cat|vim|nano|less) \/etc\/\S+\.(conf|cnf)$|^(cat|vim|nano|less) \/etc\/ssh_config$/m.test(
        rootFilesOf(buildRemoteHostFs(essid, host)).get('.bash_history') ?? '',
      ),
    );
    expect(readsConfig.length).toBeGreaterThan(0);
  });

  it('names a gateway only by its address, since two routers can share a name', () => {
    lanBoxes(ALL_ESSIDS).forEach(({ essid, host }) => {
      const text = [...rootFilesOf(buildRemoteHostFs(essid, host)).values()].join('\n');
      generateHomeLan(essid)
        .hosts.filter((candidate) => candidate.kind !== 'machine')
        .forEach((gateway) => {
          expect(text).not.toMatch(new RegExp(`\\b${gateway.hostname}\\b`));
        });
    });
  });

  it('names a neighbour on some box of every network that has one', () => {
    const networksNamingNone = ALL_ESSIDS.filter(
      (essid) =>
        !lanBoxes([essid]).some(({ host }) =>
          /^(ssh|curl|ping|nslookup) /m.test(
            rootFilesOf(buildRemoteHostFs(essid, host)).get('.bash_history') ?? '',
          ),
        ),
    );
    expect(networksNamingNone).toEqual([]);
  });

  it('names nothing on a deep layer, whose neighbours the box cannot know', () => {
    deepBoxes(crackableEssidPool).forEach(({ essid, host }) => {
      const history = rootFilesOf(buildDeepHostFs(essid, host)).get('.bash_history') ?? '';
      expect(history).not.toBe('');
      expect(history).not.toMatch(/^(ssh|curl|ping|nslookup) /m);
    });
  });

  it('dates every note to a real day in the past, within a box’s lifetime', () => {
    const epoch = new Date(WORLD_EPOCH).toISOString().slice(0, 10);
    const floor = new Date(WORLD_EPOCH - 731 * 86_400_000).toISOString().slice(0, 10);
    const dates = lanBoxes(ALL_ESSIDS).flatMap(({ essid, host }) =>
      rootNotesOf(rootFilesOf(buildRemoteHostFs(essid, host))).flatMap(
        (note) => note.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [],
      ),
    );
    expect(dates.length).toBeGreaterThan(0);
    dates.forEach((date) => {
      expect(date < epoch).toBe(true);
      expect(date >= floor).toBe(true);
    });
  });

  it('carries no software version and writes no password down', () => {
    everyBox().forEach(({ tree }) => {
      [...rootFilesOf(tree).values()].forEach((content) => {
        expect(softwareVersionsIn(content)).toEqual([]);
        expect(content).not.toMatch(/pass(word|wd)?\s*[:=]/i);
        expect(content).not.toMatch(/sshpass|mysql -p\S/);
      });
    });
  });
});

describe('no two roots are the same', () => {
  it('gives no two boxes on one network the same history or note', () => {
    ALL_ESSIDS.forEach((essid) => {
      const roots = lanBoxes([essid]).map(({ host }) => rootFilesOf(buildRemoteHostFs(essid, host)));
      const histories = roots.map((files) => files.get('.bash_history'));
      expect(new Set(histories).size).toBe(histories.length);
      const notes = roots.flatMap(rootNotesOf);
      expect(new Set(notes).size).toBe(notes.length);
    });
  });

  it('keeps histories and notes distinct across every catalog network', () => {
    const roots = lanBoxes(crackableEssidPool).map(({ essid, host }) =>
      rootFilesOf(buildRemoteHostFs(essid, host)),
    );
    const histories = roots.map((files) => files.get('.bash_history'));
    const notes = roots.flatMap(rootNotesOf);
    expect(new Set(histories).size / histories.length).toBeGreaterThanOrEqual(0.95);
    expect(new Set(notes).size / notes.length).toBeGreaterThanOrEqual(0.9);
  });

  it('gives no two boxes on one network the same greeting', () => {
    ALL_ESSIDS.forEach((essid) => {
      const greetings = lanBoxes([essid]).map(({ host }) =>
        etcFileOf(buildRemoteHostFs(essid, host), 'motd'),
      );
      expect(new Set(greetings).size).toBe(greetings.length);
    });
  });
});

const DESK_PREFIXES = ['desktop', 'laptop', 'workstation'];
const isDesk = (host: LanHost): boolean =>
  DESK_PREFIXES.includes(host.hostname.slice(0, host.hostname.lastIndexOf('-')));

/** The neighbouring machines on a box's LAN that answer on ssh, with the port they use. */
const sshNeighboursOf = ({ essid, host }: Box): readonly { host: LanHost; port: number }[] =>
  generateHomeLan(essid)
    .hosts.filter((candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip)
    .flatMap((candidate) => {
      const ssh = hostServices(essid, candidate).find(({ spec }) => spec.service === 'ssh');
      return ssh === undefined ? [] : [{ host: candidate, port: ssh.port }];
    });

/** The neighbour a `known_hosts` entry is for, or why the entry is false. */
const knownHostFalsehood = (box: Box, entry: string): string | null => {
  const [names, keyType, key] = entry.split(' ');
  if (keyType !== 'ssh-ed25519' || !/^AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(key ?? '')) {
    return 'is not an ed25519 host key';
  }
  const bracketed = /^\[([\d.]+)\]:(\d+)$/.exec(names ?? '');
  const [hostname, address] = (names ?? '').split(',');
  const target = bracketed === null ? address : bracketed[1];
  const port = bracketed === null ? 22 : Number(bracketed[2]);
  const neighbour = sshNeighboursOf(box).find((candidate) => candidate.host.ip === target);
  if (neighbour === undefined) return `${target} runs no sshd on this network`;
  if (neighbour.port !== port) return `${target} answers ssh on ${neighbour.port}, not ${port}`;
  if (bracketed === null && hostname !== neighbour.host.hostname) return `${target} is not ${hostname}`;
  if (bracketed !== null && port === 22) return 'brackets a port-22 entry';
  return null;
};

/** `~/.ssh/config` as `ssh` commands a player could type: one per `Host` block that names
 *  a machine, leaving out the `Host *` defaults every connection shares. */
const sshCommandsIn = (config: string): readonly string[] =>
  config
    .split(/^Host /m)
    .slice(1)
    .filter((block) => !block.startsWith('*'))
    .map((block) => {
      const field = (name: string): string | undefined =>
        new RegExp(`^\\s+${name} (\\S+)$`, 'm').exec(block)?.[1];
      const port = field('Port');
      return `ssh ${port === undefined ? '' : `-p ${port} `}${field('User') ?? ''}@${field('HostName') ?? ''}`;
    });

describe('who a box remembers meeting', () => {
  it('lets root recall the neighbours it reached over ssh, at the port each really answers on', () => {
    let boxesWithMemory = 0;
    lanBoxes(ALL_ESSIDS).forEach((box) => {
      const tree = buildRemoteHostFs(box.essid, box.host);
      const knownHosts = rootFilesOf(tree).get('.ssh/known_hosts');
      if (sshNeighboursOf(box).length === 0) {
        expect(knownHosts).toBeUndefined();
        return;
      }
      boxesWithMemory += 1;
      const entries = (knownHosts ?? '').split('\n').filter((line) => line !== '');
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.length).toBeLessThanOrEqual(4);
      entries.forEach((entry) => {
        expect(knownHostFalsehood(box, entry), `${box.host.hostname}: ${entry}`).toBeNull();
      });
      expect(createFsView(tree, { userType: 'user' }).read(asAbsPath('/root/.ssh/known_hosts')).ok).toBe(
        false,
      );
    });
    expect(boxesWithMemory).toBeGreaterThan(0);
  });

  it('writes a non-standard port the way ssh does, and only for a neighbour that uses one', () => {
    const entries = lanBoxes(ALL_ESSIDS).flatMap(({ essid, host }) =>
      (rootFilesOf(buildRemoteHostFs(essid, host)).get('.ssh/known_hosts') ?? '')
        .split('\n')
        .filter((line) => line !== ''),
    );
    expect(entries.some((entry) => entry.startsWith('['))).toBe(true);
    expect(entries.some((entry) => !entry.startsWith('['))).toBe(true);
  });

  it('gives a desk the person sits at a config that logs them into real neighbours', () => {
    let desksWithConfig = 0;
    lanBoxes(ALL_ESSIDS)
      .filter(({ host }) => isDesk(host))
      .forEach((box) => {
        const tree = buildRemoteHostFs(box.essid, box.host);
        const username = npcUsername(box.essid, box.host);
        const home = `/home/${username}`;
        const user = createFsView(tree, { userType: 'user' });
        const config = user.read(asAbsPath(`${home}/.ssh/config`));
        const knownHosts = user.read(asAbsPath(`${home}/.ssh/known_hosts`));
        if (sshNeighboursOf(box).length === 0) {
          expect(user.stat(asAbsPath(`${home}/.ssh`))).toBeNull();
          return;
        }
        desksWithConfig += 1;
        if (!config.ok || !knownHosts.ok) throw new Error(`${box.host.hostname}: no ~/.ssh`);
        expect(user.stat(asAbsPath(`${home}/.ssh/config`))?.owner).toBe(username);
        knownHosts.content
          .split('\n')
          .filter((line) => line !== '')
          .forEach((entry) => {
            expect(knownHostFalsehood(box, entry), `${box.host.hostname}: ${entry}`).toBeNull();
          });
        const commands = sshCommandsIn(config.content);
        expect(commands.length).toBeGreaterThanOrEqual(1);
        expect(commands.length).toBeLessThanOrEqual(2);
        commands.forEach((line) => {
          expect(falsehoodIn({ line, box, tree, home }), `${box.host.hostname}: ${line}`).toBeNull();
        });
      });
    expect(desksWithConfig).toBeGreaterThan(0);
  });

  it('keeps no ~/.ssh on a box nobody sits at', () => {
    lanBoxes(ALL_ESSIDS)
      .filter(({ host }) => !isDesk(host))
      .forEach(({ essid, host }) => {
        const tree = buildRemoteHostFs(essid, host);
        const home = `/home/${npcUsername(essid, host)}/.ssh`;
        expect(createFsView(tree, { userType: 'root' }).stat(asAbsPath(home))).toBeNull();
      });
  });

  it('remembers nobody on a deep layer', () => {
    deepBoxes(crackableEssidPool).forEach(({ essid, host }) => {
      const tree = buildDeepHostFs(essid, host);
      const view = createFsView(tree, { userType: 'root' });
      expect(view.stat(asAbsPath('/root/.ssh'))).toBeNull();
      expect(view.stat(asAbsPath(`/home/${npcUsername(essid, host)}/.ssh`))).toBeNull();
    });
  });

  it('gives no two desks on one network the same ssh config', () => {
    ALL_ESSIDS.forEach((essid) => {
      const configs = lanBoxes([essid])
        .filter(({ host }) => isDesk(host))
        .map(({ host }) =>
          createFsView(buildRemoteHostFs(essid, host), { userType: 'root' }).read(
            asAbsPath(`/home/${npcUsername(essid, host)}/.ssh/config`),
          ),
        )
        .flatMap((result) => (result.ok ? [result.content] : []));
      expect(new Set(configs).size).toBe(configs.length);
    });
  });
});
