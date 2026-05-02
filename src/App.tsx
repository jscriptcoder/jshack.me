import { useState, useCallback, useMemo } from 'react';
import { IntroScreen } from './components/IntroScreen';
import { BootScreen } from './components/BootScreen';
import { SessionProvider } from './session/SessionContext';
import { getCachedGameState, getDatabase, resetSessionCache } from './utils/storageCache';
import { saveGameState, clearAllData } from './utils/storage';
import { computePlayerHostname } from './homeNetworks/homeNetworkHelpers';
import { getIdentity } from './identity';
import { GameSession } from './game/GameSession';
import type { GameState } from './game/types';

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
