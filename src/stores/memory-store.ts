import type { RateLimitStore } from "./rate-limit-store.js";
import type {
  RateLimitStrategy,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../types.js";

interface MemoryEntry<TState> {
  expiresAt: number;
  state: TState;
}

export class MemoryStore implements RateLimitStore {
  private readonly entries = new Map<string, MemoryEntry<unknown>>();

  async consume<TState>(
    key: string,
    strategy: RateLimitStrategy<TState>,
    context: StrategyExecutionContext,
  ): Promise<StrategyExecutionSnapshot<TState>> {
    this.pruneExpired(key, context.now);

    const current = this.entries.get(key) as MemoryEntry<TState> | undefined;
    const snapshot = strategy.evaluate(current?.state, context);
    const expiresAt = context.now + snapshot.ttlMs;

    this.entries.set(key, {
      expiresAt,
      state: snapshot.state,
    });

    return snapshot;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  private pruneExpired(key: string, now: number): void {
    const current = this.entries.get(key);
    if (current && current.expiresAt <= now) {
      this.entries.delete(key);
    }
  }
}
