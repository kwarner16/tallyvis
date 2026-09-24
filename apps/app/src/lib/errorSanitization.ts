/**
 * Blocklist-based (not strict-allowlist) check for whether a caught
 * error's own `message` is safe to return verbatim to an end user.
 *
 * Written after a production incident where a raw
 * `ENOENT: no such file or directory, scandir '/var/task/...'` reached the
 * public estimator UI directly, because several catch blocks trusted
 * `err.message` unconditionally instead of only the small set of
 * deliberately-thrown, user-facing validation/business messages (e.g. "a
 * service address is required"). A strict allowlist would also work but
 * would need updating every time a new legitimate validation message is
 * added anywhere upstream; a blocklist for the shapes an *infrastructure*
 * error actually takes (filesystem paths, connection strings, stack
 * frames, Postgres internals) is more robust to that kind of drift and
 * matches the actual failure this closes. Callers must still always log
 * the real error server-side (see each file's own `logUnexpected`-style
 * helper) — this function only decides what a customer gets to see.
 */
const UNSAFE_MESSAGE_PATTERNS: RegExp[] = [
  // POSIX/Windows error codes that only ever appear on infrastructure failures.
  /\b(ENOENT|EACCES|EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EADDRINUSE|EPIPE)\b/,
  // Absolute filesystem paths.
  /\/var\/task\//,
  /\/(usr|home|etc|tmp)\//,
  /[A-Za-z]:\\/,
  /\bnode_modules\b/,
  // Stack trace lines.
  /^\s*at\s+\S+/m,
  // Connection strings / credentials-shaped content.
  /postgres(ql)?:\/\//i,
  /\bpassword\s*=/i,
  // Postgres/SQL internals that shouldn't leak schema details to a customer.
  /relation ".*" does not exist/i,
  /syntax error at or near/i,
  /\bschema_migrations\b/,
  /\bcolumn ".*" (does not exist|of relation)/i,
];

const MAX_SAFE_MESSAGE_LENGTH = 300;

export function isSafeToShowPublicly(message: string): boolean {
  if (message.length === 0 || message.length > MAX_SAFE_MESSAGE_LENGTH) return false;
  return !UNSAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/** Returns `message` if safe to show a customer, otherwise `fallback`. */
export function sanitizeForPublicDisplay(err: unknown, fallback: string): string {
  if (err instanceof Error && isSafeToShowPublicly(err.message)) return err.message;
  return fallback;
}
