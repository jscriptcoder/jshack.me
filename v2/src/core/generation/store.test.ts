import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { drawStoreLock } from './generateRedisStore';
import { CRACK_CHANCE, CRACKABLE_PASSWORDS } from './passwordPools';
import { md5 } from './md5';
import { storeIn } from '../redis/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { ALL_ESSIDS, deepBoxes, lanBoxes, type Box } from '../../test/worldContent';
import type { RedisStore } from '../redis/types';

type StoreBox = Box & { readonly store: RedisStore };

/** Every store the world holds: each LAN box that runs redis, and each deep box that
 *  does. Built inside each test rather than cached, so a mutation run credits the test
 *  that actually reads the generator. */
const everyStore = (): readonly StoreBox[] => {
  const lan = lanBoxes(ALL_ESSIDS)
    .filter(({ essid, host }) =>
      hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.redis),
    )
    .map(({ essid, host }) => ({ essid, host, fs: buildRemoteHostFs(essid, host) }));
  const deep = deepBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
    essid,
    host,
    fs: buildDeepHostFs(essid, host),
  }));
  return [...lan, ...deep].flatMap(({ essid, host, fs }) => {
    const store = storeIn(fs);
    return store === null ? [] : [{ essid, host, store }];
  });
};

const CRACKABLE_HASHES = new Set(CRACKABLE_PASSWORDS.map((password) => md5(password)));

describe('a store’s lock', () => {
  it('is drawn on its own stream and nothing else, so reshaping what a store holds never moves it', () => {
    const stores = everyStore();
    const drifted = stores
      .filter(
        ({ essid, host, store }) =>
          store.requirepassHash !== drawStoreLock(`redis-store-${essid}-${host.ip}`),
      )
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(stores.length).toBeGreaterThan(30);
    expect({ count: drifted.length, sample: drifted.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('shuts six stores in ten, on the same crack chance as an ordinary account', () => {
    const locks = Array.from({ length: 4000 }, (_, index) => drawStoreLock(`lock-${index}`));
    const locked = locks.filter((lock): lock is string => lock !== null);
    const crackable = locked.filter((lock) => CRACKABLE_HASHES.has(lock));

    expect(locked.length / locks.length).toBeGreaterThan(0.57);
    expect(locked.length / locks.length).toBeLessThan(0.63);
    expect(crackable.length / locked.length).toBeGreaterThan(CRACK_CHANCE.npcUser - 0.04);
    expect(crackable.length / locked.length).toBeLessThan(CRACK_CHANCE.npcUser + 0.04);
  });
});
