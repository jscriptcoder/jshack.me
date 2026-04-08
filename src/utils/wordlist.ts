import type { FileNode } from '../filesystem/types';

const WORDLIST_DIR = '/usr/share/wordlists';

// Resolves a wordlist file by checking cwd first, then /usr/share/wordlists/.
// Returns parsed lines (trimmed, empty lines filtered out).
export const resolveWordlist = (
  filename: string,
  getNode: (path: string) => FileNode | null,
  cwd: string,
): readonly string[] => {
  const cwdPath = `${cwd === '/' ? '' : cwd}/${filename}`;
  const cwdNode = getNode(cwdPath);
  if (cwdNode?.type === 'file' && cwdNode.content) {
    return parseWordlist(cwdNode.content);
  }

  const sysPath = `${WORDLIST_DIR}/${filename}`;
  const sysNode = getNode(sysPath);
  if (sysNode?.type === 'file' && sysNode.content) {
    return parseWordlist(sysNode.content);
  }

  throw new Error(
    `wordlist not found: ${filename}\n` +
      `Searched: ${cwdPath}, ${sysPath}\n` +
      `Install with: apt('install', 'hydra') or apt('install', 'gobuster')`,
  );
};

const parseWordlist = (content: string): readonly string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
