import { useRef, useEffect } from 'react';
import { useSession } from '../../session/SessionContext';

type PromptMode = 'username' | 'password';

type TerminalInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onHistoryUp: () => void;
  readonly onHistoryDown: () => void;
  readonly onTab: () => void;
  readonly promptMode?: PromptMode;
  readonly disabled?: boolean;
  readonly externalInputRef?: React.RefObject<HTMLInputElement>;
};

export const TerminalInput = ({
  value,
  onChange,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
  onTab,
  promptMode,
  disabled = false,
  externalInputRef,
}: TerminalInputProps) => {
  const isPromptMode = promptMode !== undefined;
  const shouldMaskInput = promptMode === 'password';
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalRef;
  const isUserInput = useRef(false);
  const { getPrompt } = useSession();

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (!isUserInput.current && inputRef.current) {
      inputRef.current.selectionStart = value.length;
      inputRef.current.selectionEnd = value.length;
    }
    isUserInput.current = false;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
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
        if (!isPromptMode) onTab();
        break;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    isUserInput.current = true;
    onChange(e.target.value);
  };

  const prompt = isPromptMode ? '' : getPrompt();

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      className="flex items-center p-4 border-t border-amber-900/30"
      onClick={handleContainerClick}
    >
      {prompt && <span className="text-amber-300 mr-2">{prompt}</span>}
      <input
        ref={inputRef}
        type={shouldMaskInput ? 'password' : 'text'}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent text-amber-400 caret-amber-400 outline-none font-mono"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        disabled={disabled}
      />
    </div>
  );
};
