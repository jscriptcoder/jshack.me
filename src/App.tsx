import { useState, useCallback } from 'react';
import { Terminal } from './components/Terminal';
import { IntroScreen } from './components/IntroScreen';
import { BootScreen } from './components/BootScreen';
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

type AppScreen = 'intro' | 'booting' | 'game';

function App() {
  const cachedGame = getCachedGameState();
  const [gameState, setGameState] = useState<GameState | null>(cachedGame);
  const [screen, setScreen] = useState<AppScreen>(cachedGame ? 'game' : 'intro');

  const handleStart = useCallback(async (state: GameState, isNewGame: boolean) => {
    if (isNewGame) {
      const db = getDatabase();
      if (db) {
        await clearAllData(db);
        await saveGameState(db, state);
      }
      resetSessionCache(state);
    }
    setGameState(state);
    setScreen(isNewGame ? 'booting' : 'game');
  }, []);

  const handleBootComplete = useCallback(() => {
    setScreen('game');
  }, []);

  if (screen === 'intro' || !gameState) {
    return <IntroScreen existingGame={cachedGame} onStart={handleStart} />;
  }

  if (screen === 'booting') {
    return (
      <BootScreen workstationName={gameState.workstationName} onComplete={handleBootComplete} />
    );
  }

  return (
    <SessionProvider workstationName={gameState.workstationName}>
      <GameSession gameState={gameState} />
    </SessionProvider>
  );
}

export default App;
