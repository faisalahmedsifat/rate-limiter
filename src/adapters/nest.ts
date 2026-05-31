import { applyHeaders } from "../utils/headers.js";
import { getDefaultKeyFromRequest, type HeaderCarrier } from "../utils/http.js";
import type { RateLimitDecision, RateLimiterLike } from "../types.js";

export interface NestLikeRequest extends HeaderCarrier {}

export interface NestLikeResponse {
  header?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
}

export interface NestHttpArgumentsHost<
  TRequest extends NestLikeRequest = NestLikeRequest,
  TResponse extends NestLikeResponse = NestLikeResponse,
> {
  getRequest(): TRequest;
  getResponse(): TResponse;
}

export interface NestExecutionContext<
  TRequest extends NestLikeRequest = NestLikeRequest,
  TResponse extends NestLikeResponse = NestLikeResponse,
> {
  switchToHttp(): NestHttpArgumentsHost<TRequest, TResponse>;
}

export interface NestRateLimitOptions<
  TRequest extends NestLikeRequest = NestLikeRequest,
  TResponse extends NestLikeResponse = NestLikeResponse,
> {
  cost?: (request: TRequest, response: TResponse) => number | Promise<number>;
  errorFactory?: (
    decision: RateLimitDecision,
    request: TRequest,
    response: TResponse,
  ) => unknown;
  key?: (request: TRequest, response: TResponse) => string | Promise<string>;
  setHeaders?: boolean;
  skip?: (request: TRequest, response: TResponse) => boolean | Promise<boolean>;
}

/**
 * Pattern: Decorator
 * Problem: NestJS needs a guard-shaped integration point, but the limiter should stay decoupled from Nest internals.
 * Solution: The adapter decorates the core limiter behind a minimal `canActivate()` contract.
 * Trade-off: Users supply their own Nest exception in `errorFactory`; justified to keep Nest optional.
 */
export function createNestRateLimitGuard<
  TRequest extends NestLikeRequest = NestLikeRequest,
  TResponse extends NestLikeResponse = NestLikeResponse,
>(
  limiter: RateLimiterLike,
  options: NestRateLimitOptions<TRequest, TResponse> = {},
): { canActivate(context: NestExecutionContext<TRequest, TResponse>): Promise<boolean> } {
  return {
    async canActivate(
      context: NestExecutionContext<TRequest, TResponse>,
    ): Promise<boolean> {
      const http = context.switchToHttp();
      const request = http.getRequest();
      const response = http.getResponse();

      if ((await options.skip?.(request, response)) === true) {
        return true;
      }

      const key =
        (await options.key?.(request, response)) ??
        getDefaultKeyFromRequest(request);
      const cost = (await options.cost?.(request, response)) ?? 1;
      const decision = await limiter.check(key, { cost });

      if (options.setHeaders !== false) {
        applyHeaders((name, value) => setNestHeader(response, name, value), decision);
      }

      if (decision.allowed) {
        return true;
      }

      throw (
        options.errorFactory?.(decision, request, response) ??
        defaultNestRateLimitError(decision)
      );
    },
  };
}

function setNestHeader(
  response: NestLikeResponse,
  name: string,
  value: string,
): void {
  if (typeof response.setHeader === "function") {
    response.setHeader(name, value);
    return;
  }

  if (typeof response.header === "function") {
    response.header(name, value);
  }
}

function defaultNestRateLimitError(decision: RateLimitDecision): Error {
  const error = new Error("Too many requests");
  Object.assign(error, { decision, statusCode: 429 });
  return error;
}
