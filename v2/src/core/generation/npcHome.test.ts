import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { machineCommandOptions } from './npcHome';
import { buildDeepHostFs } from './deepHostFs';
import { crackableEssidPool } from './generateWifi';
import { generateHomeLan, type LanHost } from './generateHomeLan';
import { generateDeepLayer } from './generateDeepLayer';
import { chainLinks } from './lanTopology';
import { inhabitant, networkPersona } from './persona';
import { createFsView } from '../filesystem/fsView';
import { WORLD_EPOCH } from '../cve/worldClock';
import { asAbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import {
  ALL_ESSIDS,
  falsehoodIn,
  filesUnder,
  lanBoxes,
  serialise,
  type Box,
} from '../../test/worldContent';

/**
 * An NPC's personal computer is somebody's: its home holds what that person left
 * behind — a shell history, a git identity, notes — and what it names on the network
 * is really there. Read the way a player reads it: through the box's own tree.
 */

const DESK_PREFIXES = ['desktop', 'laptop', 'workstation'];
const prefixOf = (host: LanHost): string => host.hostname.slice(0, host.hostname.lastIndexOf('-'));
const isDesk = (host: LanHost): boolean => DESK_PREFIXES.includes(prefixOf(host));

const deskBoxes = (essids: readonly string[]): readonly Box[] =>
  lanBoxes(essids).filter(({ host }) => isDesk(host));

const homeOf = (tree: Directory, username: string): Directory => {
  const home = tree.entries.get('home');
  const own = home?.kind === 'directory' ? home.entries.get(username) : undefined;
  if (own?.kind !== 'directory') throw new Error(`no /home/${username}`);
  return own;
};

const homeFilesOf = (box: Box): ReadonlyMap<string, string> =>
  filesUnder(homeOf(buildRemoteHostFs(box.essid, box.host), npcUsername(box.essid, box.host)));

const notesOf = (files: ReadonlyMap<string, string>): readonly string[] =>
  [...files].filter(([path]) => path.startsWith('notes/')).map(([, content]) => content);

describe('an NPC desktop reads as somebody’s', () => {
  it('keeps a shell history that names a machine on its own network', () => {
    const [desktop] = deskBoxes(crackableEssidPool);
    if (desktop === undefined) throw new Error('no catalog network carries a desktop');

    const history = homeFilesOf(desktop).get('.bash_history') ?? '';

    const neighbours = generateHomeLan(desktop.essid).hosts.filter(
      (candidate) => candidate.ip !== desktop.host.ip,
    );
    expect(
      neighbours.some(
        (neighbour) => history.includes(neighbour.ip) || history.includes(neighbour.hostname),
      ),
    ).toBe(true);
  });

  it('holds the dotfiles and a few notes of the person it belongs to, theirs to read and write', () => {
    deskBoxes(crackableEssidPool).forEach((box) => {
      const username = npcUsername(box.essid, box.host);
      const home = homeOf(buildRemoteHostFs(box.essid, box.host), username);
      const files = filesUnder(home);

      ['.bashrc', '.profile', '.bash_logout', '.bash_history', '.gitconfig'].forEach((name) => {
        expect(files.has(name)).toBe(true);
      });
      const notes = notesOf(files);
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.length).toBeLessThanOrEqual(5);

      const view = createFsView(buildRemoteHostFs(box.essid, box.host), { userType: 'user' });
      [...files.keys()].forEach((path) => {
        expect(view.read(asAbsPath(`/home/${username}/${path}`)).ok).toBe(true);
        expect(view.canWrite(asAbsPath(`/home/${username}/${path}`)).allowed).toBe(true);
      });
      const owners = [...home.entries.values()].map((node) => node.owner);
      expect(new Set(owners)).toEqual(new Set([username]));
    });
  });

  it('leaves a tablet and every box that is not a personal computer or a phone with an empty home', () => {
    lanBoxes(crackableEssidPool)
      .filter(({ host }) => !isDesk(host) && !['android', 'iphone'].includes(prefixOf(host)))
      .forEach((box) => {
        expect(homeFilesOf(box).size).toBe(0);
      });
  });

  it('shows a guest none of it', () => {
    const [desktop] = deskBoxes(crackableEssidPool);
    if (desktop === undefined) throw new Error('no catalog network carries a desktop');
    const username = npcUsername(desktop.essid, desktop.host);
    const guest = createFsView(buildRemoteHostFs(desktop.essid, desktop.host), {
      userType: 'guest',
    });

    expect(guest.list(asAbsPath(`/home/${username}`))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
    expect(guest.read(asAbsPath(`/home/${username}/.bash_history`)).ok).toBe(false);
  });

  it('is one person: their git identity and every note they signed carry the same name', () => {
    deskBoxes(crackableEssidPool).forEach((box) => {
      const username = npcUsername(box.essid, box.host);
      const person = inhabitant({ essid: box.essid, host: box.host, username });
      const files = homeFilesOf(box);

      expect(files.get('.gitconfig')).toContain(`name = ${person.fullName}`);
      expect(files.get('.gitconfig')).toContain(`email = ${person.email}`);
      notesOf(files)
        .flatMap((note) => note.split('\n').filter((line) => line.startsWith('-- ')))
        .forEach((signature) => {
          expect(signature).toBe(`-- ${person.fullName.split(' ')[0] ?? ''}`);
        });
    });
  });

  it('reads as the place the network belongs to', () => {
    deskBoxes(ALL_ESSIDS).forEach((box) => {
      const { place } = networkPersona(box.essid);

      expect(notesOf(homeFilesOf(box)).some((note) => note.includes(place))).toBe(true);
    });
  });

  it('is built the same way every time it is read', () => {
    deskBoxes(crackableEssidPool.slice(0, 5)).forEach((box) => {
      expect(serialise(buildRemoteHostFs(box.essid, box.host))).toEqual(
        serialise(buildRemoteHostFs(box.essid, box.host)),
      );
    });
  });
});

describe('what a home names is really there', () => {
  it('names only neighbours that answer the way the history says they did', () => {
    const falsehoods = deskBoxes(ALL_ESSIDS).flatMap((box) => {
      const tree = buildRemoteHostFs(box.essid, box.host);
      const username = npcUsername(box.essid, box.host);
      const history = filesUnder(homeOf(tree, username)).get('.bash_history') ?? '';
      return history
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => ({ line, why: falsehoodIn({ line, box, tree, home: `/home/${username}` }) }))
        .filter(({ why }) => why !== null)
        .map(({ line, why }) => `${box.essid} ${box.host.hostname}: "${line}" ${why}`);
    });

    expect(falsehoods).toEqual([]);
  });

  it('names a gateway only by its address, since two routers can share a name', () => {
    deskBoxes(ALL_ESSIDS).forEach((box) => {
      const text = [...homeFilesOf(box).values()].join('\n');
      generateHomeLan(box.essid)
        .hosts.filter((host) => host.kind !== 'machine')
        .forEach((gateway) => {
          expect(text).not.toMatch(new RegExp(`\\b${gateway.hostname}\\b`));
        });
    });
  });

  it('names no machine the network does not have, anywhere in the home', () => {
    deskBoxes(ALL_ESSIDS).forEach((box) => {
      const lanHosts = generateHomeLan(box.essid).hosts;
      const text = [...homeFilesOf(box).values()].join('\n');
      (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).forEach((address) => {
        expect(lanHosts.map((host) => host.ip)).toContain(address);
      });
    });
  });

  it('offers a neighbour machine only commands it truly answers, one per way it answers', () => {
    // Read against every catalog network, so a box running ssh and one serving http are
    // both really present — the guards that add those commands are then held to account,
    // not covered by whichever line a random pick happened to take.
    let sshBoxesSeen = 0;
    let httpBoxesSeen = 0;
    crackableEssidPool.forEach((essid) => {
      const hosts = generateHomeLan(essid).hosts;
      const machines = hosts.filter((host) => host.kind === 'machine');
      const [reader] = machines;
      if (reader === undefined) return;
      const tree = buildRemoteHostFs(essid, reader);
      const username = npcUsername(essid, reader);

      machines
        .filter((neighbour) => neighbour.ip !== reader.ip)
        .forEach((neighbour) => {
          const options = machineCommandOptions(essid, neighbour);
          options.forEach((line) => {
            const box = { essid, host: reader };
            expect(falsehoodIn({ line, box, tree, home: `/home/${username}` })).toBeNull();
          });
          const services = hostServices(essid, neighbour);
          if (services.some(({ spec }) => spec.service === 'ssh')) {
            sshBoxesSeen += 1;
            expect(options.some((line) => line.startsWith('ssh '))).toBe(true);
          } else {
            expect(options.some((line) => line.startsWith('ssh '))).toBe(false);
          }
          if (services.some(({ spec }) => spec.service === 'http')) {
            httpBoxesSeen += 1;
            expect(options.some((line) => line.startsWith('curl '))).toBe(true);
          } else {
            expect(options.some((line) => line.startsWith('curl '))).toBe(false);
          }
        });
    });
    expect(sshBoxesSeen).toBeGreaterThan(0);
    expect(httpBoxesSeen).toBeGreaterThan(0);
  });

  it('writes a shell history of real commands, never a blank or a dropped line', () => {
    deskBoxes(ALL_ESSIDS).forEach((box) => {
      const history = homeFilesOf(box).get('.bash_history') ?? '';
      const lines = history.split('\n').slice(0, -1);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => {
        expect(line).not.toBe('');
        expect(line).not.toContain('undefined');
      });
    });
  });
});

describe('a desktop on a deep layer', () => {
  const deepDesks = crackableEssidPool.flatMap((essid) =>
    chainLinks(essid)
      .map((link) => ({
        essid,
        gateway: { machineId: link.machineId, kind: link.host.kind },
      }))
      .filter(({ essid: network, gateway }) => isDesk(generateDeepLayer(network, gateway).host)),
  );

  it('has a home too, and names nothing, because it cannot know what its layer holds', () => {
    expect(deepDesks.length).toBeGreaterThan(0);
    deepDesks.forEach(({ essid, gateway }) => {
      const host = generateDeepLayer(essid, gateway).host;
      const files = filesUnder(homeOf(buildDeepHostFs(essid, host), npcUsername(essid, host)));

      expect(files.has('.bash_history')).toBe(true);
      const history = files.get('.bash_history') ?? '';
      expect(history).not.toMatch(/^(ssh|curl|ping|nslookup) /m);
    });
  });

  it('is the same box whether or not its layer hangs another gateway', () => {
    deepDesks.forEach(({ essid, gateway }) => {
      const terminal = generateDeepLayer(essid, gateway, { hangsChild: false }).host;
      const fronting = generateDeepLayer(essid, gateway, { hangsChild: true }).host;

      expect(serialise(buildDeepHostFs(essid, fronting))).toEqual(
        serialise(buildDeepHostFs(essid, terminal)),
      );
    });
  });
});

describe('a home keeps to the world’s rules', () => {
  const allHomeFiles = () => deskBoxes(ALL_ESSIDS).map(homeFilesOf);

  it('dates everything to a real day in the past, within a box’s lifetime', () => {
    const epoch = new Date(WORLD_EPOCH).toISOString().slice(0, 10);
    // Two years is how far back a home's dates may reach; a date at the epoch itself, or
    // before this floor, would mean the clock behind them had come loose.
    const floor = new Date(WORLD_EPOCH - 731 * 86_400_000).toISOString().slice(0, 10);
    const dates = allHomeFiles().flatMap((files) =>
      [...files.values()].flatMap((content) => content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    );
    expect(dates.length).toBeGreaterThan(0);
    dates.forEach((date) => {
      expect(date < epoch).toBe(true);
      expect(date >= floor).toBe(true);
    });
  });

  it('carries no software version, which would date it', () => {
    allHomeFiles().forEach((files) => {
      [...files.values()].forEach((content) => {
        const versions = (content.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) ?? []).filter(
          (match) => !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match),
        );
        const outsideAddresses = versions.filter(
          (version) => !(content.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).some((address) =>
            address.includes(version),
          ),
        );
        expect(outsideAddresses).toEqual([]);
      });
    });
  });

  it('writes no password down', () => {
    allHomeFiles().forEach((files) => {
      [...files.values()].forEach((content) => {
        expect(content).not.toMatch(/pass(word|wd)?\s*[:=]/i);
        expect(content).not.toMatch(/sshpass|mysql -p\S/);
      });
    });
  });
});

describe('no two homes are the same', () => {
  it('gives no two personal computers on one network the same history, identity or note', () => {
    ALL_ESSIDS.forEach((essid) => {
      const homes = deskBoxes([essid]).map(homeFilesOf);
      ['.bash_history', '.gitconfig'].forEach((name) => {
        const bodies = homes.map((files) => files.get(name));
        expect(new Set(bodies).size).toBe(bodies.length);
      });
      const notes = homes.flatMap(notesOf);
      expect(new Set(notes).size).toBe(notes.length);
    });
  });

  it('keeps histories and notes distinct across every catalog network', () => {
    const homes = deskBoxes(crackableEssidPool).map(homeFilesOf);
    const histories = homes.map((files) => files.get('.bash_history'));
    const notes = homes.flatMap(notesOf);

    expect(new Set(histories).size / histories.length).toBeGreaterThanOrEqual(0.98);
    expect(new Set(notes).size / notes.length).toBeGreaterThanOrEqual(0.9);
  });
});
