// Parses sshd pid file content to determine the SSH port to open.
// Pid file format: "sshd:port=22" or "sshd:port=2222"

export type SshdPortOverride = {
  readonly port: number;
  readonly service: 'ssh';
  readonly open: true;
};

export const parseSshdState = (content: string | undefined): readonly SshdPortOverride[] => {
  if (!content) return [];

  const match = content.match(/^sshd:port=(\d+)$/);
  if (!match) return [];

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];

  return [{ port, service: 'ssh', open: true }];
};
