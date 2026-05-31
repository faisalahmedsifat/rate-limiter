import type {
  RateLimitStrategy,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../types.js";

export interface RateLimitStore {
  consume<TState>(
    key: string,
    strategy: RateLimitStrategy<TState>,
    context: StrategyExecutionContext,
  ): Promise<StrategyExecutionSnapshot<TState>>;
  reset(key: string): Promise<void>;
}
