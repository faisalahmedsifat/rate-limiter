import { applyHeaders } from "../utils/headers.js";
import { getDefaultKeyFromFetchRequest } from "../utils/http.js";
import type { RateLimitDecision, RateLimiterLike } from "../types.js";

export interface HonoLikeRequest {
  raw: Request;
  header(name: string): string | undefined;
}

export interface HonoLikeContext {
  header(name: string, value: string): void;
  json(body: unknown, status?: number): Response;
  req: HonoLikeRequest;
}

export interface HonoRateLimitOptions<TContext extends HonoLikeContext = HonoLikeContext> {
  cost?: (context: TContext) => number | Promise<number>;
  key?: (context: TContext) => string | Promise<string>;
  onRejected?: (
    context: TContext,
    decision: RateLimitDecision,
  ) => Response | Promise<Response>;
  setHeaders?: boolean;
  skip?: (context: TContext) => boolean | Promise<boolean>;
}

/**
 * Pattern: Decorator
 * Problem: Hono middleware needs framework-specific request and response hooks while the limiter stays framework-agnostic.
 * Solution: The adapter decorates the core limiter with Hono's context API.
 * Trade-off: Separate Hono wrapper; justified because Bun/Hono is a first-class target for this package.
 */
export function createHonoRateLimit<TContext extends HonoLikeContext = HonoLikeContext>(
  limiter: RateLimiterLike,
  options: HonoRateLimitOptions<TContext> = {},
): (context: TContext, next: () => Promise<void>) => Promise<void | Response> {
  return async (context, next) => {
    if ((await options.skip?.(context)) === true) {
      await next();
      return;
    }

    const key =
      (await options.key?.(context)) ??
      getDefaultKeyFromFetchRequest(context.req.raw);
    const cost = (await options.cost?.(context)) ?? 1;
    const decision = await limiter.check(key, { cost });

    if (options.setHeaders !== false) {
      applyHeaders((name, value) => context.header(name, value), decision);
    }

    if (decision.allowed) {
      await next();
      return;
    }

    if (options.onRejected) {
      return options.onRejected(context, decision);
    }

    return context.json(defaultRateLimitBody(decision), 429);
  };
}

function defaultRateLimitBody(decision: RateLimitDecision): Record<string, unknown> {
  return {
    error: "Too many requests",
    limit: decision.limit,
    remaining: decision.remaining,
    retryAfterMs: decision.retryAfterMs,
  };
}
