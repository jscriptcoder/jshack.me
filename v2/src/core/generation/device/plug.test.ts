import { describe, expect, it } from 'vitest';
import { PLUG_APPLIANCES } from '../pools/devices';
import { WORLD_EPOCH } from '../../cve/worldClock';
import { softwareVersionsIn } from '../../../test/worldContent';
import {
  contentOf,
  read,
  syntheticBoxes,
  syntheticLanBoxes,
  worldBoxesNamed,
  type BuiltBox,
} from '../../../test/deviceBoxes';

const CONF = '/etc/plugd/plugd.conf';
const SCHEDULE = '/var/lib/plugd/schedule.conf';
const ENERGY = '/var/lib/plugd/energy.csv';

/** Every plug: the world's, LAN and deep, and synthetic ones on both layers. */
const plugs = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(['plug']),
  ...syntheticLanBoxes(['plug']),
  ...syntheticBoxes('plug').slice(0, 40),
];

const setting = (tree: BuiltBox['tree'], key: string): string | undefined =>
  new RegExp(`^${key} = (.+)$`, 'm').exec(contentOf(tree, CONF))?.[1];

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The days of the week, by `getUTCDay()`, a schedule's days field covers. */
const DAY_SPECS: Readonly<Record<string, readonly number[]>> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  'mon-fri': [1, 2, 3, 4, 5],
  'sat-sun': [0, 6],
  ...Object.fromEntries(WEEKDAYS.map((day, index) => [day, [index]])),
};

/** One rule: on these days, switched on and off at these minutes after midnight. */
type Rule = { readonly days: readonly number[]; readonly on: number; readonly off: number };

const RULE_LINE = /^(\S+) (\d\d):(\d\d) (\d\d):(\d\d)$/;

const rulesOf = (tree: BuiltBox['tree']): readonly Rule[] =>
  contentOf(tree, SCHEDULE)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const match = RULE_LINE.exec(line);
      const days = match === null ? undefined : DAY_SPECS[match[1] ?? ''];
      if (match === null || days === undefined) throw new Error(`not a schedule rule: ${line}`);
      return {
        days,
        on: Number(match[2]) * 60 + Number(match[3]),
        off: Number(match[4]) * 60 + Number(match[5]),
      };
    });

/** The minutes the plug was on during a day of the week, where its rules overlap
 *  counted once. */
const minutesOnFor = (rules: readonly Rule[], weekday: number): number => {
  const on = new Set<number>();
  rules
    .filter((rule) => rule.days.includes(weekday))
    .forEach((rule) => {
      for (let minute = rule.on; minute < rule.off; minute += 1) on.add(minute);
    });
  return on.size;
};

type Day = { readonly date: string; readonly kwh: number };

const energyOf = (tree: BuiltBox['tree']): readonly Day[] => {
  const [header, ...rows] = contentOf(tree, ENERGY).split('\n').filter((line) => line !== '');
  if (header !== 'date,kwh') throw new Error(`not an energy header: ${header}`);
  return rows.map((row) => {
    const match = /^(\d{4}-\d\d-\d\d),(\d+\.\d{3})$/.exec(row);
    if (match === null) throw new Error(`not an energy row: ${row}`);
    return { date: match[1] ?? '', kwh: Number(match[2]) };
  });
};

const DAY_MS = 86_400_000;

describe('a smart plug', () => {
  it('is found on home LANs and below them', () => {
    expect(new Set(worldBoxesNamed(['plug']).map(({ layer }) => layer))).toEqual(new Set(['lan', 'deep']));
  });

  it("keeps its daemon's config in place of device.conf, for anyone on the box to read", () => {
    plugs().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      expect(read(tree, CONF, 'guest').ok).toBe(true);
      expect(setting(tree, 'schedule')).toBe(SCHEDULE);
      expect(setting(tree, 'energy')).toBe(ENERGY);
      expect(setting(tree, 'host')).toBe('127.0.0.1');
    });
  });

  it('switches an appliance it names, at the load that appliance draws', () => {
    plugs().forEach(({ tree }) => {
      const appliance = PLUG_APPLIANCES.find((candidate) => candidate.name === setting(tree, 'name'));
      expect(appliance).toBeDefined();
      expect(setting(tree, 'load_watts')).toBe(String(appliance?.watts));
    });
  });

  it('keeps a schedule of one to three rules, each switching off after it switched on the same day', () => {
    plugs().forEach(({ tree }) => {
      const rules = rulesOf(tree);
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules.length).toBeLessThanOrEqual(3);
      rules.forEach(({ on, off }) => {
        expect(on).toBeLessThan(off);
        expect(off).toBeLessThanOrEqual(24 * 60);
      });
    });
  });

  it('logs a day for each of the thirty days before the world began, in order', () => {
    plugs().forEach(({ tree }) => {
      const days = energyOf(tree).map(({ date }) => Date.parse(`${date}T00:00:00Z`));
      expect(days).toHaveLength(Number(setting(tree, 'keep_days')));
      expect(days).toHaveLength(30);
      days.slice(1).forEach((day, index) => expect(day - (days[index] ?? 0)).toBe(DAY_MS));
      const last = days[days.length - 1] ?? 0;
      expect(last + DAY_MS).toBeLessThanOrEqual(WORLD_EPOCH);
      expect(WORLD_EPOCH - (last + DAY_MS)).toBeLessThan(DAY_MS);
    });
  });

  it('draws energy only on the days its schedule switched it on, and never more than its load for as long as it was on', () => {
    let offDays = 0;
    plugs().forEach(({ host, tree }) => {
      const rules = rulesOf(tree);
      const watts = Number(setting(tree, 'load_watts'));
      energyOf(tree).forEach(({ date, kwh }) => {
        const minutes = minutesOnFor(rules, new Date(`${date}T00:00:00Z`).getUTCDay());
        if (minutes === 0) offDays += 1;
        expect({ host: host.hostname, date, drew: kwh > 0 }).toEqual({
          host: host.hostname,
          date,
          drew: minutes > 0,
        });
        expect(kwh).toBeLessThanOrEqual((watts * minutes) / 60 / 1000 + 0.0005);
      });
    });
    expect(offDays).toBeGreaterThan(50);
  });

  it('names no software version in its config or its schedule', () => {
    plugs().forEach(({ tree }) => {
      expect(softwareVersionsIn(contentOf(tree, CONF))).toEqual([]);
      expect(softwareVersionsIn(contentOf(tree, SCHEDULE))).toEqual([]);
    });
  });

  it("keeps its schedule and its energy the box's own account's to read, and a guest's not", () => {
    plugs().forEach(({ tree }) => {
      [SCHEDULE, ENERGY].forEach((path) => {
        expect(read(tree, path, 'user').ok).toBe(true);
        expect(read(tree, path, 'guest').ok).toBe(false);
      });
    });
  });

  it('differs from plug to plug, every appliance and every kind of day drawn somewhere', () => {
    const boxes = plugs();
    expect(new Set(boxes.map(({ tree }) => setting(tree, 'name')))).toEqual(
      new Set(PLUG_APPLIANCES.map(({ name }) => name)),
    );
    const specs = new Set(
      boxes.flatMap(({ tree }) =>
        contentOf(tree, SCHEDULE)
          .split('\n')
          .filter((line) => line !== '' && !line.startsWith('#'))
          .map((line) => line.split(' ')[0]),
      ),
    );
    expect(specs).toEqual(new Set(Object.keys(DAY_SPECS)));
  });
});
