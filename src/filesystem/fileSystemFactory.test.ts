import { describe, it, expect } from 'vitest';
import { createFileSystem, mergeFileNodeChildren } from './fileSystemFactory';
import type { MachineFileSystemConfig } from './fileSystemFactory';
import type { FileNode } from './types';

const minimalConfig: MachineFileSystemConfig = {
  users: [
    { username: 'root', passwordHash: 'abc123', userType: 'root', uid: 0 },
    { username: 'testuser', passwordHash: 'def456', userType: 'user', uid: 1000 },
  ],
};

describe('createFileSystem', () => {
  describe('/boot/ directory', () => {
    it('creates /boot/ with correct permissions and both kernel files', () => {
      const fs = createFileSystem(minimalConfig);
      const boot = fs.children?.['boot'];

      expect(boot).toBeDefined();
      expect(boot?.type).toBe('directory');
      expect(boot?.owner).toBe('root');
      expect(boot?.permissions.read).toEqual(['root', 'user', 'guest']);
      expect(boot?.permissions.write).toEqual(['root']);
      expect(boot?.permissions.execute).toEqual(['root', 'user', 'guest']);

      const vmlinuz = boot?.children?.['vmlinuz'];
      expect(vmlinuz).toBeDefined();
      expect(vmlinuz?.type).toBe('file');
      expect(vmlinuz?.owner).toBe('root');
      expect(vmlinuz?.content).toBe('bzImage, version 5.15.0-91-generic');
      expect(vmlinuz?.permissions.read).toEqual(['root', 'user', 'guest']);
      expect(vmlinuz?.permissions.write).toEqual(['root']);

      const initrd = boot?.children?.['initrd.img'];
      expect(initrd).toBeDefined();
      expect(initrd?.type).toBe('file');
      expect(initrd?.owner).toBe('root');
      expect(initrd?.content).toBe('initramfs image, version 5.15.0-91-generic');
      expect(initrd?.permissions.read).toEqual(['root', 'user', 'guest']);
      expect(initrd?.permissions.write).toEqual(['root']);
    });
  });

  describe('/usr/sbin/ directory', () => {
    it('creates /usr/sbin/ under /usr/ with correct permissions', () => {
      const fs = createFileSystem({
        ...minimalConfig,
        usrSbinContent: {
          sshd: {
            name: 'sshd',
            type: 'file',
            owner: 'root',
            permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
            content: '\x7fELF',
          },
        },
      });
      const usr = fs.children?.['usr'];
      const sbin = usr?.children?.['sbin'];

      expect(sbin).toBeDefined();
      expect(sbin?.type).toBe('directory');
      expect(sbin?.owner).toBe('root');
      expect(sbin?.permissions.read).toEqual(['root', 'user', 'guest']);
      expect(sbin?.permissions.write).toEqual(['root']);
      expect(sbin?.permissions.execute).toEqual(['root', 'user', 'guest']);
      expect(sbin?.children?.['sshd']).toBeDefined();
    });
  });
});

const mkDir = (
  name: string,
  children: Record<string, FileNode>,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: { read: [owner], write: [owner], execute: [owner] },
  children,
});

const mkFile = (
  name: string,
  content: string,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: { read: [owner], write: [owner], execute: [] },
  content,
});

describe('mergeFileNodeChildren', () => {
  it('returns base unchanged when additions is empty', () => {
    const base = { foo: mkFile('foo', 'hello') };
    const result = mergeFileNodeChildren(base, {});
    expect(result).toEqual(base);
  });

  it('returns additions when base is empty', () => {
    const additions = { bar: mkFile('bar', 'world') };
    const result = mergeFileNodeChildren({}, additions);
    expect(result).toEqual(additions);
  });

  it('adds non-overlapping keys from both sides', () => {
    const base = { a: mkFile('a', '1') };
    const additions = { b: mkFile('b', '2') };
    const result = mergeFileNodeChildren(base, additions);
    expect(Object.keys(result).sort()).toEqual(['a', 'b']);
    expect(result['a']?.content).toBe('1');
    expect(result['b']?.content).toBe('2');
  });

  it('additions overwrite base for file-file conflicts', () => {
    const base = { f: mkFile('f', 'old') };
    const additions = { f: mkFile('f', 'new') };
    const result = mergeFileNodeChildren(base, additions);
    expect(result['f']?.content).toBe('new');
  });

  it('additions overwrite base when types differ (file vs directory)', () => {
    const base = { x: mkDir('x', { child: mkFile('child', 'data') }) };
    const additions = { x: mkFile('x', 'replaced') };
    const result = mergeFileNodeChildren(base, additions);
    expect(result['x']?.type).toBe('file');
    expect(result['x']?.content).toBe('replaced');
  });

  it('merges children of overlapping directories', () => {
    const base = { var: mkDir('var', { www: mkDir('www', {}) }) };
    const additions = { var: mkDir('var', { log: mkDir('log', {}) }) };
    const result = mergeFileNodeChildren(base, additions);
    expect(result['var']?.type).toBe('directory');
    const varChildren = result['var']?.children ?? {};
    expect(Object.keys(varChildren).sort()).toEqual(['log', 'www']);
  });

  it('preserves base directory metadata when merging', () => {
    const base = { d: mkDir('d', {}, 'user') };
    const additions = { d: mkDir('d', { f: mkFile('f', 'x') }, 'root') };
    const result = mergeFileNodeChildren(base, additions);
    expect(result['d']?.owner).toBe('user');
  });

  it('merges recursively at arbitrary depth', () => {
    const base = {
      var: mkDir('var', {
        log: mkDir('log', { auth: mkFile('auth', 'auth-data') }),
      }),
    };
    const additions = {
      var: mkDir('var', {
        log: mkDir('log', { syslog: mkFile('syslog', 'sys-data') }),
      }),
    };
    const result = mergeFileNodeChildren(base, additions);
    const logChildren = result['var']?.children?.['log']?.children ?? {};
    expect(Object.keys(logChildren).sort()).toEqual(['auth', 'syslog']);
    expect(logChildren['auth']?.content).toBe('auth-data');
    expect(logChildren['syslog']?.content).toBe('sys-data');
  });

  it('handles the forensics bug case: /var/log/ does not clobber /var/www/', () => {
    const webContent = {
      var: mkDir('var', {
        www: mkDir('www', {
          html: mkDir('html', { 'index.html': mkFile('index.html', '<h1>Hello</h1>') }),
        }),
      }),
    };
    const forensicsEvidence = {
      var: mkDir('var', {
        log: mkDir('log', { 'forensics.log': mkFile('forensics.log', 'attacker trace') }),
      }),
    };
    const result = mergeFileNodeChildren(webContent, forensicsEvidence);
    const varChildren = result['var']?.children ?? {};
    expect(Object.keys(varChildren).sort()).toEqual(['log', 'www']);
    expect(varChildren['www']?.children?.['html']?.children?.['index.html']?.content).toBe(
      '<h1>Hello</h1>',
    );
    expect(varChildren['log']?.children?.['forensics.log']?.content).toBe('attacker trace');
  });
});
