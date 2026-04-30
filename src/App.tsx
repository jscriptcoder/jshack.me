import { useState, useCallback, useMemo } from 'react';
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
import { generateLocalhost } from './generation/generateLocalhost';
import { useTestNetworks } from './testNetworks/useTestNetworks';
import type { GameState } from './game/types';

function GameSession({ gameState }: { readonly gameState: GameState }) {
  const { connectedWifi } = useSession();
  const { activeNetwork, allNetworks } = useHomeNetworks(gameState.seed, connectedWifi);
  const usedPublicIps = useMemo(
    () => new Set(allNetworks.map((n) => n.router.publicIp)),
    [allNetworks],
  );
  const missionState = useMissionState(usedPublicIps);
  const localhostResult = useMemo(() => generateLocalhost(gameState), [gameState]);

  // Dev-only test networks (shared across players). Merged into
  // homeFileSystems so cross-player visibility plumbing in
  // FileSystemContext picks them up via the existing machineIds
  // computation. Removed entirely at game release.
  const testNetworkFileSystems = useTestNetworks();
  const mergedHomeFileSystems = useMemo(
    () => ({ ...activeNetwork?.fileSystems, ...testNetworkFileSystems }),
    [activeNetwork?.fileSystems, testNetworkFileSystems],
  );

  return (
    <MissionProvider state={missionState} usedPublicIps={usedPublicIps}>
      <FileSystemProvider
        localhostFileSystem={localhostResult.fileSystem}
        missionFileSystems={missionState.activeMission?.fileSystems}
        homeFileSystems={mergedHomeFileSystems}
      >
        <NetworkProvider
          missionNetworkConfig={missionState.activeMission?.networkConfig}
          missionMachines={missionState.activeMission?.machines}
          missionRouterMachine={
            missionState.activeMission ? missionState.activeMission.routerMachine : undefined
          }
          missionLayers={missionState.activeMission?.layers}
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
      <BootScreen
        workstationName={gameState.workstationName}
        username={gameState.username}
        onComplete={handleBootComplete}
      />
    );
  }

  return (
    <SessionProvider workstationName={gameState.workstationName} username={gameState.username}>
      <GameSession gameState={gameState} />
    </SessionProvider>
  );
}

export default App;
