import { peekWindowCount } from "./rateLimit.js";

/**
 * The site-wide card-decline counter. api/order/create.ts adds one per definite decline (a fixed
 * 15-minute window in rate_counters) and emails the owner when a window passes the limit;
 * /api/admin/clover-status reads the same counter so a spike can be checked on demand.
 */
export const CARD_DECLINE_BUCKET = "card-declines:all";
export const CARD_DECLINE_WINDOW_SEC = 900;
/** More than this many declines in one window is treated as a spike. */
export const CARD_DECLINE_ALERT_ABOVE = 8;

export type CardDeclineCount = {
  windowMinutes: number;
  alertAbove: number;
  /** When the current window began (UTC). */
  windowStartedAt: string;
  /** Declines so far in the current window, and in the one before it; null if unreadable. */
  current: number | null;
  previous: number | null;
};

/** Never throws: an unreadable counter reports null, so the status check still answers. */
export async function cardDeclineCount(now = Date.now()): Promise<CardDeclineCount> {
  const windowStart = Math.floor(now / 1000 / CARD_DECLINE_WINDOW_SEC) * CARD_DECLINE_WINDOW_SEC;
  let current: number | null = null;
  let previous: number | null = null;
  try {
    [current, previous] = await Promise.all([
      peekWindowCount(CARD_DECLINE_BUCKET, windowStart),
      peekWindowCount(CARD_DECLINE_BUCKET, windowStart - CARD_DECLINE_WINDOW_SEC),
    ]);
  } catch (err) {
    console.error("[cardDeclines] decline count unavailable", err);
    current = previous = null;
  }
  return {
    windowMinutes: CARD_DECLINE_WINDOW_SEC / 60,
    alertAbove: CARD_DECLINE_ALERT_ABOVE,
    windowStartedAt: new Date(windowStart * 1000).toISOString(),
    current,
    previous,
  };
}
