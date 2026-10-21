import { describe, expect, it } from 'vitest';
import {
  networkByPublicIp,
  withBoardsList,
  type Board,
  type FindBoardHandle,
} from './boards.js';
import { computeApGatewayId } from '../identity/router.js';
import { publicAddress } from '../generation/world.js';
import { dir, file, PASSWD_FILE, ROOT_DIR, ROOT_FILE, TRAVERSABLE_DIR } from '../generation/baseFs.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/**
 * Which network stands at a public address, now that some addresses are stored rather than
 * derived. Every address in the contractor boards' block that a handle holds is the boards'
 * server; one nobody holds is nothing, as an empty address anywhere is; every other
 * address is wherever the world puts it, without the boards' table being read.
 */

const BOARD_SERVER = {
  router_machine_id: computeApGatewayId('boards.hireme.io'),
  essid: 'boards.hireme.io',
};

/** A boards table holding `held`, by address, that records each address it was asked. */
const boardsHolding = (
  held: Readonly<Record<string, string>>,
): { readonly find: FindBoardHandle; readonly asked: string[] } => {
  const asked: string[] = [];
  const find: FindBoardHandle = async (address) => {
    asked.push(address);
    const handle = held[address];
    return { data: handle === undefined ? null : { handle }, error: null };
  };
  return { find, asked };
};

describe('networkByPublicIp', () => {
  it("reaches the boards' server at an address a handle holds", async () => {
    const boards = boardsHolding({ '194.12.40.7': 'neo' });

    const found = await networkByPublicIp(boards.find)('194.12.40.7');

    expect(found).toEqual({ data: BOARD_SERVER, error: null });
    expect(boards.asked).toEqual(['194.12.40.7']);
  });

  it('reaches the same one server at every held address', async () => {
    const boards = boardsHolding({ '194.12.40.7': 'neo', '194.200.3.254': 'trinity' });
    const lookup = networkByPublicIp(boards.find);

    expect(await lookup('194.200.3.254')).toEqual({ data: BOARD_SERVER, error: null });
    expect(await lookup('194.12.40.7')).toEqual({ data: BOARD_SERVER, error: null });
  });

  it('finds nothing at an address in the block that nobody holds', async () => {
    const boards = boardsHolding({ '194.12.40.7': 'neo' });

    expect(await networkByPublicIp(boards.find)('194.12.40.8')).toEqual({
      data: null,
      error: null,
    });
  });

  it('passes on a failed read of the boards, never guessing either way', async () => {
    const failure = new Error('boards unreadable');
    const lookup = networkByPublicIp(async () => ({ data: null, error: failure }));

    expect(await lookup('194.12.40.7')).toEqual({ data: null, error: failure });
  });

  it('answers every other address from the world, without reading the boards', async () => {
    const boards = boardsHolding({ '194.12.40.7': 'neo' });
    const lookup = networkByPublicIp(boards.find);
    const hireme = publicAddress('hireme.io') ?? '';

    expect(await lookup(hireme)).toEqual({
      data: { router_machine_id: computeApGatewayId('hireme.io'), essid: 'hireme.io' },
      error: null,
    });
    expect(await lookup('87.1.0.1')).toEqual({ data: null, error: null });
    expect(boards.asked).toEqual([]);
  });
});

/**
 * The list a root finds on the boards' server: every board's handle beside its address, built
 * from the table's rows. The rows are made here; the file is the behaviour.
 */

const board = (overrides: Partial<Board> = {}): Board => ({
  handle: 'neo',
  address: '194.12.40.7',
  applied_at: '2026-10-20T09:00:00.000+00:00',
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

describe("the boards' server /etc/hireme/boards", () => {
  it('holds one handle and address line per board, in the order they were applied for', () => {
    const tree = withBoardsList(boardsBox(), [
      board({ handle: 'trin', address: '194.200.3.254', applied_at: '2026-10-20T10:00:00Z' }),
      board({ handle: 'neo', address: '194.12.40.7', applied_at: '2026-10-20T09:00:00Z' }),
      board({ handle: 'morph', address: '194.0.0.2', applied_at: '2026-10-20T11:00:00Z' }),
    ]);

    expect(contentAt(tree, '/etc/hireme/boards')).toBe(
      'neo 194.12.40.7\ntrin 194.200.3.254\nmorph 194.0.0.2\n',
    );
  });

  it('orders by the moment of applying, not by how the time is written', () => {
    const tree = withBoardsList(boardsBox(), [
      board({ handle: 'late', applied_at: '2026-10-20T10:00:00+00:00' }),
      board({ handle: 'early', applied_at: '2026-10-20T11:30:00+02:00' }),
    ]);

    expect(contentAt(tree, '/etc/hireme/boards')).toMatch(/^early .*\nlate /);
  });

  it('is root-only and owned by root', () => {
    const node = nodeAt(withBoardsList(boardsBox(), [board()]), '/etc/hireme/boards');

    expect(node).toMatchObject({ kind: 'file', owner: 'root', perms: ROOT_FILE });
  });

  it('is empty when nobody has applied', () => {
    expect(contentAt(withBoardsList(boardsBox(), []), '/etc/hireme/boards')).toBe('');
  });

  it('leaves the box it was given unchanged', () => {
    const box = boardsBox();

    withBoardsList(box, [board()]);

    expect(nodeAt(box, '/etc/hireme/boards')).toBeUndefined();
  });
});
