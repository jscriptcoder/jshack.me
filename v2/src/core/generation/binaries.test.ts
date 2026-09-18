import { describe, expect, it } from 'vitest';
import type { Directory, FileNode } from '../filesystem/types';
import { binaryStub, stubName } from './binaries';
import { buildWorkstationBaseFs } from './workstationFs';
import { buildRemoteHostFs } from './remoteHostFs';
import { buildApGatewayBaseFs, buildSwitchBaseFs } from './routerFs';

const ESSID = 'BEAN-THERE-WIFI';

const child = (directory: Directory | undefined, name: string): Directory | undefined => {
  const node = directory?.entries.get(name);
  return node?.kind === 'directory' ? node : undefined;
};

const filesIn = (directory: Directory | undefined): readonly [string, FileNode][] =>
  [...(directory?.entries ?? new Map<string, FileNode>())].filter(
    ([, node]) => node.kind === 'file',
  );

const binariesOf = (root: Directory): readonly [string, FileNode][] => [
  ...filesIn(child(root, 'bin')),
  ...filesIn(child(child(root, 'usr'), 'bin')),
  ...filesIn(child(child(root, 'usr'), 'sbin')),
];

const boxes: readonly [string, Directory][] = [
  [
    'a workstation',
    buildWorkstationBaseFs('1'.repeat(64), {
      machineName: 'workstation',
      username: 'alice',
      rootPassword: 'hunter2',
    }),
  ],
  [
    'a LAN host',
    buildRemoteHostFs(ESSID, { ip: '192.168.50.20', hostname: 'host-20', kind: 'machine' }),
  ],
  ['an access-point gateway', buildApGatewayBaseFs(ESSID)],
  ['a switch', buildSwitchBaseFs(ESSID, 2)],
];

describe('binary stubs', () => {
  it('read back the name they were stamped with', () => {
    expect(stubName(binaryStub('msfconsole'))).toBe('msfconsole');
  });

  it('name nothing for a header with no name after it', () => {
    expect(stubName(binaryStub(''))).toBeNull();
  });

  it.each(['', 'plain text\n', '\x7fELF but not a stub', 'a long text file\n'.repeat(20)])(
    'name nothing for content that is not a stub: %j',
    (content) => {
      expect(stubName(content)).toBeNull();
    },
  );

  it.each(boxes)('name the tool each binary on %s is filed under', (_label, root) => {
    const binaries = binariesOf(root);

    expect(binaries.length).toBeGreaterThan(0);
    binaries.forEach(([name, node]) => {
      expect(node.kind === 'file' ? stubName(node.content) : null, name).toBe(name);
    });
  });

  it.each(boxes)('name each library on %s as the .so it is, never as a tool', (_label, root) => {
    const libraries = filesIn(child(root, 'lib'));

    expect(libraries.length).toBeGreaterThan(0);
    libraries.forEach(([name, node]) => {
      expect(node.kind === 'file' ? stubName(node.content) : null, name).toBe(name);
    });
  });
});
