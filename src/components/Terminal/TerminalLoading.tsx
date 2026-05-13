import { useEffect, useState } from 'react';

export const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const FRAME_INTERVAL_MS = 80;

type TerminalLoadingProps = {
  readonly commandName: string;
};

export const TerminalLoading = ({ commandName }: TerminalLoadingProps) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % BRAILLE_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const label = commandName
    ? `${BRAILLE_FRAMES[frameIndex]} ${commandName}...`
    : BRAILLE_FRAMES[frameIndex];

  return (
    <div
      className="flex items-center p-4 border-t"
      style={{ borderColor: 'var(--theme-border)' }}
      data-testid="terminal-loading"
      aria-live="polite"
    >
      <span style={{ color: 'var(--theme-text-dim)' }}>{label}</span>
    </div>
  );
};
