// Parses vsftpd pid file content to determine the FTP port to open.
// Pid file format: "vsftpd:port=21" or "vsftpd:port=2121"

export type FtpdPortOverride = {
  readonly port: number;
  readonly service: 'ftp';
  readonly open: true;
};

export const parseFtpdState = (content: string | undefined): readonly FtpdPortOverride[] => {
  if (!content) return [];

  const match = content.match(/^vsftpd:port=(\d+)$/);
  if (!match) return [];

  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];

  return [{ port, service: 'ftp', open: true }];
};
