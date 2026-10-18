import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

/** How long a new invite link stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A new opaque invite token: 32 random bytes as base64url, which is 43
 * URL-safe characters. It is stored as-is so the admin can see the link again.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What `generateInviteToken()` produces: exactly 43 base64url characters. */
const INVITE_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether `value` has the shape of a generated invite token. Checked before
 * any database lookup, so a malformed link never reaches the database.
 */
export function isWellFormedInviteToken(value: unknown): value is string {
  return typeof value === "string" && INVITE_TOKEN_FORMAT.test(value);
}

/** What an invite link means for the person opening it. */
export type InviteStatus =
  | "unknown"
  | "member-here"
  | "other-household"
  | "used"
  | "expired"
  | "valid";

/**
 * The status of an invite for a signed-in user, checked in this order:
 * unknown, already a member of this household, in another household, used,
 * expired, valid. `callerHouseholdId` is the household the user belongs to,
 * or `null` when they have none. A replaced link has `expiresAt` set to the
 * moment it was replaced, so it reads as expired.
 */
export function inviteStatus(
  invite: { householdId: string; consumedAt: Date | null; expiresAt: Date } | null,
  callerHouseholdId: string | null,
  now: Date,
): InviteStatus {
  if (!invite) return "unknown";
  if (callerHouseholdId === invite.householdId) return "member-here";
  if (callerHouseholdId) return "other-household";
  if (invite.consumedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/**
 * Matches the household's active invites: not used yet and not expired. A
 * replaced link has `expiresAt` set to the moment it was replaced, so it is
 * no longer active.
 */
export function activeInviteWhere(
  householdId: string,
  now: Date,
): Prisma.InviteTokenWhereInput {
  return { householdId, consumedAt: null, expiresAt: { gt: now } };
}

/** The minimal header interface `resolveOrigin()` reads from. */
type HeaderSource = { get(name: string): string | null };

/** First value of a header that proxies may send as a comma-separated list. */
function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

/**
 * The origin invite URLs are built on, worked out per request and never
 * stored. `AUTH_URL` wins when it is set to a valid URL. Otherwise the origin
 * comes from `x-forwarded-proto` (default `http`) and `x-forwarded-host`,
 * falling back to `host`. Returns `""` when there is no host at all, so the
 * link degrades to a relative path rather than a made-up host.
 */
export function resolveOrigin(
  headers: HeaderSource,
  authUrl: string | undefined = process.env.AUTH_URL,
): string {
  if (authUrl) {
    try {
      return new URL(authUrl).origin;
    } catch {
      // Not a valid URL: fall through to the request headers.
    }
  }

  const host = firstValue(headers.get("x-forwarded-host")) ?? firstValue(headers.get("host"));
  if (!host) return "";
  const proto = firstValue(headers.get("x-forwarded-proto")) ?? "http";
  return `${proto}://${host}`;
}

/** The full invite URL for a token on the given origin. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin}/invite/${token}`;
}

const expiryFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** For example "23 Oct 2026, 14:05 UTC". Formatted on the server, in UTC. */
export function formatExpiry(date: Date): string {
  return expiryFormat.format(date);
}
