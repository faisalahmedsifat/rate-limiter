export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function toWholeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value + 1e-9)) : 0;
}

export function normalizeRawRedisResult(
  raw: unknown,
  strategyName: string,
): [string, string, string, string, string, string, string] {
  if (!Array.isArray(raw) || raw.length < 7) {
    throw new TypeError(
      `Redis program for "${strategyName}" returned an unexpected result.`,
    );
  }

  return [
    String(raw[0]),
    String(raw[1]),
    String(raw[2]),
    String(raw[3]),
    String(raw[4]),
    String(raw[5]),
    String(raw[6]),
  ];
}
