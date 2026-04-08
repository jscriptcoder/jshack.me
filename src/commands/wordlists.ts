import { guestPasswords, wordlistPasswords } from '../generation/pools';

// Passwords wordlist — installed with hydra via apt.
// Contains guest + wordlist passwords, one per line.
// Hydra reads this file to determine which passwords are crackable.
export const passwordsWordlistContent: string = [...guestPasswords, ...wordlistPasswords].join(
  '\n',
);

// Directory/file wordlist — installed with gobuster via apt.
// Gobuster only reveals entries whose top-level name matches this list.
// Aligned with httpEntryCredentialTemplates and web content templates.
const DIRLIST_ENTRIES = [
  // Matches httpEntryCredentialTemplates top-level paths
  '.env',
  '.git',
  'admin',
  'api',
  'backup',
  'config',
  'health',
  'phpinfo.php',
  'robots.txt',
  'server-status',
  'status',
  'wp-config.php.bak',
  // Common web directories (realistic dirb/dirbuster list)
  'cgi-bin',
  'css',
  'dashboard',
  'db',
  'debug',
  'docs',
  'files',
  'fonts',
  'images',
  'img',
  'includes',
  'js',
  'lib',
  'login',
  'logs',
  'media',
  'metrics',
  'panel',
  'private',
  'public',
  'scripts',
  'static',
  'test',
  'tmp',
  'uploads',
  'vendor',
  'wp-admin',
  'wp-content',
  // Common file names
  '.htaccess',
  '.htpasswd',
  'favicon.ico',
  'index.html',
  'index.php',
  'sitemap.xml',
  'web.config',
] as const;

export const dirlistWordlistContent: string = DIRLIST_ENTRIES.join('\n');
