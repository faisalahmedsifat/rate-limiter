import test from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../src/core/create-rate-limiter.js";
import { RateLimiterBuilder } from "../src/core/rate-limiter-builder.js";
import { RateLimiterConfigurationError } from "../src/errors.js";

test("builder requires a strategy before build", () => {
  assert.throws(() => new RateLimiterBuilder().build(), {
    name: "RateLimiterConfigurationError",
  });
});

test("builder rejects invalid cache ttl", () => {
  assert.throws(
    () =>
      new RateLimiterBuilder()
        .forSlidingWindow({ limit: 1, windowMs: 1_000 })
        .withCache(0)
        .build(),
    {
      name: "RateLimiterConfigurationError",
    },
  );
});

test("factory creates a limiter with key prefix and cache support", async () => {
  let now = 0;
  const limiter = createRateLimiter({
    algorithm: "sliding-window",
    limit: 1,
    windowMs: 1_000,
    keyPrefix: "api",
    cacheMs: 20,
    now: () => now,
  });

  const first = await limiter.check("client-1");
  assert.equal(first.key, "api:client-1");
  assert.equal(first.allowed, true);

  const second = await limiter.check("client-1");
  assert.equal(second.allowed, true);

  now = 25;
  const third = await limiter.check("client-1");
  assert.equal(third.allowed, false);
});

test("limiter rejects blank keys", async () => {
  const limiter = new RateLimiterBuilder()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withMemoryStore()
    .build();

  await assert.rejects(() => limiter.check("   "), {
    name: "RateLimiterConfigurationError",
  });
});

test("limiter rejects non-positive cost", async () => {
  const limiter = new RateLimiterBuilder()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withMemoryStore()
    .build();

  await assert.rejects(() => limiter.check("user", { cost: 0 }), {
    name: "RateLimiterConfigurationError",
  });
  await assert.rejects(() => limiter.check("user", { cost: -1 }), {
    name: "RateLimiterConfigurationError",
  });
});

test("reset clears state for the specific key only", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withMemoryStore()
    .withClock(() => now)
    .build();

  await limiter.check("a");
  await limiter.check("b");

  const blockedA = await limiter.check("a");
  const blockedB = await limiter.check("b");
  assert.equal(blockedA.allowed, false);
  assert.equal(blockedB.allowed, false);

  await limiter.reset("a");

  const afterResetA = await limiter.check("a");
  const afterResetB = await limiter.check("b");
  assert.equal(afterResetA.allowed, true);
  assert.equal(afterResetB.allowed, false);
  now = 1_000;
});

test("cache proxy returns cloned decisions rather than shared mutable objects", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .forSlidingWindow({ limit: 2, windowMs: 1_000 })
    .withMemoryStore()
    .withClock(() => now)
    .withCache(100)
    .build();

  const first = await limiter.check("clone");
  first.allowed = false;
  first.checkedAt.setTime(123);

  const second = await limiter.check("clone");
  assert.equal(second.allowed, true);
  assert.equal(second.checkedAt.getTime(), 0);
});

test("cache proxy reset invalidates cached decisions immediately", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withMemoryStore()
    .withClock(() => now)
    .withCache(100)
    .build();

  await limiter.check("reset-cache");
  await limiter.reset("reset-cache");

  const afterReset = await limiter.check("reset-cache");
  assert.equal(afterReset.allowed, true);
});

test("sliding window constructor validates config", () => {
  assert.throws(
    () => new RateLimiterBuilder().forSlidingWindow({ limit: 0, windowMs: 1 }),
    {
      name: "RateLimiterConfigurationError",
    },
  );
  assert.throws(
    () => new RateLimiterBuilder().forSlidingWindow({ limit: 1, windowMs: 0 }),
    {
      name: "RateLimiterConfigurationError",
    },
  );
});

test("token bucket constructor validates config", () => {
  assert.throws(
    () =>
      new RateLimiterBuilder().forTokenBucket({
        capacity: 0,
        refillRate: 1,
        refillIntervalMs: 1_000,
      }),
    {
      name: "RateLimiterConfigurationError",
    },
  );
  assert.throws(
    () =>
      new RateLimiterBuilder().forTokenBucket({
        capacity: 1,
        refillRate: 0,
        refillIntervalMs: 1_000,
      }),
    {
      name: "RateLimiterConfigurationError",
    },
  );
  assert.throws(
    () =>
      new RateLimiterBuilder().forTokenBucket({
        capacity: 1,
        refillRate: 1,
        refillIntervalMs: 0,
      }),
    {
      name: "RateLimiterConfigurationError",
    },
  );
});

test("exposed configuration errors use the package error type", () => {
  const error = new RateLimiterConfigurationError("bad");
  assert.equal(error.name, "RateLimiterConfigurationError");
});
