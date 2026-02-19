import { useState, useCallback } from 'react';
import type { MissionNetwork } from '../generation/types';
import { generateMissionNetwork } from '../generation/generateMission';
import { getCachedMissionSeed, getDatabase } from '../utils/storageCache';
import { saveMissionSeed } from '../utils/storage';

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
    },
    [persistSeed],
  );

  const abortMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
  }, [persistSeed]);

  const completeMission = useCallback(() => {
    setActiveMission(null);
    persistSeed(null);
  }, [persistSeed]);

  return { activeMission, startMission, abortMission, completeMission };
};
