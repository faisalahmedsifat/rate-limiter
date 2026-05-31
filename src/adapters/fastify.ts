import { applyHeaders } from "../utils/headers.js";
import { getDefaultKeyFromRequest, type HeaderCarrier } from "../utils/http.js";
import type { RateLimitDecision, RateLimiterLike } from "../types.js";

export interface FastifyLikeRequest extends HeaderCarrier {}

export interface FastifyLikeReply {
  code(statusCode: number): this;
  header(name: string, value: string): this;
  send(payload: unknown): unknown;
}

export interface FastifyRateLimitOptions<
  TRequest extends FastifyLikeRequest = FastifyLikeRequest,
  TReply extends FastifyLikeReply = FastifyLikeReply,
> {
  cost?: (request: TRequest) => number | Promise<number>;
  key?: (request: TRequest) => string | Promise<string>;
  onRejected?: (
    request: TRequest,
    reply: TReply,
    decision: RateLimitDecision,
  ) => void | Promise<void>;
  setHeaders?: boolean;
  skip?: (request: TRequest) => boolean | Promise<boolean>;
}

/**
 * Pattern: Decorator
 * Problem: Fastify request handling is framework-specific, but rate-limit decisions are not.
 * Solution: The adapter layers Fastify semantics over the shared limiter contract.
 * Trade-off: Separate adapter module; justified because it keeps the core reusable elsewhere.
 */
export function createFastifyRateLimit<
  TRequest extends FastifyLikeRequest = FastifyLikeRequest,
  TReply extends FastifyLikeReply = FastifyLikeReply,
>(
  limiter: RateLimiterLike,
  options: FastifyRateLimitOptions<TRequest, TReply> = {},
): (request: TRequest, reply: TReply) => Promise<void> {
  return async (request, reply) => {
    if ((await options.skip?.(request)) === true) {
      return;
    }

    const key = (await options.key?.(request)) ?? getDefaultKeyFromRequest(request);
    const cost = (await options.cost?.(request)) ?? 1;
    const decision = await limiter.check(key, { cost });

    if (options.setHeaders !== false) {
      applyHeaders((name, value) => {
        reply.header(name, value);
      }, decision);
    }

    if (decision.allowed) {
      return;
    }

    if (options.onRejected) {
      await options.onRejected(request, reply, decision);
      return;
    }

    reply.code(429).send(defaultRateLimitBody(decision));
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
