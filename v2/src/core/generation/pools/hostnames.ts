/**
 * The name prefixes a generated machine is drawn from, keyed by what the box is for.
 *
 * A machine is named `<prefix>-<octet>`, so the name carries two facts at once: what
 * the box probably is, and where it is. The octet half is not decoration — a player
 * reads `cam-31` off a sweep and knows the address without looking across the row,
 * and the shell leans on that constantly.
 *
 * No prefix appears under two roles. Reading a box off its name only works while the
 * reading is unambiguous, and a `db` that might be a camera would make the whole
 * scheme decorative. The generator's test holds that.
 *
 * Repeats WITHIN one LAN are fine and deliberate: two cameras on a network are
 * `cam-31` and `cam-88`, which is what a network of two cameras should look like.
 * The octet keeps them distinct, so the pools carry flavour rather than uniqueness.
 *
 * `workstation` is `DEVICE_TYPES` itself, not a copy — the personal-device names the
 * DHCP draw has always used. That list keeps ONE meaning, "the name of somebody's
 * own machine", and is shared by the player's own box and by the NPCs that are the
 * same sort of thing.
 */

import { DEVICE_TYPES } from '../../network/homeNetwork';
import type { DrawnRole } from '../machineRole';

export const HOSTNAME_PREFIXES: Readonly<Record<DrawnRole, readonly string[]>> = {
  workstation: DEVICE_TYPES,
  iot: ['cam', 'sensor', 'thermostat', 'doorbell', 'printer', 'tv', 'speaker'],
  webserver: ['web', 'www', 'portal', 'nginx', 'api'],
  fileserver: ['nas', 'files', 'share', 'backup', 'vault'],
  database: ['db', 'mysql', 'datastore', 'records', 'warehouse'],
  mailserver: ['mail', 'smtp', 'imap', 'relay', 'mx'],
  dns: ['dns', 'ns', 'resolver', 'bind'],
};
