import { createContext, useContext, type ReactNode } from 'react';
import type { MissionNetwork } from '../generation/types';
import type { MissionState } from './useMissionState';

type MissionContextValue = {
  readonly activeMission: MissionNetwork | null;
  readonly startMission: (mission: MissionNetwork) => void;
  readonly abortMission: () => void;
  readonly completeMission: () => void;
  readonly isMissionActive: () => boolean;
};

const MissionContext = createContext<MissionContextValue | null>(null);

type MissionProviderProps = {
  readonly children: ReactNode;
  readonly state: MissionState;
};

export const MissionProvider = ({ children, state }: MissionProviderProps) => {
  const isMissionActive = () => state.activeMission !== null;

  return (
    <MissionContext.Provider
      value={{
        activeMission: state.activeMission,
        startMission: state.startMission,
        abortMission: state.abortMission,
        completeMission: state.completeMission,
        isMissionActive,
      }}
    >
      {children}
    </MissionContext.Provider>
  );
};

export const useMission = (): MissionContextValue => {
  const context = useContext(MissionContext);
  if (!context) {
    throw new Error('useMission must be used within a MissionProvider');
  }
  return context;
};
