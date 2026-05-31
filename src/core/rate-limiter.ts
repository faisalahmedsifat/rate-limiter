import { RateLimiterConfigurationError } from "../errors.js";
import type { RateLimitStore } from "../stores/rate-limit-store.js";
import type {
  RateLimitCheckOptions,
  RateLimitDecision,
  RateLimiterLike,
  RateLimitStrategy,
} from "../types.js";

export interface RateLimiterOptions {
  keyPrefix?: string;
  now?: () => number;
}

/**
 * Pattern: Facade
 * Problem: Callers should not orchestrate keys, clocks, stores, and strategies themselves.
 * Solution: RateLimiter exposes a single check/reset API over the underlying subsystem.
 * Trade-off: Core composition is hidden behind one class; justified because the public API should stay small.
 */
export class RateLimiter<TState> implements RateLimiterLike {
  private readonly now: () => number;
  private readonly keyPrefix: string | undefined;

  constructor(
    private readonly store: RateLimitStore,
    private readonly strategy: RateLimitStrategy<TState>,
    options: RateLimiterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.keyPrefix = options.keyPrefix;
  }

  async check(
    key: string,
    options: RateLimitCheckOptions = {},
  ): Promise<RateLimitDecision> {
    const cost = options.cost ?? 1;
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new RateLimiterConfigurationError(
        "check() requires a positive numeric cost.",
      );
    }

    const checkedAtMs = this.now();
    const scopedKey = this.resolveKey(key);
    const snapshot = await this.store.consume(scopedKey, this.strategy, {
      now: checkedAtMs,
      cost,
    });

    return {
      key: scopedKey,
      allowed: snapshot.allowed,
      strategy: this.strategy.kind,
      policy: this.strategy.policy,
      limit: this.strategy.limit,
      used: snapshot.used,
      remaining: snapshot.remaining,
      checkedAt: new Date(checkedAtMs),
      resetAt: new Date(snapshot.resetAt),
      resetAfterMs: Math.max(0, snapshot.resetAt - checkedAtMs),
      retryAfterMs: snapshot.retryAfterMs,
      retryAfterSeconds: Math.ceil(snapshot.retryAfterMs / 1000),
    };
  }

  async reset(key: string): Promise<void> {
    await this.store.reset(this.resolveKey(key));
  }

  private resolveKey(key: string): string {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new RateLimiterConfigurationError("Rate limit keys cannot be empty.");
    }

    if (!this.keyPrefix) {
      return trimmed;
    }

    return `${this.keyPrefix}:${trimmed}`;
  }
}
