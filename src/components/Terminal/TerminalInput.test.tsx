import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalInput } from './TerminalInput';
import { SessionProvider } from '../../session/SessionContext';

// --- Test Wrapper ---

const renderWithSession = (ui: React.ReactElement) => {
  return render(
    <SessionProvider username="testuser" hostname="testuser-aabbccdd">
      {ui}
    </SessionProvider>,
  );
};

// --- Factory Functions ---

const createProps = (overrides?: Partial<Parameters<typeof TerminalInput>[0]>) => ({
  value: '',
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onHistoryUp: vi.fn(),
  onHistoryDown: vi.fn(),
  onTab: vi.fn(),
  ...overrides,
});

// --- Tests ---

describe('TerminalInput', () => {
  describe('prompt display', () => {
    it('should render prompt from session context', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      expect(screen.getByText('testuser@testuser>')).toBeInTheDocument();
    });

    it('should hide prompt in username prompt mode', () => {
      const props = createProps({ promptMode: 'username' });

      renderWithSession(<TerminalInput {...props} />);

      expect(screen.queryByText('testuser@testuser>')).not.toBeInTheDocument();
    });

    it('should hide prompt in password prompt mode', () => {
      const props = createProps({ promptMode: 'password' });

      renderWithSession(<TerminalInput {...props} />);

      expect(screen.queryByText('testuser@testuser>')).not.toBeInTheDocument();
    });

    it('should style prompt with theme dim color', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      const prompt = screen.getByText('testuser@testuser>');
      expect(prompt).toHaveStyle({ color: 'var(--theme-text-dim)' });
    });
  });

  describe('input value display', () => {
    it('should display the input value', () => {
      const props = createProps({ value: 'echo("hello")' });

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input');
      expect(input).toHaveValue('echo("hello")');
    });

    it('should use password type in password mode', () => {
      const props = createProps({ value: 'secret', promptMode: 'password' });

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input');
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveValue('secret');
    });

    it('should not mask value in username mode', () => {
      const props = createProps({ value: 'admin', promptMode: 'username' });

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input');
      expect(input).toHaveAttribute('type', 'text');
      expect(input).toHaveValue('admin');
    });

    it('should display empty input without errors', () => {
      const props = createProps({ value: '' });

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('');
    });
  });

  describe('onChange handling', () => {
    it('should call onChange when typing', async () => {
      const onChange = vi.fn();
      const props = createProps({ onChange });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'a');

      expect(onChange).toHaveBeenCalledWith('a');
    });
  });

  describe('keyboard handlers', () => {
    it('should call onSubmit on Enter', async () => {
      const onSubmit = vi.fn();
      const props = createProps({ onSubmit });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{Enter}');

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('should call onHistoryUp on ArrowUp', async () => {
      const onHistoryUp = vi.fn();
      const props = createProps({ onHistoryUp });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{ArrowUp}');

      expect(onHistoryUp).toHaveBeenCalledTimes(1);
    });

    it('should call onHistoryDown on ArrowDown', async () => {
      const onHistoryDown = vi.fn();
      const props = createProps({ onHistoryDown });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{ArrowDown}');

      expect(onHistoryDown).toHaveBeenCalledTimes(1);
    });

    it('should call onTab on Tab', async () => {
      const onTab = vi.fn();
      const props = createProps({ onTab });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{Tab}');

      expect(onTab).toHaveBeenCalledTimes(1);
    });
  });

  describe('prompt mode behavior', () => {
    it('should not call onHistoryUp in username prompt mode', async () => {
      const onHistoryUp = vi.fn();
      const props = createProps({ onHistoryUp, promptMode: 'username' });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{ArrowUp}');

      expect(onHistoryUp).not.toHaveBeenCalled();
    });

    it('should not call onHistoryDown in password prompt mode', async () => {
      const onHistoryDown = vi.fn();
      const props = createProps({ onHistoryDown, promptMode: 'password' });
      const user = userEvent.setup();

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input')!;
      await user.type(input, '{ArrowDown}');

      expect(onHistoryDown).not.toHaveBeenCalled();
    });

    it('should not call onTab in prompt mode', async () => {
      const onTab = vi.fn();
      const props = createProps({ onTab, promptMode: 'username' });
      const user = userEvent.setup();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '{Tab}');

      expect(onTab).not.toHaveBeenCalled();
    });

    it('should still call onSubmit in prompt mode', async () => {
      const onSubmit = vi.fn();
      const props = createProps({ onSubmit, promptMode: 'password' });
      const user = userEvent.setup();

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input')!;
      await user.type(input, '{Enter}');

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('cursor display', () => {
    it('should use theme caret color', () => {
      const props = createProps();

      const { container } = renderWithSession(<TerminalInput {...props} />);

      const input = container.querySelector('input');
      expect(input).toHaveStyle({ caretColor: 'var(--theme-caret)' });
    });
  });

  describe('input element attributes', () => {
    it('should have spellcheck disabled', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('spellcheck', 'false');
    });

    it('should have autocomplete disabled', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('autocomplete', 'off');
    });

    it('should have autocapitalize disabled', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('autocapitalize', 'off');
    });
  });

  describe('focus behavior', () => {
    it('should focus input on mount', () => {
      const props = createProps();

      renderWithSession(<TerminalInput {...props} />);

      const input = screen.getByRole('textbox');
      expect(input).toHaveFocus();
    });

    it('should focus input when container is clicked', async () => {
      const props = createProps();
      const user = userEvent.setup();

      const { container } = renderWithSession(<TerminalInput {...props} />);

      // Blur the input first
      const input = screen.getByRole('textbox');
      input.blur();

      // Click the container
      const containerDiv = container.querySelector('.flex.items-center');
      await user.click(containerDiv!);

      expect(input).toHaveFocus();
    });
  });
});
