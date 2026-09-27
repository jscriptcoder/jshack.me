/**
 * A media device: a television or a speaker. It keeps the phones it was paired with, what
 * it played and from where, and the apps it has installed. A phone it pairs with is one of
 * the network's own, named the way a phone names itself: its owner's and its model's.
 */

import type { Prng } from '../prng';
import { dir, file, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from '../generateHomeLan';
import { peopleOn } from '../networkMail';
import { npcUsername } from '../remoteHostFs';
import { phoneModel } from '../share';
import { MEDIA_APPS, MEDIA_MODELS, MEDIA_ROOMS, MEDIA_TITLES } from '../pools/devices';
import {
  DAY_SECONDS,
  LAST_SECOND,
  prefixOf,
  stamp,
  uiPage,
  userTree,
  type DeviceFiles,
} from './common';

const PAIRED_PATH = '/var/lib/mediad/paired.conf';
const RECENT_PATH = '/var/lib/mediad/recent.log';
const APPS_PATH = '/var/lib/mediad/apps.list';

type Flavour = 'tv' | 'speaker';

/** How long ago a phone may have been paired, and how far back what was played goes. */
const PAIRING_WINDOW_SECONDS = 180 * DAY_SECONDS;
const PLAYED_WINDOW_SECONDS = 21 * DAY_SECONDS;
/** How likely each phone on the network is to have been paired. */
const PAIRING_CHANCE = 0.7;
/** How likely something played was cast from a paired phone. */
const CAST_CHANCE = 0.5;
const PLAYED = { min: 6, max: 18 } as const;
const INSTALLED: Readonly<Record<Flavour, { readonly min: number; readonly max: number }>> = {
  tv: { min: 4, max: 7 },
  speaker: { min: 2, max: 4 },
};

/** A phone the device is paired with: its name on the network, where, what it calls
 *  itself, and when it was paired, in seconds. */
type Pairing = { readonly hostname: string; readonly address: string; readonly name: string; readonly at: number };

/**
 * The network's phones this device paired with: most of them, and always one where
 * there is one to pair. A box below the LAN sees no phone, so it pairs nothing.
 */
const pairingsOf = (prng: Prng, essid: string, host: LanHost): readonly Pairing[] => {
  if (!isOnHomeLan(essid, host)) return [];
  const people = peopleOn(essid);
  const phones = generateHomeLan(essid).hosts.flatMap((neighbour) => {
    const model = phoneModel(essid, neighbour);
    const owner = people.find((person) => person.username === npcUsername(essid, neighbour));
    if (model === undefined || owner === undefined) return [];
    const first = owner.fullName.split(' ')[0] ?? owner.fullName;
    return [{ hostname: neighbour.hostname, address: neighbour.ip, name: `${first}'s ${model.model}` }];
  });
  if (phones.length === 0) return [];
  const chosen = phones.filter(() => prng.next() < PAIRING_CHANCE);
  return (chosen.length > 0 ? chosen : [prng.pick(phones)]).map((phone) => ({
    ...phone,
    at: prng.nextInt(LAST_SECOND - PAIRING_WINDOW_SECONDS, LAST_SECOND),
  }));
};

const pairedFile = (name: string, pairings: readonly Pairing[]): string =>
  [
    `# devices paired with ${name}`,
    ...pairings.flatMap((pairing) => [
      `[${pairing.hostname}]`,
      `name = ${pairing.name}`,
      `address = ${pairing.address}`,
      `paired = ${stamp(pairing.at)}`,
    ]),
    '',
  ].join('\n');

type Played = { readonly at: number; readonly app: string; readonly title: string; readonly source: string };

/** The apps a speaker plays and so every app without a picture. */
const AUDIO_APPS: ReadonlySet<string> = new Set(MEDIA_APPS.speaker);

/** What it played, oldest first: on its own apps, cast from a phone already paired by
 *  then or else started on the device itself. */
const playedOn = ({
  prng,
  flavour,
  apps,
  pairings,
}: {
  readonly prng: Prng;
  readonly flavour: Flavour;
  readonly apps: readonly string[];
  readonly pairings: readonly Pairing[];
}): readonly Played[] => {
  const own = flavour === 'tv' ? 'remote' : 'voice';
  const seconds = Array.from({ length: prng.nextInt(PLAYED.min, PLAYED.max) }, () =>
    prng.nextInt(LAST_SECOND - PLAYED_WINDOW_SECONDS, LAST_SECOND),
  ).sort((earlier, later) => earlier - later);
  return seconds.map((at) => {
    const app = prng.pick(apps);
    const title = prng.pick(MEDIA_TITLES[AUDIO_APPS.has(app) ? 'audio' : 'video']);
    const castable = pairings.filter((pairing) => pairing.at < at);
    const source =
      castable.length > 0 && prng.next() < CAST_CHANCE ? prng.pick(castable).hostname : own;
    return { at, app, title, source };
  });
};

const recentFile = (played: readonly Played[]): string =>
  played
    .map(({ at, app, title, source }) => `${stamp(at)} app=${app} title="${title}" from=${source}\n`)
    .join('');

/** Some of the flavour's apps, in the order the store lists them. */
const installedOn = (prng: Prng, flavour: Flavour): readonly string[] => {
  const pool = MEDIA_APPS[flavour];
  const count = prng.nextInt(INSTALLED[flavour].min, INSTALLED[flavour].max);
  const chosen = new Set<string>();
  while (chosen.size < count) chosen.add(prng.pick(pool));
  return pool.filter((app) => chosen.has(app));
};

/** `/etc/mediad/mediad.conf`: what the device calls itself and is, where it takes a cast
 *  and where it keeps what it remembers. It takes a cast on the loopback, handed on by
 *  the discovery daemon, so nothing on the network answers on the cast port. */
const mediadConf = ({
  hostname,
  name,
  model,
}: {
  readonly hostname: string;
  readonly name: string;
  readonly model: string;
}): string =>
  [
    `# mediad configuration for ${hostname}`,
    '[device]',
    `name = ${name}`,
    `model = ${model}`,
    '',
    '[cast]',
    'listen = 127.0.0.1:8009',
    'discovery = mdns',
    `pairing = ${PAIRED_PATH}`,
    '',
    '[playback]',
    `history = ${RECENT_PATH}`,
    `apps = ${APPS_PATH}`,
    '',
  ].join('\n');

/** The device's own pages: what it played, newest first, and the phones it is paired
 *  with. Where it was cast from is left to its history, which is its account's. */
const mediaPages = ({
  hostname,
  name,
  model,
  played,
  pairings,
}: {
  readonly hostname: string;
  readonly name: string;
  readonly model: string;
  readonly played: readonly Played[];
  readonly pairings: readonly Pairing[];
}): ReadonlyMap<string, string> => {
  const nav = [
    ['/', 'Now playing'],
    ['/devices.html', 'Devices'],
  ] as const;
  return new Map([
    [
      'index.html',
      uiPage({
        title: `${name} - Now playing`,
        body: [
          `<p>${model} (${hostname}).</p>`,
          '<table>',
          '<tr><th>Time</th><th>App</th><th>Title</th></tr>',
          ...[...played]
            .reverse()
            .map(({ at, app, title }) => `<tr><td>${stamp(at)}</td><td>${app}</td><td>${title}</td></tr>`),
          '</table>',
        ],
        nav,
      }),
    ],
    [
      'devices.html',
      uiPage({
        title: `${name} - Devices`,
        body:
          pairings.length === 0
            ? ['<p>No devices paired.</p>']
            : [
                '<table>',
                '<tr><th>Device</th><th>Paired</th></tr>',
                ...pairings.map(({ name: phone, at }) => `<tr><td>${phone}</td><td>${stamp(at)}</td></tr>`),
                '</table>',
              ],
        nav,
      }),
    ],
  ]);
};

export const mediaFiles = ({
  prng,
  essid,
  host,
  username,
}: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): DeviceFiles => {
  const flavour: Flavour = prefixOf(host.hostname) === 'speaker' ? 'speaker' : 'tv';
  const model = prng.pick(MEDIA_MODELS[flavour]);
  const name = `${prng.pick(MEDIA_ROOMS)} ${flavour === 'tv' ? 'TV' : 'Speaker'}`;
  const apps = installedOn(prng, flavour);
  const pairings = pairingsOf(prng, essid, host);
  const played = playedOn({ prng, flavour, apps, pairings });
  return {
    etc: {
      mediad: dir(
        { 'mediad.conf': file(mediadConf({ hostname: host.hostname, name, model }), SERVICE_CONFIG_FILE) },
        TRAVERSABLE_DIR,
      ),
    },
    lib: {
      mediad: userTree(
        new Map([
          ['paired.conf', pairedFile(name, pairings)],
          ['recent.log', recentFile(played)],
          ['apps.list', apps.map((app) => `${app}\n`).join('')],
        ]),
        username,
      ),
    },
    log: {},
    var: {},
    pages: mediaPages({ hostname: host.hostname, name, model, played, pairings }),
    configPaths: ['/etc/mediad/mediad.conf'],
    printed: [],
  };
};
