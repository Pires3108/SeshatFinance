import type { Clock } from './clock.js';

/** Reads an ISO civil date in an explicit IANA zone from an injected UTC clock. */
export function readCivilDate(clock: Clock, timeZone: string): string {
  const instant = clock.now();
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError('A valid UTC instant is required.');
  }
  if (timeZone.trim() === '' || /^[+-]/u.test(timeZone)) {
    throw new RangeError('An IANA time zone is required.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'iso8601',
    numberingSystem: 'latn',
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (value === undefined) throw new RangeError('Civil date is unavailable.');
    return value;
  };
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
