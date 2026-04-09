export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function fromDate(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function toDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}
