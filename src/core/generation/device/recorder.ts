/**
 * A network video recorder: the network's cameras archived under their `.lan` names, or
 * PoE channels below the LAN, with its config and its own pages.
 */

import type { Prng } from '../prng';
import { dir, file, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from '../generateHomeLan';
import { lanZoneName } from '../../network/resolveName';
import {
  cameraRecordings,
  EVENT_WINDOW_SECONDS,
  recordingsOf,
  type CameraEvent,
  type CameraRecordings,
} from './camera';
import {
  DAY_SECONDS,
  deviceKindOf,
  pad2,
  stamp,
  uiPage,
  userTree,
  type DeviceFiles,
} from './common';

/** How many PoE channels a recorder below the LAN has cameras on. */
const CHANNEL_COUNT = { min: 2, max: 4 } as const;

/** One camera a recorder archives: the name it files it under, the address it reaches it
 *  at (none for a camera on its own PoE port), and what that camera recorded. */
type RecordedSource = {
  readonly name: string;
  readonly address: string | null;
  readonly recordings: CameraRecordings;
};

/**
 * What a recorder records. On the LAN, every camera on the network, by its `.lan` name,
 * each one's snapshots re-derived from that camera's own stream so the copies are its
 * own. Below the LAN it can see no neighbour, so its cameras hang off its own PoE ports,
 * each a camera no box stands for.
 */
const recordedSources = (prng: Prng, essid: string, host: LanHost): readonly RecordedSource[] => {
  if (isOnHomeLan(essid, host)) {
    const zone = lanZoneName(essid);
    return generateHomeLan(essid)
      .hosts.filter(
        (camera) => camera.kind === 'machine' && deviceKindOf(camera.hostname) === 'camera',
      )
      .map((camera) => ({
        name: `${camera.hostname}.${zone}`,
        address: camera.ip,
        recordings: cameraRecordings(essid, camera),
      }));
  }
  return Array.from({ length: prng.nextInt(CHANNEL_COUNT.min, CHANNEL_COUNT.max) }, (_, index) => ({
    name: `ch${pad2(index + 1)}`,
    address: null,
    recordings: recordingsOf(prng, 'cam'),
  }));
};

/** Where a recorder files one event's snapshot beneath `/var/lib/nvr`: the camera, the
 *  day, and the camera's own file name for it. */
const archivedPath = (source: RecordedSource, event: CameraEvent): string =>
  `${source.name}/${stamp(event.at).slice(0, 10)}/${event.snapshot.slice('snapshots/'.length)}`;

/** `/etc/nvr/nvr.conf`: where the recorder stores, how long, and a section per camera.
 *  A LAN camera is named with the address the network gives it and no port, since the
 *  recorder takes each snapshot as the camera makes it and nothing on the network
 *  serves a stream; a channel names the PoE port it hangs off. */
const nvrConf = (hostname: string, sources: readonly RecordedSource[]): string =>
  [
    `# network video recorder: ${hostname}`,
    'storage = /var/lib/nvr',
    `retention_days = ${EVENT_WINDOW_SECONDS / DAY_SECONDS}`,
    'snapshot_on_event = yes',
    ...sources.flatMap((source, index) => [
      '',
      `[${source.name}]`,
      source.address === null ? `port = PoE${index + 1}` : `address = ${source.address}`,
      `camera = ${source.recordings.make} ${source.recordings.model}`,
    ]),
    '',
  ].join('\n');

export const recorderFiles = ({
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
  const sources = recordedSources(prng, essid, host);
  const archived = sources
    .flatMap((source) =>
      source.recordings.events.map((event) => ({ source, event, path: archivedPath(source, event) })),
    )
    .sort((earlier, later) => earlier.event.at - later.event.at);
  const index = archived
    .map(({ source, event, path }) => `${stamp(event.at)} ${source.name} ${event.kind} ${path}\n`)
    .join('');
  return {
    etc: {
      nvr: dir(
        { 'nvr.conf': file(nvrConf(host.hostname, sources), SERVICE_CONFIG_FILE) },
        TRAVERSABLE_DIR,
      ),
    },
    lib: {
      nvr: userTree(
        new Map([
          ['index.log', index],
          ...archived.map(({ event, path }): readonly [string, string] => [path, event.content]),
        ]),
        username,
      ),
    },
    log: {},
    var: {},
    pages: recorderPages(host.hostname, sources),
    configPaths: ['/etc/nvr/nvr.conf'],
    printed: [],
  };
};

/** The recorder's own pages: the cameras it records, and how many snapshots it holds of
 *  each, day by day. */
const recorderPages = (
  hostname: string,
  sources: readonly RecordedSource[],
): ReadonlyMap<string, string> => {
  const nav = [
    ['/', 'Cameras'],
    ['/recordings.html', 'Recordings'],
  ] as const;
  const days = sources.flatMap((source) => {
    const byDay = new Map<string, number>();
    source.recordings.events.forEach((event) => {
      const day = stamp(event.at).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    });
    return [...byDay].map(([day, count]) => `<tr><td>${source.name}</td><td>${day}</td><td>${count}</td></tr>`);
  });
  return new Map([
    [
      'index.html',
      uiPage({
        title: `${hostname} - Cameras`,
        body: [
          '<table>',
          '<tr><th>Camera</th><th>Model</th></tr>',
          ...sources.map(
            (source) =>
              `<tr><td>${source.name}</td><td>${source.recordings.make} ${source.recordings.model}</td></tr>`,
          ),
          '</table>',
        ],
        nav,
      }),
    ],
    [
      'recordings.html',
      uiPage({
        title: `${hostname} - Recordings`,
        body: ['<table>', '<tr><th>Camera</th><th>Day</th><th>Snapshots</th></tr>', ...days, '</table>'],
        nav,
      }),
    ],
  ]);
};
