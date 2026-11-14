import { AsyncLocalStorage } from "node:async_hooks";

// The signed-in user per async call chain, so parallel calls in one test can
// act as different users. Read by the `@/auth` mock in setup.ts.
const storage = new AsyncLocalStorage<string>();

/** The session `auth()` returns: the user `asUser()` set, or none. */
export function currentSession() {
  const userId = storage.getStore();
  return userId ? { user: { id: userId }, expires: "2999-01-01T00:00:00.000Z" } : null;
}

/** Runs `fn` signed in as `userId`. */
export function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(userId, fn);
}
