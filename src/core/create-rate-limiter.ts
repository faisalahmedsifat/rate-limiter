import { RateLimiterBuilder } from "./rate-limiter-builder.js";
import type { StrategyConfig } from "./strategy-factory.js";
import type { RateLimitStore } from "../stores/rate-limit-store.js";
import type { RateLimiterLike } from "../types.js";

export type CreateRateLimiterConfig = StrategyConfig & {
  cacheMs?: number;
  keyPrefix?: string;
  now?: () => number;
  store?: RateLimitStore;
};

export function createRateLimiter(
  config: CreateRateLimiterConfig,
): RateLimiterLike {
  const builder = new RateLimiterBuilder();

  if (config.store) {
    builder.useStore(config.store);
  } else {
    builder.withMemoryStore();
  }

  if (config.keyPrefix) {
    builder.withKeyPrefix(config.keyPrefix);
  }

  if (config.now) {
    builder.withClock(config.now);
  }

  if (config.cacheMs !== undefined) {
    builder.withCache(config.cacheMs);
  }

  if (config.algorithm === "sliding-window") {
    builder.forSlidingWindow({
      limit: config.limit,
      windowMs: config.windowMs,
    });
  } else {
    builder.forTokenBucket({
      capacity: config.capacity,
      refillRate: config.refillRate,
      refillIntervalMs: config.refillIntervalMs,
    });
  }

  return builder.build();
}
