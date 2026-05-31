import { applyHeaders } from "../utils/headers.js";
import { getDefaultKeyFromFetchRequest } from "../utils/http.js";
import type { RateLimitDecision, RateLimiterLike } from "../types.js";

export type FetchLikeHandler<TContext = unknown> = (
  request: Request,
  context: TContext,
) => Response | Promise<Response>;

export interface FetchRateLimitOptions<TContext = unknown> {
  cost?: (request: Request, context: TContext) => number | Promise<number>;
  key?: (request: Request, context: TContext) => string | Promise<string>;
  onRejected?: (
    request: Request,
    context: TContext,
    decision: RateLimitDecision,
  ) => Response | Promise<Response>;
  setHeaders?: boolean;
  skip?: (request: Request, context: TContext) => boolean | Promise<boolean>;
}

/**
 * Pattern: Decorator
 * Problem: Fetch-style runtimes need rate limiting without coupling the core to Bun or Next.js.
 * Solution: The adapter decorates standard Request/Response handlers behind a shared contract.
 * Trade-off: One more wrapper around the handler; justified because Bun and Next.js both speak fetch natively.
 */
export function createFetchRateLimit<TContext = unknown>(
  limiter: RateLimiterLike,
  options: FetchRateLimitOptions<TContext> = {},
): (handler: FetchLikeHandler<TContext>) => FetchLikeHandler<TContext> {
  return (handler) => {
    return async (request, context) => {
      if ((await options.skip?.(request, context)) === true) {
        return handler(request, context);
      }

      const key =
        (await options.key?.(request, context)) ??
        getDefaultKeyFromFetchRequest(request);
      const cost = (await options.cost?.(request, context)) ?? 1;
      const decision = await limiter.check(key, { cost });

      if (!decision.allowed) {
        const rejected =
          (await options.onRejected?.(request, context, decision)) ??
          defaultRateLimitResponse(decision);
        return options.setHeaders === false
          ? rejected
          : withRateLimitHeaders(rejected, decision);
      }

      const response = await handler(request, context);
      if (options.setHeaders === false) {
        return response;
      }

      return withRateLimitHeaders(response, decision);
    };
  };
}

function defaultRateLimitResponse(decision: RateLimitDecision): Response {
  return Response.json(
    {
      error: "Too many requests",
      limit: decision.limit,
      remaining: decision.remaining,
      retryAfterMs: decision.retryAfterMs,
    },
    { status: 429 },
  );
}

function withRateLimitHeaders(
  response: Response,
  decision: RateLimitDecision,
): Response {
  const headers = new Headers(response.headers);
  applyHeaders((name, value) => {
    headers.set(name, value);
  }, decision);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
