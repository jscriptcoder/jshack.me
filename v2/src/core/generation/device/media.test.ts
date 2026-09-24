import { describe, expect, it } from 'vitest';
import { MEDIA_APPS, MEDIA_MODELS } from '../pools/devices';
import { generateHomeLan } from '../generateHomeLan';
import { peopleOn } from '../networkMail';
import { npcUsername } from '../remoteHostFs';
import { phoneModel } from '../share';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { softwareVersionsIn } from '../../../test/worldContent';
import {
  contentOf,
  prefixOf,
  read,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

const MEDIA_PREFIXES = ['tv', 'speaker'];

const CONF = '/etc/mediad/mediad.conf';
const PAIRED = '/var/lib/mediad/paired.conf';
const RECENT = '/var/lib/mediad/recent.log';
const APPS = '/var/lib/mediad/apps.list';

/** Every media box: the world's, LAN and deep, and synthetic ones of each flavour on
 *  both layers. */
const mediaBoxes = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(MEDIA_PREFIXES),
  ...syntheticLanBoxes(MEDIA_PREFIXES),
  ...MEDIA_PREFIXES.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 15)),
];

const setting = (tree: BuiltBox['tree'], key: string): string | undefined =>
  new RegExp(`^${key} = (.+)$`, 'm').exec(contentOf(tree, CONF))?.[1];

const SECOND_STAMP = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/;

const timeOf = (text: string): number => {
  const match = SECOND_STAMP.exec(text);
  if (match === null) throw new Error(`not a time: ${text}`);
  const [, year, month, day, hours, minutes, seconds] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
};

/** One paired device, as its `[hostname]` section in `paired.conf` gives it. */
type Pairing = { readonly hostname: string; readonly name: string; readonly address: string; readonly at: number };

const pairingsOf = (tree: BuiltBox['tree']): readonly Pairing[] =>
  contentOf(tree, PAIRED)
    .split(/\n(?=\[)/)
    .filter((section) => section.startsWith('['))
    .map((section) => {
      const value = (key: string) => new RegExp(`^${key} = (.+)$`, 'm').exec(section)?.[1] ?? '';
      return {
        hostname: /^\[([^\]]+)\]/.exec(section)?.[1] ?? '',
        name: value('name'),
        address: value('address'),
        at: timeOf(value('paired')),
      };
    });

/** One thing played: when, on which app, what, and from where. */
type Played = { readonly at: number; readonly app: string; readonly title: string; readonly source: string };

const PLAYED_LINE = /^(\S+ \S+) app=(.+?) title="([^"]+)" from=(\S+)$/;

const playedOn = (tree: BuiltBox['tree']): readonly Played[] =>
  contentOf(tree, RECENT)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = PLAYED_LINE.exec(line);
      if (match === null) throw new Error(`not a played line: ${line}`);
      const [, when = '', app = '', title = '', source = ''] = match;
      return { at: timeOf(when), app, title, source };
    });

const appsOn = (tree: BuiltBox['tree']): readonly string[] =>
  contentOf(tree, APPS)
    .split('\n')
    .filter((line) => line !== '');

const flavourOf = (box: BuiltBox): 'tv' | 'speaker' =>
  prefixOf(box.host.hostname) === 'speaker' ? 'speaker' : 'tv';

describe('a media device', () => {
  it('is found on home LANs and below them, in both flavours', () => {
    expect(new Set(worldBoxesNamed(MEDIA_PREFIXES).map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
    expect(new Set(mediaBoxes().map(({ host }) => prefixOf(host.hostname)))).toEqual(new Set(MEDIA_PREFIXES));
  });

  it("keeps its daemon's config in place of device.conf, for anyone on the box to read", () => {
    mediaBoxes().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      expect(read(tree, CONF, 'guest').ok).toBe(true);
      expect(setting(tree, 'pairing')).toBe(PAIRED);
      expect(setting(tree, 'history')).toBe(RECENT);
      expect(setting(tree, 'apps')).toBe(APPS);
    });
  });

  it('listens for a cast on the loopback only, so no file claims a port a scan cannot see', () => {
    mediaBoxes().forEach(({ tree }) => {
      expect(setting(tree, 'listen')).toMatch(/^127\.0\.0\.1:\d+$/);
    });
  });

  it('is a model of its own flavour', () => {
    mediaBoxes().forEach((box) => {
      expect(MEDIA_MODELS[flavourOf(box)]).toContain(setting(box.tree, 'model'));
    });
  });

  it("pairs only its own network's phones, each named for its owner and the model it is", () => {
    let paired = 0;
    mediaBoxes()
      .filter(({ layer }) => layer === 'lan')
      .forEach(({ essid, tree }) => {
        const hosts = generateHomeLan(essid).hosts;
        const people = peopleOn(essid);
        pairingsOf(tree).forEach((pairing) => {
          paired += 1;
          const phone = hosts.find((host) => host.hostname === pairing.hostname);
          expect(phone?.ip).toBe(pairing.address);
          const model = phone === undefined ? undefined : phoneModel(essid, phone);
          expect({ phone: pairing.hostname, isPhone: model !== undefined }).toEqual({
            phone: pairing.hostname,
            isPhone: true,
          });
          const owner = people.find((person) => phone !== undefined && person.username === npcUsername(essid, phone));
          const first = owner?.fullName.split(' ')[0];
          expect(pairing.name).toBe(`${first}'s ${model?.model}`);
        });
      });
    // Few home LANs hold both a phone and a media box, so a dozen pairings is what the
    // world and the synthetic LANs have between them.
    expect(paired).toBeGreaterThan(10);
  });

  it('pairs something wherever its network has a phone', () => {
    mediaBoxes()
      .filter(({ layer }) => layer === 'lan')
      .forEach(({ essid, host, tree }) => {
        const phones = generateHomeLan(essid).hosts.filter((neighbour) => phoneModel(essid, neighbour) !== undefined);
        expect({ host: host.hostname, paired: pairingsOf(tree).length > 0 }).toEqual({
          host: host.hostname,
          paired: phones.length > 0,
        });
      });
  });

  it('pairs nothing below the LAN, where it can see no phone', () => {
    mediaBoxes()
      .filter(({ layer }) => layer === 'deep')
      .forEach(({ tree }) => expect(pairingsOf(tree)).toEqual([]));
  });

  it('was paired with each phone before the world began', () => {
    mediaBoxes().forEach(({ tree }) => {
      pairingsOf(tree).forEach(({ at }) => expect(at).toBeLessThan(WORLD_EPOCH));
    });
  });

  it('remembers what it played in order, before the world began, each on an app it has installed', () => {
    mediaBoxes().forEach(({ host, tree }) => {
      const played = playedOn(tree);
      const installed = appsOn(tree);
      expect({ host: host.hostname, some: played.length > 0 }).toEqual({ host: host.hostname, some: true });
      const times = played.map(({ at }) => at);
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      played.forEach(({ at, app }) => {
        expect(at).toBeLessThan(WORLD_EPOCH);
        expect({ host: host.hostname, app, installed: installed.includes(app) }).toEqual({
          host: host.hostname,
          app,
          installed: true,
        });
      });
    });
  });

  it('was cast to only from a phone it is paired with, and otherwise played from its own remote or by voice', () => {
    let cast = 0;
    mediaBoxes().forEach((box) => {
      const paired = new Set(pairingsOf(box.tree).map(({ hostname }) => hostname));
      const own = flavourOf(box) === 'tv' ? 'remote' : 'voice';
      playedOn(box.tree).forEach(({ source }) => {
        if (source === own) return;
        cast += 1;
        expect({ host: box.host.hostname, source, paired: paired.has(source) }).toEqual({
          host: box.host.hostname,
          source,
          paired: true,
        });
      });
    });
    expect(cast).toBeGreaterThan(20);
  });

  it('installs only apps made for its flavour, each once', () => {
    mediaBoxes().forEach((box) => {
      const installed = appsOn(box.tree);
      expect(installed.length).toBeGreaterThan(1);
      expect(new Set(installed).size).toBe(installed.length);
      installed.forEach((app) => expect(MEDIA_APPS[flavourOf(box)]).toContain(app));
    });
  });

  it('names no software version anywhere it keeps', () => {
    mediaBoxes().forEach(({ tree }) => {
      [CONF, PAIRED, RECENT, APPS].forEach((path) => expect(softwareVersionsIn(contentOf(tree, path))).toEqual([]));
    });
  });

  it("keeps what it paired, played and installed the box's own account's to read, and a guest's not", () => {
    mediaBoxes().forEach(({ tree }) => {
      [PAIRED, RECENT, APPS].forEach((path) => {
        expect(read(tree, path, 'user').ok).toBe(true);
        expect(read(tree, path, 'guest').ok).toBe(false);
      });
    });
  });

  it('differs from box to box, every model and app drawn somewhere', () => {
    const boxes = mediaBoxes();
    (['tv', 'speaker'] as const).forEach((flavour) => {
      const ofFlavour = boxes.filter((box) => flavourOf(box) === flavour);
      expect(new Set(ofFlavour.map(({ tree }) => setting(tree, 'model')))).toEqual(new Set(MEDIA_MODELS[flavour]));
      expect(new Set(ofFlavour.flatMap(({ tree }) => appsOn(tree)))).toEqual(new Set(MEDIA_APPS[flavour]));
    });
  });
});
