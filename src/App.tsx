import { Terminal } from './components/Terminal';
import { SessionProvider } from './session/SessionContext';
import { FileSystemProvider } from './filesystem';
import { NetworkProvider } from './network';
import { MissionProvider, useMissionState } from './mission';

function App() {
  const missionState = useMissionState();

  return (
    <SessionProvider>
      <MissionProvider state={missionState}>
        <FileSystemProvider missionFileSystems={missionState.activeMission?.fileSystems}>
          <NetworkProvider missionNetworkConfig={missionState.activeMission?.networkConfig}>
            <Terminal />
          </NetworkProvider>
        </FileSystemProvider>
      </MissionProvider>
    </SessionProvider>
  );
}

export default App;
