// Server-side parser for /etc/vsftpd/virtual_users.conf — returns the
// password hash for a given username, or undefined when the user is not
// present in the overlay (handler then falls back to /etc/passwd).
//
// Format mirrors src/generation/ftpCredentials.ts's `formatVirtualUsersConf`:
// one entry per line, `username:md5hash`. Whitespace-only and malformed
// lines (missing colon) are skipped. Empty content / null content
// returns undefined.
//
// Kept minimal and server-side-isolated to avoid bundling the generation
// pools/PRNG modules into the serverless function. Drift risk vs the
// generator is bounded — both sides have unit tests pinning the format,
// and the format is trivial.

export const findVirtualUserHash = (
  content: string | null,
  username: string,
): string | undefined => {
  if (!content) return undefined;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.includes(':')) continue;
    const colonIdx = trimmed.indexOf(':');
    const lineUsername = trimmed.slice(0, colonIdx);
    const lineHash = trimmed.slice(colonIdx + 1);
    if (lineUsername === username && lineHash.length > 0) {
      return lineHash;
    }
  }
  return undefined;
};
