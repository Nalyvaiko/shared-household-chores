// Date-and-time formats shared by the server and the browser. No Node-only
// imports here: the chore list's client date component uses this module.

const baseOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

const utcFormat = new Intl.DateTimeFormat("en-GB", {
  ...baseOptions,
  timeZone: "UTC",
  timeZoneName: "short",
});

/** For example "23 Oct 2026, 14:05 UTC". */
export function formatUtcDateTime(date: Date): string {
  return utcFormat.format(date);
}

/**
 * The same format in the runtime's own time zone, without the zone name, for
 * example "23 Oct 2026, 16:05" in UTC+2. Only meaningful in the browser.
 */
export function formatLocalDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", baseOptions).format(date);
}
