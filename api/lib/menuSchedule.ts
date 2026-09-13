export const MENU_SYNC_TIME_ZONE = "America/New_York";

export type MenuRefreshWindow = {
  localDate: string;
  localHour: number;
  shouldRun: boolean;
};

/**
 * Vercel schedules in UTC. The project invokes the cron at both possible UTC
 * equivalents of 4 AM Eastern (08:00 and 09:00); this gate selects exactly the
 * one that is 4 AM in New York on that date, including DST transition days.
 */
export function menuRefreshWindow(now: Date, hour = 4): MenuRefreshWindow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MENU_SYNC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const localHour = Number(value("hour"));
  return { localDate, localHour, shouldRun: localHour === hour };
}

export function isVercelCron(userAgent: string | string[] | undefined): boolean {
  return (Array.isArray(userAgent) ? userAgent[0] : userAgent) === "vercel-cron/1.0";
}
