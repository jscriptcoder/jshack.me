import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { MissionNetwork } from '../generation/types';
import type { MissionState } from './useMissionState';
import { useSession } from '../session/SessionContext';
import { isOwnWorkstation } from '../homeNetworks/homeNetworkHelpers';

type MissionContextValue = {
  readonly activeMission: MissionNetwork | null;
  readonly startMission: (mission: MissionNetwork) => void;
  readonly abortMission: () => void;
  readonly completeMission: () => void;
  readonly isMissionActive: () => boolean;
  readonly usedPublicIps: ReadonlySet<string>;
};

const MissionContext = createContext<MissionContextValue | null>(null);

type MissionProviderProps = {
  readonly children: ReactNode;
  readonly state: MissionState;
  readonly usedPublicIps: ReadonlySet<string>;
};

export const MissionProvider = ({ children, state, usedPublicIps }: MissionProviderProps) => {
  const { session, popAllSessions, hostname } = useSession();
  const prevMissionRef = useRef(state.activeMission);
  const isMissionActive = () => state.activeMission !== null;

  // When a cross-tab abort clears the mission while this tab is SSH'd into
  // a mission machine, reset the session back to the player's own
  // workstation. Local aborts already call popAllSessions() before clearing
  // activeMission, so the session will already be on the workstation —
  // this only triggers for remote changes.
  //
  // The player's workstation is the only "persistent" machine outside
  // missions; home network machines are dynamic per WiFi connection.
  // hostname is the workstation_id (set once at App.tsx); compare via
  // isOwnWorkstation rather than the legacy localhost literal.
  useEffect(() => {
    const wasMissionActive = prevMissionRef.current !== null;
    const isMissionNowInactive = state.activeMission === null;
    prevMissionRef.current = state.activeMission;

    if (
      wasMissionActive &&
      isMissionNowInactive &&
      hostname !== undefined &&
      !isOwnWorkstation(session.machine, hostname)
    ) {
      popAllSessions();
    }
  }, [state.activeMission, session.machine, popAllSessions, hostname]);

  return (
    <MissionContext.Provider
      value={{
        activeMission: state.activeMission,
        startMission: state.startMission,
        abortMission: state.abortMission,
        completeMission: state.completeMission,
        isMissionActive,
        usedPublicIps,
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
