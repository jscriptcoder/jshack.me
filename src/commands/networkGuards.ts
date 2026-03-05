import type { AsyncOutput, Command } from '../components/Terminal/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

// Higher-order function that wraps a network command with WiFi connectivity gating.
// The isWifiRequired closure is evaluated at execution time (not wrap time), so it
// always reflects the current WiFi state.
export const wrapWithWifiCheck = (cmd: Command, isWifiRequired: () => boolean): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    if (isWifiRequired()) {
      throw new Error('Network is unreachable — wlan0 is not connected');
    }
    return cmd.fn(...args);
  },
});

const BRICKED_TIMEOUT_MS = 3000;

// Wraps a network command with a bricked machine check. Extracts the target IP
// from the first string argument and checks if that machine has been bricked.
// Returns an AsyncOutput with a realistic delay to simulate a connection timeout.
export const wrapWithBrickedCheck = (
  cmd: Command,
  isMachineBricked: (machine: string) => boolean,
): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    const target = args.find((arg) => typeof arg === 'string') as string | undefined;
    if (target && isMachineBricked(target)) {
      const token = createCancellationToken();
      const result: AsyncOutput = {
        __type: 'async',
        start: (onLine, onComplete) => {
          onLine(`Connecting to ${target}...`);

          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(`connect: Connection timed out — host ${target} appears to be down`);
            onComplete();
          }, jitter(BRICKED_TIMEOUT_MS));
        },
        cancel: token.cancel,
      };
      return result;
    }
    return cmd.fn(...args);
  },
});
