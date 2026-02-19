type CancellationToken = {
  readonly isCancelled: () => boolean;
  readonly schedule: (fn: () => void, delay: number) => void;
  readonly cancel: () => void;
};

// Cancellation token for async commands (ping, nmap, ssh, airdump, aircrack).
// Tracks all scheduled timeouts so cancel() can clear them all at once,
// preventing dangling async output after the user interrupts a command.
const createCancellationToken = (): CancellationToken => {
  let cancelled = false;
  const timeoutIds: ReturnType<typeof setTimeout>[] = [];

  return {
    isCancelled: () => cancelled,
    schedule: (fn: () => void, delay: number) => {
      timeoutIds.push(setTimeout(fn, delay));
    },
    cancel: () => {
      cancelled = true;
      timeoutIds.forEach((id) => clearTimeout(id));
    },
  };
};

export { createCancellationToken, type CancellationToken };
