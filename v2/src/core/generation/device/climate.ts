/**
 * A climate device: a sensor board reading a room's temperature and humidity, or a
 * thermostat that does the same and switches the heating to a schedule. Its daemon keeps
 * the readings it took and publishes each to a broker on the board itself.
 */

import type { Prng } from '../prng';
import { dir, file, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import type { LanHost } from '../generateHomeLan';
import { CLIMATE_CHIPS, CLIMATE_ROOMS } from '../pools/devices';
import { DAY_SECONDS, LAST_SECOND, pad2, prefixOf, stamp, userTree, type DeviceFiles } from './common';

const CONF_PATH = '/etc/sensord/sensord.conf';
const READINGS_PATH = '/var/lib/sensord/readings.csv';
const SCHEDULE_PATH = '/var/lib/sensord/schedule.conf';

/** How often the daemon reads, in seconds, and how many readings it keeps: a day's worth
 *  at the least, eight at the most. */
const INTERVALS: readonly number[] = [900, 1800, 3600];
const KEEP = { min: 96, max: 192 } as const;

type Days = 'mon-fri' | 'sat-sun';

/** From `from` minutes after midnight on `days`, heat to `celsius`. */
type SetPoint = { readonly days: Days; readonly from: number; readonly celsius: number };

/** The half hours a set point may begin on: 05:00 to 23:30. */
const FIRST_SLOT = 10;
const LAST_SLOT = 47;
/** A day's set points come in pairs, a warm one and the cool one after it. */
const PAIRS = { min: 1, max: 2 } as const;
/** In half degrees, so every set point is one a dial can show. */
const WARM = { min: 38, max: 44 } as const;
const COOL = { min: 29, max: 35 } as const;

/** Each group of days in order of the day, warming and cooling by turns, as a home
 *  heats for the morning, lets it drop while out and heats again for the evening, and
 *  always ends the day cool for the night. */
const scheduleOf = (prng: Prng): readonly SetPoint[] =>
  (['mon-fri', 'sat-sun'] as const).flatMap((days) => {
    const count = prng.nextInt(PAIRS.min, PAIRS.max) * 2;
    const slots = new Set<number>();
    while (slots.size < count) slots.add(prng.nextInt(FIRST_SLOT, LAST_SLOT));
    return [...slots]
      .sort((earlier, later) => earlier - later)
      .map((slot, index) => {
        const band = index % 2 === 0 ? WARM : COOL;
        return { days, from: slot * 30, celsius: prng.nextInt(band.min, band.max) / 2 };
      });
  });

const daysOf = (second: number): Days =>
  [0, 6].includes(new Date(second * 1000).getUTCDay()) ? 'sat-sun' : 'mon-fri';

/** The set point in force at `second`: the day's latest one already reached, or where
 *  none is yet, the last of the day before. */
const setPointAt = (schedule: readonly SetPoint[], second: number): number => {
  const midnight = second - (second % DAY_SECONDS);
  const started = (day: number) =>
    schedule
      .filter((point) => point.days === daysOf(day))
      .map((point) => ({ celsius: point.celsius, since: day + point.from * 60 }));
  const today = started(midnight).filter(({ since }) => since <= second);
  const found = today.length > 0 ? today : started(midnight - DAY_SECONDS);
  return found[found.length - 1]?.celsius ?? 0;
};

const scheduleFile = (schedule: readonly SetPoint[]): string =>
  [
    '# heating schedule: days, from, set point in celsius',
    ...schedule.map(
      ({ days, from, celsius }) =>
        `${days} ${pad2(Math.floor(from / 60))}:${pad2(from % 60)} ${celsius.toFixed(1)}`,
    ),
    '',
  ].join('\n');

/** How fast a room closes on its set point, in seconds: after three hours what is left of
 *  any gap is a few hundredths of it. */
const WARMING_SECONDS = 2700;
/** How much a single reading wanders from the room's true temperature, either way. */
const NOISE = 0.2;

type Reading = { readonly at: number; readonly temperature: number; readonly humidity: number };

/**
 * The readings, oldest first. A thermostat's room closes on whatever set point is in
 * force, from a day before the first reading kept so the first is already settled; a
 * plain sensor's room follows the day, warmest in the afternoon. Humidity falls as the
 * air warms.
 */
const readingsOf = ({
  prng,
  schedule,
  interval,
  keep,
}: {
  readonly prng: Prng;
  readonly schedule: readonly SetPoint[] | null;
  readonly interval: number;
  readonly keep: number;
}): readonly Reading[] => {
  const last = LAST_SECOND - (LAST_SECOND % interval);
  const first = last - (keep - 1) * interval;
  const base = prng.nextInt(170, 230) / 10;
  const swing = prng.nextInt(5, 25) / 10;
  const humid = prng.nextInt(35, 60);
  const settling = Math.ceil(DAY_SECONDS / interval);
  const closing = 1 - Math.exp(-interval / WARMING_SECONDS);
  const seconds = Array.from({ length: settling + keep }, (_, index) => first + (index - settling) * interval);
  const truths = seconds.reduce<readonly number[]>((room, second) => {
    if (schedule === null) {
      const hour = (second % DAY_SECONDS) / 3600;
      return [...room, base + swing * Math.sin((2 * Math.PI * (hour - 9)) / 24)];
    }
    const before = room[room.length - 1] ?? setPointAt(schedule, second);
    const target = setPointAt(schedule, second);
    return [...room, before + (target - before) * closing];
  }, []);
  return truths.slice(settling).map((truth, index) => {
    const temperature = Math.round((truth + (prng.next() * 2 - 1) * NOISE) * 10) / 10;
    const humidity = Math.round(humid - (temperature - 20) * 1.5 + (prng.next() * 2 - 1) * 2);
    return {
      at: seconds[settling + index] ?? first,
      temperature,
      humidity: Math.min(80, Math.max(20, humidity)),
    };
  });
};

const readingsFile = (readings: readonly Reading[]): string =>
  [
    'time,temperature_c,humidity_pct',
    ...readings.map(({ at, temperature, humidity }) => `${stamp(at)},${temperature.toFixed(1)},${humidity}`),
    '',
  ].join('\n');

/** `/etc/sensord/sensord.conf`: the chip it reads, where, how often, what it keeps and
 *  where it publishes. Its broker is the board's own, so nothing on the network answers
 *  on 1883. */
const sensordConf = ({
  hostname,
  chip,
  room,
  interval,
  keep,
  thermostat,
}: {
  readonly hostname: string;
  readonly chip: (typeof CLIMATE_CHIPS)[number];
  readonly room: string;
  readonly interval: number;
  readonly keep: number;
  readonly thermostat: boolean;
}): string =>
  [
    `# sensord configuration for ${hostname}`,
    '[sensor]',
    `chip = ${chip.chip}`,
    'bus = /dev/i2c-1',
    `address = ${chip.address}`,
    `room = ${room}`,
    `interval = ${interval}`,
    'units = celsius',
    '',
    '[log]',
    `file = ${READINGS_PATH}`,
    `keep = ${keep}`,
    '',
    '[mqtt]',
    'host = 127.0.0.1',
    'port = 1883',
    `topic = home/${room}/climate`,
    ...(thermostat ? ['', '[thermostat]', `schedule = ${SCHEDULE_PATH}`, 'relay = gpio17'] : []),
    '',
  ].join('\n');

export const climateFiles = ({
  prng,
  host,
  username,
}: {
  readonly prng: Prng;
  readonly host: LanHost;
  readonly username: string;
}): DeviceFiles => {
  const thermostat = prefixOf(host.hostname) === 'thermostat';
  const chip = prng.pick(CLIMATE_CHIPS);
  const room = prng.pick(CLIMATE_ROOMS);
  const interval = prng.pick(INTERVALS);
  const keep = prng.nextInt(KEEP.min, KEEP.max);
  const schedule = thermostat ? scheduleOf(prng) : null;
  const readings = readingsOf({ prng, schedule, interval, keep });
  const conf = sensordConf({ hostname: host.hostname, chip, room, interval, keep, thermostat });
  return {
    etc: { sensord: dir({ 'sensord.conf': file(conf, SERVICE_CONFIG_FILE) }, TRAVERSABLE_DIR) },
    lib: {
      sensord: userTree(
        new Map([
          ['readings.csv', readingsFile(readings)],
          ...(schedule === null ? [] : [['schedule.conf', scheduleFile(schedule)] as const]),
        ]),
        username,
      ),
    },
    var: {},
    pages: new Map(),
    configPaths: [CONF_PATH],
    printed: [],
  };
};
