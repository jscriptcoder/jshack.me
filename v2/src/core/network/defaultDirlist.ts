/**
 * The default path list — the file `apt install gobuster` puts on a player's box,
 * and the thing that decides what a sweep can find.
 *
 * Membership in this list IS the gate, exactly as it is for passwords: a path
 * absent from it is never found however plainly it sits in the document root, and
 * one present in it is found the moment something is served there. That is why the
 * tool must read the FILE on the player's machine rather than this constant — the
 * player owns their copy, edits it with `nano`, and grows it with paths they see
 * referenced elsewhere.
 *
 * It lives beside `http.ts` rather than with the password wordlist because these
 * are HTTP request paths, and `http.ts` is what decides how a request path resolves
 * to a file. The two lists share a shape and nothing else: one widens what a
 * credential attack can open, this one widens what a server will admit to having.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';

/** Where the path list lives, and where a sweep looks for one. Sits alongside the
 *  password wordlist in the directory a player already knows. */
export const DIRLIST_PATH: AbsPath = asAbsPath('/usr/share/wordlists/dirlist.txt');

/** Readable by every tier so a guest-tier tool can consult it, writable only by
 *  root so appending a path is a deliberate act, and NEVER executable — it is data
 *  the tool reads, not a program. Matches the password wordlist exactly. */
export const DIRLIST_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/**
 * The paths a default install tries. Chosen to read like a real dirlist — the
 * things an operator leaves lying around — rather than as a key to this specific
 * world.
 *
 * `admin`, `status`, `server-status`, `api/health` and `metrics` earn their place
 * by being what a real list tries, and nothing more. They once justified
 * themselves by matching what every generated page linked, but pages no longer
 * advertise paths their host cannot serve — a page that invites recon it cannot
 * answer tells the player the server lies. So these find nothing today, exactly
 * like the rest of the list does against a thin world, and they start finding
 * things when generated content grows pages at them. That is the normal state of
 * a wordlist, not a debt.
 */
export const DEFAULT_DIRLIST: readonly string[] = [
  'index.html',
  'admin',
  'administrator',
  'login',
  'logout',
  'dashboard',
  'status',
  'server-status',
  'metrics',
  'health',
  'api',
  'api/health',
  'api/v1',
  'backup',
  'backups',
  'config',
  'config.php',
  'settings',
  'db',
  'database',
  'dump.sql',
  'uploads',
  'files',
  'images',
  'assets',
  'static',
  'private',
  'internal',
  'staging',
  'test',
  'tmp',
  'old',
  'robots.txt',
  'sitemap.xml',
  'readme.txt',
  'notes.txt',
  'todo.txt',
  '.git',
  '.env',
  'wp-admin',
];

/** Render a path list as file content: one path per line, no trailing blank — a
 *  blank line would probe the document root itself on every run. */
export const formatDirlist = (paths: readonly string[]): string => paths.join('\n');

/** Read file content back into candidate paths. Blank lines are dropped: an editor
 *  leaves a trailing newline behind, and the empty path is not something the player
 *  typed into their list. */
export const parseDirlist = (content: string): readonly string[] =>
  content.split('\n').filter((path) => path.length > 0);
