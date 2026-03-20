import { useState, useCallback } from 'react';
import { Terminal } from './components/Terminal';
import { IntroScreen } from './components/IntroScreen';
import { SessionProvider } from './session/SessionContext';
import { FileSystemProvider } from './filesystem';
import { NetworkProvider } from './network';
import { MissionProvider, useMissionState } from './mission';
import { getCachedGameState, getDatabase } from './utils/storageCache';
import { saveGameState, clearAllData } from './utils/storage';
import type { GameState } from './game/types';

function GameSession() {
  const missionState = useMissionState();

  return (
    <MissionProvider state={missionState}>
      <FileSystemProvider missionFileSystems={missionState.activeMission?.fileSystems}>
        <NetworkProvider
          missionNetworkConfig={missionState.activeMission?.networkConfig}
          missionMachines={missionState.activeMission?.machines}
          missionRouterMachine={
            missionState.activeMission ? missionState.activeMission.routerMachine : undefined
          }
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
    setGameState(state);
  }, []);

  if (!gameState) {
    return <IntroScreen existingGame={getCachedGameState()} onStart={handleStart} />;
  }

  return (
    <SessionProvider>
      <GameSession />
    </SessionProvider>
  );
}

export default App;
