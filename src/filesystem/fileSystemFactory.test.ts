import { describe, it, expect } from 'vitest';
import { createFileSystem } from './fileSystemFactory';
import type { MachineFileSystemConfig } from './fileSystemFactory';

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
