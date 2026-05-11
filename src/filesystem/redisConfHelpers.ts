// Server-side parser for /etc/redis/redis.conf — extracts the
// `requirepass` plaintext value, or undefined when the directive is
// absent / commented out / file empty.
//
// Real Redis stores the password in plaintext in its config (no
// hashing — Redis predates that pattern); the game model matches.
// Format: `requirepass <value>` per line, leading whitespace allowed,
// `#`-prefixed lines are comments.

export const findRedisRequirepass = (content: string | null): string | undefined => {
  if (!content) return undefined;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith('requirepass ')) continue;
    const value = trimmed.slice('requirepass '.length).trim();
    if (value.length === 0) continue;
    return value;
  }
  return undefined;
};
