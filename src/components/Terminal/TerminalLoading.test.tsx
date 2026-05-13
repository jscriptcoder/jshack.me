import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TerminalLoading, BRAILLE_FRAMES, FRAME_INTERVAL_MS } from './TerminalLoading';

describe('TerminalLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('frame rendering', () => {
    it('should render the first braille frame initially', () => {
      render(<TerminalLoading commandName="nmap" />);

      expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[0]);
    });

    it('should advance to the next frame after the interval', () => {
      render(<TerminalLoading commandName="nmap" />);

      act(() => {
        vi.advanceTimersByTime(FRAME_INTERVAL_MS);
      });

      expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[1]);
    });

    it('should wrap around to the first frame after the last one', () => {
      render(<TerminalLoading commandName="nmap" />);

      act(() => {
        vi.advanceTimersByTime(FRAME_INTERVAL_MS * BRAILLE_FRAMES.length);
      });

      expect(screen.getByTestId('terminal-loading')).toHaveTextContent(BRAILLE_FRAMES[0]);
    });
  });

  describe('command name display', () => {
    it('should render the command name followed by an ellipsis', () => {
      render(<TerminalLoading commandName="nmap" />);

      expect(screen.getByTestId('terminal-loading')).toHaveTextContent('nmap...');
    });

    it('should render a different command name', () => {
      render(<TerminalLoading commandName="msfconsole" />);

      expect(screen.getByTestId('terminal-loading')).toHaveTextContent('msfconsole...');
    });

    it('should render only the spinner when no command name is given', () => {
      render(<TerminalLoading commandName="" />);

      const node = screen.getByTestId('terminal-loading');
      expect(node.textContent?.trim()).toBe(BRAILLE_FRAMES[0]);
    });
  });

  describe('layout parity with TerminalInput', () => {
    it('should use the same outer bar classes as TerminalInput', () => {
      const { container } = render(<TerminalLoading commandName="nmap" />);

      const bar = container.firstChild as HTMLElement;
      expect(bar.className).toContain('flex');
      expect(bar.className).toContain('items-center');
      expect(bar.className).toContain('p-4');
      expect(bar.className).toContain('border-t');
    });
  });

  describe('cleanup', () => {
    it('should clear the interval on unmount', () => {
      const { unmount } = render(<TerminalLoading commandName="nmap" />);

      unmount();

      // Advancing time after unmount must not throw or schedule further state updates.
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(FRAME_INTERVAL_MS * 5);
        });
      }).not.toThrow();
    });
  });
});
