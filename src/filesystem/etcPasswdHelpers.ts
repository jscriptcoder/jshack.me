import type { UserType } from '../session/types';

// Pure helpers for parsing /etc/passwd content.
//
// /etc/passwd is the canonical credential source across the SSH/SCP/FTP
// auth paths and SSH key fingerprinting. Each consumer needs to look up
// a single user's hash from the file, so the parsing lives here as one
// pure function and is shared across call sites. See plans/etc-passwd-canonical.md.

// Returns the password hash field for `username` from /etc/passwd content,
// or undefined when the file is unreadable, the user is missing, or the
// hash field is empty/garbled. Callers treat undefined as "no credential
// available" — auth fails, key fingerprints can't be computed, hydra has
// no candidate.
export const getEtcPasswdHash = (content: string | null, username: string): string | undefined => {
  if (!content) return undefined;
  const entry = content.split('\n').find((line) => line.split(':')[0] === username);
  if (!entry) return undefined;
  const hash = entry.split(':')[1];
  return hash || undefined;
};

// Derives the userType for `username` from /etc/passwd content. uid 0 →
// root; literal username 'guest' → guest; any other parseable line → user.
// Returns undefined when content is null, the user is missing, or the uid
// field is empty/non-numeric — callers treat undefined as "cannot decide
// from this file" and reject the session-create claim.
//
// Used by createSession's server-side userType validation: the client
// claims a userType, the server reads the live /etc/passwd, derives,
// and rejects on mismatch. See plans/etc-passwd-canonical.md step 5.
export const deriveUserTypeFromEtcPasswd = (
  content: string | null,
  username: string,
): UserType | undefined => {
  if (!content) return undefined;
  const entry = content.split('\n').find((line) => line.split(':')[0] === username);
  if (!entry) return undefined;
  const uidField = entry.split(':')[2];
  if (!uidField) return undefined;
  const uid = Number.parseInt(uidField, 10);
  if (!Number.isFinite(uid)) return undefined;
  if (uid === 0) return 'root';
  if (username === 'guest') return 'guest';
  return 'user';
};
