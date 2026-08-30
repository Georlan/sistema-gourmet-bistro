import { parseBackendTimestamp } from '../utils/dateTime';

/**
 * Normalizes any timestamp input (number, ISO string, clock HH:MM string, Date)
 * into a valid unix timestamp in milliseconds, handling timezone offsets.
 */
export function normalizeOperationalTimestamp(raw: unknown, now: number = Date.now()): number | null {
  const date = parseBackendTimestamp(raw as string | number | Date | null | undefined, now);
  return date ? date.getTime() : null;
}

/**
 * Gets the elapsed time since the first order was made.
 * Returns formatted string like "45m" or "1h 12m" or "--".
 */
export function formatElapsedTime(
  firstOrderTimestamp: number | string | Date | undefined | null,
  currentTime: number = Date.now()
): string {
  const ts = normalizeOperationalTimestamp(firstOrderTimestamp, currentTime);
  if (ts === null) return '--';
  const diffMs = Math.max(0, currentTime - ts);

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  const hours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  return `${hours}h ${remainingMins}m`;
}
