import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type { PermissionResult } from '../../filesystem/types';

type NanoEditorProps = {
  readonly filePath: string;
  readonly initialContent: string;
  readonly isNewFile: boolean;
  readonly onSave: (content: string) => PermissionResult;
  readonly onCreate: (content: string) => PermissionResult;
  readonly onClose: () => void;
};

export const NanoEditor = ({
  filePath,
  initialContent,
  isNewFile,
  onSave,
  onCreate,
  onClose,
}: NanoEditorProps) => {
  const [content, setContent] = useState(initialContent);
  const [modified, setModified] = useState(false);
  const [fileCreated, setFileCreated] = useState(!isNewFile);
  const [exitPrompt, setExitPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Deferred cursor positioning: when Tab inserts spaces, React re-renders the textarea
  // with new content, which resets the cursor to the end. We store the desired position
  // in this ref, then restore it in useLayoutEffect (which runs after DOM update but
  // before paint) so the cursor never visibly jumps.
  const pendingCursorPos = useRef<number | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (pendingCursorPos.current !== null && textareaRef.current) {
      textareaRef.current.selectionStart = pendingCursorPos.current;
      textareaRef.current.selectionEnd = pendingCursorPos.current;
      pendingCursorPos.current = null;
    }
  });

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const updateCursorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, pos);
    const lines = textBefore.split('\n');
    setCursorLine(lines.length);
    setCursorCol((lines[lines.length - 1]?.length ?? 0) + 1);
  }, []);

  const saveFile = useCallback((): boolean => {
    const result = fileCreated ? onSave(content) : onCreate(content);
    if (result.allowed) {
      if (!fileCreated) setFileCreated(true);
      setModified(false);
      const lineCount = content.split('\n').length;
      setStatusMessage(`[ Wrote ${lineCount} line${lineCount !== 1 ? 's' : ''} ]`);
      return true;
    }
    setStatusMessage(`[ Error: ${result.error ?? 'unknown error'} ]`);
    return false;
  }, [content, fileCreated, onSave, onCreate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (exitPrompt) {
        e.preventDefault();
        const key = e.key.toLowerCase();
        if (key === 'y') {
          if (saveFile()) {
            onClose();
          } else {
            setExitPrompt(false);
          }
        } else if (key === 'n') {
          onClose();
        } else if (key === 'c' || e.key === 'Escape') {
          setExitPrompt(false);
          textareaRef.current?.focus();
        }
        return;
      }

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveFile();
        return;
      }

      if ((e.ctrlKey && e.key === 'x') || e.key === 'Escape') {
        e.preventDefault();
        if (modified) {
          setExitPrompt(true);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        const before = content.substring(0, start);
        const after = content.substring(end);
        setContent(before + '  ' + after);
        if (!modified) setModified(true);
        pendingCursorPos.current = start + 2;
        return;
      }
    },
    [exitPrompt, content, modified, saveFile, onClose],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      if (!modified) setModified(true);
      setTimeout(updateCursorPosition, 0);
    },
    [modified, updateCursorPosition],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col font-mono text-sm"
      style={{ backgroundColor: 'var(--theme-bg)' }}
    >
      {/* Title bar */}
      <div
        className="px-4 py-0.5 flex justify-center items-center gap-4 text-xs"
        style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-accent-text)' }}
      >
        <span>GNU nano 7.2</span>
        <span className="font-bold">{filePath}</span>
        {modified && <span>Modified</span>}
      </div>

      {/* Editor area */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={updateCursorPosition}
        onClick={updateCursorPosition}
        className="flex-1 p-2 resize-none outline-none leading-5"
        style={{
          backgroundColor: 'var(--theme-bg)',
          color: 'var(--theme-text-bright)',
          caretColor: 'var(--theme-caret)',
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        data-testid="nano-editor-textarea"
      />

      {/* Status bar */}
      <div className="px-4 py-0.5 text-xs flex justify-between">
        <span
          data-testid="nano-status"
          style={{
            color: exitPrompt ? 'var(--theme-text-bright)' : 'var(--theme-text-dim)',
            fontWeight: exitPrompt ? 'bold' : 'normal',
          }}
        >
          {exitPrompt
            ? 'Save modified buffer?'
            : statusMessage || (!fileCreated ? '[ New File ]' : '')}
        </span>
        {!exitPrompt && (
          <span style={{ color: 'var(--theme-text-dim)' }}>
            Ln {cursorLine}, Col {cursorCol}
          </span>
        )}
      </div>

      {/* Help bar */}
      <div
        className="px-4 py-0.5 text-xs flex gap-6"
        style={{ backgroundColor: 'var(--theme-border)', color: 'var(--theme-text-dim)' }}
      >
        {exitPrompt ? (
          <>
            <span>
              <span
                className="px-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent-text)',
                }}
              >
                Y
              </span>{' '}
              Yes
            </span>
            <span>
              <span
                className="px-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent-text)',
                }}
              >
                N
              </span>{' '}
              No
            </span>
            <span>
              <span
                className="px-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent-text)',
                }}
              >
                C
              </span>{' '}
              Cancel
            </span>
          </>
        ) : (
          <>
            <span>
              <span
                className="px-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent-text)',
                }}
              >
                ^S
              </span>{' '}
              Save
            </span>
            <span>
              <span
                className="px-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent)',
                  color: 'var(--theme-accent-text)',
                }}
              >
                ^X
              </span>{' '}
              Exit
            </span>
          </>
        )}
      </div>
    </div>
  );
};
