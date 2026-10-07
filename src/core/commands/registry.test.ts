import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry.js';
import { COMMAND_CATEGORIES } from './types.js';
import { scriptIdentifier } from '../scripting/commandContext.js';

describe('commandRegistry', () => {
  it('keys each registered command by its own `name`', () => {
    // Load-bearing invariant: a future `['ls', cat]` typo, a renamed
    // command whose import-key wasn't updated, or a tuple-swap mutation
    // ([command.name, command] → [command, command.name]) would all
    // surface here. Existing terminal integration tests catch the more
    // obvious "command not found" failures; this test catches the
    // *silent* shadowing where one name resolves to a wrong command.
    for (const [key, command] of commandRegistry) {
      expect(command.name).toBe(key);
    }
  });

  it('assigns every registered command a known category', () => {
    // Drives the `category` field `help` groups by: a command that forgot
    // to declare one (or declared a typo'd value) can never be sectioned,
    // so it would silently vanish from the `help` listing.
    for (const command of commandRegistry.values()) {
      expect(COMMAND_CATEGORIES).toContain(command.category);
    }
  });

  it('gives every command a JS identifier a script can be given', () => {
    // Each name becomes a formal PARAMETER of the script sandbox's function.
    // A name that derives a reserved word, an invalid identifier, or a
    // duplicate is a SyntaxError at the point the function is built — which
    // takes down EVERY script in the game at once, for a reason the player
    // cannot see and the author of the new command would never connect to it.
    // Hence the guard here rather than in the scripting tests: this fires the
    // day the command is added, not the day someone writes a script.
    const reserved = new Set([
      'await',
      'break',
      'case',
      'catch',
      'class',
      'const',
      'continue',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'enum',
      'export',
      'extends',
      'false',
      'finally',
      'for',
      'function',
      'if',
      'implements',
      'import',
      'in',
      'instanceof',
      'interface',
      'let',
      'new',
      'null',
      'package',
      'private',
      'protected',
      'public',
      'return',
      'static',
      'super',
      'switch',
      'this',
      'throw',
      'true',
      'try',
      'typeof',
      'var',
      'void',
      'while',
      'with',
      'yield',
    ]);
    const identifiers = [...commandRegistry.keys()].map(scriptIdentifier);

    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
      expect(reserved).not.toContain(identifier);
    }
    // `console`, `fs`, `process` and `sleep` are injected alongside them and
    // would be displaced by a collision, so they count as taken. A command named
    // `fs` would silently shadow the filesystem for every script on the box, and
    // one named `sleep` would take away the only await Ctrl-C is guaranteed to
    // reach.
    expect(new Set([...identifiers, 'console', 'fs', 'process', 'sleep']).size).toBe(
      identifiers.length + 4,
    );
  });

  it('categorises echo under general and the filesystem commands under filesystem', () => {
    // Spot-check the data mappings so an "everything is filesystem" or a
    // swapped-label regression is caught, not just a missing field.
    expect(commandRegistry.get('echo')?.category).toBe('general');
    expect(commandRegistry.get('identity')?.category).toBe('general');
    expect(commandRegistry.get('author')?.category).toBe('general');
    expect(commandRegistry.get('xterm')?.category).toBe('general');
    expect(commandRegistry.get('ls')?.category).toBe('filesystem');
    expect(commandRegistry.get('cat')?.category).toBe('filesystem');
  });
});

/**
 * No IP tool is left at home. Every command that reaches another machine runs from the
 * box the shell stands on, so each `network`-category command is accounted for exactly
 * once: an IP tool that travels from the vantage, or a box-local tool that does not. A
 * command added later in neither list fails here the day it is registered — forcing its
 * author either to wire the vantage and prove it in that tool's own "from a hop" tests,
 * or to record why it stays put.
 *
 * The IP list is decision 2's roster; the per-tool runtime proof that each carries the
 * shell's box lives in each tool's own test file (ssh/nmap/curl/… "from a hop"). What
 * this guard owns is completeness: the set cannot grow a tool that nobody decided about.
 */
describe('every IP tool runs from a hop, and only box-local tools stay home', () => {
  // Reaches another machine, so it travels from the vantage (decision 2).
  const IP_TOOLS: ReadonlySet<string> = new Set([
    'ssh',
    'scp',
    'ftp',
    'nc',
    'nmap',
    'ping',
    'curl',
    'lynx',
    'gobuster',
    'hydra',
    'mysql',
    'redis-cli',
    'snmpwalk',
    'snmpset',
    'msfconsole',
    'apt',
    'dig',
    'nslookup',
  ]);

  // Acts on the box itself, so where the shell stands does not move it.
  const BOX_LOCAL_TOOLS: ReadonlyMap<string, string> = new Map([
    ['sshd', 'daemon — brings a service up on the box it runs on'],
    ['vsftpd', 'daemon — brings a service up on the box it runs on'],
    ['nginx', 'daemon — brings a service up on the box it runs on'],
    ['apache2', 'daemon — brings a service up on the box it runs on'],
    ['mysqld', 'daemon — brings a service up on the box it runs on'],
    ['named', 'daemon — brings a service up on the box it runs on'],
    ['redis-server', 'daemon — brings a service up on the box it runs on'],
    ['systemctl', 'controls the box’s own services'],
    ['kill', 'ends one of the box’s own processes'],
    ['ps', 'lists the box’s own processes'],
    ['ifconfig', 'reads out where the shell stands (decision 9)'],
    ['whois', 'a registry lookup reveals nothing location-dependent (decision 2)'],
  ]);

  const networkCommands = [...commandRegistry.values()]
    .filter((command) => command.category === 'network')
    .map((command) => command.name);

  it('classifies every network-category command as an IP tool or a box-local one', () => {
    for (const name of networkCommands) {
      // Exactly one bucket: a new command lands in neither and fails here, so it cannot
      // be registered as a network tool without a decision about where it runs from.
      const classified = IP_TOOLS.has(name) !== BOX_LOCAL_TOOLS.has(name);
      expect(classified, `${name} is in neither (or both) of the IP / box-local lists`).toBe(true);
    }
  });

  it('keeps no stale name in either list that the registry no longer carries', () => {
    const registered = new Set(networkCommands);
    for (const name of [...IP_TOOLS, ...BOX_LOCAL_TOOLS.keys()]) {
      expect(registered.has(name), `${name} is listed but no longer a network command`).toBe(true);
    }
  });
});
