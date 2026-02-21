import { describe, it, expect } from 'vitest';
import type { Command } from '../components/Terminal/types';
import {
  hasPrivilege,
  getAccessibleCommandNames,
  applyCommandRestrictions,
  COMMAND_TIERS,
} from './permissions';

const getMockCommand = (overrides?: Partial<Command>): Command => ({
  name: 'test',
  description: 'A test command',
  fn: () => 'test result',
  ...overrides,
});

describe('permissions', () => {
  describe('hasPrivilege', () => {
    it('should grant root access to all levels', () => {
      expect(hasPrivilege('root', 'root')).toBe(true);
      expect(hasPrivilege('root', 'user')).toBe(true);
      expect(hasPrivilege('root', 'guest')).toBe(true);
    });

    it('should grant user access to user and guest levels', () => {
      expect(hasPrivilege('user', 'user')).toBe(true);
      expect(hasPrivilege('user', 'guest')).toBe(true);
    });

    it('should deny user access to root level', () => {
      expect(hasPrivilege('user', 'root')).toBe(false);
    });

    it('should grant guest access only to guest level', () => {
      expect(hasPrivilege('guest', 'guest')).toBe(true);
    });

    it('should deny guest access to user and root levels', () => {
      expect(hasPrivilege('guest', 'user')).toBe(false);
      expect(hasPrivilege('guest', 'root')).toBe(false);
    });
  });

  describe('getAccessibleCommandNames', () => {
    const allCommands = [
      'help',
      'man',
      'echo',
      'whoami',
      'pwd',
      'ls',
      'cd',
      'cat',
      'su',
      'clear',
      'author',
      'ifconfig',
      'ping',
      'nmap',
      'nslookup',
      'ssh',
      'ftp',
      'nc',
      'curl',
      'strings',
      'output',
      'resolve',
      'exit',
      'decrypt',
    ];

    it('should give guest only basic commands', () => {
      const result = getAccessibleCommandNames(allCommands, 'guest');
      expect(result).toEqual([
        'help',
        'man',
        'echo',
        'whoami',
        'pwd',
        'ls',
        'cd',
        'cat',
        'su',
        'clear',
        'author',
        'exit',
      ]);
    });

    it('should give user basic and standard commands', () => {
      const result = getAccessibleCommandNames(allCommands, 'user');
      expect(result).toEqual([
        'help',
        'man',
        'echo',
        'whoami',
        'pwd',
        'ls',
        'cd',
        'cat',
        'su',
        'clear',
        'author',
        'ifconfig',
        'ping',
        'nmap',
        'nslookup',
        'ssh',
        'ftp',
        'nc',
        'curl',
        'strings',
        'output',
        'resolve',
        'exit',
      ]);
    });

    it('should give root all commands', () => {
      const result = getAccessibleCommandNames(allCommands, 'root');
      expect(result).toEqual(allCommands);
    });

    it('should include unknown commands for all user types', () => {
      const names = ['customcmd'];
      expect(getAccessibleCommandNames(names, 'guest')).toEqual(['customcmd']);
      expect(getAccessibleCommandNames(names, 'user')).toEqual(['customcmd']);
      expect(getAccessibleCommandNames(names, 'root')).toEqual(['customcmd']);
    });
  });

  describe('applyCommandRestrictions', () => {
    it('should pass through unrestricted commands unchanged', () => {
      const original = getMockCommand({ name: 'ls' });
      const commands = new Map([['ls', original]]);
      const restricted = applyCommandRestrictions(commands, 'guest');
      expect(restricted.get('ls')).toBe(original);
    });

    it('should throw permission denied for guest calling user command', () => {
      const commands = new Map([['nmap', getMockCommand({ name: 'nmap' })]]);
      const restricted = applyCommandRestrictions(commands, 'guest');
      const nmap = restricted.get('nmap');
      expect(() => nmap?.fn()).toThrow("permission denied: 'nmap' requires user privileges");
    });

    it('should throw permission denied for guest calling root command', () => {
      const commands = new Map([['decrypt', getMockCommand({ name: 'decrypt' })]]);
      const restricted = applyCommandRestrictions(commands, 'guest');
      const decrypt = restricted.get('decrypt');
      expect(() => decrypt?.fn()).toThrow("permission denied: 'decrypt' requires root privileges");
    });

    it('should throw permission denied for user calling root command', () => {
      const commands = new Map([['decrypt', getMockCommand({ name: 'decrypt' })]]);
      const restricted = applyCommandRestrictions(commands, 'user');
      const decrypt = restricted.get('decrypt');
      expect(() => decrypt?.fn()).toThrow("permission denied: 'decrypt' requires root privileges");
    });

    it('should allow user to call user commands', () => {
      const commands = new Map([['nmap', getMockCommand({ name: 'nmap' })]]);
      const restricted = applyCommandRestrictions(commands, 'user');
      expect(restricted.get('nmap')?.fn()).toBe('test result');
    });

    it('should allow root to call all commands', () => {
      const commands = new Map<string, Command>([
        ['nmap', getMockCommand({ name: 'nmap' })],
        ['decrypt', getMockCommand({ name: 'decrypt' })],
        ['ls', getMockCommand({ name: 'ls' })],
      ]);
      const restricted = applyCommandRestrictions(commands, 'root');
      expect(restricted.get('nmap')?.fn()).toBe('test result');
      expect(restricted.get('decrypt')?.fn()).toBe('test result');
      expect(restricted.get('ls')?.fn()).toBe('test result');
    });

    it('should preserve command metadata when restricting', () => {
      const original = getMockCommand({
        name: 'nmap',
        description: 'Network scan',
        manual: {
          synopsis: 'nmap(target)',
          description: 'Scan ports on target',
        },
      });
      const commands = new Map([['nmap', original]]);
      const restricted = applyCommandRestrictions(commands, 'guest');
      const cmd = restricted.get('nmap');
      expect(cmd?.name).toBe('nmap');
      expect(cmd?.description).toBe('Network scan');
      expect(cmd?.manual?.synopsis).toBe('nmap(target)');
    });

    it('should handle all user-tier commands', () => {
      const userCommands = Object.entries(COMMAND_TIERS)
        .filter(([, tier]) => tier === 'user')
        .map(([name]): readonly [string, Command] => [name, getMockCommand({ name })]);

      const commands = new Map<string, Command>(userCommands);
      const restricted = applyCommandRestrictions(commands, 'guest');

      userCommands.forEach(([name]) => {
        expect(() => restricted.get(name)?.fn()).toThrow('permission denied');
      });
    });

    it('should handle all root-tier commands', () => {
      const rootCommands = Object.entries(COMMAND_TIERS)
        .filter(([, tier]) => tier === 'root')
        .map(([name]): readonly [string, Command] => [name, getMockCommand({ name })]);

      const commands = new Map<string, Command>(rootCommands);
      const restricted = applyCommandRestrictions(commands, 'user');

      rootCommands.forEach(([name]) => {
        expect(() => restricted.get(name)?.fn()).toThrow('permission denied');
      });
    });
  });

  describe('COMMAND_TIERS', () => {
    it('should have decrypt as the only root-tier command', () => {
      const rootCommands = Object.entries(COMMAND_TIERS)
        .filter(([, tier]) => tier === 'root')
        .map(([name]) => name);
      expect(rootCommands).toEqual(['decrypt']);
    });

    it('should have 23 user-tier commands', () => {
      const userCommands = Object.entries(COMMAND_TIERS)
        .filter(([, tier]) => tier === 'user')
        .map(([name]) => name);
      expect(userCommands).toHaveLength(23);
      expect(userCommands).toContain('nmap');
      expect(userCommands).toContain('ssh');
      expect(userCommands).toContain('curl');
      expect(userCommands).toContain('strings');
      expect(userCommands).toContain('nano');
      expect(userCommands).toContain('exploit');
      expect(userCommands).toContain('node');
      expect(userCommands).toContain('missions');
      expect(userCommands).toContain('accept');
      expect(userCommands).toContain('abort');
    });

    it('should not restrict basic commands', () => {
      const basicCommands = [
        'help',
        'man',
        'echo',
        'whoami',
        'pwd',
        'ls',
        'cd',
        'cat',
        'su',
        'clear',
        'author',
      ];
      basicCommands.forEach((name) => {
        expect(COMMAND_TIERS[name]).toBeUndefined();
      });
    });
  });
});
