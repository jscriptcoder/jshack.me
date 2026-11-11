import { describe, expect, it } from 'vitest';
import { withContractsList, type ActiveContract } from './contractsList.js';
import {
  dir,
  file,
  PASSWD_FILE,
  ROOT_DIR,
  ROOT_FILE,
  TRAVERSABLE_DIR,
} from '../generation/baseFs.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/**
 * The list a root finds on the boards' server: every active job beside who works it, for
 * which client, at which address and for how much, built from the table's rows. The client
 * and the pay are drawn from each number's terms, so the expected lines name what those
 * numbers' briefings name.
 */

const contract = (overrides: Partial<ActiveContract> = {}): ActiveContract => ({
  handle: 'neo',
  number: 796679,
  accepted_at: '2026-11-03T09:00:00.000+00:00',
  ...overrides,
});

/** The box as the boards' server is generated: `/etc/hireme` there, empty, beside the box's
 *  own `/etc/passwd`. */
const boardsBox = (): Directory =>
  dir(
    {
      etc: dir(
        {
          passwd: file('root:x:0:0:root:/root:/bin/bash\n', PASSWD_FILE),
          hireme: dir({}, ROOT_DIR),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

const contentAt = (tree: Directory, path: string): string | undefined => {
  const node = nodeAt(tree, path);
  return node?.kind === 'file' ? node.content : undefined;
};

describe("the boards' server /etc/hireme/contracts", () => {
  it('holds one handle, client handle, address and pay line per job, in the order they were accepted', () => {
    const tree = withContractsList(boardsBox(), [
      contract({ handle: 'trin', number: 2, accepted_at: '2026-11-03T10:00:00Z' }),
      contract({ handle: 'neo', number: 796679, accepted_at: '2026-11-03T09:00:00Z' }),
      contract({ handle: 'morph', number: 131330, accepted_at: '2026-11-03T11:00:00Z' }),
    ]);

    // Contracts 2 and 131330 are two-hop, so their lines carry a two-hop job's pay.
    expect(contentAt(tree, '/etc/hireme/contracts')).toBe(
      'neo bellwether-desk 195.12.40.7 1150\n' +
        'trin marlowe-ops 195.0.0.2 2550\n' +
        'morph greyline-jobs 195.2.1.2 2650\n',
    );
  });

  it('orders by the moment of accepting, not by how the time is written', () => {
    const tree = withContractsList(boardsBox(), [
      contract({ handle: 'late', accepted_at: '2026-11-03T10:00:00+00:00' }),
      contract({ handle: 'early', accepted_at: '2026-11-03T11:30:00+02:00' }),
    ]);

    expect(contentAt(tree, '/etc/hireme/contracts')).toMatch(/^early .*\nlate /);
  });

  it('is root-only and owned by root', () => {
    const node = nodeAt(withContractsList(boardsBox(), [contract()]), '/etc/hireme/contracts');

    expect(node).toMatchObject({ kind: 'file', owner: 'root', perms: ROOT_FILE });
  });

  it('is empty when no job is active', () => {
    expect(contentAt(withContractsList(boardsBox(), []), '/etc/hireme/contracts')).toBe('');
  });

  it('gives no line to a number that names no contract, since it has no address', () => {
    const tree = withContractsList(boardsBox(), [
      contract({ handle: 'ghost', number: 256 }),
      contract({ handle: 'neo', number: 796679 }),
    ]);

    expect(contentAt(tree, '/etc/hireme/contracts')).toBe('neo bellwether-desk 195.12.40.7 1150\n');
  });

  it('leaves the box it was given unchanged', () => {
    const box = boardsBox();

    withContractsList(box, [contract()]);

    expect(nodeAt(box, '/etc/hireme/contracts')).toBeUndefined();
  });
});
