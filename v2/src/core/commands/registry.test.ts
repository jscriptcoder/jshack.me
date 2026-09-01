import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry';
import { COMMAND_CATEGORIES } from './types';
import { scriptIdentifier } from '../scripting/commandContext';

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
    expect(commandRegistry.get('ls')?.category).toBe('filesystem');
    expect(commandRegistry.get('cat')?.category).toBe('filesystem');
  });
});
