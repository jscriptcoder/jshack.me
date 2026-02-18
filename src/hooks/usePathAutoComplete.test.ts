import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePathAutoComplete } from './usePathAutoComplete';
import type { FileNode } from '../filesystem/types';

const makeDir = (name: string, children: Record<string, FileNode> = {}): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
});

const makeFile = (name: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content: '',
});

const testFs: FileNode = makeDir('/', {
  etc: makeDir('etc', {
    passwd: makeFile('passwd'),
    hostname: makeFile('hostname'),
    hosts: makeFile('hosts'),
  }),
  home: makeDir('home', {
    jshacker: makeDir('jshacker', {
      'readme.txt': makeFile('readme.txt'),
      downloads: makeDir('downloads', {
        'wifi_tools.txt': makeFile('wifi_tools.txt'),
      }),
    }),
  }),
  tmp: makeDir('tmp'),
});

const resolveNode = (path: string): FileNode | null => {
  const parts = path.split('/').filter(Boolean);
  return parts.reduce<FileNode | null>((current, part) => {
    if (!current || current.type !== 'directory' || !current.children) return null;
    return current.children[part] ?? null;
  }, testFs);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockListDirectory = (path: string, _userType: string): string[] | null => {
  const resolved = path === '/' ? testFs : resolveNode(path);
  if (!resolved || resolved.type !== 'directory' || !resolved.children) return null;
  return Object.keys(resolved.children);
};

const mockGetNode = (path: string): FileNode | null => {
  if (path === '/') return testFs;
  return resolveNode(path);
};

const mockResolvePath = (path: string): string => {
  if (path.startsWith('/')) return path;
  if (path === '.') return '/home/jshacker';
  return `/home/jshacker/${path}`;
};

const setup = () =>
  renderHook(() =>
    usePathAutoComplete({
      listDirectory: mockListDirectory as Parameters<
        typeof usePathAutoComplete
      >[0]['listDirectory'],
      getNode: mockGetNode,
      resolvePath: mockResolvePath,
      userType: 'user',
    }),
  );

describe('usePathAutoComplete', () => {
  describe('not in string context', () => {
    it('returns null when cursor is not inside a string', () => {
      const { result } = setup();
      expect(result.current.getPathCompletions('cat()', 3)).toBeNull();
    });

    it('returns null for plain text input', () => {
      const { result } = setup();
      expect(result.current.getPathCompletions('help', 4)).toBeNull();
    });

    it('returns null when cursor is after closing quote', () => {
      const { result } = setup();
      expect(result.current.getPathCompletions("cat('readme.txt')", 17)).toBeNull();
    });
  });

  describe('single match', () => {
    it('completes a single file match in current directory', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('read", 9);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toEqual(['readme.txt']);
      expect(completion!.replacement).toBe("cat('readme.txt");
      expect(completion!.newCursorPosition).toBe(15);
    });

    it('completes a single directory match with trailing slash', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cd('down", 8);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toEqual(['downloads/']);
      expect(completion!.replacement).toBe("cd('downloads/");
    });
  });

  describe('absolute paths', () => {
    it('completes from absolute path', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('/etc/pass", 14);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toEqual(['passwd']);
      expect(completion!.replacement).toBe("cat('/etc/passwd");
    });

    it('lists all entries in directory with empty prefix', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("ls('/etc/", 9);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toHaveLength(3);
      expect(completion!.matches).toContain('hostname');
      expect(completion!.matches).toContain('hosts');
      expect(completion!.matches).toContain('passwd');
    });
  });

  describe('multiple matches', () => {
    it('returns multiple matches with common prefix', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('/etc/hos", 13);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toHaveLength(2);
      expect(completion!.matches).toContain('hostname');
      expect(completion!.matches).toContain('hosts');
      expect(completion!.replacement).toBe("cat('/etc/host");
    });

    it('provides display text with all matches', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('/etc/hos", 13);

      expect(completion).not.toBeNull();
      expect(completion!.displayText).toContain('hostname');
      expect(completion!.displayText).toContain('hosts');
    });
  });

  describe('no matches', () => {
    it('returns null when no entries match prefix', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('nonexistent", 16);
      expect(completion).toBeNull();
    });

    it('returns null for invalid directory', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('/fake/dir/", 15);
      expect(completion).toBeNull();
    });
  });

  describe('empty string argument', () => {
    it('lists all entries in current directory for empty string', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('", 5);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toContain('readme.txt');
      expect(completion!.matches).toContain('downloads/');
    });
  });

  describe('double quotes', () => {
    it('works with double-quoted strings', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions('cat("read', 9);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toEqual(['readme.txt']);
      expect(completion!.replacement).toBe('cat("readme.txt');
    });
  });

  describe('cursor in middle of input', () => {
    it('preserves text after cursor', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('read')", 9);

      expect(completion).not.toBeNull();
      expect(completion!.replacement).toBe("cat('readme.txt')");
      expect(completion!.newCursorPosition).toBe(15);
    });
  });

  describe('relative paths with directories', () => {
    it('completes through subdirectories', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("cat('downloads/wifi", 19);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toEqual(['wifi_tools.txt']);
      expect(completion!.replacement).toBe("cat('downloads/wifi_tools.txt");
    });
  });

  describe('root directory listing', () => {
    it('completes from root path', () => {
      const { result } = setup();
      const completion = result.current.getPathCompletions("ls('/", 5);

      expect(completion).not.toBeNull();
      expect(completion!.matches).toContain('etc/');
      expect(completion!.matches).toContain('home/');
      expect(completion!.matches).toContain('tmp/');
    });
  });
});
