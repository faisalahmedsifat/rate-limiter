import { applyHeaders } from "../utils/headers.js";
import { getDefaultKeyFromRequest, type HeaderCarrier } from "../utils/http.js";
import type { RateLimitDecision, RateLimiterLike } from "../types.js";

export interface ExpressLikeRequest extends HeaderCarrier {}

export interface ExpressLikeResponse {
  end(body?: string): unknown;
  json?(body: unknown): unknown;
  setHeader(name: string, value: string): void;
  status(code: number): this;
}

export type ExpressLikeNext = (error?: unknown) => void;

export interface ExpressRateLimitOptions<
  TRequest extends ExpressLikeRequest = ExpressLikeRequest,
  TResponse extends ExpressLikeResponse = ExpressLikeResponse,
> {
  cost?: (request: TRequest) => number | Promise<number>;
  key?: (request: TRequest) => string | Promise<string>;
  onRejected?: (
    request: TRequest,
    response: TResponse,
    decision: RateLimitDecision,
  ) => void | Promise<void>;
  setHeaders?: boolean;
  skip?: (request: TRequest) => boolean | Promise<boolean>;
}

/**
 * Pattern: Decorator
 * Problem: HTTP concerns should not leak into the core limiter.
 * Solution: The adapter decorates the core limiter with request parsing and response shaping.
 * Trade-off: One wrapper per framework; justified because the core stays framework-agnostic.
 */
export function createExpressRateLimit<
  TRequest extends ExpressLikeRequest = ExpressLikeRequest,
  TResponse extends ExpressLikeResponse = ExpressLikeResponse,
>(
  limiter: RateLimiterLike,
  options: ExpressRateLimitOptions<TRequest, TResponse> = {},
): (
  request: TRequest,
  response: TResponse,
  next: ExpressLikeNext,
) => Promise<void> {
  return async (request, response, next) => {
    try {
      if ((await options.skip?.(request)) === true) {
        next();
        return;
      }

      const key =
        (await options.key?.(request)) ?? getDefaultKeyFromRequest(request);
      const cost = (await options.cost?.(request)) ?? 1;
      const decision = await limiter.check(key, { cost });

      if (options.setHeaders !== false) {
        applyHeaders((name, value) => response.setHeader(name, value), decision);
      }

      if (decision.allowed) {
        next();
        return;
      }

      if (options.onRejected) {
        await options.onRejected(request, response, decision);
        return;
      }

      response.status(429);
      response.setHeader("content-type", "application/json; charset=utf-8");
      if (typeof response.json === "function") {
        response.json(defaultRateLimitBody(decision));
        return;
      }

      response.end(JSON.stringify(defaultRateLimitBody(decision)));
    } catch (error) {
      next(error);
    }
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
