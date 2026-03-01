import { useState, useCallback, useEffect, useRef } from 'react';
import type { MissionNetwork } from '../generation/types';
import { generateMissionNetwork } from '../generation/generateMission';
import { getCachedMissionSeed, getDatabase } from '../utils/storageCache';
import { saveMissionSeed } from '../utils/storage';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';

// On reload, regenerate the full mission network from the persisted seed string.
// Only the seed is stored in IndexedDB — the deterministic PRNG ensures the same
// seed always produces an identical network, so we don't need to store the full state.
const initializeMission = (): MissionNetwork | null => {
  const cachedSeed = getCachedMissionSeed();
  if (!cachedSeed) return null;
  return generateMissionNetwork(cachedSeed);
};

export type MissionState = {
  readonly activeMission: MissionNetwork | null;
  readonly startMission: (mission: MissionNetwork) => void;
  readonly abortMission: () => void;
  readonly completeMission: () => void;
};

export const useMissionState = (): MissionState => {
  const [activeMission, setActiveMission] = useState<MissionNetwork | null>(initializeMission);
  const syncChannelRef = useRef(createSyncChannel());

  // Subscribe to mission changes from other tabs
  useEffect(() => {
    const channel = syncChannelRef.current;
    channel.onMessage((message: SyncMessage) => {
      if (message.type !== 'mission-changed') return;

      if (message.seed) {
        const mission = generateMissionNetwork(message.seed);
        setActiveMission(mission);
        const db = getDatabase();
        if (db) saveMissionSeed(db, message.seed);
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
      syncChannelRef.current.broadcast({ type: 'mission-changed', seed: mission.seed });
    },
    [persistSeed],
  );

  const abortMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
    syncChannelRef.current.broadcast({ type: 'mission-changed', seed: null });
  }, [persistSeed]);

  const completeMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
    syncChannelRef.current.broadcast({ type: 'mission-changed', seed: null });
  }, [persistSeed]);

  return { activeMission, startMission, abortMission, completeMission };
};
