// Rejects whitespace, control characters (C0, DEL, C1) and backslashes
// anywhere in the value. Browsers strip tabs and newlines from URLs and treat
// `\` like `/`, so `/\t/evil.com` or `/\evil.com` would become `//evil.com`.
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f-\u009f\\]/;

/**
 * Returns `value` when it is a same-origin relative path (`/invite/abc`), and
 * `"/"` for anything else: missing, repeated (an array), absolute URLs (even on
 * our own origin), protocol-relative `//host`, or unsafe characters.
 */
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (UNSAFE_CHARACTERS.test(value)) return "/";
  return value;
}

/**
 * Appends a safe `callbackUrl` to `path` as a query parameter. Leaves `path`
 * alone when there is nothing to carry (the callback is `/`).
 */
export function withCallbackUrl(path: string, callbackUrl: unknown): string {
  const safe = safeCallbackUrl(callbackUrl);
  if (safe === "/") return path;
  return `${path}?${new URLSearchParams({ callbackUrl: safe })}`;
}
