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

import { createPrng } from './prng';
import type { LanHost } from './generateHomeLan';
import { peopleKnownOn } from './mailbox';
import { cameraFiles } from './device/camera';
import { deviceKindOf, type DeviceFiles } from './device/common';
import { printerFiles } from './device/printer';
import { recorderFiles } from './device/recorder';

export { cameraRecordings, type CameraEvent, type CameraRecordings } from './device/camera';
export { deviceKindOf, type DeviceFiles, type DeviceKind } from './device/common';
export type { PrintedJob } from './device/printer';

/** What the device `host` is keeps on disk, or null where its kind keeps nothing of its
 *  own yet and the box keeps the generic device config instead. `username` is the box's
 *  own account, which is who a box below the LAN knows beside its application's logins. */
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
  if (kind === 'recorder') return recorderFiles({ prng, essid, host, username });
  if (kind !== 'printer') return null;
  return printerFiles({ prng, essid, host, people: peopleKnownOn({ essid, host, username }) });
};
