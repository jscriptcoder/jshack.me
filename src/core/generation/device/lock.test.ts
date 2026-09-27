import { describe, expect, it } from 'vitest';
import { LOCK_MODELS, LOCK_ROLE_SLOTS } from '../pools/devices';
import { generateHomeLan } from '../generateHomeLan';
import { peopleKnownOn } from '../mailbox';
import { npcUsername } from '../remoteHostFs';
import { phoneModel } from '../share';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { softwareVersionsIn } from '../../../test/worldContent';
import {
  contentOf,
  pagesOf,
  read,
  servesHttp,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

const CONF = '/etc/lockd/lockd.conf';
const SLOTS = '/var/lib/lockd/slots.conf';
const LIVE = '/var/log/lockd/access.log';
/** Rotated on the last morning, so what the lock remembers is here, the live log empty. */
const ACCESS = '/var/log/lockd/access.log.1';

/** Every lock: the world's, LAN and deep, and synthetic ones on both layers. */
const locks = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(['lock']),
  ...syntheticLanBoxes(['lock']),
  ...syntheticBoxes('lock').slice(0, 40),
];

const setting = (tree: BuiltBox['tree'], key: string): string | undefined =>
  new RegExp(`^${key} = (.+)$`, 'm').exec(contentOf(tree, CONF))?.[1];

const slotsOf = (tree: BuiltBox['tree']): readonly string[] =>
  contentOf(tree, SLOTS)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'));

/** One unlock: when, who (where the lock knows them), and how. */
type Entry = {
  readonly at: number;
  readonly person: string | null;
  readonly phone: { readonly hostname: string; readonly address: string } | null;
  readonly slot: string | null;
};

const ENTRY_LINE =
  /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) unlocked (?:by "([^"]+)" )?via (?:phone (\S+) \((\S+)\)|keypad slot "([^"]+)")$/;

const entriesOf = (tree: BuiltBox['tree']): readonly Entry[] =>
  contentOf(tree, ACCESS)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = ENTRY_LINE.exec(line);
      if (match === null) throw new Error(`not an access line: ${line}`);
      const [, year, month, day, hours, minutes, seconds, person, hostname, address, slot] = match;
      return {
        at: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
        person: person ?? null,
        phone: hostname === undefined || address === undefined ? null : { hostname, address },
        slot: slot ?? null,
      };
    });

/** The full name of each person the box knows, and the phone each owns on its LAN. */
const castOf = ({ essid, host, layer }: BuiltBox) => {
  const people = peopleKnownOn({ essid, host, username: npcUsername(essid, host) });
  const phones =
    layer === 'lan'
      ? generateHomeLan(essid).hosts.filter((neighbour) => phoneModel(essid, neighbour) !== undefined)
      : [];
  return new Map(
    people.map((person) => [
      person.fullName,
      phones.filter((phone) => npcUsername(essid, phone) === person.username),
    ]),
  );
};

describe('a smart lock', () => {
  it('is found on home LANs and below them', () => {
    expect(new Set(worldBoxesNamed(['lock']).map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
  });

  it("keeps its daemon's config in place of device.conf, for anyone on the box to read, naming nobody", () => {
    locks().forEach((box) => {
      const { host, tree } = box;
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      expect(read(tree, CONF, 'guest').ok).toBe(true);
      expect(setting(tree, 'slots')).toBe(SLOTS);
      expect(setting(tree, 'log')).toBe(LIVE);
      expect(setting(tree, 'host')).toBe('127.0.0.1');
      expect(LOCK_MODELS).toContain(setting(tree, 'model'));
      const conf = contentOf(tree, CONF);
      expect(softwareVersionsIn(conf)).toEqual([]);
      [...castOf(box).keys()].forEach((person) => expect(conf).not.toContain(person));
    });
  });

  it('names its keypad slots and never numbers them, and keeps no code', () => {
    locks().forEach(({ host, tree }) => {
      const slots = slotsOf(tree);
      expect(slots.length).toBeGreaterThan(0);
      expect(new Set(slots).size).toBe(slots.length);
      expect({ host: host.hostname, digits: /\d/.test(contentOf(tree, SLOTS)) }).toEqual({
        host: host.hostname,
        digits: false,
      });
    });
  });

  it("keeps its slots the box's own account's to read, and its access log root's alone", () => {
    locks().forEach(({ tree }) => {
      expect(contentOf(tree, LIVE)).toBe('');
      expect(read(tree, LIVE, 'user').ok).toBe(false);
      expect(read(tree, SLOTS, 'user').ok).toBe(true);
      expect(read(tree, SLOTS, 'guest').ok).toBe(false);
      expect(read(tree, ACCESS, 'root').ok).toBe(true);
      expect(read(tree, ACCESS, 'user').ok).toBe(false);
      expect(read(tree, ACCESS, 'guest').ok).toBe(false);
    });
  });

  it('logs its unlocks in order, before the world began', () => {
    locks().forEach(({ host, tree }) => {
      const times = entriesOf(tree).map(({ at }) => at);
      expect({ host: host.hostname, some: times.length > 0 }).toEqual({ host: host.hostname, some: true });
      expect(times).toEqual([...times].sort((earlier, later) => earlier - later));
      times.forEach((at) => expect(at).toBeLessThan(WORLD_EPOCH));
    });
  });

  it('lets in by name only people the box knows, each by their own phone where they have one and by their slot otherwise', () => {
    let byPhone = 0;
    let byKeypad = 0;
    locks().forEach((box) => {
      const cast = castOf(box);
      const slots = slotsOf(box.tree);
      entriesOf(box.tree)
        .filter((entry) => entry.person !== null)
        .forEach((entry) => {
          const phones = cast.get(entry.person ?? '');
          expect({ person: entry.person, known: phones !== undefined }).toEqual({ person: entry.person, known: true });
          if ((phones ?? []).length > 0) {
            byPhone += 1;
            expect({ person: entry.person, byPhone: entry.phone !== null }).toEqual({
              person: entry.person,
              byPhone: true,
            });
            const phone = phones?.find((candidate) => candidate.hostname === entry.phone?.hostname);
            expect({ person: entry.person, phone: entry.phone?.hostname, own: phone?.ip }).toEqual({
              person: entry.person,
              phone: entry.phone?.hostname,
              own: entry.phone?.address,
            });
          } else {
            byKeypad += 1;
            expect(entry.phone).toBeNull();
            expect(entry.slot).toBe(entry.person);
            expect(slots).toContain(entry.slot);
          }
        });
    });
    expect(byPhone).toBeGreaterThan(10);
    expect(byKeypad).toBeGreaterThan(10);
  });

  it('lets in by keypad alone below the LAN, where it can see no phone', () => {
    locks()
      .filter(({ layer }) => layer === 'deep')
      .forEach(({ tree }) => entriesOf(tree).forEach((entry) => expect(entry.phone).toBeNull()));
  });

  it("lets in a slot kept for a role, such as the cleaner's, by that slot and no person's name", () => {
    let roles = 0;
    locks().forEach(({ tree }) => {
      const slots = slotsOf(tree);
      entriesOf(tree)
        .filter((entry) => entry.person === null)
        .forEach((entry) => {
          roles += 1;
          expect(LOCK_ROLE_SLOTS).toContain(entry.slot);
          expect(slots).toContain(entry.slot);
        });
    });
    expect(roles).toBeGreaterThan(5);
  });

  it('keeps one or two slots for a role, beside its people\'s', () => {
    locks().forEach(({ host, tree }) => {
      const roles = slotsOf(tree).filter((slot) => LOCK_ROLE_SLOTS.includes(slot)).length;
      expect({ host: host.hostname, roles: roles >= 1 && roles <= 2 }).toEqual({ host: host.hostname, roles: true });
    });
  });

  it('remembers two weeks of comings and goings, not one morning', () => {
    const spans = locks().map(({ tree }) => {
      const times = entriesOf(tree).map(({ at }) => at);
      return (Math.max(...times) - Math.min(...times)) / 86_400_000;
    });
    expect(Math.max(...spans)).toBeGreaterThan(10);
    spans.forEach((days) => expect(days).toBeLessThanOrEqual(14));
  });

  it('locks itself again after a real number of seconds', () => {
    locks().forEach(({ tree }) => {
      expect(Number(setting(tree, 'auto_lock_seconds'))).toBeGreaterThanOrEqual(15);
      expect(Number(setting(tree, 'auto_lock_seconds'))).toBeLessThanOrEqual(120);
    });
  });

  it('keeps a slot for exactly the people and roles that use the keypad', () => {
    locks().forEach((box) => {
      const cast = castOf(box);
      slotsOf(box.tree).forEach((slot) => {
        const phones = cast.get(slot);
        expect({ slot, keypad: LOCK_ROLE_SLOTS.includes(slot) || (phones !== undefined && phones.length === 0) }).toEqual({
          slot,
          keypad: true,
        });
      });
    });
  });

  it('differs from lock to lock, every model and role slot drawn somewhere', () => {
    const boxes = locks();
    expect(new Set(boxes.map(({ tree }) => setting(tree, 'model')))).toEqual(new Set(LOCK_MODELS));
    expect(new Set(boxes.flatMap(({ tree }) => slotsOf(tree)).filter((slot) => LOCK_ROLE_SLOTS.includes(slot)))).toEqual(
      new Set(LOCK_ROLE_SLOTS),
    );
  });
});

/** A moment in milliseconds as a device's page shows it. */
const shown = (at: number): string => new Date(at).toISOString().slice(0, 19).replace('T', ' ');


describe("a smart lock's own pages", () => {
  const serving = (): readonly BuiltBox[] => locks().filter(servesHttp);

  it('show the door, and when it was last unlocked as its log has it', () => {
    const boxes = serving();
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach(({ tree }) => {
      const page = pagesOf(tree).get('index.html') ?? '';
      const last = entriesOf(tree).at(-1);
      expect(page).toContain(`<h1>${setting(tree, 'name')}`);
      expect(page).toContain(`Last unlocked: ${shown(last?.at ?? 0)}`);
    });
  });

  it('say on its Settings page how soon it locks again and how many slots it keeps', () => {
    serving().forEach(({ tree }) => {
      const page = pagesOf(tree).get('settings.html') ?? '';
      expect(page).toContain(`Locks again after ${setting(tree, 'auto_lock_seconds')} seconds.`);
      expect(page).toContain(`${slotsOf(tree).length} keypad slots.`);
    });
  });

  it('name nobody it lets in, no slot and no phone, since its slots and its log are not the web\'s to show', () => {
    serving().forEach((box) => {
      const pages = [...pagesOf(box.tree).values()].join('\n');
      const named = [
        ...castOf(box).keys(),
        ...slotsOf(box.tree),
        ...entriesOf(box.tree).flatMap(({ phone }) => (phone === null ? [] : [phone.hostname])),
      ];
      named.forEach((name) => {
        expect({ host: box.host.hostname, name, shown: pages.includes(name) }).toEqual({
          host: box.host.hostname,
          name,
          shown: false,
        });
      });
    });
  });
});
