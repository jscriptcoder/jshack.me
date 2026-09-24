import { describe, expect, it } from 'vitest';
import { CLIMATE_CHIPS, CLIMATE_ROOMS } from '../pools/devices';
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

const CLIMATE_PREFIXES = ['sensor', 'thermostat'];

const CONF = '/etc/sensord/sensord.conf';
const READINGS = '/var/lib/sensord/readings.csv';
const SCHEDULE = '/var/lib/sensord/schedule.conf';

/** Every climate box: the world's, LAN and deep, and synthetic ones of each flavour on
 *  both layers. */
const climates = (): readonly BuiltBox[] => [
  ...worldBoxesNamed(CLIMATE_PREFIXES),
  ...syntheticLanBoxes(CLIMATE_PREFIXES).slice(0, 40),
  ...CLIMATE_PREFIXES.flatMap((prefix) => syntheticBoxes(prefix).slice(0, 15)),
];

const thermostats = (): readonly BuiltBox[] =>
  climates().filter(({ host }) => prefixOf(host.hostname) === 'thermostat');

/** A setting's value in the daemon's config, `key = value`. */
const setting = (tree: BuiltBox['tree'], key: string): string | undefined =>
  new RegExp(`^${key} = (.+)$`, 'm').exec(contentOf(tree, CONF))?.[1];

type Reading = {
  /** In milliseconds. */
  readonly at: number;
  readonly temperature: number;
  readonly humidity: number;
};

const READING_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d),(-?\d+\.\d),(\d+)$/;

const readingsOf = (tree: BuiltBox['tree']): readonly Reading[] => {
  const [header, ...rows] = contentOf(tree, READINGS).split('\n').filter((line) => line !== '');
  if (header !== 'time,temperature_c,humidity_pct') throw new Error(`not a readings header: ${header}`);
  return rows.map((row) => {
    const match = READING_LINE.exec(row);
    if (match === null) throw new Error(`not a reading: ${row}`);
    const [, year, month, day, hours, minutes, seconds, temperature, humidity] = match;
    return {
      at: Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds),
      ),
      temperature: Number(temperature),
      humidity: Number(humidity),
    };
  });
};

/** One line of a heating schedule: from this time of day, on these days, this set point. */
type SetPoint = {
  readonly days: 'mon-fri' | 'sat-sun';
  /** Minutes after midnight. */
  readonly from: number;
  readonly celsius: number;
};

const SCHEDULE_LINE = /^(mon-fri|sat-sun) (\d\d):(\d\d) (\d+\.\d)$/;

const scheduleOf = (tree: BuiltBox['tree']): readonly SetPoint[] =>
  contentOf(tree, SCHEDULE)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const match = SCHEDULE_LINE.exec(line);
      if (match === null) throw new Error(`not a schedule line: ${line}`);
      const [, days, hours, minutes, celsius] = match;
      return {
        days: days === 'sat-sun' ? 'sat-sun' : 'mon-fri',
        from: Number(hours) * 60 + Number(minutes),
        celsius: Number(celsius),
      };
    });

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const daysOf = (at: number): SetPoint['days'] =>
  [0, 6].includes(new Date(at).getUTCDay()) ? 'sat-sun' : 'mon-fri';

/** The set point in force at `at`, and since when: the day's latest entry already
 *  reached, or where none is yet, the last one of the day before. */
const inForce = (schedule: readonly SetPoint[], at: number): { celsius: number; since: number } => {
  const midnight = at - (at % DAY_MS);
  const started = (day: number) =>
    schedule
      .filter((point) => point.days === daysOf(day))
      .map((point) => ({ celsius: point.celsius, since: day + point.from * MINUTE_MS }));
  const today = started(midnight).filter(({ since }) => since <= at);
  const found = today.length > 0 ? today : started(midnight - DAY_MS);
  const latest = found[found.length - 1];
  if (latest === undefined) throw new Error('an empty schedule');
  return latest;
};

describe('a climate device', () => {
  it('is found on home LANs and below them, in both flavours', () => {
    expect(new Set(worldBoxesNamed(CLIMATE_PREFIXES).map(({ layer }) => layer))).toEqual(
      new Set(['lan', 'deep']),
    );
    expect(new Set(climates().map(({ host }) => prefixOf(host.hostname)))).toEqual(
      new Set(CLIMATE_PREFIXES),
    );
  });

  it("keeps its daemon's config in place of device.conf, for anyone on the box to read", () => {
    climates().forEach(({ host, tree }) => {
      expect({ host: host.hostname, device: read(tree, '/etc/device.conf').ok }).toEqual({
        host: host.hostname,
        device: false,
      });
      expect(read(tree, CONF, 'guest').ok).toBe(true);
      expect(setting(tree, 'file')).toBe(READINGS);
      expect(softwareVersionsIn(contentOf(tree, CONF))).toEqual([]);
    });
  });

  it('publishes to a broker on the loopback only, so no file claims a port a scan cannot see', () => {
    climates().forEach(({ tree }) => {
      expect(setting(tree, 'host')).toBe('127.0.0.1');
      expect(setting(tree, 'topic')).toBe(`home/${setting(tree, 'room')}/climate`);
    });
  });

  it('names a chip it really could be, at the address that chip answers on', () => {
    climates().forEach(({ tree }) => {
      const chip = CLIMATE_CHIPS.find((candidate) => candidate.chip === setting(tree, 'chip'));
      expect(chip).toBeDefined();
      expect(setting(tree, 'address')).toBe(chip?.address);
    });
  });

  it('keeps as many readings as its config says, one every interval, the last before the world began', () => {
    climates().forEach(({ host, tree }) => {
      const readings = readingsOf(tree);
      const interval = Number(setting(tree, 'interval')) * 1000;
      expect({ host: host.hostname, count: readings.length }).toEqual({
        host: host.hostname,
        count: Number(setting(tree, 'keep')),
      });
      readings.slice(1).forEach((reading, index) => {
        expect(reading.at - (readings[index]?.at ?? 0)).toBe(interval);
      });
      const last = readings[readings.length - 1]?.at ?? 0;
      expect(last).toBeLessThan(WORLD_EPOCH);
      expect(WORLD_EPOCH - last).toBeLessThanOrEqual(interval);
      expect(last % interval).toBe(0);
    });
  });

  it('reads only what a room indoors can read', () => {
    climates().forEach(({ tree }) => {
      readingsOf(tree).forEach(({ temperature, humidity }) => {
        expect(temperature).toBeGreaterThanOrEqual(10);
        expect(temperature).toBeLessThanOrEqual(32);
        expect(humidity).toBeGreaterThanOrEqual(20);
        expect(humidity).toBeLessThanOrEqual(80);
      });
    });
  });

  it("keeps its readings the box's own account's to read, and a guest's not", () => {
    climates().forEach(({ tree }) => {
      expect(read(tree, READINGS, 'user').ok).toBe(true);
      expect(read(tree, READINGS, 'guest').ok).toBe(false);
    });
  });

  it('differs from box to box: chips, rooms, intervals and how long a history it keeps', () => {
    const boxes = climates();
    const drawn = (key: string) => new Set(boxes.map(({ tree }) => setting(tree, key)));
    expect(drawn('chip')).toEqual(new Set(CLIMATE_CHIPS.map(({ chip }) => chip)));
    expect(drawn('room')).toEqual(new Set(CLIMATE_ROOMS));
    expect(drawn('interval').size).toBeGreaterThan(1);
    expect(drawn('keep').size).toBeGreaterThan(5);
  });
});

describe("a thermostat's schedule", () => {
  it('is kept on every thermostat, named by its config, and on no plain sensor', () => {
    climates().forEach(({ host, tree }) => {
      const thermostat = prefixOf(host.hostname) === 'thermostat';
      expect({ host: host.hostname, schedule: read(tree, SCHEDULE, 'user').ok }).toEqual({
        host: host.hostname,
        schedule: thermostat,
      });
      expect(setting(tree, 'schedule')).toBe(thermostat ? SCHEDULE : undefined);
      if (thermostat) expect(read(tree, SCHEDULE, 'guest').ok).toBe(false);
    });
  });

  it('sets the heat for weekdays and weekends, each day in order, within what a home heats to', () => {
    thermostats().forEach(({ tree }) => {
      const schedule = scheduleOf(tree);
      (['mon-fri', 'sat-sun'] as const).forEach((days) => {
        const froms = schedule.filter((point) => point.days === days).map((point) => point.from);
        expect(froms.length).toBeGreaterThanOrEqual(2);
        expect(froms).toEqual([...new Set(froms)].sort((earlier, later) => earlier - later));
      });
      schedule.forEach(({ celsius }) => {
        expect(celsius).toBeGreaterThanOrEqual(14);
        expect(celsius).toBeLessThanOrEqual(23);
      });
    });
  });

  it('lets the home cool for the night: each day ends on a lower set point than the one before it', () => {
    thermostats().forEach(({ host, tree }) => {
      const schedule = scheduleOf(tree);
      (['mon-fri', 'sat-sun'] as const).forEach((days) => {
        const day = schedule.filter((point) => point.days === days).map((point) => point.celsius);
        const [evening = 0, night = 0] = day.slice(-2);
        expect({ host: host.hostname, days, cooler: night < evening }).toEqual({
          host: host.hostname,
          days,
          cooler: true,
        });
      });
    });
  });

  it('holds the room within a degree of the set point once it has had three hours to get there', () => {
    let settled = 0;
    thermostats().forEach(({ host, tree }) => {
      const schedule = scheduleOf(tree);
      readingsOf(tree).forEach(({ at, temperature }) => {
        const { celsius, since } = inForce(schedule, at);
        if (at - since < 3 * 60 * MINUTE_MS) return;
        settled += 1;
        expect({ host: host.hostname, at, off: Math.abs(temperature - celsius) <= 1 }).toEqual({
          host: host.hostname,
          at,
          off: true,
        });
      });
    });
    expect(settled).toBeGreaterThan(100);
  });

  it('follows the set point down as well as up', () => {
    thermostats().forEach(({ host, tree }) => {
      const schedule = scheduleOf(tree);
      const temperatures = readingsOf(tree).map(({ at, temperature }) => ({
        temperature,
        celsius: inForce(schedule, at).celsius,
      }));
      const warmest = Math.max(...temperatures.map(({ celsius }) => celsius));
      const coolest = Math.min(...temperatures.map(({ celsius }) => celsius));
      const mean = (celsius: number) => {
        const during = temperatures.filter((entry) => entry.celsius === celsius);
        return during.reduce((sum, entry) => sum + entry.temperature, 0) / during.length;
      };
      if (warmest === coolest) return;
      expect({ host: host.hostname, warmer: mean(warmest) > mean(coolest) }).toEqual({
        host: host.hostname,
        warmer: true,
      });
    });
  });
});
