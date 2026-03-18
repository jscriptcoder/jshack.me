export type SshdAdapter = {
  readonly isPortOpen: (port: number) => boolean;
  readonly pidFileExists: () => boolean;
  readonly writePidFile: (content: string) => void;
};

const DEFAULT_PORT = 22;

const parsePort = (args: readonly unknown[]): number => {
  if (args.length === 0) return DEFAULT_PORT;

  const port = Number(args[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('sshd: invalid port number');
  }
  return port;
};

export const startSshd = (adapter: SshdAdapter, args: readonly unknown[]): string => {
  const port = parsePort(args);

  if (adapter.isPortOpen(port) || adapter.pidFileExists()) {
    return `sshd is already running on port ${port}`;
  }

  adapter.writePidFile(`sshd:port=${port}`);
  return [
    `Starting OpenSSH server...`,
    `sshd is running on port ${port}`,
    `Server listening on 0.0.0.0 port ${port}.`,
  ].join('\n');
};
