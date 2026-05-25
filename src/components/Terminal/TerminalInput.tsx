import { useRef, useEffect } from 'react';
import { useSession } from '../../session/SessionContext';

type PromptMode = 'username' | 'password';

type TerminalInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onHistoryUp: () => void;
  readonly onHistoryDown: () => void;
  readonly onTab: (cursorPosition: number) => void;
  readonly promptMode?: PromptMode;
  readonly externalInputRef?: React.RefObject<HTMLInputElement | null>;
};

export const TerminalInput = ({
  value,
  onChange,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
  onTab,
  promptMode,
  externalInputRef,
}: TerminalInputProps) => {
  const isPromptMode = promptMode !== undefined;
  const shouldMaskInput = promptMode === 'password';
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalRef;
  // Tracks whether the current value change was user-initiated (typing) vs programmatic
  // (autocomplete, history navigation). When programmatic, we reposition the cursor to
  // the end so the user doesn't see it jump to an unexpected position.
  const isUserInput = useRef(false);
  const { getPrompt } = useSession();

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  useEffect(() => {
    if (!isUserInput.current && inputRef.current) {
      inputRef.current.selectionStart = value.length;
      inputRef.current.selectionEnd = value.length;
    }
    isUserInput.current = false;
  }, [value, inputRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        onSubmit();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isPromptMode) onHistoryUp();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!isPromptMode) onHistoryDown();
        break;
      case 'Tab':
        e.preventDefault();
        if (!isPromptMode) onTab(inputRef.current?.selectionStart ?? value.length);
        break;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isUserInput.current = true;
    onChange(e.target.value);
  };

  const prompt = isPromptMode ? '' : getPrompt();

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      className="flex items-center p-4 border-t"
      style={{ borderColor: 'var(--theme-border)' }}
      onClick={handleContainerClick}
    >
      {prompt && (
        <span className="mr-2" style={{ color: 'var(--theme-text-dim)' }}>
          {prompt}
        </span>
      )}
      <input
        ref={inputRef}
        type={shouldMaskInput ? 'password' : 'text'}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent outline-none font-mono"
        style={{ color: 'var(--theme-text-bright)', caretColor: 'var(--theme-caret)' }}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        data-testid="terminal-input"
      />
    </div>
  );
};
