import { useState, useCallback, useRef, useEffect } from 'react';
import type { GameState } from '../game/types';
import { generateGameSeed } from '../game/gameSeed';

type IntroScreenProps = {
  readonly existingGame: GameState | null;
  readonly onStart: (gameState: GameState) => void;
};

const LOGO = `
     ██╗███████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗   ███╗   ███╗███████╗
     ██║██╔════╝██║  ██║██╔══██╗██╔════╝██║ ██╔╝   ████╗ ████║██╔════╝
     ██║███████╗███████║███████║██║     █████╔╝    ██╔████╔██║█████╗
██   ██║╚════██║██╔══██║██╔══██║██║     ██╔═██╗    ██║╚██╔╝██║██╔══╝
╚█████╔╝███████║██║  ██║██║  ██║╚██████╗██║  ██╗██╗██║ ╚═╝ ██║███████╗
 ╚════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝`.trim();

type Screen = 'menu' | 'new-game';

export const IntroScreen = ({ existingGame, onStart }: IntroScreenProps) => {
  const [screen, setScreen] = useState<Screen>('menu');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (screen === 'new-game') {
      inputRef.current?.focus();
    }
  }, [screen]);

  const handleNewGame = useCallback(() => {
    setScreen('new-game');
    setName('');
    setError('');
  }, []);

  const handleContinue = useCallback(() => {
    if (existingGame) {
      onStart(existingGame);
    }
  }, [existingGame, onStart]);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) {
      setError('Enter a name for your workstation');
      return;
    }
    if (trimmed.length > 24) {
      setError('Name must be 24 characters or less');
      return;
    }
    if (!/^[a-z0-9][-a-z0-9]*[a-z0-9]$|^[a-z0-9]$/.test(trimmed)) {
      setError('Use letters, numbers, and hyphens only');
      return;
    }
    onStart({ seed: generateGameSeed(), workstationName: trimmed });
  }, [name, onStart]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
      if (e.key === 'Escape') {
        setScreen('menu');
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-4 font-mono">
      <pre
        className="mb-8 text-center text-xs leading-tight sm:text-sm"
        style={{ color: 'var(--theme-text)' }}
      >
        {LOGO}
      </pre>

      {screen === 'menu' && (
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleNewGame}
            className="w-48 cursor-pointer border px-6 py-2 font-mono text-sm transition-colors"
            style={{
              borderColor: 'var(--theme-text-dim)',
              color: 'var(--theme-text)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--theme-text-dim)';
              e.currentTarget.style.color = 'var(--theme-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--theme-text)';
            }}
          >
            NEW GAME
          </button>
          {existingGame && (
            <button
              onClick={handleContinue}
              className="w-48 cursor-pointer border px-6 py-2 font-mono text-sm transition-colors"
              style={{
                borderColor: 'var(--theme-text-dim)',
                color: 'var(--theme-text)',
                backgroundColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--theme-text-dim)';
                e.currentTarget.style.color = 'var(--theme-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--theme-text)';
              }}
            >
              CONTINUE
            </button>
          )}
        </div>
      )}

      {screen === 'new-game' && (
        <div className="flex flex-col items-center gap-4">
          <label className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
            Name your workstation:
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              jshacker@
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="my-machine"
              maxLength={24}
              className="border-b bg-transparent px-1 py-0.5 font-mono text-sm outline-none"
              style={{
                borderColor: 'var(--theme-text-dim)',
                color: 'var(--theme-text-bright)',
                caretColor: 'var(--theme-caret)',
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              &gt;
            </span>
          </div>
          {error && (
            <p className="text-xs" style={{ color: 'var(--theme-error)' }}>
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-4">
            <button
              onClick={() => setScreen('menu')}
              className="cursor-pointer border px-4 py-1 font-mono text-xs transition-colors"
              style={{
                borderColor: 'var(--theme-text-dim)',
                color: 'var(--theme-text-dim)',
                backgroundColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--theme-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--theme-text-dim)';
              }}
            >
              BACK
            </button>
            <button
              onClick={handleSubmit}
              className="cursor-pointer border px-4 py-1 font-mono text-xs transition-colors"
              style={{
                borderColor: 'var(--theme-text-dim)',
                color: 'var(--theme-text)',
                backgroundColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--theme-text-dim)';
                e.currentTarget.style.color = 'var(--theme-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--theme-text)';
              }}
            >
              START
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
