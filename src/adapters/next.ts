import {
  createFetchRateLimit,
  type FetchLikeHandler,
  type FetchRateLimitOptions,
} from "./fetch.js";
import type { RateLimiterLike } from "../types.js";

export type NextRouteHandler<TContext = unknown> = FetchLikeHandler<TContext>;
export type NextRateLimitOptions<TContext = unknown> =
  FetchRateLimitOptions<TContext>;

/**
 * Pattern: Decorator
 * Problem: Next.js route handlers need the same core behavior as Bun without a framework dependency in the core.
 * Solution: The Next.js adapter is a thin decorator over the shared fetch adapter.
 * Trade-off: A tiny alias layer; justified because it gives Next.js users a first-class API surface.
 */
export function createNextRateLimit<TContext = unknown>(
  limiter: RateLimiterLike,
  options: NextRateLimitOptions<TContext> = {},
): (
  handler: NextRouteHandler<TContext>,
) => NextRouteHandler<TContext> {
  return createFetchRateLimit(limiter, options);
}
