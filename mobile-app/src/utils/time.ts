export function unixTimestampSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export function isoNow(): string {
  return new Date().toISOString();
}
