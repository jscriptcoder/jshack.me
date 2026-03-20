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
      <div className="mb-3 text-center">
        <h1
          className="text-5xl font-bold tracking-widest sm:text-6xl"
          style={{ color: 'var(--theme-text-bright)' }}
        >
          JSHACK.ME
        </h1>
        <div className="mt-2 h-px w-full" style={{ backgroundColor: 'var(--theme-text-dim)' }} />
      </div>

      {/* Tagline */}
      <p className="mb-8 text-base tracking-wide" style={{ color: 'var(--theme-text-dim)' }}>
        Hack the network. Complete the contract. Get paid.
      </p>

      {/* Intro text + buttons — only on menu screen */}
      {screen === 'menu' && (
        <div className="flex max-w-lg flex-col items-center">
          <div
            className="mb-8 text-center text-base leading-relaxed"
            style={{ color: 'var(--theme-text-dim)' }}
          >
            <p className="mb-4">
              You are <span style={{ color: 'var(--theme-text)' }}>jshacker</span>, a freelance
              operator working from a personal workstation. Your WiFi card can reach several
              networks, each hiding its own machines. Crack in, explore, and install your toolkit.
            </p>
            <p className="mb-4">
              When you are ready, browse the darknet marketplace for contracts. Every job is a new
              target network. Find what the client wants, deliver the proof, and move on to the next
              one.
            </p>
            <p>Everything runs in your browser. No server, no tracking.</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <MenuButton onClick={handleNewGame}>NEW GAME</MenuButton>
            {existingGame && <MenuButton onClick={handleContinue}>CONTINUE</MenuButton>}
          </div>
        </div>
      )}

      {screen === 'new-game' && (
        <div className="flex flex-col items-center gap-4">
          <label className="text-base" style={{ color: 'var(--theme-text-dim)' }}>
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
