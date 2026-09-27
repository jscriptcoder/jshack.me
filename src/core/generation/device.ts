/**
 * What a generated IoT box keeps because of the device it is: a printer its print
 * server's config and spool, a camera its events. It sits on top of the small Linux
 * board every IoT box already is, and moves nothing about that board.
 *
 * Which device a box is comes off its name, as its role does, so a box named `printer-44`
 * on a scan is a printer on disk.
 *
 * Every draw comes from the box's own `device-` stream, so giving a box a device moves
 * no account, password, page or history already generated.
 */

import { createPrng } from './prng.js';
import type { LanHost } from './generateHomeLan.js';
import { peopleKnownOn } from './mailbox.js';
import { cameraFiles } from './device/camera.js';
import { climateFiles } from './device/climate.js';
import { lockFiles } from './device/lock.js';
import { mediaFiles } from './device/media.js';
import { plugFiles } from './device/plug.js';
import { deviceKindOf, type DeviceFiles } from './device/common.js';
import { printerFiles } from './device/printer.js';
import { recorderFiles } from './device/recorder.js';

export { cameraRecordings, type CameraEvent, type CameraRecordings } from './device/camera.js';
export { deviceKindOf, type DeviceFiles, type DeviceKind } from './device/common.js';
export type { PrintedJob } from './device/printer.js';

/** What the device `host` is keeps on disk, or null for a box that is no device.
 *  `username` is the box's own account, which is who a box below the LAN knows beside
 *  its application's logins. */
export const buildDevice = ({
  essid,
  host,
  username,
}: {
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
}): DeviceFiles | null => {
  const kind = deviceKindOf(host.hostname);
  const prng = createPrng(`device-${essid}-${host.ip}`);
  if (kind === 'camera') return cameraFiles({ prng, host, username });
  if (kind === 'climate') return climateFiles({ prng, host, username });
  if (kind === 'media') return mediaFiles({ prng, essid, host, username });
  if (kind === 'plug') return plugFiles({ prng, host, username });
  if (kind === 'lock') {
    return lockFiles({ prng, essid, host, username, people: peopleKnownOn({ essid, host, username }) });
  }
  if (kind === 'recorder') return recorderFiles({ prng, essid, host, username });
  if (kind === 'printer') {
    return printerFiles({ prng, essid, host, people: peopleKnownOn({ essid, host, username }) });
  }
  return null;
};
