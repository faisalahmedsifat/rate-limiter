import { RateLimiterConfigurationError } from "../errors.js";
import { clamp, normalizeRawRedisResult, toWholeNumber } from "../utils/math.js";
import type {
  RateLimitStrategy,
  RedisStrategyProgram,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../types.js";

export interface TokenBucketConfig {
  capacity: number;
  refillIntervalMs: number;
  refillRate: number;
}

export interface TokenBucketState {
  lastRefillAt: number;
  tokens: number;
}

/**
 * Pattern: Strategy
 * Problem: Burst control and rolling windows are separate rate-limit behaviors.
 * Solution: Token bucket is isolated behind the shared strategy contract.
 * Trade-off: Slightly more structure; justified because callers should not care which algorithm is active.
 */
export class TokenBucketStrategy
  implements RateLimitStrategy<TokenBucketState>
{
  readonly kind = "token-bucket";
  readonly limit: number;
  readonly policy: string;
  readonly redis: RedisStrategyProgram<TokenBucketState>;
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private readonly refillRate: number;
  private readonly refillPerMs: number;

  constructor(config: TokenBucketConfig) {
    if (!Number.isFinite(config.capacity) || config.capacity <= 0) {
      throw new RateLimiterConfigurationError(
        "TokenBucketStrategy requires a positive capacity.",
      );
    }

    if (
      !Number.isFinite(config.refillIntervalMs) ||
      config.refillIntervalMs <= 0
    ) {
      throw new RateLimiterConfigurationError(
        "TokenBucketStrategy requires a positive refillIntervalMs.",
      );
    }

    if (!Number.isFinite(config.refillRate) || config.refillRate <= 0) {
      throw new RateLimiterConfigurationError(
        "TokenBucketStrategy requires a positive refillRate.",
      );
    }

    this.capacity = config.capacity;
    this.refillIntervalMs = config.refillIntervalMs;
    this.refillRate = config.refillRate;
    this.refillPerMs = this.refillRate / this.refillIntervalMs;
    this.limit = Math.floor(this.capacity);
    this.policy = `${this.limit};w=${Math.ceil(
      this.refillIntervalMs / 1000,
    )};burst=${this.limit}`;
    this.redis = createTokenBucketRedisProgram(
      this.capacity,
      this.refillRate,
      this.refillIntervalMs,
    );
  }

  initialState(now: number): TokenBucketState {
    return {
      lastRefillAt: now,
      tokens: this.capacity,
    };
  }

  evaluate(
    currentState: TokenBucketState | undefined,
    context: StrategyExecutionContext,
  ): StrategyExecutionSnapshot<TokenBucketState> {
    const state = currentState
      ? { ...currentState }
      : this.initialState(context.now);

    if (context.now > state.lastRefillAt) {
      const refill = (context.now - state.lastRefillAt) * this.refillPerMs;
      state.tokens = clamp(state.tokens + refill, 0, this.capacity);
      state.lastRefillAt = context.now;
    }

    const allowed = state.tokens + 1e-9 >= context.cost;
    if (allowed) {
      state.tokens = clamp(state.tokens - context.cost, 0, this.capacity);
    }

    const retryAfterMs = allowed
      ? 0
      : Math.max(1, Math.ceil((context.cost - state.tokens) / this.refillPerMs));
    const timeToFullMs = Math.ceil(
      (this.capacity - state.tokens) / this.refillPerMs,
    );

    return {
      state,
      allowed,
      used: this.limit - toWholeNumber(state.tokens),
      remaining: toWholeNumber(state.tokens),
      resetAt: context.now + Math.max(0, timeToFullMs),
      retryAfterMs,
      ttlMs: Math.max(this.refillIntervalMs, timeToFullMs),
    };
  }
}

function createTokenBucketRedisProgram(
  capacity: number,
  refillRate: number,
  refillIntervalMs: number,
): RedisStrategyProgram<TokenBucketState> {
  const script = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local refillRate = tonumber(ARGV[4])
local refillIntervalMs = tonumber(ARGV[5])
local refillPerMs = refillRate / refillIntervalMs

local raw = redis.call("GET", key)
local state
if raw then
  state = cjson.decode(raw)
else
  state = {
    lastRefillAt = now,
    tokens = capacity
  }
end

if now > state.lastRefillAt then
  local refill = (now - state.lastRefillAt) * refillPerMs
  state.tokens = math.min(capacity, math.max(0, state.tokens + refill))
  state.lastRefillAt = now
end

local allowed = 0
if state.tokens + 0.000000001 >= cost then
  allowed = 1
  state.tokens = math.min(capacity, math.max(0, state.tokens - cost))
end

local remaining = math.max(0, math.floor(state.tokens + 0.000000001))
local used = math.floor(capacity) - remaining
local retryAfterMs = 0
if allowed == 0 then
  retryAfterMs = math.max(1, math.ceil((cost - state.tokens) / refillPerMs))
end

local timeToFullMs = math.ceil((capacity - state.tokens) / refillPerMs)
if timeToFullMs < 0 then
  timeToFullMs = 0
end
local ttlMs = math.max(refillIntervalMs, timeToFullMs)
local resetAt = now + timeToFullMs

redis.call("PSETEX", key, ttlMs, cjson.encode(state))
return {
  cjson.encode(state),
  tostring(allowed),
  tostring(used),
  tostring(remaining),
  tostring(resetAt),
  tostring(retryAfterMs),
  tostring(ttlMs)
}
`;

  return {
    script,
    getArgs(context: StrategyExecutionContext): string[] {
      return [
        String(context.now),
        String(context.cost),
        String(capacity),
        String(refillRate),
        String(refillIntervalMs),
      ];
    },
    parse(raw: unknown): StrategyExecutionSnapshot<TokenBucketState> {
      const values = normalizeRawRedisResult(raw, "token-bucket");
      return {
        state: JSON.parse(values[0]) as TokenBucketState,
        allowed: values[1] === "1",
        used: Number(values[2]),
        remaining: Number(values[3]),
        resetAt: Number(values[4]),
        retryAfterMs: Number(values[5]),
        ttlMs: Number(values[6]),
      };
    },
  };
}
