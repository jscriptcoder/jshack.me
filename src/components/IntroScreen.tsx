import { useState, useCallback, useRef, useEffect } from 'react';
import type { GameState } from '../game/types';
import { generateGameSeed } from '../game/gameSeed';

type IntroScreenProps = {
  readonly existingGame: GameState | null;
  readonly onStart: (gameState: GameState) => void;
};

type Screen = 'menu' | 'new-game';

const MenuButton = ({
  onClick,
  children,
  dim,
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly dim?: boolean;
}) => (
  <button
    onClick={onClick}
    className="w-48 cursor-pointer border px-6 py-2 font-mono text-sm transition-colors"
    style={{
      borderColor: 'var(--theme-text-dim)',
      color: dim ? 'var(--theme-text-dim)' : 'var(--theme-text)',
      backgroundColor: 'transparent',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = 'var(--theme-text-dim)';
      e.currentTarget.style.color = 'var(--theme-bg)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = 'transparent';
      e.currentTarget.style.color = dim ? 'var(--theme-text-dim)' : 'var(--theme-text)';
    }}
  >
    {children}
  </button>
);

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
      {/* Logo */}
      <div className="mb-2 text-center">
        <h1
          className="text-4xl font-bold tracking-widest sm:text-5xl"
          style={{ color: 'var(--theme-text-bright)' }}
        >
          JSHACK.ME
        </h1>
        <div
          className="mx-auto mt-1 h-px w-48"
          style={{ backgroundColor: 'var(--theme-text-dim)' }}
        />
      </div>

      {/* Tagline */}
      <p className="mb-6 text-sm tracking-wide" style={{ color: 'var(--theme-text-dim)' }}>
        hack the network. complete the contract. get paid.
      </p>

      {/* Intro text — only on menu screen */}
      {screen === 'menu' && (
        <div
          className="mb-8 max-w-md text-center text-sm leading-relaxed"
          style={{ color: 'var(--theme-text-dim)' }}
        >
          <p className="mb-3">
            You are <span style={{ color: 'var(--theme-text)' }}>jshacker</span> — a freelance
            operator working from a personal workstation. Your WiFi card can reach several networks,
            each hiding its own machines. Crack in, explore, and install your toolkit.
          </p>
          <p>
            When you are ready, browse the darknet marketplace for contracts. Every job is a new
            target network. Find what the client wants, deliver the proof, and move on to the next
            one.
          </p>
        </div>
      )}

      {screen === 'menu' && (
        <div className="flex flex-col items-center gap-3">
          <MenuButton onClick={handleNewGame}>NEW GAME</MenuButton>
          {existingGame && <MenuButton onClick={handleContinue}>CONTINUE</MenuButton>}
          <p className="mt-3 text-xs" style={{ color: 'var(--theme-text-dim)' }}>
            everything runs in your browser. no server, no tracking.
          </p>
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
            <MenuButton onClick={() => setScreen('menu')} dim>
              BACK
            </MenuButton>
            <MenuButton onClick={handleSubmit}>START</MenuButton>
          </div>
        </div>
      )}
    </div>
  );
};
