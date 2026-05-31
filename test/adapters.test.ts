import test from "node:test";
import assert from "node:assert/strict";

import { createExpressRateLimit } from "../src/adapters/express.js";
import { createFastifyRateLimit } from "../src/adapters/fastify.js";
import { RateLimiterBuilder } from "../src/core/rate-limiter-builder.js";
import {
  createMockExpressResponse,
  createMockFastifyReply,
} from "./helpers/mock-http.js";

test("express decorator sets headers and rejects over-limit requests", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withClock(() => now)
    .build();

  const middleware = createExpressRateLimit(limiter);
  const request = {
    headers: {},
    ip: "127.0.0.1",
  };

  const firstResponse = createMockExpressResponse();
  let firstNextCalls = 0;
  await middleware(request, firstResponse, () => {
    firstNextCalls += 1;
  });

  assert.equal(firstNextCalls, 1);
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.headers["ratelimit-limit"], "1");

  now = 10;
  const secondResponse = createMockExpressResponse();
  let secondNextCalls = 0;
  await middleware(request, secondResponse, () => {
    secondNextCalls += 1;
  });

  assert.equal(secondNextCalls, 0);
  assert.equal(secondResponse.statusCode, 429);
  assert.equal(secondResponse.headers["retry-after"], "1");
  assert.deepEqual(secondResponse.jsonBody, {
    error: "Too many requests",
    limit: 1,
    remaining: 0,
    retryAfterMs: 990,
  });
});

test("express decorator respects skip and custom hooks", async () => {
  let checks = 0;
  const limiter = {
    async check(key: string, options?: { cost?: number }) {
      checks += 1;
      return {
        key,
        allowed: false,
        strategy: "test",
        policy: "1;w=1",
        limit: 1,
        used: options?.cost ?? 1,
        remaining: 0,
        checkedAt: new Date(0),
        resetAt: new Date(1_000),
        resetAfterMs: 1_000,
        retryAfterMs: 1_000,
        retryAfterSeconds: 1,
      };
    },
    async reset() {},
  };

  const middleware = createExpressRateLimit(limiter, {
    skip: async (request) => request.headers?.["x-skip"] === "1",
    key: async () => "custom-key",
    cost: async () => 3,
    setHeaders: false,
    onRejected: async (_request, response, decision) => {
      response.status(418);
      response.end(`blocked:${decision.key}:${decision.used}`);
    },
  });

  let nextCalls = 0;
  await middleware(
    { headers: { "x-skip": "1" } },
    createMockExpressResponse(),
    () => {
      nextCalls += 1;
    },
  );

  assert.equal(nextCalls, 1);
  assert.equal(checks, 0);

  const response = createMockExpressResponse();
  await middleware({ headers: {} }, response, () => {
    throw new Error("should not continue");
  });

  assert.equal(checks, 1);
  assert.equal(response.statusCode, 418);
  assert.equal(response.headers["ratelimit-limit"], undefined);
  assert.equal(response.body, "blocked:custom-key:3");
});

test("express decorator forwards errors to next", async () => {
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .build();
  const middleware = createExpressRateLimit(limiter, {
    key: async () => {
      throw new Error("boom");
    },
  });

  let forwarded: unknown;
  await middleware({ headers: {} }, createMockExpressResponse(), (error) => {
    forwarded = error;
  });

  assert.equal((forwarded as Error).message, "boom");
});

test("fastify decorator sets headers and default rejection payload", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withClock(() => now)
    .build();
  const hook = createFastifyRateLimit(limiter);

  await hook({ headers: {}, ip: "127.0.0.1" }, createMockFastifyReply());

  now = 10;
  const reply = createMockFastifyReply();
  await hook({ headers: {}, ip: "127.0.0.1" }, reply);

  assert.equal(reply.statusCode, 429);
  assert.equal(reply.headers["ratelimit-limit"], "1");
  assert.deepEqual(reply.payload, {
    error: "Too many requests",
    limit: 1,
    remaining: 0,
    retryAfterMs: 990,
  });
});

test("fastify decorator supports skip and custom rejection", async () => {
  let checks = 0;
  const limiter = {
    async check() {
      checks += 1;
      return {
        key: "client",
        allowed: false,
        strategy: "test",
        policy: "1;w=1",
        limit: 1,
        used: 1,
        remaining: 0,
        checkedAt: new Date(0),
        resetAt: new Date(1_000),
        resetAfterMs: 1_000,
        retryAfterMs: 1_000,
        retryAfterSeconds: 1,
      };
    },
    async reset() {},
  };

  const hook = createFastifyRateLimit(limiter, {
    skip: async (request) => request.headers?.["x-skip"] === "1",
    onRejected: async (_request, reply, decision) => {
      reply.code(451).send(`blocked:${decision.key}`);
    },
    setHeaders: false,
  });

  await hook({ headers: { "x-skip": "1" } }, createMockFastifyReply());
  assert.equal(checks, 0);

  const reply = createMockFastifyReply();
  await hook({ headers: {} }, reply);
  assert.equal(checks, 1);
  assert.equal(reply.statusCode, 451);
  assert.equal(reply.headers["ratelimit-limit"], undefined);
  assert.equal(reply.payload, "blocked:client");
});
