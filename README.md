# `@xyph3r/rate-limiter`

Framework-agnostic rate limiting for Node.js and fetch-based runtimes with two clear goals:

- keep the core API small enough to use without ceremony
- keep the internals structured enough to stay maintainable when requirements change

The package is organized around a few deliberate design choices:

- `Strategy`: sliding window and token bucket are swappable algorithms
- `Builder`: fluent construction for readable setup
- `Decorator`: optional Express and Fastify adapters wrap the core
- `Decorator`: fetch/Hono/Next/Nest integrations stay outside the core
- `Proxy`: short-lived decision caching for hot paths

## Install

```bash
npm install @xyph3r/rate-limiter
```

## Quick start

```ts
import { createExpressRateLimit, RateLimiterBuilder } from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .withMemoryStore()
  .withKeyPrefix("api")
  .build();

app.use(createExpressRateLimit(limiter));
```

## Bun

For Bun's native `fetch` handler, use the shared fetch adapter:

```ts
import { createFetchRateLimit, RateLimiterBuilder } from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .withMemoryStore()
  .build();

const withRateLimit = createFetchRateLimit(limiter);

Bun.serve({
  fetch: withRateLimit(async () => {
    return Response.json({ ok: true });
  }),
});
```

## Core usage

### Sliding window

```ts
import { MemoryStore, RateLimiterBuilder } from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .useStore(new MemoryStore())
  .forSlidingWindow({
    limit: 10,
    windowMs: 1_000,
  })
  .build();

const decision = await limiter.check("user:42");

if (!decision.allowed) {
  console.log(`Retry in ${decision.retryAfterMs}ms`);
}
```

### Token bucket

```ts
import { createRateLimiter } from "@xyph3r/rate-limiter";

const limiter = createRateLimiter({
  algorithm: "token-bucket",
  capacity: 20,
  refillRate: 5,
  refillIntervalMs: 1_000,
  keyPrefix: "jobs",
});
```

## Redis-backed usage

The package does not force a Redis client. Instead, it ships lightweight executors for the two common interfaces.

### `node-redis`

```ts
import { createClient } from "redis";
import {
  createNodeRedisExecutor,
  RedisStore,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const client = createClient();
await client.connect();

const store = new RedisStore(createNodeRedisExecutor(client));

const limiter = new RateLimiterBuilder()
  .useStore(store)
  .forSlidingWindow({ limit: 200, windowMs: 60_000 })
  .build();
```

### `ioredis`

```ts
import Redis from "ioredis";
import {
  createIORedisExecutor,
  RedisStore,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const client = new Redis(process.env.REDIS_URL!);
const store = new RedisStore(createIORedisExecutor(client));
```

## Simple factory

If you prefer a plain config object over the builder:

```ts
import { createRateLimiter } from "@xyph3r/rate-limiter";

const limiter = createRateLimiter({
  algorithm: "sliding-window",
  limit: 50,
  windowMs: 10_000,
  keyPrefix: "public-api",
  cacheMs: 25,
});
```

## Express adapter

```ts
import express from "express";
import {
  createExpressRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = express();

const limiter = new RateLimiterBuilder()
  .forTokenBucket({
    capacity: 30,
    refillRate: 10,
    refillIntervalMs: 1_000,
  })
  .withMemoryStore()
  .build();

app.use(
  createExpressRateLimit(limiter, {
    key: (req) => req.headers["x-api-key"] as string,
  }),
);
```

## Hono adapter

```ts
import { Hono } from "hono";
import {
  createHonoRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = new Hono();

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 20, windowMs: 1_000 })
  .withMemoryStore()
  .build();

app.use("*", createHonoRateLimit(limiter));
```

## Fastify adapter

```ts
import fastify from "fastify";
import {
  createFastifyRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = fastify();

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 5, windowMs: 1_000 })
  .withMemoryStore()
  .build();

app.addHook("preHandler", createFastifyRateLimit(limiter));
```

## Next.js route handlers

For App Router route handlers, wrap the exported handler:

```ts
import { createNextRateLimit, RateLimiterBuilder } from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 30, windowMs: 60_000 })
  .withMemoryStore()
  .build();

const withRateLimit = createNextRateLimit(limiter);

export const GET = withRateLimit(async () => {
  return Response.json({ ok: true });
});
```

You can also use `key(request, context)` to derive limits from route params, session data, or tenant IDs.

## NestJS guard

Nest is exposed as a guard-shaped decorator. Pass your own exception from `@nestjs/common` so the framework returns a proper `429`.

```ts
import { TooManyRequestsException } from "@nestjs/common";
import {
  createNestRateLimitGuard,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 10, windowMs: 1_000 })
  .withMemoryStore()
  .build();

export const RateLimitGuard = createNestRateLimitGuard(limiter, {
  errorFactory: (decision) =>
    new TooManyRequestsException({
      error: "Too many requests",
      retryAfterMs: decision.retryAfterMs,
    }),
});
```

## Public API

### `RateLimiterBuilder`

- `.forSlidingWindow({ limit, windowMs })`
- `.forTokenBucket({ capacity, refillRate, refillIntervalMs })`
- `.useStore(store)` / `.withMemoryStore()`
- `.withKeyPrefix(prefix)`
- `.withCache(ttlMs)`
- `.build()`

### `RateLimiterLike`

- `check(key, { cost? })`
- `reset(key)`

### Adapters

- `createFetchRateLimit()` for Bun or any fetch-native runtime
- `createHonoRateLimit()` for Hono middleware
- `createNextRateLimit()` for Next.js App Router handlers
- `createNestRateLimitGuard()` for NestJS HTTP guards
- `createExpressRateLimit()` and `createFastifyRateLimit()`

### Decision fields

- `allowed`
- `limit`
- `used`
- `remaining`
- `retryAfterMs`
- `resetAt`
- `policy`

## Notes

- The memory store is process-local. Use Redis for multi-instance deployments.
- Redis execution is atomic because each strategy ships its own Lua program.
- The sliding window implementation uses a weighted previous-window approximation rather than a timestamp log. That keeps storage compact and predictable.
- Bun, Hono, and Next.js all use the fetch-compatible adapter surface under the hood.

## Publishing

The package is set up so `npm publish` builds `dist/` during `prepack` and runs the test suite during `prepublishOnly`.

Release flow:

1. Install dev dependencies with `npm install`.
2. Verify the package locally with `npm test`.
3. Inspect the publish tarball with `npm pack --dry-run`.
4. Log in with `npm login` if needed, then confirm the target account with `npm whoami`.
5. Publish the public scoped package with `npm publish --access public --provenance`.
