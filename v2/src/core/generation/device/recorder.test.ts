import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs } from '../remoteHostFs';
import { deviceKindOf } from '../device';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { lanZoneName, resolveLanName } from '../../network/resolveName';
import { createFsView } from '../../filesystem/fsView';
import { asAbsPath } from '../../types';
import { lanBoxes, softwareVersionsIn } from '../../../test/worldContent';
import {
  archiveOf,
  archivedSources,
  contentOf,
  eventsOf,
  pagesOf,
  read,
  recorders,
  servesHttp,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

describe('a recorder', () => {
  it('is found on home LANs and below them', () => {
    expect(new Set(worldBoxesNamed(['nvr']).map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
  });

  it('keeps a recorder config in place of device.conf', () => {
    recorders().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      expect(softwareVersionsIn(contentOf(tree, '/etc/nvr/nvr.conf'))).toEqual([]);
    });
  });

  it("archives exactly its network's cameras on the LAN, each under its .lan name", () => {
    const lan = recorders().filter(({ layer }) => layer === 'lan');
    expect(lan.some(({ tree }) => archivedSources(tree).size > 1)).toBe(true);
    lan.forEach(({ essid, host, tree }) => {
      const zone = lanZoneName(essid);
      const networkCameras = lanBoxes([essid])
        .filter((box) => deviceKindOf(box.host.hostname) === 'camera')
        .map((box) => `${box.host.hostname}.${zone}`);
      expect({ host: host.hostname, sources: archivedSources(tree) }).toEqual({
        host: host.hostname,
        sources: new Set(networkCameras),
      });
    });
  });

  it("holds each LAN camera's snapshots byte for byte, every one of them, under the day it was taken", () => {
    recorders()
      .filter(({ layer }) => layer === 'lan')
      .forEach(({ essid, tree }) => {
        const archive = archiveOf(tree);
        lanBoxes([essid])
          .filter((box) => deviceKindOf(box.host.hostname) === 'camera')
          .forEach((camera) => {
            const cameraTree = buildRemoteHostFs(essid, camera.host);
            const fqdn = `${camera.host.hostname}.${lanZoneName(essid)}`;
            const own = eventsOf(cameraTree).map((event) => ({
              path: `${fqdn}/${new Date(event.at).toISOString().slice(0, 10)}/${event.snapshot.slice('snapshots/'.length)}`,
              content: contentOf(cameraTree, `/var/lib/motion/${event.snapshot}`),
            }));
            const archived = [...archive].filter(([path]) => path.startsWith(`${fqdn}/`));
            expect(archived.map(([path]) => path).sort()).toEqual(own.map(({ path }) => path).sort());
            own.forEach(({ path, content }) => expect(archive.get(path) === content).toBe(true));
          });
      });
  });

  it('lists in its config every camera it archives, at the address the network gives it', () => {
    recorders()
      .filter(({ layer }) => layer === 'lan')
      .forEach(({ essid, tree }) => {
        const conf = contentOf(tree, '/etc/nvr/nvr.conf');
        archivedSources(tree).forEach((fqdn) => {
          const resolved = resolveLanName(essid, fqdn);
          expect(conf).toContain(`[${fqdn}]`);
          expect(conf).toContain(`address = ${resolved?.ip}`);
        });
      });
  });

  it('records, below the LAN, the PoE channels on its own ports and names no LAN host', () => {
    recorders()
      .filter(({ layer }) => layer === 'deep')
      .forEach(({ host, tree }) => {
        const sources = [...archivedSources(tree)];
        expect(sources.length).toBeGreaterThan(0);
        sources.forEach((source) => expect(source).toMatch(/^ch\d\d$/));
        const conf = contentOf(tree, '/etc/nvr/nvr.conf');
        sources.forEach((source) => expect(conf).toContain(`[${source}]`));
        expect({ host: host.hostname, lanNames: /\.lan\b|192\.168\./.test(conf) }).toEqual({
          host: host.hostname,
          lanNames: false,
        });
      });
  });

  it('indexes every archived snapshot, in the order taken, each before the world began', () => {
    recorders().forEach(({ tree }) => {
      const lines = contentOf(tree, '/var/lib/nvr/index.log')
        .split('\n')
        .filter((line) => line !== '');
      const indexed = lines.map((line) => line.slice(line.lastIndexOf(' ') + 1));
      expect([...indexed].sort()).toEqual([...archiveOf(tree).keys()].sort());
      const times = lines.map((line) => Date.parse(`${line.slice(0, 19).replace(' ', 'T')}Z`));
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      times.forEach((at) => expect(at).toBeLessThan(WORLD_EPOCH));
    });
  });

  it('keeps nothing older than the retention its config states', () => {
    recorders().forEach(({ tree }) => {
      const days = Number(/^retention_days = (\d+)$/m.exec(contentOf(tree, '/etc/nvr/nvr.conf'))?.[1]);
      // The same two weeks a camera keeps of its own events.
      expect(days).toBe(14);
      contentOf(tree, '/var/lib/nvr/index.log')
        .split('\n')
        .filter((line) => line !== '')
        .forEach((line) => {
          const at = Date.parse(`${line.slice(0, 19).replace(' ', 'T')}Z`);
          expect(at).toBeGreaterThanOrEqual(WORLD_EPOCH - days * 86_400_000);
        });
    });
  });

  it('numbers each PoE port after the channel on it', () => {
    recorders()
      .filter(({ layer }) => layer === 'deep')
      .forEach(({ tree }) => {
        const conf = contentOf(tree, '/etc/nvr/nvr.conf');
        [...archivedSources(tree)].forEach((channel) => {
          expect(conf).toContain(`[${channel}]\nport = PoE${Number(channel.slice(2))}\n`);
        });
      });
  });

  it("keeps its archive for the box's own user to read, and not a guest", () => {
    recorders().forEach(({ tree }) => {
      expect(read(tree, '/var/lib/nvr/index.log', 'user').ok).toBe(true);
      expect(read(tree, '/var/lib/nvr/index.log', 'guest').ok).toBe(false);
      expect(createFsView(tree, { userType: 'guest' }).list(asAbsPath('/var/lib/nvr')).ok).toBe(false);
    });
  });
});

describe("a recorder's own pages", () => {
  const serving = (): readonly BuiltBox[] => recorders().filter(servesHttp);

  it("count on a recorder's Recordings page the snapshots it holds of each camera each day", () => {
    serving()
      .forEach(({ tree }) => {
        const held = new Map<string, number>();
        [...archiveOf(tree).keys()].forEach((path) => {
          const [source, day] = path.split('/');
          const key = `${source}|${day}`;
          held.set(key, (held.get(key) ?? 0) + 1);
        });
        const shown = new Map(
          (pagesOf(tree).get('recordings.html') ?? '')
            .split('\n')
            .map((line) => /^<tr><td>([^<]+)<\/td><td>(\d{4}-\d\d-\d\d)<\/td><td>(\d+)<\/td><\/tr>$/.exec(line))
            .flatMap((match) =>
              match === null ? [] : [[`${match[1]}|${match[2]}`, Number(match[3])] as const],
            ),
        );
        expect(shown).toEqual(held);
      });
  });

  it("name on a recorder's Cameras page every camera it records", () => {
    const recorderBoxes = serving();
    expect(recorderBoxes.length).toBeGreaterThan(0);
    recorderBoxes.forEach(({ tree }) => {
      const page = pagesOf(tree).get('index.html') ?? '';
      archivedSources(tree).forEach((source) => expect(page).toContain(source));
    });
  });
});
