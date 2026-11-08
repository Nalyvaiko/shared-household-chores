"use client";

import { useEffect } from "react";

/**
 * `href` as a path without the `name` search param, keeping the other params
 * and the hash, or null when `name` isn't there.
 */
export function urlWithoutSearchParam(href: string, name: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(name)) return null;
  url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Removes a one-time search param (such as `notice` on `/chores`) from the
 * address bar once the page that read it has rendered, without a navigation,
 * so a reload doesn't show it again. Renders nothing.
 */
export function DropSearchParam({ name }: { name: string }) {
  useEffect(() => {
    const next = urlWithoutSearchParam(window.location.href, name);
    // Next.js syncs its router with history.replaceState, without a request.
    if (next !== null) window.history.replaceState(null, "", next);
  }, [name]);

  return null;
}
