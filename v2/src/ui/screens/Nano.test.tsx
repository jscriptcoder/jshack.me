import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Nano } from './Nano';
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

  it('focuses the textarea on open so the player can type immediately', () => {
    renderNano();

    expect(document.activeElement).toBe(editor());
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

  it('shows a permission error and keeps the buffer when a save is denied', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'permission_denied' }) as PatchResult);
    renderNano({ content: 'original', onSave });

    fireEvent.input(editor(), { target: { value: 'edited but not saveable' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(
      await screen.findByText('[ Error writing /home/alice/notes.txt: Permission denied ]'),
    ).toBeInTheDocument();
    // The edited buffer is intact (no data loss) and the editor stays open.
    expect(editor()).toHaveValue('edited but not saveable');
  });

  it('tells the player the file changed underneath them, and keeps the buffer', async () => {
    // Distinct wording from a denial or an I/O failure: nothing is wrong with the
    // player or the network — somebody else edited the file since it was opened.
    const onSave = vi.fn(async () => ({ ok: false, error: 'modified_since_open' }) as PatchResult);
    renderNano({ content: 'two forwards', onSave });

    fireEvent.input(editor(), { target: { value: 'two forwards\n# alice was here' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(
      await screen.findByText(
        '[ Error writing /home/alice/notes.txt: File was modified since you opened it ]',
      ),
    ).toBeInTheDocument();
    expect(editor()).toHaveValue('two forwards\n# alice was here');
  });

  it('reports an I/O error when the save fails on the network', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'network_error' }) as PatchResult);
    renderNano({ onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(
      await screen.findByText('[ Error writing /home/alice/notes.txt: I/O error ]'),
    ).toBeInTheDocument();
  });
});
