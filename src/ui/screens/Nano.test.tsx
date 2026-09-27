import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Nano, type NanoProps } from './Nano';
import { asAbsPath } from '../../core/types';
import type { PatchResult } from '../../core/commands/types';

const okSave = (): NanoProps['onSave'] => vi.fn(async () => ({ ok: true }) as PatchResult);

/** The server's real answer to a stale save: refused while it names a base the
 *  machine no longer holds, accepted once the player forces it (a forced save
 *  carries no base at all, so there is nothing left to compare). Modelling both
 *  answers in one fake is what makes the `y` tests meaningful — the second write
 *  lands only BECAUSE it carried the option. */
const refusingSave = (): NanoProps['onSave'] =>
  vi.fn(
    async (_content: string, options?: { readonly overwriteUnseen?: boolean }) =>
      (options?.overwriteUnseen === true
        ? { ok: true }
        : { ok: false, error: 'modified_since_open' }) as PatchResult,
  );

const CONFIRM = 'File was modified since you opened it, continue saving? (y/n)';

const renderNano = (overrides?: {
  content?: string;
  onSave?: NanoProps['onSave'];
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
    // The report is the editor's status region, which is what lets the tests
    // below assert that NO status is showing without passing vacuously.
    expect(await screen.findByRole('status')).toHaveTextContent('[ Wrote 3 lines ]');
    expect(editor()).toBeInTheDocument();
  });

  it('exits via onExit on Ctrl-X', () => {
    const onExit = vi.fn();
    renderNano({ onExit });

    fireEvent.keyDown(editor(), { key: 'x', ctrlKey: true });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('treats only the chords as chords, so ordinary typing neither saves nor exits', () => {
    const onExit = vi.fn();
    const onSave = okSave();
    renderNano({ onSave, onExit });

    // The chord letter without the chord, then a chord nano does not bind.
    fireEvent.keyDown(editor(), { key: 'x' });
    fireEvent.keyDown(editor(), { key: 'o' });
    fireEvent.keyDown(editor(), { key: 'a', ctrlKey: true });

    expect(onExit).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens with no status message', () => {
    renderNano();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('counts an emptied buffer as zero lines written', async () => {
    const onSave = okSave();
    renderNano({ content: 'seed', onSave });

    fireEvent.input(editor(), { target: { value: '' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    // Not one line: an empty file has no lines, and `''.split('\n')` would claim one.
    expect(await screen.findByText('[ Wrote 0 lines ]')).toBeInTheDocument();
  });

  it('reports a lost session as a denial rather than a blank reason', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'no_session' }) as PatchResult);
    renderNano({ onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(
      await screen.findByText('[ Error writing /home/alice/notes.txt: Permission denied ]'),
    ).toBeInTheDocument();
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

  it('reports an I/O error when the save fails on the network', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'network_error' }) as PatchResult);
    renderNano({ onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(
      await screen.findByText('[ Error writing /home/alice/notes.txt: I/O error ]'),
    ).toBeInTheDocument();
  });
});

/**
 * A save refused because somebody else edited the file since it opened is not an
 * error to report — it is a question to ask, exactly as GNU nano asks it. The
 * player can still destroy the other occupant's edit; they just have to say so.
 */
describe('Nano overwrite confirm', () => {
  it('asks whether to continue, instead of reporting an error, when the file changed underneath', async () => {
    renderNano({ content: 'two forwards', onSave: refusingSave() });

    fireEvent.input(editor(), { target: { value: 'two forwards\n# alice was here' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(await screen.findByText(CONFIRM)).toBeInTheDocument();
    // The question REPLACES the error line — one message, not two saying the
    // same thing. (The denial and I/O cases above still report, so this
    // assertion cannot pass by the status line having gone missing entirely.)
    expect(screen.queryByText(/Error writing/)).not.toBeInTheDocument();
    expect(editor()).toHaveValue('two forwards\n# alice was here');
  });

  it('clears a stale write-status when the question comes up', async () => {
    // The player wrote once, kept editing, and the next write was refused. A
    // leftover "[ Wrote 1 lines ]" under the question would report that the
    // buffer being asked about had already been saved.
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ ok: true } as PatchResult)
      .mockResolvedValueOnce({ ok: false, error: 'modified_since_open' } as PatchResult);
    renderNano({ content: 'two forwards', onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText('[ Wrote 1 lines ]');

    fireEvent.input(editor(), { target: { value: 'two forwards\n# alice was here' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(await screen.findByText(CONFIRM)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['y', 'Y'])('overwrites deliberately when the player answers %s', async (key) => {
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    fireEvent.input(editor(), { target: { value: 'two forwards\n# alice was here' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key });

    // The SAME buffer goes out again, this time forced past the base check.
    expect(onSave).toHaveBeenNthCalledWith(2, 'two forwards\n# alice was here', {
      overwriteUnseen: true,
    });
    expect(await screen.findByText('[ Wrote 2 lines ]')).toBeInTheDocument();
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
  });

  it.each(['n', 'N', 'Escape'])('abandons the save when the player answers %s', async (key) => {
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    fireEvent.input(editor(), { target: { value: 'two forwards\n# alice was here' } });
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key });

    // Nothing further is written and the buffer survives intact, so the player
    // can keep editing or walk away without losing the work.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    expect(editor()).toHaveValue('two forwards\n# alice was here');
  });

  it('abandons the save on Ctrl-C', async () => {
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key: 'c', ctrlKey: true });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
  });

  it('keeps asking when the player presses a key that is not an answer', async () => {
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key: 'q' });

    expect(screen.getByText(CONFIRM)).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('takes the buffer out of the player’s hands while the question stands', async () => {
    // The question owns the keyboard, so a stray keystroke cannot silently edit
    // the buffer that is about to be written. Asserted on the textarea's own
    // read-only state rather than by typing and checking for no change: jsdom
    // does not perform the browser's text insertion, so a type-and-compare test
    // would pass even with no guard at all.
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    expect(editor()).not.toHaveAttribute('readonly');

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);

    expect(editor()).toHaveAttribute('readonly');

    fireEvent.keyDown(editor(), { key: 'n' });

    expect(editor()).not.toHaveAttribute('readonly');
  });

  it('does not exit on Ctrl-X while the question stands', async () => {
    const onExit = vi.fn();
    renderNano({ content: 'two forwards', onSave: refusingSave(), onExit });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key: 'x', ctrlKey: true });

    // Answer first — otherwise ^X would discard the buffer while the player
    // still believes they are being asked about it.
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText(CONFIRM)).toBeInTheDocument();
  });

  it('does not re-fire the save on Ctrl-O while the question stands', async () => {
    const onSave = refusingSave();
    renderNano({ content: 'two forwards', onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText(CONFIRM)).toBeInTheDocument();
  });

  it('reports a forced save that fails for a different reason through the status line', async () => {
    // Forcing past the base check does not make the write privileged: a denial
    // is still a denial, and it reads as one rather than re-asking the question.
    const onSave = vi.fn(async (_content: string, options?: { readonly overwriteUnseen?: boolean }) =>
      (options?.overwriteUnseen === true
        ? { ok: false, error: 'permission_denied' }
        : { ok: false, error: 'modified_since_open' }) as PatchResult,
    );
    renderNano({ content: 'two forwards', onSave });

    fireEvent.keyDown(editor(), { key: 'o', ctrlKey: true });
    await screen.findByText(CONFIRM);
    fireEvent.keyDown(editor(), { key: 'y' });

    expect(
      await screen.findByText('[ Error writing /home/alice/notes.txt: Permission denied ]'),
    ).toBeInTheDocument();
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
  });
});
