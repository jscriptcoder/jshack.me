import { useMemo } from 'react';
import { Terminal } from '../components/Terminal';
import { useSession } from '../session/SessionContext';
import { FileSystemProvider } from '../filesystem';
import { NetworkProvider } from '../network';
import { MissionProvider, useMissionState } from '../mission';
import { HomeNetworksProvider, useHomeNetworks } from '../homeNetworks/HomeNetworksContext';
import { generateLocalhost } from '../generation/generateLocalhost';
import { useWorldNetworks } from '../worldNetworks/useWorldNetworks';
import type { GameState } from './types';
import type { FileNode } from '../filesystem/types';

export function GameSession({
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
      <GameProviders gameState={gameState} hostname={hostname} />
    </HomeNetworksProvider>
  );
}

function GameProviders({
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
  // resolve their machines. The handlers map dispatches dynamic HTTP
  // behavior on themed networks (search engine, etc.) — handlers are
  // looked up by router IP via NetworkProvider's getHandler.
  const { networks: worldNetworks, handlers: worldHandlers } = useWorldNetworks();
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
          worldHandlers={worldHandlers}
          lanOccupants={lanOccupants}
        >
          <Terminal />
        </NetworkProvider>
      </FileSystemProvider>
    </MissionProvider>
  );
}
