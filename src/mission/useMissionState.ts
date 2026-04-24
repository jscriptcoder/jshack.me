import { useState, useCallback, useEffect, useRef } from 'react';
import type { MissionNetwork } from '../generation/types';
import { generateMissionNetwork } from '../generation/generateMission';
import { getCachedMissionSeed, getDatabase } from '../utils/storageCache';
import { saveMissionSeed } from '../utils/storage';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';

export type MissionState = {
  readonly activeMission: MissionNetwork | null;
  readonly startMission: (mission: MissionNetwork) => void;
  readonly abortMission: () => void;
  readonly completeMission: () => void;
};

export const useMissionState = (usedPublicIps: ReadonlySet<string>): MissionState => {
  const [activeMission, setActiveMission] = useState<MissionNetwork | null>(null);
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcast calls always use
  // the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);

  // Keep usedPublicIps in a ref so the mount-only effect below can read the
  // current value without resubscribing the channel every time it changes.
  const usedPublicIpsRef = useRef(usedPublicIps);
  useEffect(() => {
    usedPublicIpsRef.current = usedPublicIps;
  }, [usedPublicIps]);

  // On reload, regenerate the full mission network from the persisted seed.
  // Only the seed is stored; the deterministic PRNG reproduces the same
  // network. Async from B2 onwards: Phase 5 adds a server round-trip for
  // IP allocation inside generateMissionNetwork.
  useEffect(() => {
    const cachedSeed = getCachedMissionSeed();
    if (!cachedSeed) return;

    let cancelled = false;
    void generateMissionNetwork(cachedSeed, usedPublicIpsRef.current).then((mission) => {
      if (!cancelled) setActiveMission(mission);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to mission changes from other tabs
  useEffect(() => {
    const channel = createSyncChannel();
    syncChannelRef.current = channel;
    channel.onMessage((message: SyncMessage) => {
      if (message.type !== 'mission-changed') return;

      if (message.seed) {
        void generateMissionNetwork(message.seed, usedPublicIpsRef.current).then((mission) => {
          setActiveMission(mission);
          const db = getDatabase();
          if (db) saveMissionSeed(db, message.seed);
        });
      } else {
        setActiveMission(null);
        const db = getDatabase();
        if (db) saveMissionSeed(db, null);
      }
    });
    return () => channel.close();
  }, []);

  const persistSeed = useCallback((seed: string | null) => {
    const db = getDatabase();
    if (db) {
      saveMissionSeed(db, seed);
    }
  }, []);

  const startMission = useCallback(
    (mission: MissionNetwork) => {
      setActiveMission(mission);
      persistSeed(mission.seed);
      syncChannelRef.current?.broadcast({ type: 'mission-changed', seed: mission.seed });
    },
    [persistSeed],
  );

  const abortMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
    syncChannelRef.current?.broadcast({ type: 'mission-changed', seed: null });
  }, [persistSeed]);

  const completeMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
    syncChannelRef.current?.broadcast({ type: 'mission-changed', seed: null });
  }, [persistSeed]);

  return { activeMission, startMission, abortMission, completeMission };
};
