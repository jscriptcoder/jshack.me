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
import { HomeNetworksProvider, useHomeNetworks } from './homeNetworks/HomeNetworksContext';
import { generateLocalhost } from './generation/generateLocalhost';
import { useWorldNetworks } from './worldNetworks/useWorldNetworks';
import { computePlayerHostname } from './homeNetworks/homeNetworkHelpers';
import { getIdentity } from './identity';
import type { GameState } from './game/types';
import type { FileNode } from './filesystem/types';

function GameSession({
  gameState,
  hostname,
}: {
  readonly gameState: GameState;
  readonly hostname: string;
}) {
  const { connectedWifi } = useSession();
  return (
    <HomeNetworksProvider
      gameSeed={gameState.seed}
      workstationPrefix={gameState.workstationName}
      connectedWifi={connectedWifi}
    >
      <GameInner gameState={gameState} hostname={hostname} />
    </HomeNetworksProvider>
  );
}

function GameInner({
  gameState,
  hostname,
}: {
  readonly gameState: GameState;
  readonly hostname: string;
}) {
  const { activeNetwork, joinedNetworks, lanOccupants } = useHomeNetworks();

  const usedPublicIps = useMemo(
    () => new Set(joinedNetworks.map((n) => n.router.publicIp)),
    [joinedNetworks],
  );
  const missionState = useMissionState(usedPublicIps);
  const localhostResult = useMemo(
    () => generateLocalhost(gameState, hostname),
    [gameState, hostname],
  );

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
          lanOccupants={lanOccupants}
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

  // Compute the player's full hostname (workstationName + identity-derived
  // suffix) once per gameState. Threaded through to every consumer so
  // /etc/hostname, sample log entries, the prompt, and the boot screen
  // all reflect the same name. The suffix is stable per identity — same
  // player always gets the same suffix on every LAN — so the hostname is
  // a permanent property of the player's machine, not WiFi state.
  const hostname = useMemo(
    () => (gameState ? computePlayerHostname(gameState.workstationName, getIdentity()) : null),
    [gameState],
  );

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

  if (screen === 'intro' || !gameState || !hostname) {
    return <IntroScreen existingGame={cachedGame} onStart={handleStart} />;
  }

  if (screen === 'booting') {
    return (
      <BootScreen
        hostname={hostname}
        username={gameState.username}
        onComplete={handleBootComplete}
      />
    );
  }

  return (
    <SessionProvider hostname={hostname} username={gameState.username}>
      <GameSession gameState={gameState} hostname={hostname} />
    </SessionProvider>
  );
}

export default App;
