import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry';

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
});
