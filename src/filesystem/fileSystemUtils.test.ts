import { describe, it, expect } from 'vitest';
import type { FileNode, FileSystemPatch } from './types';
import {
  normalizePath,
  resolvePath,
  getNodeAtPath,
  updateNodeAtPath,
  addChildAtPath,
  removeChildAtPath,
  upsertPatch,
  applyPatchToList,
  applyPatches,
  isValidPatch,
  planDirectoryCreation,
} from './fileSystemUtils';

const makeDir = (
  name: string,
  children: Record<string, FileNode> = {},
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root', owner],
    execute: ['root', 'user', 'guest'],
  },
  children,
});

const makeFile = (
  name: string,
  content: string = '',
  owner: 'root' | 'user' | 'guest' = 'user',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: {
    read: ['root', owner],
    write: ['root', owner],
    execute: ['root', owner],
  },
  content,
});

const sampleFs: FileNode = makeDir('/', {
  home: makeDir('home', {
    jshacker: makeDir('jshacker', {
      'notes.txt': makeFile('notes.txt', 'hello world', 'user'),
    }),
  }),
  etc: makeDir('etc', {
    passwd: makeFile('passwd', 'root:x:0:0', 'root'),
  }),
});

describe('normalizePath', () => {
  it('resolves . segments', () => {
    expect(normalizePath('/home/./jshacker')).toBe('/home/jshacker');
  });

  it('resolves .. segments', () => {
    expect(normalizePath('/home/jshacker/..')).toBe('/home');
  });

  it('strips trailing slashes', () => {
    expect(normalizePath('/home/jshacker/')).toBe('/home/jshacker');
  });

  it('resolves to root for excessive ..', () => {
    expect(normalizePath('/home/../../..')).toBe('/');
  });

  it('normalizes absolute paths', () => {
    expect(normalizePath('/home//jshacker')).toBe('/home/jshacker');
  });

  it('returns root for empty segments', () => {
    expect(normalizePath('/')).toBe('/');
  });
});

describe('resolvePath', () => {
  it('returns normalized absolute paths as-is', () => {
    expect(resolvePath('/etc/passwd', '/home/jshacker')).toBe('/etc/passwd');
  });

  it('resolves relative paths against cwd', () => {
    expect(resolvePath('notes.txt', '/home/jshacker')).toBe('/home/jshacker/notes.txt');
  });

  it('handles .. as a special case', () => {
    expect(resolvePath('..', '/home/jshacker')).toBe('/home');
  });

  it('returns cwd for .', () => {
    expect(resolvePath('.', '/home/jshacker')).toBe('/home/jshacker');
  });

  it('handles relative paths from root', () => {
    expect(resolvePath('home', '/')).toBe('/home');
  });

  it('resolves relative paths with .. prefix', () => {
    expect(resolvePath('../etc/passwd', '/home/jshacker')).toBe('/home/etc/passwd');
  });

  it('handles .. from root', () => {
    expect(resolvePath('..', '/')).toBe('/');
  });
});

describe('getNodeAtPath', () => {
  it('returns the root node for empty path', () => {
    expect(getNodeAtPath(sampleFs, '/')).toBe(sampleFs);
  });

  it('returns a nested file', () => {
    const node = getNodeAtPath(sampleFs, '/home/jshacker/notes.txt');
    expect(node?.name).toBe('notes.txt');
    expect(node?.content).toBe('hello world');
  });

  it('returns a nested directory', () => {
    const node = getNodeAtPath(sampleFs, '/home/jshacker');
    expect(node?.name).toBe('jshacker');
    expect(node?.type).toBe('directory');
  });

  it('returns null for missing node', () => {
    expect(getNodeAtPath(sampleFs, '/home/missing')).toBeNull();
  });

  it('returns null when path goes through a file', () => {
    expect(getNodeAtPath(sampleFs, '/etc/passwd/invalid')).toBeNull();
  });
});

describe('updateNodeAtPath', () => {
  it('updates at root (empty path)', () => {
    const result = updateNodeAtPath(sampleFs, [], (node) => ({ ...node, name: 'updated' }));
    expect(result.name).toBe('updated');
  });

  it('updates a nested file content', () => {
    const result = updateNodeAtPath(sampleFs, ['home', 'jshacker', 'notes.txt'], (node) => ({
      ...node,
      content: 'updated',
    }));
    const file = result.children?.['home']?.children?.['jshacker']?.children?.['notes.txt'];
    expect(file?.content).toBe('updated');
  });

  it('preserves other siblings', () => {
    const result = updateNodeAtPath(sampleFs, ['etc', 'passwd'], (node) => ({
      ...node,
      content: 'new',
    }));
    expect(result.children?.['home']).toBe(sampleFs.children?.['home']);
  });
});

describe('addChildAtPath', () => {
  const newFile = makeFile('new.txt', 'new content');

  it('adds a child to root', () => {
    const result = addChildAtPath(sampleFs, [], 'new.txt', newFile);
    expect(result.children?.['new.txt']).toBe(newFile);
    expect(result.children?.['home']).toBe(sampleFs.children?.['home']);
  });

  it('adds a child to a nested directory', () => {
    const result = addChildAtPath(sampleFs, ['home', 'jshacker'], 'new.txt', newFile);
    expect(result.children?.['home']?.children?.['jshacker']?.children?.['new.txt']).toBe(newFile);
  });
});

describe('removeChildAtPath', () => {
  it('removes a child from root', () => {
    const result = removeChildAtPath(sampleFs, [], 'etc');
    expect(result.children?.['etc']).toBeUndefined();
    expect(result.children?.['home']).toBe(sampleFs.children?.['home']);
  });

  it('removes a nested child', () => {
    const result = removeChildAtPath(sampleFs, ['home', 'jshacker'], 'notes.txt');
    expect(
      result.children?.['home']?.children?.['jshacker']?.children?.['notes.txt'],
    ).toBeUndefined();
  });

  it('returns unchanged tree when child does not exist', () => {
    const result = removeChildAtPath(sampleFs, [], 'nonexistent');
    expect(result.children?.['home']).toBe(sampleFs.children?.['home']);
    expect(result.children?.['etc']).toBe(sampleFs.children?.['etc']);
  });
});

describe('upsertPatch', () => {
  const patch1: FileSystemPatch = {
    machineId: 'localhost',
    path: '/home/test.txt',
    content: 'hello',
    owner: 'user',
  };

  it('inserts a new patch', () => {
    const result = upsertPatch([], patch1);
    expect(result).toEqual([patch1]);
  });

  it('updates an existing patch with matching machineId and path', () => {
    const updated = { ...patch1, content: 'updated' };
    const result = upsertPatch([patch1], updated);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('updated');
  });

  it('preserves isNew flag on write-after-create', () => {
    const createPatch: FileSystemPatch = { ...patch1, isNew: true };
    const writePatch: FileSystemPatch = { ...patch1, content: 'updated' };
    const result = upsertPatch([createPatch], writePatch);
    expect(result[0]?.isNew).toBe(true);
    expect(result[0]?.content).toBe('updated');
  });

  it('does not add isNew when original patch lacks it', () => {
    const writePatch: FileSystemPatch = { ...patch1, content: 'updated' };
    const result = upsertPatch([patch1], writePatch);
    expect(result[0]?.isNew).toBeUndefined();
  });
});

describe('applyPatchToList', () => {
  const writePatch: FileSystemPatch = {
    machineId: 'localhost',
    path: '/home/test.txt',
    content: 'hello',
    owner: 'user',
  };

  it('upserts when patch content is non-null (write/create case)', () => {
    const result = applyPatchToList([], writePatch);
    expect(result).toEqual([writePatch]);
  });

  it('updates the existing patch when content is non-null and a row exists at (machineId, path)', () => {
    const updated: FileSystemPatch = { ...writePatch, content: 'updated' };
    const result = applyPatchToList([writePatch], updated);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('updated');
  });

  it('drops the patch entirely when deleting an isNew patch (no null tombstone)', () => {
    const createPatch: FileSystemPatch = { ...writePatch, isNew: true };
    const deletePatch: FileSystemPatch = { ...writePatch, content: null };
    const result = applyPatchToList([createPatch], deletePatch);
    expect(result).toEqual([]);
  });

  it('records a null marker when deleting a base file (no existing isNew patch)', () => {
    const deletePatch: FileSystemPatch = { ...writePatch, content: null };
    const result = applyPatchToList([], deletePatch);
    expect(result).toEqual([deletePatch]);
  });

  it('replaces an existing non-isNew row with the null marker on base-file deletion', () => {
    const deletePatch: FileSystemPatch = { ...writePatch, content: null };
    const result = applyPatchToList([writePatch], deletePatch);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBeNull();
  });

  it('drops descendant patches when deleting a directory path (isNew case)', () => {
    const dirPatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub',
      content: null,
      owner: 'user',
      isNew: true,
      nodeType: 'directory',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
    };
    const childPatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub/file.txt',
      content: 'child',
      owner: 'user',
    };
    const deletePatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub',
      content: null,
      owner: 'user',
    };
    const result = applyPatchToList([dirPatch, childPatch], deletePatch);
    expect(result).toEqual([]);
  });

  it('drops descendant patches when deleting a base directory (non-isNew case keeps null marker)', () => {
    const childPatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub/file.txt',
      content: 'child',
      owner: 'user',
    };
    const deletePatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub',
      content: null,
      owner: 'user',
    };
    const result = applyPatchToList([childPatch], deletePatch);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('/home/sub');
    expect(result[0]?.content).toBeNull();
  });

  it('only drops descendants on the same machineId', () => {
    const otherMachineChild: FileSystemPatch = {
      machineId: 'other',
      path: '/home/sub/file.txt',
      content: 'kept',
      owner: 'user',
    };
    const deletePatch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/sub',
      content: null,
      owner: 'user',
      isNew: true,
    };
    const existingIsNew: FileSystemPatch = {
      ...deletePatch,
      content: 'created',
      isNew: true,
    };
    const result = applyPatchToList([existingIsNew, otherMachineChild], deletePatch);
    expect(result).toEqual([otherMachineChild]);
  });
});

describe('applyPatches', () => {
  const baseState = { localhost: sampleFs };

  it('creates a new file via patch', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/new.txt',
      content: 'new file',
      owner: 'user',
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/new.txt');
    expect(node?.content).toBe('new file');
    expect(node?.owner).toBe('user');
  });

  it('creates new file with no execute permission by default', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/new.txt',
      content: 'new file',
      owner: 'user',
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/new.txt');
    expect(node?.permissions.execute).toEqual(['root']);
    expect(node?.permissions.read).toEqual(['root', 'user']);
    expect(node?.permissions.write).toEqual(['root', 'user']);
  });

  it('uses explicit permissions from patch when provided', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/script.sh',
      content: '#!/bin/bash',
      owner: 'user',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', 'user'],
        execute: ['root', 'user', 'guest'],
      },
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/script.sh');
    expect(node?.permissions.execute).toEqual(['root', 'user', 'guest']);
    expect(node?.permissions.read).toEqual(['root', 'user', 'guest']);
    expect(node?.permissions.write).toEqual(['root', 'user']);
  });

  it('preserves existing file permissions when updating content only', () => {
    const existingNode = getNodeAtPath(baseState['localhost'], '/home/jshacker/notes.txt');
    const originalPerms = existingNode?.permissions;

    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/notes.txt',
      content: 'updated content',
      owner: 'user',
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node?.content).toBe('updated content');
    expect(node?.permissions).toEqual(originalPerms);
  });

  it('overrides existing file permissions when patch includes permissions', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/notes.txt',
      content: 'updated content',
      owner: 'user',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user'],
      },
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node?.permissions.execute).toEqual(['root', 'user']);
    expect(node?.permissions.read).toEqual(['root', 'user', 'guest']);
  });

  it('updates an existing file via patch', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/notes.txt',
      content: 'updated',
      owner: 'user',
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node?.content).toBe('updated');
  });

  it('deletes a file via null-content patch', () => {
    const patch: FileSystemPatch = {
      machineId: 'localhost',
      path: '/home/jshacker/notes.txt',
      content: null,
      owner: 'user',
    };
    const result = applyPatches(baseState, [patch]);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node).toBeNull();
  });

  it('applies multiple patches in sequence', () => {
    const patches: FileSystemPatch[] = [
      { machineId: 'localhost', path: '/home/jshacker/a.txt', content: 'A', owner: 'user' },
      { machineId: 'localhost', path: '/home/jshacker/b.txt', content: 'B', owner: 'user' },
      { machineId: 'localhost', path: '/home/jshacker/notes.txt', content: null, owner: 'user' },
    ];
    const result = applyPatches(baseState, patches);
    expect(getNodeAtPath(result['localhost'], '/home/jshacker/a.txt')?.content).toBe('A');
    expect(getNodeAtPath(result['localhost'], '/home/jshacker/b.txt')?.content).toBe('B');
    expect(getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt')).toBeNull();
  });

  // Cross-player last-write-wins contract — load-bearing for shared
  // persistent state. Server returns rows ORDER BY updated_at ASC, so
  // the array order IS the application order. Two players writing to
  // the same path must resolve to the latest write's content, not
  // interleave or skip-by-deduplication. If a refactor introduces e.g.
  // Set-by-path dedup, this test fails immediately.
  //
  // Owner is NOT asserted: writing to an existing file doesn't transfer
  // ownership in the simulated filesystem (chown / chmod are the only
  // ownership-changing operations). Only content is the LWW surface.
  it('two patches at the same (machineId, path) resolve last-write-wins on content', () => {
    const patches: FileSystemPatch[] = [
      {
        machineId: 'localhost',
        path: '/home/jshacker/notes.txt',
        content: 'older write from player A',
        owner: 'user',
      },
      {
        machineId: 'localhost',
        path: '/home/jshacker/notes.txt',
        content: 'newer write from player B',
        owner: 'user',
      },
    ];
    const result = applyPatches(baseState, patches);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node?.content).toBe('newer write from player B');
  });

  // Companion case: explicit permissions on the later patch DO override.
  // applyPatches updates permissions on existing files only when the
  // patch supplies them — without this, a permissions change can't
  // propagate cross-player.
  it('two patches at the same path apply last-supplied explicit permissions', () => {
    const patches: FileSystemPatch[] = [
      {
        machineId: 'localhost',
        path: '/home/jshacker/notes.txt',
        content: 'older',
        owner: 'user',
      },
      {
        machineId: 'localhost',
        path: '/home/jshacker/notes.txt',
        content: 'newer',
        owner: 'user',
        permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      },
    ];
    const result = applyPatches(baseState, patches);
    const node = getNodeAtPath(result['localhost'], '/home/jshacker/notes.txt');
    expect(node?.permissions.read).toEqual(['root']);
  });

  it('creates an FS on demand for an unknown machineId and applies the patch', () => {
    // Cross-player visibility for occupant workstations: when an
    // occupant on the same LAN writes a patch (e.g. sshd pid file), the
    // receiving player's base FS map doesn't include the occupant's
    // workstation_id (only NPC home machines + own workstation are in
    // the base). Without on-demand FS creation, the patch would drop
    // and daemon state changes would be invisible cross-player —
    // breaking nmap-of-occupant port rendering.
    //
    // Security note: the receiving client's apply step isn't a security
    // boundary. Patches that reach this code have already passed L1 +
    // L2 server-side; trusting them here just lands them in the client
    // view.
    const patch: FileSystemPatch = {
      machineId: 'alice-box-aabbccdd',
      path: '/var/run/sshd.pid',
      content: 'sshd:port=22',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
    };
    const result = applyPatches(baseState, [patch]);
    expect(result['alice-box-aabbccdd']).toBeDefined();
    const pidNode = getNodeAtPath(result['alice-box-aabbccdd']!, '/var/run/sshd.pid');
    expect(pidNode?.type).toBe('file');
    expect(pidNode?.content).toBe('sshd:port=22');
  });

  it('does not disturb existing machine entries when creating one on demand', () => {
    // Adding a new entry for an unknown machineId must not mutate or
    // overwrite the entries that were already in the base state.
    const patch: FileSystemPatch = {
      machineId: 'alice-box-aabbccdd',
      path: '/var/run/sshd.pid',
      content: 'sshd:port=22',
      owner: 'root',
    };
    const result = applyPatches(baseState, [patch]);
    expect(result['localhost']).toBe(baseState['localhost']);
  });

  describe('directory patches', () => {
    it('creates an empty directory via nodeType: directory patch', () => {
      const patch: FileSystemPatch = {
        machineId: 'localhost',
        path: '/home/jshacker/stash',
        content: null,
        owner: 'user',
        isNew: true,
        nodeType: 'directory',
      };
      const result = applyPatches(baseState, [patch]);
      const node = getNodeAtPath(result['localhost'], '/home/jshacker/stash');
      expect(node?.type).toBe('directory');
      expect(node?.owner).toBe('user');
      expect(node?.children).toEqual({});
    });

    it('uses patch permissions on the new directory', () => {
      const patch: FileSystemPatch = {
        machineId: 'localhost',
        path: '/home/jshacker/private',
        content: null,
        owner: 'user',
        isNew: true,
        nodeType: 'directory',
        permissions: {
          read: ['root', 'user'],
          write: ['root', 'user'],
          execute: ['root', 'user'],
        },
      };
      const result = applyPatches(baseState, [patch]);
      const node = getNodeAtPath(result['localhost'], '/home/jshacker/private');
      expect(node?.permissions.read).toEqual(['root', 'user']);
      expect(node?.permissions.execute).toEqual(['root', 'user']);
    });

    it('is a no-op when the directory already exists', () => {
      const patch: FileSystemPatch = {
        machineId: 'localhost',
        path: '/home/jshacker',
        content: null,
        owner: 'user',
        isNew: true,
        nodeType: 'directory',
      };
      const existingChildren = getNodeAtPath(baseState['localhost'], '/home/jshacker')?.children;
      const result = applyPatches(baseState, [patch]);
      const node = getNodeAtPath(result['localhost'], '/home/jshacker');
      // Existing contents survive — mkdir-on-existing must never clobber children
      expect(node?.children).toBe(existingChildren);
    });

    it('deletes a directory via null-content patch without nodeType', () => {
      // Deletion reuses the file-deletion path; nodeType only matters for creation.
      const createPatch: FileSystemPatch = {
        machineId: 'localhost',
        path: '/home/jshacker/tempdir',
        content: null,
        owner: 'user',
        isNew: true,
        nodeType: 'directory',
      };
      const afterCreate = applyPatches(baseState, [createPatch]);
      expect(getNodeAtPath(afterCreate['localhost'], '/home/jshacker/tempdir')).not.toBeNull();

      const deletePatch: FileSystemPatch = {
        machineId: 'localhost',
        path: '/home/jshacker/tempdir',
        content: null,
        owner: 'user',
      };
      const afterDelete = applyPatches(afterCreate, [deletePatch]);
      expect(getNodeAtPath(afterDelete['localhost'], '/home/jshacker/tempdir')).toBeNull();
    });
  });
});

describe('isValidPatch', () => {
  const validBase = {
    machineId: 'localhost',
    path: '/home/jshacker/test.txt',
    content: 'hello',
    owner: 'user',
  };

  it('should accept a valid patch with string content', () => {
    expect(isValidPatch(validBase)).toBe(true);
  });

  it('should accept a valid patch with null content (deletion)', () => {
    expect(isValidPatch({ ...validBase, content: null })).toBe(true);
  });

  it('should accept a valid patch with isNew: true', () => {
    expect(isValidPatch({ ...validBase, isNew: true })).toBe(true);
  });

  it('should accept a valid patch without isNew (undefined)', () => {
    expect(isValidPatch({ ...validBase })).toBe(true);
    expect(validBase).not.toHaveProperty('isNew');
  });

  it('should reject a patch with isNew: false', () => {
    expect(isValidPatch({ ...validBase, isNew: false })).toBe(false);
  });

  it('should reject a patch with isNew as a non-boolean', () => {
    expect(isValidPatch({ ...validBase, isNew: 'yes' })).toBe(false);
  });

  it('should reject non-object values', () => {
    expect(isValidPatch(null)).toBe(false);
    expect(isValidPatch(undefined)).toBe(false);
    expect(isValidPatch('string')).toBe(false);
    expect(isValidPatch(42)).toBe(false);
  });

  it('should reject patches with missing fields', () => {
    expect(isValidPatch({ machineId: 'x', path: '/a' })).toBe(false);
    expect(isValidPatch({ machineId: 'x', content: 'hi', owner: 'user' })).toBe(false);
  });

  it('should reject patches with invalid owner', () => {
    expect(isValidPatch({ ...validBase, owner: 'admin' })).toBe(false);
  });

  it('should accept all valid owner types', () => {
    expect(isValidPatch({ ...validBase, owner: 'root' })).toBe(true);
    expect(isValidPatch({ ...validBase, owner: 'user' })).toBe(true);
    expect(isValidPatch({ ...validBase, owner: 'guest' })).toBe(true);
  });

  it('should accept a valid patch with permissions', () => {
    expect(
      isValidPatch({
        ...validBase,
        permissions: {
          read: ['root', 'user'],
          write: ['root'],
          execute: ['root', 'user'],
        },
      }),
    ).toBe(true);
  });

  it('should accept a valid patch without permissions (undefined)', () => {
    expect(isValidPatch(validBase)).toBe(true);
    expect(validBase).not.toHaveProperty('permissions');
  });

  it('should reject a patch with invalid permissions structure', () => {
    expect(isValidPatch({ ...validBase, permissions: 'rwx' })).toBe(false);
    expect(isValidPatch({ ...validBase, permissions: { read: ['root'] } })).toBe(false);
    expect(
      isValidPatch({ ...validBase, permissions: { read: 'root', write: [], execute: [] } }),
    ).toBe(false);
  });
});

describe('planDirectoryCreation', () => {
  const allowWrite = { allowed: true as const };
  const denyWrite = { allowed: false as const };

  const getNodeFromMap = (nodes: Readonly<Record<string, FileNode>>) => (path: string) =>
    nodes[path] ?? null;

  it('plans a single new directory when the parent exists', () => {
    const tmp = makeDir('tmp');
    const result = planDirectoryCreation({
      parts: ['tmp', 'newdir'],
      targetPath: '/tmp/newdir',
      parents: false,
      getNode: getNodeFromMap({ '/tmp': tmp }),
      canWriteParent: () => allowWrite,
    });

    expect(result).toEqual({ ok: true, toCreate: ['/tmp/newdir'] });
  });

  it('plans the full chain when -p is set and the parent exists', () => {
    // The original bug: canWriteParent was called with '/tmp/a' (a path that
    // does not yet exist in the filesystem), so the underlying check returned
    // "No such file or directory" and the walk aborted. With the fix, the
    // canWriteParent callback is only invoked while toCreate is still empty.
    const tmp = makeDir('tmp');
    const calls: string[] = [];

    const result = planDirectoryCreation({
      parts: ['tmp', 'a', 'b', 'c'],
      targetPath: '/tmp/a/b/c',
      parents: true,
      getNode: getNodeFromMap({ '/tmp': tmp }),
      canWriteParent: (path) => {
        calls.push(path);
        return allowWrite;
      },
    });

    expect(result).toEqual({ ok: true, toCreate: ['/tmp/a', '/tmp/a/b', '/tmp/a/b/c'] });
    expect(calls).toEqual(['/tmp']);
  });

  it('returns an empty plan when the target already exists and -p is set', () => {
    // Real callers short-circuit before planDirectoryCreation runs when the
    // target exists, but the planner should still be safe in that case.
    const tmp = makeDir('tmp', { existing: makeDir('existing') });
    const result = planDirectoryCreation({
      parts: ['tmp', 'existing'],
      targetPath: '/tmp/existing',
      parents: true,
      getNode: getNodeFromMap({ '/tmp': tmp, '/tmp/existing': tmp.children!.existing! }),
      canWriteParent: () => allowWrite,
    });

    expect(result).toEqual({ ok: true, toCreate: [] });
  });

  it('errors when a missing intermediate is hit without -p', () => {
    const tmp = makeDir('tmp');
    const result = planDirectoryCreation({
      parts: ['tmp', 'a', 'b'],
      targetPath: '/tmp/a/b',
      parents: false,
      getNode: getNodeFromMap({ '/tmp': tmp }),
      canWriteParent: () => allowWrite,
    });

    expect(result).toEqual({
      ok: false,
      error: "mkdir: cannot create directory '/tmp/a/b': No such file or directory",
    });
  });

  it('errors when the caller lacks write on the first missing parent', () => {
    const tmp = makeDir('tmp');
    const result = planDirectoryCreation({
      parts: ['tmp', 'forbidden'],
      targetPath: '/tmp/forbidden',
      parents: false,
      getNode: getNodeFromMap({ '/tmp': tmp }),
      canWriteParent: () => denyWrite,
    });

    expect(result).toEqual({
      ok: false,
      error: "mkdir: cannot create directory '/tmp/forbidden': Permission denied",
    });
  });

  it('errors when a segment along the path is not a directory', () => {
    const tmp = makeDir('tmp');
    const file: FileNode = {
      name: 'blocker',
      type: 'file',
      owner: 'user',
      permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
      content: '',
    };
    const result = planDirectoryCreation({
      parts: ['tmp', 'blocker', 'nested'],
      targetPath: '/tmp/blocker/nested',
      parents: true,
      getNode: getNodeFromMap({ '/tmp': tmp, '/tmp/blocker': file }),
      canWriteParent: () => allowWrite,
    });

    expect(result).toEqual({
      ok: false,
      error: "mkdir: cannot create directory '/tmp/blocker/nested': Not a directory",
    });
  });

  it('only checks canWriteParent once, at the first missing segment', () => {
    // Regression guard for the original bug.
    const tmp = makeDir('tmp');
    const calls: string[] = [];

    planDirectoryCreation({
      parts: ['tmp', 'a', 'b', 'c', 'd'],
      targetPath: '/tmp/a/b/c/d',
      parents: true,
      getNode: getNodeFromMap({ '/tmp': tmp }),
      canWriteParent: (path) => {
        calls.push(path);
        return allowWrite;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('/tmp');
  });
});
