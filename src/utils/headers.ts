import type { RateLimitDecision } from "../types.js";

export function buildRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    "ratelimit-limit": String(decision.limit),
    "ratelimit-remaining": String(decision.remaining),
    "ratelimit-reset": String(Math.max(0, Math.ceil(decision.resetAfterMs / 1000))),
    "ratelimit-policy": decision.policy,
    "retry-after": String(decision.retryAfterSeconds),
  };
}

export function applyHeaders(
  setHeader: (name: string, value: string) => void,
  decision: RateLimitDecision,
): void {
  const headers = buildRateLimitHeaders(decision);
  for (const [name, value] of Object.entries(headers)) {
    setHeader(name, value);
  }
}
