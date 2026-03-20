import { useState, useCallback } from 'react';
import { Terminal } from './components/Terminal';
import { IntroScreen } from './components/IntroScreen';
import { SessionProvider, useSession } from './session/SessionContext';
import { FileSystemProvider } from './filesystem';
import { NetworkProvider } from './network';
import { MissionProvider, useMissionState } from './mission';
import { getCachedGameState, getDatabase, resetSessionCache } from './utils/storageCache';
import { saveGameState, clearAllData } from './utils/storage';
import { useHomeNetworks } from './game/useHomeNetworks';
import type { GameState } from './game/types';

function GameSession({ gameState }: { readonly gameState: GameState }) {
  const { connectedWifi } = useSession();
  const missionState = useMissionState();
  const { activeNetwork } = useHomeNetworks(gameState.seed, connectedWifi);

  return (
    <MissionProvider state={missionState}>
      <FileSystemProvider
        missionFileSystems={missionState.activeMission?.fileSystems}
        homeFileSystems={activeNetwork?.fileSystems}
        workstationName={gameState.workstationName}
      >
        <NetworkProvider
          missionNetworkConfig={missionState.activeMission?.networkConfig}
          missionMachines={missionState.activeMission?.machines}
          missionRouterMachine={
            missionState.activeMission ? missionState.activeMission.routerMachine : undefined
          }
          homeNetwork={activeNetwork}
        >
          <Terminal />
        </NetworkProvider>
      </FileSystemProvider>
    </MissionProvider>
  );
}

function App() {
  const [gameState, setGameState] = useState<GameState | null>(getCachedGameState);

  const handleStart = useCallback(async (state: GameState) => {
    const db = getDatabase();
    if (db) {
      // Wipe all previous data before starting (fresh slate)
      await clearAllData(db);
      await saveGameState(db, state);
    }
    // Clear cached session so SessionProvider starts as jshacker/user, not stale root.
    // Also sets the new game state so useWifiCommands sees the seed immediately.
    resetSessionCache(state);
    setGameState(state);
  }, []);

  if (!gameState) {
    return <IntroScreen existingGame={getCachedGameState()} onStart={handleStart} />;
  }

  return (
    <SessionProvider workstationName={gameState.workstationName}>
      <GameSession gameState={gameState} />
    </SessionProvider>
  );
}

export default App;
