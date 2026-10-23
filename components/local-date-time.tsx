"use client";

import { useSyncExternalStore } from "react";

import { formatLocalDateTime, formatUtcDateTime } from "@/lib/date-time-format";

const noSubscription = () => () => {};

/**
 * A date and time as `<time>`. The server and the first client render show
 * the UTC text ("23 Oct 2026, 14:05 UTC"), so hydration always matches and
 * the time stays unambiguous without JavaScript. Once hydrated it shows the
 * same format in the browser's time zone, without the zone name.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  // false on the server and during hydration, true afterwards.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const date = new Date(iso);

  return (
    <time dateTime={iso}>{hydrated ? formatLocalDateTime(date) : formatUtcDateTime(date)}</time>
  );
}
