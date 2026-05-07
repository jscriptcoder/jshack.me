import type { Prng } from '../prng';
import type { FileNode } from '../../filesystem/types';
import {
  credentialLeakTemplates,
  crossMachineCredentialLeakTemplates,
  httpEntryCredentialTemplates,
  webCredentialTemplates,
} from '../pools';
import { wrapInBinaryNoise } from '../binary';
import { mkFile, mkDir, fillTemplate, findLeafDir, buildNestedDirs } from './helpers';
import type { SameLayerCredential } from './sameLayerCredentials';

const CREDENTIAL_LEAK_CHANCE = 0.3;

// Places a credential leak file on a machine ~30% of the time.
// Leaks a user-type account's credentials in a guest-readable location.
// DB-themed templates use MySQL credentials when available; others use system credentials.
// Always consumes 2 PRNG calls for sequence stability.
export const placeCredentialLeak = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  mysqlCreds: readonly { readonly username: string; readonly password: string }[] | undefined,
  extraDirectories: Record<string, FileNode>,
  etcExtraContent: Record<string, FileNode>,
): void => {
  const roll = prng.next();
  const template = prng.pick(credentialLeakTemplates);

  // DB-themed templates use MySQL credentials; system-themed use system credentials
  const isDbTemplate = template.credentialType === 'mysql';
  const cred =
    isDbTemplate && mysqlCreds && mysqlCreds.length > 0
      ? (mysqlCreds.find((c) => c.username !== 'root' && c.username !== 'readonly') ??
        mysqlCreds[0])
      : machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (roll >= CREDENTIAL_LEAK_CHANCE || !cred) return;

  const content = fillTemplate(template.content, {
    username: cred.username,
    password: cred.password,
  });

  const segments = template.path.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'config';
  const fileContent = template.binary ? wrapInBinaryNoise(prng, content) : content;

  // Guest-readable: use 'guest' owner so all users can read
  const file = mkFile(fileName, fileContent, 'guest');

  const topDir = segments[0] ?? 'etc';

  // /etc/ files go into etcExtraContent (merged into the /etc/ directory by the factory)
  if (topDir === 'etc') {
    // For nested /etc/ paths like /etc/crontab, place directly in etcExtraContent
    if (segments.length === 2) {
      etcExtraContent[fileName] = file;
    } else {
      // Deeper paths like /etc/foo/bar — build nested dirs
      const subSegments = segments.slice(1);
      etcExtraContent[subSegments[0] as string] = buildNestedDirs(subSegments, file);
    }
    return;
  }

  // Other paths (/tmp/, /srv/, /opt/, /var/, /usr/) go into extraDirectories.
  // If the top-level directory already exists (e.g., /var/ from web content),
  // merge the leak file into the existing tree's deepest directory.
  const existingDir = extraDirectories[topDir];
  if (existingDir) {
    const leafDir = findLeafDir(existingDir);
    if (leafDir?.children) {
      (leafDir.children as Record<string, FileNode>)[fileName] = file;
    }
  } else {
    extraDirectories[topDir] = buildNestedDirs(segments, file);
  }
};

const CROSS_MACHINE_LEAK_CHANCE = 0.3;

// Places a cross-machine credential leak file on a machine ~30% of the time.
// These reference same-layer peer machines, enabling lateral movement after escalation.
// Files are root- or user-owned (NOT guest) — requires privilege escalation to read.
// Always consumes 3 PRNG calls for sequence stability.
export const placeCrossMachineCredentialLeak = (
  prng: Prng,
  sameLayerCreds: readonly SameLayerCredential[],
  ownerUsername: string,
  extraDirectories: Record<string, FileNode>,
  etcExtraContent: Record<string, FileNode>,
): void => {
  const roll = prng.next();
  const template = prng.pick(crossMachineCredentialLeakTemplates);
  const targetIdx = prng.nextInt(0, Math.max(sameLayerCreds.length, 1));

  if (roll >= CROSS_MACHINE_LEAK_CHANCE || sameLayerCreds.length === 0) return;

  const target = sameLayerCreds[targetIdx % sameLayerCreds.length]!;

  const content = fillTemplate(template.content, {
    target_ip: target.ip,
    target_username: target.username,
    target_password: target.password,
    owner: ownerUsername,
  });

  const path = fillTemplate(template.path, { owner: ownerUsername });
  const segments = path.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? 'config';
  const fileContent = template.binary ? wrapInBinaryNoise(prng, content) : content;

  const file = mkFile(fileName, fileContent, template.owner);

  const topDir = segments[0] ?? 'etc';

  if (topDir === 'etc') {
    if (segments.length === 2) {
      etcExtraContent[fileName] = file;
    } else {
      const subSegments = segments.slice(1);
      etcExtraContent[subSegments[0] as string] = buildNestedDirs(subSegments, file);
    }
    return;
  }

  const existingDir = extraDirectories[topDir];
  if (existingDir) {
    const leafDir = findLeafDir(existingDir);
    if (leafDir?.children) {
      (leafDir.children as Record<string, FileNode>)[fileName] = file;
    }
  } else {
    extraDirectories[topDir] = buildNestedDirs(segments, file);
  }
};

const WEB_CREDENTIAL_CHANCE = 0.3;

// Places same-machine credentials in /var/www/html/ on non-entry web machines (~30%).
// Supports body-based (creds in file content) and header-based (.headers sidecar).
// Always consumes 2 PRNG calls for sequence stability.
export const placeWebCredentials = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  htmlChildren: Record<string, FileNode>,
): void => {
  const roll = prng.next();
  const template = prng.pick(webCredentialTemplates);

  const userCred = machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (roll >= WEB_CREDENTIAL_CHANCE || !userCred) return;

  if (template.sidecarHeader) {
    const credString = `${userCred.username}:${userCred.password}`;
    const sidecarContent = `${template.sidecarHeader}: ${credString}`;
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;
    const sidecarName = `${fileName}.headers`;

    if (segments.length === 1) {
      if (template.content) {
        htmlChildren[fileName] = mkFile(fileName, template.content);
      }
      htmlChildren[sidecarName] = mkFile(sidecarName, sidecarContent);
    } else {
      const dirName = segments[0] as string;
      const dirChildren: Record<string, FileNode> = {
        ...(template.content ? { [fileName]: mkFile(fileName, template.content) } : {}),
        [sidecarName]: mkFile(sidecarName, sidecarContent),
      };
      htmlChildren[dirName] = mkDir(dirName, dirChildren, 'root', true);
    }
  } else {
    const content = fillTemplate(template.content, {
      username: userCred.username,
      password: userCred.password,
    });
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;

    if (segments.length === 1) {
      htmlChildren[fileName] = mkFile(fileName, content);
    } else {
      const dirName = segments[0] as string;
      htmlChildren[dirName] = mkDir(
        dirName,
        { [fileName]: mkFile(fileName, content) },
        'root',
        true,
      );
    }
  }
};

// Places SSH credentials in /var/www/html/ for HTTP entry variant missions.
// PRNG picks a template: body-based (creds in file content) or header-based
// (creds in .headers sidecar, discoverable via curl -i).
// Files are root-owned — curl serves them (reads as root), but users can't cat them locally.
export const placeHttpEntryCredentials = (
  prng: Prng,
  machineCreds: readonly { readonly username: string; readonly password: string }[],
  htmlChildren: Record<string, FileNode>,
): void => {
  const userCred = machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest');
  if (!userCred) return;

  const template = prng.pick(httpEntryCredentialTemplates);
  const credString = `${userCred.username}:${userCred.password}`;

  if (template.sidecarHeader) {
    // Header-based: create .headers sidecar file with credential header.
    // For 'index.html', the body already exists — only add the sidecar.
    // For other paths, create both the body file and its sidecar.
    const sidecarContent = `${template.sidecarHeader}: ${credString}`;
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;
    const sidecarName = `${fileName}.headers`;

    if (segments.length === 1) {
      // Top-level path (e.g., 'index.html', 'status')
      if (template.content) {
        htmlChildren[fileName] = mkFile(fileName, template.content);
      }
      htmlChildren[sidecarName] = mkFile(sidecarName, sidecarContent);
    } else {
      // Nested path (e.g., 'admin/debug.html')
      const dirName = segments[0] as string;
      const dirChildren: Record<string, FileNode> = {
        ...(template.content ? { [fileName]: mkFile(fileName, template.content) } : {}),
        [sidecarName]: mkFile(sidecarName, sidecarContent),
      };
      htmlChildren[dirName] = mkDir(dirName, dirChildren, 'root', true);
    }
  } else {
    // Body-based: credentials are in the file content itself
    const content = fillTemplate(template.content, {
      username: userCred.username,
      password: userCred.password,
    });
    const segments = template.webPath.split('/');
    const fileName = segments[segments.length - 1] as string;

    if (segments.length === 1) {
      htmlChildren[fileName] = mkFile(fileName, content);
    } else {
      const dirName = segments[0] as string;
      htmlChildren[dirName] = mkDir(
        dirName,
        { [fileName]: mkFile(fileName, content) },
        'root',
        true,
      );
    }
  }
};
