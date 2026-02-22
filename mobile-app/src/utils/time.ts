export function unixTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isoNow(): string {
  return new Date().toISOString();
}
