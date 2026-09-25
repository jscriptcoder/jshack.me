import { describe, expect, it } from 'vitest';
import { CAMERA_MODELS, CAMERA_RESOLUTIONS } from '../pools/devices';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { createFsView } from '../../filesystem/fsView';
import { asAbsPath } from '../../types';
import type { Directory } from '../../filesystem/types';
import { softwareVersionsIn } from '../../../test/worldContent';
import {
  cameraNameOf,
  cameras,
  CAMERA_PREFIXES,
  contentOf,
  eventsOf,
  pagesOf,
  prefixOf,
  read,
  readableLinesOf,
  servesHttp,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

const snapshotNamesOf = (tree: Directory): readonly string[] => {
  const listing = createFsView(tree, { userType: 'root' }).list(asAbsPath('/var/lib/motion/snapshots'));
  if (!listing.ok) throw new Error(`/var/lib/motion/snapshots: ${listing.error}`);
  return listing.entries;
};

/** A photo's Exif date, as `strings` shows it. */
const exifDate = (at: number): string => {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10).replaceAll('-', ':')} ${iso.slice(11, 19)}`;
};

describe('a camera', () => {
  it('is found on home LANs and below them, in every flavour', () => {
    const boxes = worldBoxesNamed(CAMERA_PREFIXES);
    expect(new Set(boxes.map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
    const flavours = new Set(cameras().map(({ host }) => prefixOf(host.hostname)));
    expect(flavours).toEqual(new Set(CAMERA_PREFIXES));
  });

  it('keeps a motion config naming where its events and snapshots go, in place of device.conf', () => {
    cameras().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      const conf = contentOf(tree, '/etc/motion/motion.conf');
      expect(conf).toMatch(/^target_dir \/var\/lib\/motion$/m);
      expect(conf).toMatch(/^picture_filename snapshots\/%Y%m%d-%H%M%S$/m);
      expect(softwareVersionsIn(conf)).toEqual([]);
    });
  });

  it('serves its stream and its controls on the loopback only, so no file claims a port a scan cannot see', () => {
    cameras().forEach(({ tree }) => {
      const conf = contentOf(tree, '/etc/motion/motion.conf');
      expect(conf).toMatch(/^stream_localhost on$/m);
      expect(conf).toMatch(/^webcontrol_localhost on$/m);
    });
  });

  it('indexes every event against a snapshot it holds, and holds no snapshot no event names', () => {
    cameras().forEach(({ host, tree }) => {
      const events = eventsOf(tree);
      const held = snapshotNamesOf(tree).map((name) => `snapshots/${name}`);
      expect({ host: host.hostname, some: events.length > 0 }).toEqual({ host: host.hostname, some: true });
      expect([...events.map((event) => event.snapshot)].sort()).toEqual([...held].sort());
    });
  });

  it('logs its events in order, each before the world began', () => {
    cameras().forEach(({ tree }) => {
      const times = eventsOf(tree).map((event) => event.at);
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      times.forEach((at) => expect(at).toBeLessThan(WORLD_EPOCH));
    });
  });

  it("stamps each snapshot, through strings, with the camera's own make and model and the event's time", async () => {
    for (const { tree } of cameras()) {
      const name = cameraNameOf(tree);
      for (const event of eventsOf(tree)) {
        const lines = await readableLinesOf(contentOf(tree, `/var/lib/motion/${event.snapshot}`));
        const model = CAMERA_MODELS.find((camera) => `${camera.make} ${camera.model}` === name);
        expect({ name, known: model !== undefined }).toEqual({ name, known: true });
        expect(lines).toContain(model?.make);
        expect(lines).toContain(model?.model);
        expect(lines).toContain(exifDate(event.at));
      }
    }
  });

  it('records rings on a doorbell, sound on a baby monitor, and motion alone on any other camera', () => {
    cameras().forEach(({ host, tree }) => {
      const kinds = new Set(eventsOf(tree).map((event) => event.kind));
      const flavour = prefixOf(host.hostname);
      const allowed =
        flavour === 'doorbell' ? ['motion', 'ring'] : flavour === 'babycam' ? ['motion', 'sound'] : ['motion'];
      kinds.forEach((kind) => expect({ host: host.hostname, kind, allowed: allowed.includes(kind) }).toEqual({
        host: host.hostname,
        kind,
        allowed: true,
      }));
      if (flavour === 'doorbell') expect(kinds).toContain('ring');
      if (flavour === 'babycam') expect(kinds).toContain('sound');
    });
  });

  it('sees plain motion on a doorbell and a baby monitor too, not only its own kind of event', () => {
    ['doorbell', 'babycam'].forEach((flavour) => {
      const kinds = new Set(
        cameras()
          .filter(({ host }) => prefixOf(host.hostname) === flavour)
          .flatMap(({ tree }) => eventsOf(tree).map((event) => event.kind)),
      );
      expect({ flavour, motion: kinds.has('motion') }).toEqual({ flavour, motion: true });
    });
  });

  it('holds the last two weeks of events, over more than a day', () => {
    const boxes = cameras();
    boxes.forEach(({ tree }) => {
      eventsOf(tree).forEach((event) =>
        expect(event.at).toBeGreaterThanOrEqual(WORLD_EPOCH - 14 * 86_400_000),
      );
    });
    const spans = boxes.map(({ tree }) => {
      const times = eventsOf(tree).map((event) => event.at);
      return Math.max(...times) - Math.min(...times);
    });
    expect(spans.filter((span) => span > 86_400_000).length).toBeGreaterThan(spans.length / 2);
  });

  it("keeps its events for the box's own user to read, and not a guest", () => {
    cameras().forEach(({ tree }) => {
      const first = snapshotNamesOf(tree)[0] ?? '';
      expect(read(tree, '/var/lib/motion/events.log', 'user').ok).toBe(true);
      expect(read(tree, `/var/lib/motion/snapshots/${first}`, 'user').ok).toBe(true);
      expect(read(tree, '/var/lib/motion/events.log', 'guest').ok).toBe(false);
      expect(createFsView(tree, { userType: 'guest' }).list(asAbsPath('/var/lib/motion')).ok).toBe(false);
    });
  });

  it('is a model of the flavour its name says, drawing every model in the pool somewhere', () => {
    const named = cameras().map(({ host, tree }) => ({ host, name: cameraNameOf(tree) }));
    const drawn = new Set(named.map(({ name }) => name));
    CAMERA_MODELS.forEach(({ make, model, flavour }) => {
      const name = `${make} ${model}`;
      expect({ name, drawn: drawn.has(name) }).toEqual({ name, drawn: true });
      named
        .filter((camera) => camera.name === name)
        .forEach(({ host }) => expect(prefixOf(host.hostname)).toBe(flavour));
    });
  });

  it('states a real frame size, and shows the same one on its Live page', () => {
    cameras().forEach(({ essid, host, tree }) => {
      const conf = contentOf(tree, '/etc/motion/motion.conf');
      const width = Number(/^width (\d+)$/m.exec(conf)?.[1]);
      const height = Number(/^height (\d+)$/m.exec(conf)?.[1]);
      expect(width).toBeGreaterThanOrEqual(1280);
      expect(height).toBeGreaterThanOrEqual(720);
      if (servesHttp({ essid, host })) {
        expect(pagesOf(tree).get('index.html')).toContain(`${width}x${height}`);
      }
    });
  });

  it('streams at every frame size in the pool somewhere', () => {
    const sizes = new Set(
      cameras().map(({ tree }) => {
        const conf = contentOf(tree, '/etc/motion/motion.conf');
        return `${/^width (\d+)$/m.exec(conf)?.[1]}x${/^height (\d+)$/m.exec(conf)?.[1]}`;
      }),
    );
    expect(sizes).toEqual(new Set(CAMERA_RESOLUTIONS.map(([width, height]) => `${width}x${height}`)));
  });
});

describe("a camera's own pages", () => {
  const serving = (): readonly BuiltBox[] => cameras().filter(servesHttp);

  it("list a camera's events newest first", () => {
    serving()
      .forEach(({ tree }) => {
        const shown = (pagesOf(tree).get('events.html') ?? '')
          .split('\n')
          .filter((line) => line.startsWith('<tr><td>'))
          .map((line) => line.slice('<tr><td>'.length, '<tr><td>'.length + 19));
        const held = [...eventsOf(tree)]
          .reverse()
          .map((event) => new Date(event.at).toISOString().slice(0, 19).replace('T', ' '));
        expect(shown).toEqual(held);
      });
  });

  it("name on a camera's Live page the camera it is", () => {
    serving()
      .forEach(({ tree }) => {
        expect(pagesOf(tree).get('index.html')).toContain(cameraNameOf(tree));
      });
  });

  it("list a camera's events as its index holds them", () => {
    const cameraBoxes = serving();
    expect(cameraBoxes.length).toBeGreaterThan(0);
    cameraBoxes.forEach(({ tree }) => {
      const page = pagesOf(tree).get('events.html') ?? '';
      eventsOf(tree).forEach((event) => {
        const when = new Date(event.at).toISOString().slice(0, 19).replace('T', ' ');
        expect(page).toContain(`<td>${when}</td><td>${event.kind}</td>`);
      });
    });
  });
});
