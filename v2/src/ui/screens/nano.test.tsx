import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Nano } from './nano';
import { asAbsPath } from '../../core/types';
import type { PatchResult } from '../../core/commands/types';

const okSave = (): ((content: string) => Promise<PatchResult>) =>
  vi.fn(async () => ({ ok: true }) as PatchResult);

const renderNano = (overrides?: {
  content?: string;
  onSave?: (content: string) => Promise<PatchResult>;
  onExit?: () => void;
}) => {
  const onSave = overrides?.onSave ?? okSave();
  const onExit = overrides?.onExit ?? vi.fn();
  render(() => (
    <Nano
      path={asAbsPath('/home/alice/notes.txt')}
      content={overrides?.content ?? 'first line\nsecond line'}
      onSave={onSave}
      onExit={onExit}
    />
  ));
  return { onSave, onExit };
};

const editor = () => screen.getByRole('textbox', { name: /editor/i });

describe('Nano editor', () => {
  it('shows the path being edited and loads the file content into the buffer', () => {
    renderNano();

    expect(screen.getByText(/\/home\/alice\/notes\.txt/)).toBeInTheDocument();
    expect(editor()).toHaveValue('first line\nsecond line');
  });

  it('updates the buffer as the player types', () => {
    renderNano({ content: '' });

    fireEvent.input(editor(), { target: { value: 'typed text' } });

    expect(editor()).toHaveValue('typed text');
  });

  it('writes the buffer through onSave on Ctrl-O, shows a wrote-status, and stays open', async () => {
    const onSave = okSave();
    renderNano({ content: 'seed', onSave });

    fireEvent.input(editor(), { target: { value: 'one\ntwo\nthree' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith('one\ntwo\nthree');
    // nano reports the line count of what it wrote, and does NOT exit on Ctrl-O.
    expect(await screen.findByText('[ Wrote 3 lines ]')).toBeInTheDocument();
    expect(editor()).toBeInTheDocument();
  });

  it('exits via onExit on Ctrl-X', () => {
    const onExit = vi.fn();
    renderNano({ onExit });

    fireEvent.keyDown(editor(), { key: 'x', ctrlKey: true });

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
