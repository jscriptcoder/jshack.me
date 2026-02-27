import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { MissionNetwork } from '../generation/types';
import type { MissionState } from './useMissionState';
import { useSession } from '../session/SessionContext';

// Static machines that exist outside of missions — used to detect if the
// session is on a mission machine when a cross-tab mission abort arrives.
const STATIC_MACHINES = new Set(['localhost', '192.168.1.100', '192.168.1.1']);

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
  const { session, popAllSessions } = useSession();
  const prevMissionRef = useRef(state.activeMission);
  const isMissionActive = () => state.activeMission !== null;

  // When a cross-tab abort clears the mission while this tab is SSH'd into a
  // mission machine, reset the session back to localhost. Local aborts already
  // call popAllSessions() before clearing activeMission, so the session will
  // already be on localhost — this only triggers for remote changes.
  useEffect(() => {
    const wasMissionActive = prevMissionRef.current !== null;
    const isMissionNowInactive = state.activeMission === null;
    prevMissionRef.current = state.activeMission;

    if (wasMissionActive && isMissionNowInactive && !STATIC_MACHINES.has(session.machine)) {
      popAllSessions();
    }
  }, [state.activeMission, session.machine, popAllSessions]);

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
