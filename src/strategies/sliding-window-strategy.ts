import { RateLimiterConfigurationError } from "../errors.js";
import { clamp, normalizeRawRedisResult, toWholeNumber } from "../utils/math.js";
import type {
  RateLimitStrategy,
  RedisStrategyProgram,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../types.js";

export interface SlidingWindowConfig {
  limit: number;
  windowMs: number;
}

export interface SlidingWindowState {
  currentCount: number;
  currentWindowStart: number;
  previousCount: number;
  previousWindowStart: number;
}

/**
 * Pattern: Strategy
 * Problem: Sliding window and token bucket use materially different accounting logic.
 * Solution: Both implement the same strategy contract, so the limiter delegates without branching.
 * Trade-off: One extra layer of indirection; justified because these algorithms diverge quickly.
 */
export class SlidingWindowStrategy
  implements RateLimitStrategy<SlidingWindowState>
{
  readonly kind = "sliding-window";
  readonly limit: number;
  readonly policy: string;
  readonly redis: RedisStrategyProgram<SlidingWindowState>;
  private readonly windowMs: number;

  constructor(config: SlidingWindowConfig) {
    if (!Number.isFinite(config.limit) || config.limit <= 0) {
      throw new RateLimiterConfigurationError(
        "SlidingWindowStrategy requires a positive limit.",
      );
    }

    if (!Number.isFinite(config.windowMs) || config.windowMs <= 0) {
      throw new RateLimiterConfigurationError(
        "SlidingWindowStrategy requires a positive windowMs.",
      );
    }

    this.limit = Math.floor(config.limit);
    this.windowMs = Math.floor(config.windowMs);
    this.policy = `${this.limit};w=${Math.ceil(this.windowMs / 1000)}`;
    this.redis = createSlidingWindowRedisProgram(this.limit, this.windowMs);
  }

  initialState(now: number): SlidingWindowState {
    const windowStart = this.getWindowStart(now);
    return {
      currentCount: 0,
      currentWindowStart: windowStart,
      previousCount: 0,
      previousWindowStart: windowStart - this.windowMs,
    };
  }

  evaluate(
    currentState: SlidingWindowState | undefined,
    context: StrategyExecutionContext,
  ): StrategyExecutionSnapshot<SlidingWindowState> {
    const state = this.advanceState(currentState, context.now);
    const elapsed = context.now - state.currentWindowStart;
    const previousWeight = clamp(
      (this.windowMs - elapsed) / this.windowMs,
      0,
      1,
    );
    const effectiveBefore =
      state.currentCount + state.previousCount * previousWeight;
    const allowed = effectiveBefore + context.cost <= this.limit + 1e-9;

    if (allowed) {
      state.currentCount += context.cost;
    }

    const effectiveAfter =
      state.currentCount + state.previousCount * previousWeight;
    const resetAt = state.currentWindowStart + this.windowMs;

    return {
      state,
      allowed,
      used: this.limit - toWholeNumber(this.limit - effectiveAfter),
      remaining: toWholeNumber(this.limit - effectiveAfter),
      resetAt,
      retryAfterMs: allowed
        ? 0
        : this.calculateRetryAfterMs(state, context.cost, elapsed),
      ttlMs: this.windowMs * 2,
    };
  }

  private advanceState(
    currentState: SlidingWindowState | undefined,
    now: number,
  ): SlidingWindowState {
    if (!currentState) {
      return this.initialState(now);
    }

    const nextWindowStart = this.getWindowStart(now);
    if (currentState.currentWindowStart === nextWindowStart) {
      return { ...currentState };
    }

    if (currentState.currentWindowStart === nextWindowStart - this.windowMs) {
      return {
        currentCount: 0,
        currentWindowStart: nextWindowStart,
        previousCount: currentState.currentCount,
        previousWindowStart: currentState.currentWindowStart,
      };
    }

    return this.initialState(now);
  }

  private calculateRetryAfterMs(
    state: SlidingWindowState,
    cost: number,
    elapsed: number,
  ): number {
    const resetAt = state.currentWindowStart + this.windowMs;
    if (state.currentCount + cost > this.limit || state.previousCount <= 0) {
      return Math.max(1, resetAt - (state.currentWindowStart + elapsed));
    }

    const decayBudget = this.limit - cost - state.currentCount;
    if (decayBudget < 0) {
      return Math.max(1, resetAt - (state.currentWindowStart + elapsed));
    }

    const targetWeight = clamp(decayBudget / state.previousCount, 0, 1);
    const targetElapsed = this.windowMs - targetWeight * this.windowMs;
    return Math.max(1, Math.ceil(targetElapsed - elapsed));
  }

  private getWindowStart(now: number): number {
    return Math.floor(now / this.windowMs) * this.windowMs;
  }
}

function createSlidingWindowRedisProgram(
  limit: number,
  windowMs: number,
): RedisStrategyProgram<SlidingWindowState> {
  const script = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local windowMs = tonumber(ARGV[4])

local raw = redis.call("GET", key)
local state
if raw then
  state = cjson.decode(raw)
else
  local windowStart = math.floor(now / windowMs) * windowMs
  state = {
    currentCount = 0,
    currentWindowStart = windowStart,
    previousCount = 0,
    previousWindowStart = windowStart - windowMs
  }
end

local nextWindowStart = math.floor(now / windowMs) * windowMs
if state.currentWindowStart ~= nextWindowStart then
  if state.currentWindowStart == nextWindowStart - windowMs then
    state = {
      currentCount = 0,
      currentWindowStart = nextWindowStart,
      previousCount = state.currentCount,
      previousWindowStart = state.currentWindowStart
    }
  else
    state = {
      currentCount = 0,
      currentWindowStart = nextWindowStart,
      previousCount = 0,
      previousWindowStart = nextWindowStart - windowMs
    }
  end
end

local elapsed = now - state.currentWindowStart
local previousWeight = (windowMs - elapsed) / windowMs
if previousWeight < 0 then
  previousWeight = 0
elseif previousWeight > 1 then
  previousWeight = 1
end

local effectiveBefore = state.currentCount + (state.previousCount * previousWeight)
local allowed = 0
if effectiveBefore + cost <= limit + 0.000000001 then
  allowed = 1
  state.currentCount = state.currentCount + cost
end

local effectiveAfter = state.currentCount + (state.previousCount * previousWeight)
local remaining = math.max(0, math.floor(limit - effectiveAfter + 0.000000001))
local used = limit - remaining
local resetAt = state.currentWindowStart + windowMs
local retryAfterMs = 0

if allowed == 0 then
  if state.currentCount + cost > limit or state.previousCount <= 0 then
    retryAfterMs = math.max(1, resetAt - now)
  else
    local decayBudget = limit - cost - state.currentCount
    if decayBudget < 0 then
      retryAfterMs = math.max(1, resetAt - now)
    else
      local targetWeight = decayBudget / state.previousCount
      if targetWeight < 0 then
        targetWeight = 0
      elseif targetWeight > 1 then
        targetWeight = 1
      end
      local targetElapsed = windowMs - (targetWeight * windowMs)
      retryAfterMs = math.max(1, math.ceil(targetElapsed - elapsed))
    end
  end
end

local ttlMs = windowMs * 2
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
        String(limit),
        String(windowMs),
      ];
    },
    parse(raw: unknown): StrategyExecutionSnapshot<SlidingWindowState> {
      const values = normalizeRawRedisResult(raw, "sliding-window");
      return {
        state: JSON.parse(values[0]) as SlidingWindowState,
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
