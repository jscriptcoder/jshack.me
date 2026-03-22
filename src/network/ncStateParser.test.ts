import { describe, it, expect } from 'vitest';
import { parseNcPidContent, parseNcPidFiles } from './ncStateParser';
import type { FileNode } from '../filesystem/types';

describe('parseNcPidContent', () => {
  it('returns empty array for undefined content', () => {
    expect(parseNcPidContent(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseNcPidContent('')).toEqual([]);
  });

  it('parses valid pid file content with user owner', () => {
    expect(
      parseNcPidContent('nc:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
    ).toEqual([
      {
        port: 4444,
        service: 'elite',
        open: true,
        owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
      },
    ]);
  });

  it('parses valid pid file content with root owner', () => {
    expect(parseNcPidContent('nc:port=8888,user=root,userType=root,home=/root')).toEqual([
      {
        port: 8888,
        service: 'elite',
        open: true,
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      },
    ]);
  });

  it('parses valid pid file content with guest owner', () => {
    expect(
      parseNcPidContent('nc:port=1337,user=ftpuser,userType=guest,home=/home/ftpuser'),
    ).toEqual([
      {
        port: 1337,
        service: 'elite',
        open: true,
        owner: { username: 'ftpuser', userType: 'guest', homePath: '/home/ftpuser' },
      },
    ]);
  });

  it('returns empty array for malformed content', () => {
    expect(parseNcPidContent('garbage')).toEqual([]);
    expect(parseNcPidContent('nc:port=')).toEqual([]);
    expect(parseNcPidContent('nc:port=abc,user=x,userType=user,home=/home/x')).toEqual([]);
    expect(parseNcPidContent('sshd:port=22')).toEqual([]);
  });

  it('returns empty array for invalid port number', () => {
    expect(parseNcPidContent('nc:port=0,user=root,userType=root,home=/root')).toEqual([]);
    expect(parseNcPidContent('nc:port=70000,user=root,userType=root,home=/root')).toEqual([]);
  });

  it('returns empty array for invalid userType', () => {
    expect(parseNcPidContent('nc:port=4444,user=hacker,userType=admin,home=/home/hacker')).toEqual(
      [],
    );
  });
});

describe('parseNcPidFiles', () => {
  const mkFile = (content: string): FileNode => ({
    name: 'test',
    type: 'file',
    owner: 'root',
    permissions: { read: ['root'], write: ['root'], execute: ['root'] },
    content,
  });

  const mkDir = (children: Record<string, FileNode>): FileNode => ({
    name: 'run',
    type: 'directory',
    owner: 'root',
    permissions: { read: ['root'], write: ['root'], execute: ['root'] },
    children,
  });

  it('returns empty array for null node', () => {
    expect(parseNcPidFiles(null)).toEqual([]);
  });

  it('returns empty array for file node instead of directory', () => {
    expect(parseNcPidFiles(mkFile('content'))).toEqual([]);
  });

  it('returns empty array for directory with no nc pid files', () => {
    expect(
      parseNcPidFiles(
        mkDir({
          'sshd.pid': mkFile('sshd:port=22'),
          'vsftpd.pid': mkFile('vsftpd:port=21'),
        }),
      ),
    ).toEqual([]);
  });

  it('parses single nc pid file from directory', () => {
    const result = parseNcPidFiles(
      mkDir({
        'nc-4444.pid': mkFile('nc:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
      }),
    );
    expect(result).toEqual([
      {
        port: 4444,
        service: 'elite',
        open: true,
        owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
      },
    ]);
  });

  it('parses multiple nc pid files from directory', () => {
    const result = parseNcPidFiles(
      mkDir({
        'sshd.pid': mkFile('sshd:port=22'),
        'nc-4444.pid': mkFile('nc:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
        'nc-8888.pid': mkFile('nc:port=8888,user=root,userType=root,home=/root'),
      }),
    );
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(
      expect.objectContaining({
        port: 4444,
        owner: expect.objectContaining({ username: 'webadmin' }),
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ port: 8888, owner: expect.objectContaining({ username: 'root' }) }),
    );
  });

  it('skips nc pid files with invalid content', () => {
    const result = parseNcPidFiles(
      mkDir({
        'nc-4444.pid': mkFile('nc:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
        'nc-9999.pid': mkFile('garbage'),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.port).toBe(4444);
  });
});
