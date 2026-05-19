import { useMemo } from 'react';
import { Terminal } from '../components/Terminal';
import { useSession } from '../session/SessionContext';
import { FileSystemProvider } from '../filesystem';
import { NetworkProvider } from '../network';
import { MissionProvider, useMissionState } from '../mission';
import { HomeNetworksProvider, useHomeNetworks } from '../homeNetworks/HomeNetworksContext';
import {
  ForeignNetworksProvider,
  useForeignNetworks,
} from '../foreignNetworks/ForeignNetworksContext';
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

  // Active-LAN occupants' hostnames are workstation_ids of OTHER
  // players on the same LAN. Folding them into FileSystemProvider's
  // keyset subscribes us to their workstation patch streams so daemon
  // state changes (sshd pid file, etc.) propagate live cross-player.
  // Memoized for reference stability — without it, every render of
  // GameProviders would create a fresh array and machineIdsKey would
  // recompute unnecessarily.
  const lanOccupantHostnames = useMemo(() => lanOccupants.map((o) => o.hostname), [lanOccupants]);

  return (
    <ForeignNetworksProvider ownActiveHomePublicIp={activeNetwork?.router.publicIp ?? null}>
      <ForeignAwareProviders
        gameState={gameState}
        hostname={hostname}
        activeNetwork={activeNetwork}
        usedPublicIps={usedPublicIps}
        missionState={missionState}
        localhostResult={localhostResult}
        mergedHomeFileSystems={mergedHomeFileSystems}
        lanOccupantHostnames={lanOccupantHostnames}
        worldNetworks={worldNetworks}
        worldHandlers={worldHandlers}
        lanOccupants={lanOccupants}
      />
    </ForeignNetworksProvider>
  );
}

function ForeignAwareProviders({
  missionState,
  localhostResult,
  mergedHomeFileSystems,
  lanOccupantHostnames,
  activeNetwork,
  worldNetworks,
  worldHandlers,
  lanOccupants,
  usedPublicIps,
}: {
  readonly gameState: GameState;
  readonly hostname: string;
  readonly activeNetwork: ReturnType<typeof useHomeNetworks>['activeNetwork'];
  readonly usedPublicIps: ReadonlySet<string>;
  readonly missionState: ReturnType<typeof useMissionState>;
  readonly localhostResult: ReturnType<typeof generateLocalhost>;
  readonly mergedHomeFileSystems: Record<string, FileNode>;
  readonly lanOccupantHostnames: readonly string[];
  readonly worldNetworks: ReturnType<typeof useWorldNetworks>['networks'];
  readonly worldHandlers: ReturnType<typeof useWorldNetworks>['handlers'];
  readonly lanOccupants: ReturnType<typeof useHomeNetworks>['lanOccupants'];
}) {
  const {
    foreignFileSystems,
    foreignLanOccupantHostnames,
    foreignNetworks,
    ensureForeignReachable,
  } = useForeignNetworks();
  return (
    <MissionProvider state={missionState} usedPublicIps={usedPublicIps}>
      <FileSystemProvider
        localhostFileSystem={localhostResult.fileSystem}
        missionFileSystems={missionState.activeMission?.fileSystems}
        homeFileSystems={mergedHomeFileSystems}
        lanOccupantHostnames={lanOccupantHostnames}
        foreignFileSystems={foreignFileSystems}
        foreignLanOccupantHostnames={foreignLanOccupantHostnames}
      >
        <NetworkProvider
          missionNetworkConfig={missionState.activeMission?.networkConfig}
          missionMachines={missionState.activeMission?.machines}
          missionRouterMachine={
            missionState.activeMission ? missionState.activeMission.routerMachine : undefined
          }
          missionLayers={missionState.activeMission?.layers}
          homeNetwork={activeNetwork}
          foreignNetworks={foreignNetworks}
          ensureForeignReachable={ensureForeignReachable}
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
