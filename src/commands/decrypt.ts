import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { decryptContent } from '../utils/crypto';

type DecryptContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
};

const DECRYPT_DELAY_MS = 500;

export const createDecryptCommand = (context: DecryptContext): Command => ({
  name: 'decrypt',
  description: 'Decrypt a file using AES-256',
  manual: {
    synopsis: 'decrypt(file, key)',
    description:
      'Decrypt an encrypted file using a 256-bit key. ' +
      'The file should contain base64-encoded encrypted data. ' +
      'The key should be a 64-character hex string (256 bits).',
    arguments: [
      {
        name: 'file',
        description: 'Path to the encrypted file',
        required: true,
      },
      {
        name: 'key',
        description: 'Decryption key as hex string (64 characters)',
        required: true,
      },
    ],
    examples: [
      {
        command: 'decrypt("secret.enc", "a1b2c3...")',
        description: 'Decrypt a file with the given key',
      },
      {
        command: 'decrypt("/home/ghost/message.enc", key)',
        description: 'Decrypt using a key stored in a variable',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { resolvePath, getNode, getUserType } = context;

    const filePath = args[0] as string | undefined;
    const key = args[1] as string | undefined;

    if (!filePath) {
      throw new Error('decrypt: missing file path\nUsage: decrypt("file", "key")');
    }

    if (!key) {
      throw new Error('decrypt: missing key\nUsage: decrypt("file", "key")');
    }

    const cleanKey = key.replace(/\s/g, '');
    // 64 hex chars = 256 bits key length
    if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      throw new Error(
        'decrypt: invalid key format\nKey must be 64 hexadecimal characters (256 bits)',
      );
    }

    const userType = getUserType();
    const targetPath = resolvePath(filePath);
    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`decrypt: ${filePath}: No such file or directory`);
    }

    if (node.type === 'directory') {
      throw new Error(`decrypt: ${filePath}: Is a directory`);
    }

    if (!node.permissions.read.includes(userType) && userType !== 'root') {
      throw new Error(`decrypt: ${filePath}: Permission denied`);
    }

    const encryptedContent = node.content ?? '';
    if (!encryptedContent) {
      throw new Error(`decrypt: ${filePath}: File is empty`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine('Decrypting...');

        token.schedule(() => {
          if (token.isCancelled()) return;

          try {
            const decrypted = decryptContent(encryptedContent, cleanKey);
            onLine('');
            onLine(decrypted);
            onComplete();
          } catch {
            onLine('');
            onLine('Error: Decryption failed - invalid key or corrupted data');
            onComplete();
          }
        }, jitter(DECRYPT_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
