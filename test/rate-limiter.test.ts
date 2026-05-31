import test from "node:test";
import assert from "node:assert/strict";

import { createExpressRateLimit } from "../src/adapters/express.js";
import { RateLimiterBuilder } from "../src/core/rate-limiter-builder.js";
import { MemoryStore } from "../src/stores/memory-store.js";
import type { RateLimitStore } from "../src/stores/rate-limit-store.js";
import type {
  RateLimitStrategy,
  StrategyExecutionContext,
  StrategyExecutionSnapshot,
} from "../src/types.js";

test("sliding window blocks when the limit is exceeded", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 2, windowMs: 1_000 })
    .withClock(() => now)
    .build();

  assert.equal((await limiter.check("user-1")).allowed, true);
  assert.equal((await limiter.check("user-1")).allowed, true);

  const blocked = await limiter.check("user-1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterMs, 1_000);

  now = 1_500;
  assert.equal((await limiter.check("user-1")).allowed, true);
});

test("token bucket refills over time", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forTokenBucket({
      capacity: 2,
      refillRate: 1,
      refillIntervalMs: 1_000,
    })
    .withClock(() => now)
    .build();

  assert.equal((await limiter.check("ip-1")).allowed, true);
  assert.equal((await limiter.check("ip-1")).allowed, true);

  const blocked = await limiter.check("ip-1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1_000);

  now = 1_000;
  assert.equal((await limiter.check("ip-1")).allowed, true);
});

test("cache proxy avoids redundant store work inside the cache ttl", async () => {
  let calls = 0;
  let now = 0;

  class CountingStore implements RateLimitStore {
    constructor(private readonly inner: RateLimitStore) {}

    async consume<TState>(
      key: string,
      strategy: RateLimitStrategy<TState>,
      context: StrategyExecutionContext,
    ): Promise<StrategyExecutionSnapshot<TState>> {
      calls += 1;
      return this.inner.consume(key, strategy, context);
    }

    async reset(key: string): Promise<void> {
      return this.inner.reset(key);
    }
  }

  const limiter = new RateLimiterBuilder()
    .useStore(new CountingStore(new MemoryStore()))
    .forSlidingWindow({ limit: 10, windowMs: 1_000 })
    .withClock(() => now)
    .withCache(50)
    .build();

  await limiter.check("cache-key");
  await limiter.check("cache-key");
  assert.equal(calls, 1);

  now = 60;
  await limiter.check("cache-key");
  assert.equal(calls, 2);
});

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

  const firstResponse = createMockResponse();
  let firstNextCalls = 0;
  await middleware(request, firstResponse, () => {
    firstNextCalls += 1;
  });

  assert.equal(firstNextCalls, 1);
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.headers["ratelimit-limit"], "1");

  now = 10;
  const secondResponse = createMockResponse();
  let secondNextCalls = 0;
  await middleware(request, secondResponse, () => {
    secondNextCalls += 1;
  });

  assert.equal(secondNextCalls, 0);
  assert.equal(secondResponse.statusCode, 429);
  assert.equal(secondResponse.headers["retry-after"], "1");
  assert.match(secondResponse.body ?? "", /Too many requests/);
});

interface MockResponse {
  body: string | undefined;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

function createMockResponse(): MockResponse {
  return {
    body: undefined,
    headers: {},
    statusCode: 200,
    setHeader(name: string, value: string): void {
      this.headers[name] = value;
    },
    status(code: number): MockResponse {
      this.statusCode = code;
      return this;
    },
    end(body?: string): void {
      this.body = body;
    },
  };
}
