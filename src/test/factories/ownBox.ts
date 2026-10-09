/**
 * The player's own box, standing at home, for the doors that reach it by `localhost`
 * or by the address it was leased.
 *
 * Its `/etc/passwd` holds a guest and a root with passwords, and a passwordless `alice`
 * — the player's own login, which no door admits. The shell stands on it as `alice`, so
 * a test can tell the tier a door's login bought from the one the shell already had.
 * The network seams a remote target would need throw if asked: the own box is answered
 * from its own tree.
 */

import { buildDirectory, buildFile } from './filesystem.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockLogApi,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
} from './commandEnv.js';
import { md5 } from '../../core/generation/md5.js';
import { assignHomeNetwork } from '../../core/network/homeNetwork.js';
import {
  buildColdStartConnectivity,
  type ConnectivityState,
} from '../../core/network/interfaces.js';
import { formatPidfileContent } from '../../core/services/pidfile.js';
import { SERVICE_CATALOG } from '../../core/services/serviceCatalog.js';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../../core/types.js';
import type { AuthLogEvent, CommandEnv } from '../../core/commands/types.js';
import type { Directory } from '../../core/filesystem/types.js';

const PUBKEY = 'a'.repeat(64);

export const OWN_BOX = {
  pubkey: PUBKEY,
  essid: 'BEAN-THERE-WIFI',
  machineId: asMachineId('skylab-deadbeef'),
  hostname: 'skylab',
  guestPassword: 'guestpw',
  rootPassword: 'rootpw',
  now: 1700000000000,
  /** The address the box was leased on its WiFi. */
  leasedIp: assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI').localIp,
} as const;

/** The door daemons the box is running, by the port each listens on; null for one
 *  that is not running. sshd runs on :22 and vsftpd on :21 unless told otherwise. */
export type OwnBoxDaemons = {
  readonly sshdPort?: number | null;
  readonly vsftpdPort?: number | null;
};

const pidfiles = ({ sshdPort = 22, vsftpdPort = 21 }: OwnBoxDaemons) => ({
  ...(sshdPort === null
    ? {}
    : { 'sshd.pid': buildFile(formatPidfileContent(SERVICE_CATALOG.ssh, sshdPort)) }),
  ...(vsftpdPort === null
    ? {}
    : { 'vsftpd.pid': buildFile(formatPidfileContent(SERVICE_CATALOG.ftp, vsftpdPort)) }),
});

export const ownBoxTree = (daemons: OwnBoxDaemons = {}): Directory =>
  buildDirectory({
    etc: buildDirectory({
      passwd: buildFile(
        [
          `root:${md5(OWN_BOX.rootPassword)}:0:0:root:/root:/bin/bash`,
          `guest:${md5(OWN_BOX.guestPassword)}:1001:1001:guest:/home/guest:/bin/bash`,
          'alice::1000:1000:alice:/home/alice:/bin/bash',
        ].join('\n') + '\n',
      ),
    }),
    home: buildDirectory({
      alice: buildDirectory(
        { 'notes.txt': buildFile('remember the milk\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
      guest: buildDirectory({}, { owner: 'guest' }),
    }),
    var: buildDirectory({ run: buildDirectory(pidfiles(daemons)) }),
  });

/** wlan0 associated with the box's WiFi and holding its lease. */
const onlineConnectivity = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', {
      ...wlan0,
      association: { essid: OWN_BOX.essid, bssid: 'AA:BB:CC:DD:EE:FF' },
      ipv4: OWN_BOX.leasedIp,
    }),
  };
};

export type OwnBoxOptions = OwnBoxDaemons & {
  /** Offline is the cold-start box: loopback only. */
  readonly online?: boolean;
  /** Every line the box's daemons are asked to write. */
  readonly onLog?: (event: AuthLogEvent) => void;
};

/** A shell standing at home on the own box as `alice`, typing the guest password at
 *  any prompt unless `over` says otherwise. */
export const ownBoxEnv = (options: OwnBoxOptions = {}, over: Partial<CommandEnv> = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(
      options.online === false ? buildColdStartConnectivity(PUBKEY) : onlineConnectivity(),
    ),
    session: mockSession({
      id: 'login-1',
      machineId: OWN_BOX.machineId,
      username: 'alice',
      userType: 'user',
    }),
    hostname: OWN_BOX.hostname,
    fs: mockFsViewFromTree(ownBoxTree(options), { userType: 'user' }),
    now: () => asEpochMs(OWN_BOX.now),
    prompt: async () => OWN_BOX.guestPassword,
    scan: mockScanApi({
      resolveOccupants: async () => {
        throw new Error('the own box never asks who else is on the network');
      },
    }),
    log: {
      ...mockLogApi(),
      appendAuthLog: async (event) => {
        options.onLog?.(event);
      },
    },
    ...over,
  });
