import { vi } from "vitest";

// `server-only` throws when imported outside a React Server Components build.
// Next handles it itself; under Vitest it is replaced with an empty module so
// server modules such as `lib/auth/guards.ts` can be tested.
vi.mock("server-only", () => ({}));
