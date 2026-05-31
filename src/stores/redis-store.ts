import { UnsupportedStoreError } from "../errors.js";
import type {
  RateLimitStrategy,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../types.js";
import type { RateLimitStore } from "./rate-limit-store.js";

export interface RedisCommandExecutor {
  del(key: string): Promise<void>;
  eval(script: string, key: string, args: string[]): Promise<unknown>;
}

export interface NodeRedisLikeClient {
  del(key: string): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export interface IORedisLikeClient {
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export class RedisStore implements RateLimitStore {
  constructor(private readonly executor: RedisCommandExecutor) {}

  async consume<TState>(
    key: string,
    strategy: RateLimitStrategy<TState>,
    context: StrategyExecutionContext,
  ): Promise<StrategyExecutionSnapshot<TState>> {
    if (!strategy.redis) {
      throw new UnsupportedStoreError(
        `Strategy "${strategy.kind}" does not provide a Redis program.`,
      );
    }

    const raw = await this.executor.eval(
      strategy.redis.script,
      key,
      strategy.redis.getArgs(context),
    );

    return strategy.redis.parse(raw);
  }

  async reset(key: string): Promise<void> {
    await this.executor.del(key);
  }
}

export function createNodeRedisExecutor(
  client: NodeRedisLikeClient,
): RedisCommandExecutor {
  return {
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async eval(script: string, key: string, args: string[]): Promise<unknown> {
      return client.eval(script, {
        keys: [key],
        arguments: args,
      });
    },
  };
}

export function createIORedisExecutor(
  client: IORedisLikeClient,
): RedisCommandExecutor {
  return {
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async eval(script: string, key: string, args: string[]): Promise<unknown> {
      return client.eval(script, 1, key, ...args);
    },
  };
}
