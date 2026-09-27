import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { BRAILLE_FRAMES, FRAME_INTERVAL_MS, TerminalLoading } from './TerminalLoading';

describe('TerminalLoading', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the command the shell is busy with', () => {
    render(() => <TerminalLoading commandName="nmap" />);

    expect(screen.getByTestId('terminal-loading')).toHaveTextContent('nmap...');
  });

  it('advances one braille frame per interval', () => {
    vi.useFakeTimers();
    render(() => <TerminalLoading commandName="nmap" />);
    expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[0]);

    vi.advanceTimersByTime(FRAME_INTERVAL_MS);

    expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[1]);
  });

  it('holds a frame until its full interval has elapsed', () => {
    vi.useFakeTimers();
    render(() => <TerminalLoading commandName="nmap" />);

    vi.advanceTimersByTime(FRAME_INTERVAL_MS - 1);

    expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[0]);
  });

  it('cycles back to the first frame after the last one', () => {
    vi.useFakeTimers();
    render(() => <TerminalLoading commandName="nmap" />);

    vi.advanceTimersByTime(FRAME_INTERVAL_MS * BRAILLE_FRAMES.length);

    expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[0]);
  });

  it('spins bare when there is no command name to show', () => {
    render(() => <TerminalLoading commandName="" />);

    expect(screen.getByTestId('terminal-loading').textContent?.trim()).toBe(BRAILLE_FRAMES[0]);
  });

  it('stops its frame timer on unmount, so a finished command leaves nothing ticking', () => {
    vi.useFakeTimers();
    const { unmount } = render(() => <TerminalLoading commandName="nmap" />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
