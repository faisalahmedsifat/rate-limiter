import { RateLimiterConfigurationError } from "../errors.js";
import { RateLimiter } from "./rate-limiter.js";
import { CachedRateLimiterProxy } from "./cached-rate-limiter-proxy.js";
import {
  SlidingWindowStrategy,
  type SlidingWindowConfig,
} from "../strategies/sliding-window-strategy.js";
import {
  TokenBucketStrategy,
  type TokenBucketConfig,
} from "../strategies/token-bucket-strategy.js";
import { MemoryStore } from "../stores/memory-store.js";
import type { RateLimitStore } from "../stores/rate-limit-store.js";
import type { RateLimiterLike, RateLimitStrategy } from "../types.js";

/**
 * Pattern: Builder
 * Problem: Limiter construction spans strategy choice, store choice, key scoping, and optional caching.
 * Solution: The builder makes each choice explicit and validates the combination at build time.
 * Trade-off: More ceremony than a bare constructor; justified because the configuration surface is non-trivial.
 */
export class RateLimiterBuilder {
  private store: RateLimitStore | undefined;
  private strategy: RateLimitStrategy<unknown> | undefined;
  private keyPrefix: string | undefined;
  private cacheTtlMs: number | undefined;
  private now: (() => number) | undefined;

  useStore(store: RateLimitStore): this {
    this.store = store;
    return this;
  }

  withMemoryStore(): this {
    this.store = new MemoryStore();
    return this;
  }

  useStrategy(strategy: RateLimitStrategy<unknown>): this {
    this.strategy = strategy;
    return this;
  }

  forSlidingWindow(config: SlidingWindowConfig): this {
    this.strategy = new SlidingWindowStrategy(config);
    return this;
  }

  forTokenBucket(config: TokenBucketConfig): this {
    this.strategy = new TokenBucketStrategy(config);
    return this;
  }

  withKeyPrefix(prefix: string): this {
    this.keyPrefix = prefix;
    return this;
  }

  withCache(ttlMs: number): this {
    this.cacheTtlMs = ttlMs;
    return this;
  }

  withClock(now: () => number): this {
    this.now = now;
    return this;
  }

  build(): RateLimiterLike {
    if (!this.strategy) {
      throw new RateLimiterConfigurationError(
        "RateLimiterBuilder requires a strategy before build().",
      );
    }

    const store = this.store ?? new MemoryStore();
    const options: { keyPrefix?: string; now?: () => number } = {};
    if (this.keyPrefix !== undefined) {
      options.keyPrefix = this.keyPrefix;
    }

    if (this.now !== undefined) {
      options.now = this.now;
    }

    const limiter = new RateLimiter(store, this.strategy, options);

    if (this.cacheTtlMs === undefined) {
      return limiter;
    }

    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs <= 0) {
      throw new RateLimiterConfigurationError(
        "withCache() requires a positive cache TTL in milliseconds.",
      );
    }

    return new CachedRateLimiterProxy(limiter, this.cacheTtlMs, this.now);
  }
}
