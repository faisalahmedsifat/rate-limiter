# `@xyph3r/rate-limiter`

Framework-agnostic rate limiting for Node.js with two clear goals:

- keep the core API small enough to use without ceremony
- keep the internals structured enough to stay maintainable when requirements change

The package follows the architecture laid out in `.idea.md`:

- `Strategy`: sliding window and token bucket are swappable algorithms
- `Builder`: fluent construction for readable setup
- `Decorator`: optional Express and Fastify adapters wrap the core
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
