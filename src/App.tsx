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
import { HomeNetworksProvider, useHomeNetworks } from './game/HomeNetworksContext';
import { generateLocalhost } from './generation/generateLocalhost';
import { useWorldNetworks } from './worldNetworks/useWorldNetworks';
import type { GameState } from './game/types';
import type { FileNode } from './filesystem/types';

function GameSession({ gameState }: { readonly gameState: GameState }) {
  const { connectedWifi } = useSession();
  return (
    <HomeNetworksProvider
      gameSeed={gameState.seed}
      workstationPrefix={gameState.workstationName}
      connectedWifi={connectedWifi}
    >
      <GameInner gameState={gameState} />
    </HomeNetworksProvider>
  );
}

function GameInner({ gameState }: { readonly gameState: GameState }) {
  const { activeNetwork, joinedNetworks } = useHomeNetworks();
  const usedPublicIps = useMemo(
    () => new Set(joinedNetworks.map((n) => n.router.publicIp)),
    [joinedNetworks],
  );
  const missionState = useMissionState(usedPublicIps);
  const localhostResult = useMemo(() => generateLocalhost(gameState), [gameState]);

  // World networks (shared persistent content visible to every player —
  // playground, future themed locales). Each network's fileSystems are
  // merged into homeFileSystems for FileSystemProvider; the full array
  // is passed to NetworkProvider so commands like nmap/ssh/curl can
  // resolve their machines.
  const worldNetworks = useWorldNetworks();
  const mergedHomeFileSystems = useMemo(() => {
    const base: Record<string, FileNode> = { ...(activeNetwork?.fileSystems ?? {}) };
    for (const wn of worldNetworks) {
      Object.assign(base, wn.fileSystems);
    }
    return base;
  }, [activeNetwork?.fileSystems, worldNetworks]);

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
          worldNetworks={worldNetworks}
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
