export interface RateLimitCheckOptions {
  cost?: number;
}

export interface RateLimitDecision {
  key: string;
  allowed: boolean;
  strategy: string;
  policy: string;
  limit: number;
  used: number;
  remaining: number;
  checkedAt: Date;
  resetAt: Date;
  resetAfterMs: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
}

export interface RateLimiterLike {
  check(key: string, options?: RateLimitCheckOptions): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}

export interface StrategyExecutionContext {
  now: number;
  cost: number;
}

export interface StrategyExecutionSnapshot<TState> {
  state: TState;
  allowed: boolean;
  used: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
  ttlMs: number;
}

export interface RedisStrategyProgram<TState> {
  script: string;
  getArgs(context: StrategyExecutionContext): string[];
  parse(raw: unknown): StrategyExecutionSnapshot<TState>;
}

export interface RateLimitStrategy<TState> {
  kind: string;
  limit: number;
  policy: string;
  initialState(now: number): TState;
  evaluate(
    currentState: TState | undefined,
    context: StrategyExecutionContext,
  ): StrategyExecutionSnapshot<TState>;
  redis?: RedisStrategyProgram<TState>;
}
