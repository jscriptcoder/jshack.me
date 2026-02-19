import { useState, useCallback } from 'react';
import type { MissionNetwork } from '../generation/types';
import { generateMissionNetwork } from '../generation/generateMission';
import { getCachedMissionSeed, getDatabase } from '../utils/storageCache';
import { saveMissionSeed } from '../utils/storage';

const initializeMission = (): MissionNetwork | null => {
  const cachedSeed = getCachedMissionSeed();
  if (!cachedSeed) return null;
  return generateMissionNetwork(cachedSeed);
};

export type MissionState = {
  readonly activeMission: MissionNetwork | null;
  readonly startMission: (seed: string) => void;
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
    (seed: string) => {
      const mission = generateMissionNetwork(seed);
      setActiveMission(mission);
      persistSeed(seed);
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
