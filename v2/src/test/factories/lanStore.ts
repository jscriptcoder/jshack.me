/**
 * Finding a generated box on a HIDDEN layer that really serves a key-value store, and
 * the password that opens it when it has one.
 *
 * Searched for rather than named, for the reason the database's twin states: both facts
 * are per-network rolls — which layers exist, which of their boxes run a store, and
 * whether that store's password came from a pool a test can recover. Naming one essid
 * would leave this passing on a fixture and failing the day the world re-rolls.
 *
 * Everything here is the generator's: the layer's subnet, the box's services, its own
 * store. What a test supplies is the forward that exposes it, which is the one thing a
 * player has to do by hand.
 *
 * OPEN and LOCKED are both asked for by name, because for this door they are different
 * worlds rather than different values — four stores in ten answer to nobody, and a
 * criterion about `NOAUTH` and a criterion about walking straight in cannot share one
 * box.
 */

import { generateHomeLan, type LanHost } from '../../core/generation/generateHomeLan';
import { crackableEssidPool } from '../../core/generation/generateWifi';
import {
  buildDeepHostFs,
  generateDeepLayer,
  type DeepLayer,
} from '../../core/generation/generateDeepLayer';
import { computeInnerGatewayId } from '../../core/identity/router';
import { hostMachineId } from '../../core/generation/remoteHostId';
import { storeIn } from '../../core/redis/datadir';
import { ownStore } from '../../core/redis/ownStore';
import { materializeWorkstationFs } from '../../core/network/materializeWorkstationFs';
import type { NatOccupantRow } from '../../core/network/resolvePublicTarget';
import { readOpenPorts } from '../../core/services/pidfile';
import { SERVICE_CATALOG } from '../../core/services/serviceCatalog';
import { ALL_GENERATED_PASSWORDS } from '../../core/generation/passwordPools';
import { md5 } from '../../core/generation/md5';
import type { RedisStore } from '../../core/redis/types';
import type { Directory } from '../../core/filesystem/types';

export type DeepStoreFixture = {
  readonly essid: string;
  /** The Layer-1 inner gateway whose forward table is the only door to the layer. */
  readonly gateway: LanHost;
  readonly gatewayMachineId: string;
  readonly layer: DeepLayer;
  readonly machineId: string;
  /** The box's SEEDED tree — no journal replayed, which is exactly what the chain
   *  resolver hands back and why a door answering with DATA has to materialize on top
   *  of it. */
  readonly fs: Directory;
  /** The port the daemon holds down there, read off the box rather than assumed: a
   *  generated host may serve the store on an alternate port. */
  readonly port: number;
  /** The only address NAT ever shows this box: the fronting gateway's downstream `.1`. */
  readonly natIp: string;
  readonly store: RedisStore;
  /** The plaintext behind `requirepassHash`, recovered by matching the generator's own
   *  pool — a thing only a test standing outside the game can do. `null` on an open
   *  store, which is a state rather than a missing value. */
  readonly password: string | null;
};

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const passwordBehind = (hash: string): string | undefined =>
  ALL_GENERATED_PASSWORDS.find((word) => md5(word) === hash);

const deepStoreAt = (essid: string, gateway: LanHost): DeepStoreFixture | null => {
  if (gateway.kind !== 'router' || octetOf(gateway) === 1) return null;
  const gatewayMachineId = computeInnerGatewayId(essid, octetOf(gateway));
  const layer = generateDeepLayer(essid, { machineId: gatewayMachineId, kind: 'router' });
  const fs = buildDeepHostFs(essid, layer.host);
  const open = readOpenPorts(fs).find(
    (candidate) => candidate.service === SERVICE_CATALOG.redis.service,
  );
  const store = storeIn(fs);
  if (open === undefined || store === null) return null;
  const hash = store.requirepassHash;
  const password = hash === null ? null : (passwordBehind(hash) ?? null);
  // A locked store whose password came from the uncrackable pool is a real state of the
  // world and useless as a fixture: nothing outside the game can open it.
  if (hash !== null && password === null) return null;
  return {
    essid,
    gateway,
    gatewayMachineId,
    layer,
    machineId: hostMachineId(layer.host, essid),
    fs,
    port: open.port,
    natIp: `${layer.subnet}.1`,
    store,
    password,
  };
};

/** A deep box serving a store, locked or open as asked. Throws rather than skipping:
 *  a world that fronts neither is a world this door cannot be played in, and a silent
 *  pass would hide that. */
export const deepStoreFixture = (want: { readonly locked: boolean }): DeepStoreFixture => {
  for (const essid of crackableEssidPool) {
    for (const gateway of generateHomeLan(essid).hosts) {
      const fixture = deepStoreAt(essid, gateway);
      if (fixture !== null && (fixture.password !== null) === want.locked) return fixture;
    }
  }
  throw new Error(`no network fronts a deep store that is ${want.locked ? 'locked' : 'open'}`);
};

/** The store on a PLAYER's box — drawn exactly as their own `apt install redis` draws
 *  it, from their key and their box's own accounts.
 *
 *  Built through `ownStore` rather than hand-written so a test target is the same
 *  object the game plants. The lock especially: it mirrors the root password in that
 *  box's `/etc/passwd`, so the plaintext a test needs is one it already chose when it
 *  built the occupant row, and a fixture that invented a `requirepassHash` would be
 *  asserting against a store no player could ever hold. */
export const playerStoreOn = (occupant: NatOccupantRow): RedisStore =>
  ownStore({
    ownerKeyHex: occupant.owner_key,
    hostname: occupant.workstation_machine_name,
    fs: materializeWorkstationFs(occupant, []),
  });
