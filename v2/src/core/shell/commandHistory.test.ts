import { describe, expect, it } from 'vitest';
import { idleNav, navigateDown, navigateUp } from './commandHistory';

/** A populated, multi-entry history shared by the navigation specs. Oldest
 *  first — index 0 is the earliest command, the last index the newest. */
const history = ['git status', 'ls /etc', 'cat /etc/passwd'] as const;

describe('idleNav', () => {
  it('starts not-navigating with no captured draft', () => {
    expect(idleNav()).toEqual({ index: -1, draft: '' });
  });
});

describe('navigateUp', () => {
  it('is a no-op against empty history, preserving the current input', () => {
    const step = navigateUp([], idleNav(), 'half-typed');

    expect(step.value).toBe('half-typed');
    expect(step.nav).toEqual(idleNav());
  });

  it('jumps to the newest command on the first press', () => {
    const step = navigateUp(history, idleNav(), '');

    expect(step.value).toBe('cat /etc/passwd');
    expect(step.nav.index).toBe(2);
  });

  it('captures the in-progress line as the draft when navigation begins', () => {
    const step = navigateUp(history, idleNav(), 'sudo rm -rf');

    expect(step.nav.draft).toBe('sudo rm -rf');
  });

  it('walks backward through older commands on successive presses', () => {
    const first = navigateUp(history, idleNav(), '');
    const second = navigateUp(history, first.nav, first.value);

    expect(second.value).toBe('ls /etc');
    expect(second.nav.index).toBe(1);
  });

  it('clamps at the oldest command and keeps the draft intact', () => {
    const atOldest = { index: 0, draft: 'my draft' } as const;
    const step = navigateUp(history, atOldest, 'ls /etc');

    expect(step.value).toBe('git status');
    expect(step.nav.index).toBe(0);
    expect(step.nav.draft).toBe('my draft');
  });

  it('does not re-capture the draft once already navigating', () => {
    const navigating = { index: 2, draft: 'original draft' } as const;
    const step = navigateUp(history, navigating, 'cat /etc/passwd');

    expect(step.nav.draft).toBe('original draft');
  });
});

describe('navigateDown', () => {
  it('is a no-op while not navigating, preserving the current input', () => {
    const step = navigateDown(history, idleNav(), 'fresh text');

    expect(step.value).toBe('fresh text');
    expect(step.nav).toEqual(idleNav());
  });

  it('walks forward toward newer commands', () => {
    const step = navigateDown(history, { index: 0, draft: '' }, 'git status');

    expect(step.value).toBe('ls /etc');
    expect(step.nav.index).toBe(1);
  });

  it('restores the captured draft when stepping past the newest command', () => {
    const atNewest = { index: 2, draft: 'sudo rm -rf' } as const;
    const step = navigateDown(history, atNewest, 'cat /etc/passwd');

    expect(step.value).toBe('sudo rm -rf');
    expect(step.nav).toEqual(idleNav());
  });
});

describe('full navigation cycle (bash-style draft restore)', () => {
  it('walks up to the oldest then back down, restoring the original draft', () => {
    const draft = 'half-typed command';

    const up1 = navigateUp(history, idleNav(), draft);
    const up2 = navigateUp(history, up1.nav, up1.value);
    const up3 = navigateUp(history, up2.nav, up2.value);
    expect([up1.value, up2.value, up3.value]).toEqual(['cat /etc/passwd', 'ls /etc', 'git status']);

    const down1 = navigateDown(history, up3.nav, up3.value);
    const down2 = navigateDown(history, down1.nav, down1.value);
    const down3 = navigateDown(history, down2.nav, down2.value);
    expect([down1.value, down2.value]).toEqual(['ls /etc', 'cat /etc/passwd']);

    // Down past the newest entry hands back exactly what was being typed.
    expect(down3.value).toBe(draft);
    expect(down3.nav).toEqual(idleNav());
  });
});
