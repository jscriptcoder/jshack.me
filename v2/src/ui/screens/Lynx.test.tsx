import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Lynx } from './Lynx';

const PAGE =
  '<html><body><h1>db-01</h1><p>Server operational. Build 4.2.1</p><!-- TODO: remove debug endpoints --></body></html>';

const renderLynx = (overrides?: { content?: string; onExit?: () => void }) => {
  const onExit = overrides?.onExit ?? vi.fn();
  render(() => (
    <Lynx url="http://192.168.1.5/" content={overrides?.content ?? PAGE} onExit={onExit} />
  ));
  return { onExit };
};

const browser = () => screen.getByRole('main');

describe('Lynx browser screen', () => {
  it('shows the address being read', () => {
    renderLynx();

    expect(screen.getByText(/http:\/\/192\.168\.1\.5\//)).toBeInTheDocument();
  });

  it('shows the page as text rather than as markup', () => {
    renderLynx();

    expect(screen.getByText('db-01')).toBeInTheDocument();
    expect(screen.getByText('Server operational. Build 4.2.1')).toBeInTheDocument();
  });

  it('leaves the comment behind — reading a page is not reading its source', () => {
    renderLynx();

    expect(screen.queryByText(/TODO/)).not.toBeInTheDocument();
  });

  it('takes the keyboard on open, so quitting needs no click first', () => {
    renderLynx();

    expect(document.activeElement).toBe(browser());
  });

  // Real lynx quits on either case, and the editor beside it already takes `y`
  // and `Y` for the same answer — a held shift should not strand a reader.
  it.each(['q', 'Q'])('quits on %s', (key) => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key });

    expect(onExit).toHaveBeenCalled();
  });

  it('quits on Escape', () => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key: 'Escape' });

    expect(onExit).toHaveBeenCalled();
  });

  it('stays open on any other key', () => {
    const { onExit } = renderLynx();

    fireEvent.keyDown(browser(), { key: 'j' });
    fireEvent.keyDown(browser(), { key: 'Enter' });

    expect(onExit).not.toHaveBeenCalled();
  });

  it('shows an empty page as an empty screen rather than failing to open', () => {
    renderLynx({ content: '<html><body></body></html>' });

    expect(browser()).toBeInTheDocument();
  });
});
