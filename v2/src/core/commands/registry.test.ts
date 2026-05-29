import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry';
import { COMMAND_CATEGORIES } from './types';

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

  it('categorises echo under general and the filesystem commands under filesystem', () => {
    // Spot-check the data mappings so an "everything is filesystem" or a
    // swapped-label regression is caught, not just a missing field.
    expect(commandRegistry.get('echo')?.category).toBe('general');
    expect(commandRegistry.get('identity')?.category).toBe('general');
    expect(commandRegistry.get('ls')?.category).toBe('filesystem');
    expect(commandRegistry.get('cat')?.category).toBe('filesystem');
  });
});
