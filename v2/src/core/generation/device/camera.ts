/**
 * A camera, in any of its flavours: motion's config, the events it recorded and the
 * snapshot each one took, and its own pages. A doorbell's events include rings and a baby
 * monitor's the sounds it heard.
 */

import { createPrng, type Prng } from '../prng';
import { dir, file, HOME_DIR, HOME_FILE, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import { renderDocument } from '../documentFormats';
import type { LanHost } from '../generateHomeLan';
import { CAMERA_MODELS, CAMERA_RESOLUTIONS, FLAVOUR_EVENTS } from '../pools/devices';
import type { Directory } from '../../filesystem/types';
import {
  DAY_SECONDS,
  LAST_SECOND,
  prefixOf,
  shownAt,
  stamp,
  uiPage,
  type DeviceFiles,
} from './common';

/** How many events a camera still holds, and how far back its storage reaches. */
const EVENT_COUNT = { min: 4, max: 12 } as const;
export const EVENT_WINDOW_SECONDS = 14 * DAY_SECONDS;
/** How often an event on a doorbell or baby monitor is its flavour's own rather than
 *  plain motion. */
const FLAVOUR_EVENT_CHANCE = 0.4;


/** A snapshot's file name, as motion's `picture_filename` pattern writes it. */
const snapshotName = (second: number): string =>
  `${stamp(second).replaceAll('-', '').replace(' ', '-').replaceAll(':', '')}.jpg`;


/** One event a camera recorded: when, what set it off, and the snapshot it took. */
export type CameraEvent = {
  /** In seconds. */
  readonly at: number;
  readonly kind: string;
  /** Its path beneath `/var/lib/motion`. */
  readonly snapshot: string;
  readonly content: string;
};

/** A camera as it is: the model it is and the events it still holds, oldest first. */
export type CameraRecordings = {
  readonly make: string;
  readonly model: string;
  readonly events: readonly CameraEvent[];
};

export const recordingsOf = (prng: Prng, flavour: string): CameraRecordings => {
  const camera = prng.pick(CAMERA_MODELS.filter((candidate) => candidate.flavour === flavour));
  const count = prng.nextInt(EVENT_COUNT.min, EVENT_COUNT.max);
  // One second holds one snapshot, so two events drawn into the same second are one.
  const seconds = [
    ...new Set(
      Array.from({ length: count }, () =>
        prng.nextInt(LAST_SECOND - EVENT_WINDOW_SECONDS, LAST_SECOND),
      ),
    ),
  ].sort((earlier, later) => earlier - later);
  const flavourEvent = FLAVOUR_EVENTS[flavour];
  // A doorbell that never rang would not be one, so one event is always its own kind.
  const certain = prng.nextInt(0, seconds.length - 1);
  const events = seconds.map((second, index) => ({
    at: second,
    kind:
      flavourEvent !== undefined && (index === certain || prng.next() < FLAVOUR_EVENT_CHANCE)
        ? flavourEvent
        : 'motion',
    snapshot: `snapshots/${snapshotName(second)}`,
    content: renderDocument(
      {
        format: 'jpeg',
        make: camera.make,
        model: camera.model,
        takenAt: second * 1000,
        artist: null,
      },
      prng,
    ),
  }));
  return { make: camera.make, model: camera.model, events };
};

/** What a camera-kind box records, without building the box: the first draws of its own
 *  `device-` stream, the same ones `buildDevice` takes. A recorder archiving the camera
 *  reads this, so its copies are the camera's own snapshots byte for byte. */
export const cameraRecordings = (essid: string, host: LanHost): CameraRecordings =>
  recordingsOf(createPrng(`device-${essid}-${host.ip}`), prefixOf(host.hostname));

/** `/etc/motion/motion.conf`: the camera it drives, where it writes, and how it decides
 *  something moved. Its stream and its controls answer on the loopback only, since
 *  nothing on the network answers on their ports. */
const motionConf = ({
  prng,
  hostname,
  recordings,
  frame: [width, height],
}: {
  readonly prng: Prng;
  readonly hostname: string;
  readonly recordings: CameraRecordings;
  readonly frame: readonly [number, number];
}): string =>
  [
    `# motion configuration for ${hostname}`,
    'daemon on',
    'setup_mode off',
    `camera_name ${recordings.make} ${recordings.model}`,
    'videodevice /dev/video0',
    `width ${width}`,
    `height ${height}`,
    `framerate ${prng.pick([10, 15, 20])}`,
    `threshold ${prng.pick([1500, 2500, 4000])}`,
    `event_gap ${prng.pick([30, 60, 120])}`,
    'target_dir /var/lib/motion',
    `picture_output ${prng.pick(['first', 'best', 'center'])}`,
    'picture_filename snapshots/%Y%m%d-%H%M%S',
    'movie_output off',
    'stream_port 8081',
    'stream_localhost on',
    'webcontrol_port 8080',
    'webcontrol_localhost on',
    '',
  ].join('\n');

/** The camera's own pages: what it is and that its picture stays on the box, and the
 *  events it holds, newest first. */
const cameraPages = ({
  hostname,
  recordings,
  frame: [width, height],
}: {
  readonly hostname: string;
  readonly recordings: CameraRecordings;
  readonly frame: readonly [number, number];
}): ReadonlyMap<string, string> => {
  const nav = [
    ['/', 'Live'],
    ['/events.html', 'Events'],
  ] as const;
  return new Map([
    [
      'index.html',
      uiPage({
        title: `${hostname} - Live`,
        body: [
          `<p>${recordings.make} ${recordings.model}, ${width}x${height}.</p>`,
          '<p>The live picture is viewed on this device only.</p>',
          `<p>${recordings.events.length} events held.</p>`,
        ],
        nav,
      }),
    ],
    [
      'events.html',
      uiPage({
        title: `${hostname} - Events`,
        body: [
          '<table>',
          '<tr><th>Time</th><th>Event</th></tr>',
          ...[...recordings.events]
            .reverse()
            .map(({ at, kind }) => `<tr><td>${shownAt(at * 1000)}</td><td>${kind}</td></tr>`),
          '</table>',
        ],
        nav,
      }),
    ],
  ]);
};

/** `/var/lib/motion`: the event index and the snapshot each event took. The daemon runs
 *  as the box's own account, so they are that user's to read and a guest's not. */
const motionState = (recordings: CameraRecordings, username: string): Directory =>
  dir(
    {
      'events.log': file(
        recordings.events
          .map(({ at, kind, snapshot }) => `${stamp(at)} ${kind} ${snapshot}\n`)
          .join(''),
        HOME_FILE,
        username,
      ),
      snapshots: dir(
        Object.fromEntries(
          recordings.events.map(({ snapshot, content }) => [
            snapshot.slice('snapshots/'.length),
            file(content, HOME_FILE, username),
          ]),
        ),
        HOME_DIR,
        username,
      ),
    },
    HOME_DIR,
    username,
  );

export const cameraFiles = ({
  prng,
  host,
  username,
}: {
  readonly prng: Prng;
  readonly host: LanHost;
  readonly username: string;
}): DeviceFiles => {
  const recordings = recordingsOf(prng, prefixOf(host.hostname));
  const frame = prng.pick(CAMERA_RESOLUTIONS);
  const conf = motionConf({ prng, hostname: host.hostname, recordings, frame });
  return {
    etc: {
      motion: dir({ 'motion.conf': file(conf, SERVICE_CONFIG_FILE) }, TRAVERSABLE_DIR),
    },
    lib: { motion: motionState(recordings, username) },
    var: {},
    pages: cameraPages({ hostname: host.hostname, recordings, frame }),
    configPaths: ['/etc/motion/motion.conf'],
    printed: [],
  };
};
