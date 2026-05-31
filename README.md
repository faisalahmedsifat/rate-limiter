# `@xyph3r/rate-limiter`

Framework-agnostic rate limiting for Node.js and fetch-based runtimes.

This package is for the common cases people actually need:

- protect a public API by IP or API key
- slow down abusive login attempts
- apply per-tenant or per-user quotas
- add rate-limit headers to HTTP responses
- use Redis when you run more than one app instance

The package is intentionally small:

- `Strategy`: sliding window and token bucket are swappable algorithms
- `Builder`: setup stays readable as configuration grows
- `Decorator`: framework adapters wrap the core without coupling it to Express, Fastify, Hono, or Next
- `Proxy`: optional short-lived caching reduces repeated checks on hot paths

## Install

```bash
npm install @xyph3r/rate-limiter
```

or

```bash
bun add @xyph3r/rate-limiter
```

## When to use which algorithm

### Sliding window

Use sliding window when you want a straightforward limit like:

- `100 requests per minute`
- `5 login attempts per 10 minutes`
- `30 requests per second`

This is usually the default choice for HTTP APIs.

### Token bucket

Use token bucket when you want bursts to be allowed but still controlled over time.

Examples:

- allow a short burst of `20` requests, then refill at `5/second`
- smooth traffic for jobs or background workers
- tolerate small spikes without rejecting immediately

## Production advice

- `MemoryStore` is process-local. Use it for local dev, tests, or single-instance apps.
- `RedisStore` is the right choice for multi-instance deployments.
- Rate limiting only works as well as your key choice. Pick a stable identity: IP, API key, tenant ID, or user ID.

## Quick start

```ts
import express from "express";
import {
  createExpressRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = express();

const limiter = new RateLimiterBuilder()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .withMemoryStore()
  .withKeyPrefix("api")
  .build();

app.use(createExpressRateLimit(limiter));
```

## Core usage

Use the core API when you want rate-limit decisions outside HTTP middleware.

```ts
import { RateLimiterBuilder } from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
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

### Token bucket example

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

The package does not force a Redis client. It ships small executors for the common client shapes.

### `node-redis`

```ts
import { createClient } from "redis";
import {
  createNodeRedisExecutor,
  RedisStore,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const limiter = new RateLimiterBuilder()
  .useStore(new RedisStore(createNodeRedisExecutor(client)))
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

const limiter = new RateLimiterBuilder()
  .useStore(new RedisStore(createIORedisExecutor(client)))
  .forSlidingWindow({ limit: 200, windowMs: 60_000 })
  .build();
```

## Framework usage

### Express

Use `createExpressRateLimit()` as middleware.

```ts
import express from "express";
import {
  createExpressRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = express();

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 50, windowMs: 60_000 })
  .build();

app.use(
  createExpressRateLimit(limiter, {
    key: (request) =>
      request.headers["x-api-key"] as string || request.ip || "anonymous",
    skip: (request) => request.headers["x-internal-call"] === "1",
  }),
);
```

Use this for:

- public REST APIs
- login and auth routes
- per-customer API key limits

### Fastify

Use `createFastifyRateLimit()` in `preHandler`.

```ts
import Fastify from "fastify";
import {
  createFastifyRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = Fastify();

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forTokenBucket({
    capacity: 30,
    refillRate: 10,
    refillIntervalMs: 1_000,
  })
  .build();

app.addHook(
  "preHandler",
  createFastifyRateLimit(limiter, {
    key: (request) =>
      request.headers["x-api-key"] as string || request.ip || "anonymous",
  }),
);
```

### Fetch / Bun / standard `Request` handlers

Use `createFetchRateLimit()` when your runtime already uses the standard `Request -> Response` shape.

```ts
import {
  createFetchRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .build();

const withRateLimit = createFetchRateLimit(limiter, {
  key: (request) => request.headers.get("x-api-key") ?? "anonymous",
});

const handler = withRateLimit(async () => {
  return Response.json({ ok: true });
});
```

#### Bun example

```ts
import {
  createFetchRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .build();

const withRateLimit = createFetchRateLimit(limiter, {
  key: (request) => request.headers.get("x-forwarded-for") ?? "anonymous",
});

Bun.serve({
  fetch: withRateLimit(async () => Response.json({ ok: true })),
});
```

### Hono

Use `createHonoRateLimit()` as Hono middleware.

```ts
import { Hono } from "hono";
import {
  createHonoRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const app = new Hono();

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 20, windowMs: 1_000 })
  .build();

app.use(
  "*",
  createHonoRateLimit(limiter, {
    key: (c) => c.req.header("x-api-key") ?? "anonymous",
  }),
);
```

### Next.js App Router

Use `createNextRateLimit()` to wrap the exported route handler.

```ts
import {
  createNextRateLimit,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 30, windowMs: 60_000 })
  .build();

const withRateLimit = createNextRateLimit(limiter, {
  key: (request) => request.headers.get("x-api-key") ?? "anonymous",
});

export const GET = withRateLimit(async () => {
  return Response.json({ ok: true });
});
```

You can also derive the key from route params or tenant context:

```ts
const withRateLimit = createNextRateLimit(limiter, {
  key: (_request, context: { params: { tenantId: string } }) => context.params.tenantId,
});
```

### NestJS

Use `createNestRateLimitGuard()` where a Nest guard fits better than middleware.

```ts
import { TooManyRequestsException } from "@nestjs/common";
import {
  createNestRateLimitGuard,
  RateLimiterBuilder,
} from "@xyph3r/rate-limiter";

const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 10, windowMs: 1_000 })
  .build();

export const RateLimitGuard = createNestRateLimitGuard(limiter, {
  key: (request) => request.headers?.["x-api-key"] as string || request.ip || "anonymous",
  errorFactory: (decision) =>
    new TooManyRequestsException({
      error: "Too many requests",
      retryAfterMs: decision.retryAfterMs,
    }),
});
```

## Choosing the key

A good rate-limit key represents the caller you want to control.

Good keys:

- client IP for anonymous traffic
- API key
- authenticated user ID
- tenant ID
- machine or worker ID for background endpoints

Bad keys:

- a random UUID per request
- request timestamp
- request path alone, if many callers share it

## Cost-based limiting

Every adapter and the core API support `cost`.

Use this when one operation is more expensive than another.

```ts
const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 100, windowMs: 60_000 })
  .build();

await limiter.check("tenant:42", { cost: 5 });
```

Example uses:

- expensive report generation counts as `5`
- normal read counts as `1`
- bulk export counts as `10`

## Response headers

By default the HTTP adapters set:

- `ratelimit-limit`
- `ratelimit-remaining`
- `ratelimit-reset`
- `ratelimit-policy`
- `retry-after`

Disable this with `setHeaders: false` if you need full manual control.

## Factory vs Builder

Use the Builder when you want readability and progressive configuration.

```ts
const limiter = new RateLimiterBuilder()
  .withMemoryStore()
  .forSlidingWindow({ limit: 50, windowMs: 10_000 })
  .withKeyPrefix("public-api")
  .withCache(25)
  .build();
```

Use `createRateLimiter()` when a plain config object is enough.

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

## Public API

### `RateLimiterBuilder`

- `.forSlidingWindow({ limit, windowMs })`
- `.forTokenBucket({ capacity, refillRate, refillIntervalMs })`
- `.useStore(store)` / `.withMemoryStore()`
- `.withKeyPrefix(prefix)`
- `.withCache(ttlMs)`
- `.withClock(now)`
- `.build()`

### `RateLimiterLike`

- `check(key, { cost? })`
- `reset(key)`

### Adapters

- `createExpressRateLimit()`
- `createFastifyRateLimit()`
- `createFetchRateLimit()`
- `createHonoRateLimit()`
- `createNextRateLimit()`
- `createNestRateLimitGuard()`

### Decision fields

- `allowed`
- `limit`
- `used`
- `remaining`
- `retryAfterMs`
- `retryAfterSeconds`
- `resetAt`
- `resetAfterMs`
- `policy`

## Notes

- Sliding window uses a weighted previous-window approximation, not a timestamp log.
- Redis checks are atomic because each strategy ships its own Lua program.
- Bun and Next.js share the fetch adapter shape under the hood.
- The optional cache proxy is only for very short-lived hot-path reuse. It is not a replacement for Redis.

## Publishing

The package is set up so `npm publish` builds `dist/` during `prepack` and runs tests during `prepublishOnly`.

Release flow:

1. Install dependencies with `bun install` or `npm install`.
2. Verify with `bun run test` and `bun run build`.
3. Inspect the tarball with `npm pack --dry-run`.
4. Log in with `npm login` if needed.
5. Publish with `npm publish --access public --provenance`.
