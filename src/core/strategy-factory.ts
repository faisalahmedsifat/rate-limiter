import type { RateLimitStrategy } from "../types.js";
import {
  SlidingWindowStrategy,
  type SlidingWindowConfig,
} from "../strategies/sliding-window-strategy.js";
import {
  TokenBucketStrategy,
  type TokenBucketConfig,
} from "../strategies/token-bucket-strategy.js";

export type StrategyConfig =
  | ({ algorithm: "sliding-window" } & SlidingWindowConfig)
  | ({ algorithm: "token-bucket" } & TokenBucketConfig);

/**
 * Pattern: Factory
 * Problem: Callers want a simple config object, not direct knowledge of every strategy class.
 * Solution: The factory centralizes strategy instantiation behind one method.
 * Trade-off: One more creation layer; justified because package ergonomics improve substantially.
 */
export class RateLimitStrategyFactory {
  static create(config: StrategyConfig): RateLimitStrategy<unknown> {
    if (config.algorithm === "sliding-window") {
      return new SlidingWindowStrategy(config);
    }

    return new TokenBucketStrategy(config);
  }
}
