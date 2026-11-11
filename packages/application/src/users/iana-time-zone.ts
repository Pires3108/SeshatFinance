const ianaNamePattern = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z0-9][A-Za-z0-9_+-]*)*$/u;
const maxTimeZoneLength = 64;

export function isIanaTimeZone(value: string): boolean {
  if (value.length > maxTimeZoneLength || !ianaNamePattern.test(value)) {
    return false;
  }
  try {
    const resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
    return resolved === value || resolved.toLowerCase() !== value.toLowerCase();
  } catch {
    return false;
  }
}
