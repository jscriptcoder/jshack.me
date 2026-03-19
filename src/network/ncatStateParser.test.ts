import { describe, it, expect } from 'vitest';
import { parseNcatPidContent, parseNcatPidFiles } from './ncatStateParser';
import type { FileNode } from '../filesystem/types';

describe('parseNcatPidContent', () => {
  it('returns empty array for undefined content', () => {
    expect(parseNcatPidContent(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseNcatPidContent('')).toEqual([]);
  });

  it('parses valid pid file content with user owner', () => {
    expect(
      parseNcatPidContent('ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
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
    expect(parseNcatPidContent('ncat:port=8888,user=root,userType=root,home=/root')).toEqual([
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
      parseNcatPidContent('ncat:port=1337,user=ftpuser,userType=guest,home=/home/ftpuser'),
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
    expect(parseNcatPidContent('garbage')).toEqual([]);
    expect(parseNcatPidContent('ncat:port=')).toEqual([]);
    expect(parseNcatPidContent('ncat:port=abc,user=x,userType=user,home=/home/x')).toEqual([]);
    expect(parseNcatPidContent('sshd:port=22')).toEqual([]);
  });

  it('returns empty array for invalid port number', () => {
    expect(parseNcatPidContent('ncat:port=0,user=root,userType=root,home=/root')).toEqual([]);
    expect(parseNcatPidContent('ncat:port=70000,user=root,userType=root,home=/root')).toEqual([]);
  });

  it('returns empty array for invalid userType', () => {
    expect(
      parseNcatPidContent('ncat:port=4444,user=hacker,userType=admin,home=/home/hacker'),
    ).toEqual([]);
  });
});

describe('parseNcatPidFiles', () => {
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
    expect(parseNcatPidFiles(null)).toEqual([]);
  });

  it('returns empty array for file node instead of directory', () => {
    expect(parseNcatPidFiles(mkFile('content'))).toEqual([]);
  });

  it('returns empty array for directory with no ncat pid files', () => {
    expect(
      parseNcatPidFiles(
        mkDir({
          'sshd.pid': mkFile('sshd:port=22'),
          'ftpd.pid': mkFile('ftpd:port=21'),
        }),
      ),
    ).toEqual([]);
  });

  it('parses single ncat pid file from directory', () => {
    const result = parseNcatPidFiles(
      mkDir({
        'ncat-4444.pid': mkFile('ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
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

  it('parses multiple ncat pid files from directory', () => {
    const result = parseNcatPidFiles(
      mkDir({
        'sshd.pid': mkFile('sshd:port=22'),
        'ncat-4444.pid': mkFile('ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
        'ncat-8888.pid': mkFile('ncat:port=8888,user=root,userType=root,home=/root'),
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

  it('skips ncat pid files with invalid content', () => {
    const result = parseNcatPidFiles(
      mkDir({
        'ncat-4444.pid': mkFile('ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin'),
        'ncat-9999.pid': mkFile('garbage'),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.port).toBe(4444);
  });
});
