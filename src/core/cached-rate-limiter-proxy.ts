import type {
  RateLimitCheckOptions,
  RateLimitDecision,
  RateLimiterLike,
} from "../types.js";

interface CacheEntry {
  decision: RateLimitDecision;
  expiresAt: number;
}

/**
 * Pattern: Proxy
 * Problem: Extremely hot endpoints can hit the backing store repeatedly within the same micro-burst.
 * Solution: This proxy caches recent decisions for a short TTL while preserving the limiter API.
 * Trade-off: Very small staleness window; justified only for intentionally tiny cache durations.
 */
export class CachedRateLimiterProxy implements RateLimiterLike {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: RateLimiterLike,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async check(
    key: string,
    options: RateLimitCheckOptions = {},
  ): Promise<RateLimitDecision> {
    const cacheKey = `${key}:${options.cost ?? 1}`;
    const currentTime = this.now();
    const cached = this.entries.get(cacheKey);

    if (cached && cached.expiresAt > currentTime) {
      return cloneDecision(cached.decision);
    }

    const decision = await this.inner.check(key, options);
    this.entries.set(cacheKey, {
      decision: cloneDecision(decision),
      expiresAt: currentTime + this.ttlMs,
    });

    return decision;
  }

  async reset(key: string): Promise<void> {
    for (const cacheKey of this.entries.keys()) {
      if (cacheKey === key || cacheKey.startsWith(`${key}:`)) {
        this.entries.delete(cacheKey);
      }
    }

    await this.inner.reset(key);
  }
}

function cloneDecision(decision: RateLimitDecision): RateLimitDecision {
  return {
    ...decision,
    checkedAt: new Date(decision.checkedAt.getTime()),
    resetAt: new Date(decision.resetAt.getTime()),
  };
}
