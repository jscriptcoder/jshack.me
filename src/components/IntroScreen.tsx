import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { GameState } from '../game/types';
import { generateGameSeed } from '../game/gameSeed';
import { computePlayerHostname } from '../homeNetworks/homeNetworkHelpers';
import { getIdentity } from '../identity';

type IntroScreenProps = {
  readonly existingGame: GameState | null;
  readonly onStart: (gameState: GameState, isNewGame: boolean) => void;
};

type Screen = 'menu' | 'new-game';

const RESERVED_USERNAMES = new Set(['root', 'guest', 'admin', 'daemon', 'bin', 'sys', 'nobody']);
const HOSTNAME_REGEX = /^[a-z0-9][-a-z0-9]*[a-z0-9]$|^[a-z0-9]$/;

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

const validateHostname = (value: string): string | null => {
  if (!value) return 'Enter a name for your workstation';
  if (value.length > 24) return 'Name must be 24 characters or less';
  if (!HOSTNAME_REGEX.test(value)) return 'Use letters, numbers, and hyphens only';
  return null;
};

const validateUsername = (value: string): string | null => {
  if (!value) return 'Enter a username';
  if (value.length > 24) return 'Username must be 24 characters or less';
  if (!/^[a-z][a-z0-9_-]*$/.test(value))
    return 'Start with a letter, then letters, numbers, hyphens, or underscores';
  if (RESERVED_USERNAMES.has(value)) return `"${value}" is a reserved system name`;
  return null;
};

const validatePassword = (value: string): string | null => {
  if (value.length < 4) return 'Password must be at least 4 characters';
  return null;
};

export const IntroScreen = ({ existingGame, onStart }: IntroScreenProps) => {
  const [screen, setScreen] = useState<Screen>('menu');
  const [hostnamePreview, setHostnamePreview] = useState('');
  const [usernamePreview, setUsernamePreview] = useState('');
  const [error, setError] = useState('');

  // Show the player's full hostname (workstationName + identity-derived
  // suffix) in the prompt preview so they see exactly what their prompt
  // will look like in-game. getIdentity() lazy-creates the keypair on
  // first call; calling it during intro is benign (the identity is just
  // a localStorage-stored Ed25519 keypair, no server-side commitment).
  const previewHostname = useMemo(() => {
    const trimmed = hostnamePreview.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) return '';
    return computePlayerHostname(trimmed, getIdentity());
  }, [hostnamePreview]);

  const hostnameRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (screen === 'new-game') {
      hostnameRef.current?.focus();
    }
  }, [screen]);

  const handleNewGame = useCallback(() => {
    setScreen('new-game');
    setHostnamePreview('');
    setUsernamePreview('');
    setError('');
  }, []);

  const handleContinue = useCallback(() => {
    if (existingGame) {
      onStart(existingGame, false);
    }
  }, [existingGame, onStart]);

  const handleSubmit = useCallback(() => {
    const hostnameRaw = hostnameRef.current?.value ?? '';
    const usernameRaw = usernameRef.current?.value ?? '';
    const password = passwordRef.current?.value ?? '';
    const confirmPassword = confirmPasswordRef.current?.value ?? '';

    const trimmedHostname = hostnameRaw.trim().toLowerCase().replace(/\s+/g, '-');
    const trimmedUsername = usernameRaw.trim().toLowerCase().replace(/\s+/g, '');

    const hostnameError = validateHostname(trimmedHostname);
    if (hostnameError) {
      setError(hostnameError);
      return;
    }

    const usernameError = validateUsername(trimmedUsername);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    onStart(
      {
        seed: generateGameSeed(),
        workstationName: trimmedHostname,
        username: trimmedUsername,
        rootPassword: password,
      },
      true,
    );
  }, [onStart]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
      if (e.key === 'Escape') setScreen('menu');
    },
    [handleSubmit],
  );

  const inputStyle = {
    borderColor: 'var(--theme-text-dim)',
    color: 'var(--theme-text-bright)',
    caretColor: 'var(--theme-caret)',
  };

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

      {/* Tagline — contextual per screen */}
      <p className="mb-8 text-base tracking-wide" style={{ color: 'var(--theme-text-dim)' }}>
        {screen === 'menu'
          ? 'Hack the network. Complete the contract. Get paid.'
          : 'Configure your workstation.'}
      </p>

      {/* Menu screen */}
      {screen === 'menu' && (
        <div className="flex max-w-lg flex-col items-center">
          <div
            className="mb-8 text-center text-base leading-relaxed"
            style={{ color: 'var(--theme-text-dim)' }}
          >
            <p className="mb-4">
              You are a freelance operator working from a personal workstation. Your WiFi card can
              reach several networks, each hiding its own machines. Crack in, explore, and install
              your toolkit.
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

      {/* New game form — all fields on one screen */}
      {screen === 'new-game' && (
        <div className="flex flex-col items-center gap-5">
          <div
            className="grid items-center gap-x-4 gap-y-3"
            style={{ gridTemplateColumns: 'auto 1fr' }}
          >
            {/* Hostname */}
            <label className="text-right text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              Workstation
            </label>
            <input
              ref={hostnameRef}
              type="text"
              defaultValue=""
              onChange={(e) => {
                setHostnamePreview(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="my-machine"
              maxLength={24}
              className="w-48 border-b bg-transparent px-1 py-0.5 font-mono text-sm outline-none"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
            />

            {/* Username */}
            <label className="text-right text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              Username
            </label>
            <input
              ref={usernameRef}
              type="text"
              defaultValue=""
              onChange={(e) => {
                setUsernamePreview(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="hacker"
              maxLength={24}
              className="w-48 border-b bg-transparent px-1 py-0.5 font-mono text-sm outline-none"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
            />

            {/* Root password */}
            <label className="text-right text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              Root password
            </label>
            <input
              ref={passwordRef}
              type="password"
              defaultValue=""
              onChange={() => setError('')}
              onKeyDown={handleKeyDown}
              placeholder="password"
              className="w-48 border-b bg-transparent px-1 py-0.5 font-mono text-sm outline-none"
              style={inputStyle}
              autoComplete="new-password"
              spellCheck={false}
            />

            {/* Confirm password */}
            <label className="text-right text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              Confirm password
            </label>
            <input
              ref={confirmPasswordRef}
              type="password"
              defaultValue=""
              onChange={() => setError('')}
              onKeyDown={handleKeyDown}
              placeholder="confirm password"
              className="w-48 border-b bg-transparent px-1 py-0.5 font-mono text-sm outline-none"
              style={inputStyle}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>

          {/* Preview */}
          {hostnamePreview.trim() && usernamePreview.trim() && (
            <p className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
              <span style={{ color: 'var(--theme-text)' }}>
                {usernamePreview.trim().toLowerCase()}@{previewHostname}
              </span>
              &gt;
            </p>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--theme-error)' }}>
              {error}
            </p>
          )}
          <div className="mt-1 flex gap-4">
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
