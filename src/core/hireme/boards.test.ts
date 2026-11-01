import { describe, expect, it } from 'vitest';
import {
  networkByPublicIp,
  withBoardsList,
  type Board,
  type FindBoardHandle,
  type FindMissionState,
} from './boards.js';
import { computeApGatewayId } from '../identity/router.js';
import { publicAddress } from '../generation/world.js';
import { missionEssid } from '../missions/missionNetwork.js';
import { dir, file, PASSWD_FILE, ROOT_DIR, ROOT_FILE, TRAVERSABLE_DIR } from '../generation/baseFs.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/**
 * Which network stands at a public address, now that some addresses are stored rather than
 * derived. Every address in the contractor boards' block that a handle holds is the boards'
 * server; a contract's 195 address answers as its network only once a contractor has
 * accepted it (and for good after that); one nobody holds is nothing, as an empty address
 * anywhere is; every other address is wherever the world puts it, without either table being
 * read.
 */

const BOARD_SERVER = {
  router_machine_id: computeApGatewayId('boards.hireme.io'),
  essid: 'boards.hireme.io',
};

// A contract number and the 195 address it writes to (195.1.2.3 = 1·65536 + 2·256 + 3), its
// last octet a host octet so it names a contract; and a 195 address whose last octet is not a
// host octet, so it names none.
const MISSION_NUMBER = 66051;
const MISSION_ADDRESS = '195.1.2.3';
const NON_CONTRACT_195 = '195.1.2.0';

const missionNetwork = (missionNumber: number) => ({
  router_machine_id: computeApGatewayId(missionEssid(missionNumber)),
  essid: missionEssid(missionNumber),
});

/** The two injected lookups, each recording what it was asked, over a given set of held
 *  board addresses and contract rows (by number → state). A lookup that is never set reads
 *  nothing; a `*Error` makes its read fail. */
const lookupOver = (
  options: {
    readonly boards?: Readonly<Record<string, string>>;
    readonly missions?: Readonly<Record<number, string>>;
    readonly boardsError?: unknown;
    readonly missionsError?: unknown;
  } = {},
): {
  readonly lookup: ReturnType<typeof networkByPublicIp>;
  readonly askedBoards: readonly string[];
  readonly askedMissions: readonly number[];
} => {
  const askedBoards: string[] = [];
  const askedMissions: number[] = [];
  const findBoardHandle: FindBoardHandle = async (address) => {
    askedBoards.push(address);
    if (options.boardsError !== undefined) return { data: null, error: options.boardsError };
    const handle = options.boards?.[address];
    return { data: handle === undefined ? null : { handle }, error: null };
  };
  const findMissionState: FindMissionState = async (missionNumber) => {
    askedMissions.push(missionNumber);
    if (options.missionsError !== undefined) return { data: null, error: options.missionsError };
    const state = options.missions?.[missionNumber];
    return { data: state === undefined ? null : { state }, error: null };
  };
  return { lookup: networkByPublicIp({ findBoardHandle, findMissionState }), askedBoards, askedMissions };
};

describe('networkByPublicIp', () => {
  it("reaches the boards' server at an address a handle holds", async () => {
    const boards = lookupOver({ boards: { '194.12.40.7': 'neo' } });

    const found = await boards.lookup('194.12.40.7');

    expect(found).toEqual({ data: BOARD_SERVER, error: null });
    expect(boards.askedBoards).toEqual(['194.12.40.7']);
  });

  it('reaches the same one server at every held address', async () => {
    const boards = lookupOver({ boards: { '194.12.40.7': 'neo', '194.200.3.254': 'trinity' } });

    expect(await boards.lookup('194.200.3.254')).toEqual({ data: BOARD_SERVER, error: null });
    expect(await boards.lookup('194.12.40.7')).toEqual({ data: BOARD_SERVER, error: null });
  });

  it('finds nothing at an address in the block that nobody holds', async () => {
    const boards = lookupOver({ boards: { '194.12.40.7': 'neo' } });

    expect(await boards.lookup('194.12.40.8')).toEqual({ data: null, error: null });
  });

  it('passes on a failed read of the boards, never guessing either way', async () => {
    const failure = new Error('boards unreadable');
    const boards = lookupOver({ boardsError: failure });

    expect(await boards.lookup('194.12.40.7')).toEqual({ data: null, error: failure });
  });

  it('answers every other address from the world, without reading either table', async () => {
    const boards = lookupOver({ boards: { '194.12.40.7': 'neo' } });
    const hireme = publicAddress('hireme.io') ?? '';

    expect(await boards.lookup(hireme)).toEqual({
      data: { router_machine_id: computeApGatewayId('hireme.io'), essid: 'hireme.io' },
      error: null,
    });
    expect(await boards.lookup('87.1.0.1')).toEqual({ data: null, error: null });
    expect(boards.askedBoards).toEqual([]);
    expect(boards.askedMissions).toEqual([]);
  });

  it('reaches a contract network at the address of an accepted number', async () => {
    const missions = lookupOver({ missions: { [MISSION_NUMBER]: 'accepted' } });

    expect(await missions.lookup(MISSION_ADDRESS)).toEqual({
      data: missionNetwork(MISSION_NUMBER),
      error: null,
    });
    expect(missions.askedMissions).toEqual([MISSION_NUMBER]);
    expect(missions.askedBoards).toEqual([]);
  });

  it('keeps a completed or an abandoned contract reachable', async () => {
    const completed = lookupOver({ missions: { [MISSION_NUMBER]: 'completed' } });
    const abandoned = lookupOver({ missions: { [MISSION_NUMBER]: 'abandoned' } });

    expect(await completed.lookup(MISSION_ADDRESS)).toEqual({
      data: missionNetwork(MISSION_NUMBER),
      error: null,
    });
    expect(await abandoned.lookup(MISSION_ADDRESS)).toEqual({
      data: missionNetwork(MISSION_NUMBER),
      error: null,
    });
  });

  it('answers an offered or a burned number as an empty address does', async () => {
    const offered = lookupOver({ missions: { [MISSION_NUMBER]: 'offered' } });
    const burned = lookupOver({ missions: { [MISSION_NUMBER]: 'burned' } });

    expect(await offered.lookup(MISSION_ADDRESS)).toEqual({ data: null, error: null });
    expect(await burned.lookup(MISSION_ADDRESS)).toEqual({ data: null, error: null });
  });

  it('answers a 195 address with no row as an empty address does', async () => {
    const missions = lookupOver();

    expect(await missions.lookup(MISSION_ADDRESS)).toEqual({ data: null, error: null });
    expect(missions.askedMissions).toEqual([MISSION_NUMBER]);
  });

  it('passes on a failed read of the contract, never guessing either way', async () => {
    const failure = new Error('missions unreadable');
    const missions = lookupOver({ missionsError: failure });

    expect(await missions.lookup(MISSION_ADDRESS)).toEqual({ data: null, error: failure });
  });

  it('answers a 195 address that names no contract without reading the table', async () => {
    const missions = lookupOver({ missions: { [MISSION_NUMBER]: 'accepted' } });

    expect(await missions.lookup(NON_CONTRACT_195)).toEqual({ data: null, error: null });
    expect(missions.askedMissions).toEqual([]);
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
