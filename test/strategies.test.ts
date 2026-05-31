import test from "node:test";
import assert from "node:assert/strict";

import { RateLimiterBuilder } from "../src/core/rate-limiter-builder.js";

test("sliding window blocks on the third hit and recovers after enough decay", async () => {
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

  now = 1_250;
  assert.equal((await limiter.check("user-1")).allowed, false);

  now = 1_500;
  assert.equal((await limiter.check("user-1")).allowed, true);
});

test("sliding window supports variable request cost", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 5, windowMs: 1_000 })
    .withClock(() => now)
    .build();

  const first = await limiter.check("cost", { cost: 3 });
  assert.equal(first.allowed, true);
  assert.equal(first.used, 3);
  assert.equal(first.remaining, 2);

  const second = await limiter.check("cost", { cost: 3 });
  assert.equal(second.allowed, false);
  assert.equal(second.retryAfterMs, 1_000);
});

test("sliding window state resets after long idle gaps", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .withClock(() => now)
    .build();

  await limiter.check("idle");
  now = 3_001;

  const decision = await limiter.check("idle");
  assert.equal(decision.allowed, true);
  assert.equal(decision.used, 1);
  assert.equal(decision.remaining, 0);
});

test("sliding window keeps keys isolated", async () => {
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 1, windowMs: 1_000 })
    .build();

  assert.equal((await limiter.check("a")).allowed, true);
  assert.equal((await limiter.check("b")).allowed, true);
  assert.equal((await limiter.check("a")).allowed, false);
  assert.equal((await limiter.check("b")).allowed, false);
});

test("token bucket refills over time and caps at capacity", async () => {
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

  now = 10_000;
  const full = await limiter.check("ip-1");
  assert.equal(full.allowed, true);
  assert.equal(full.used <= 2, true);
});

test("token bucket supports fractional cost and precise retry timing", async () => {
  let now = 0;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forTokenBucket({
      capacity: 3,
      refillRate: 3,
      refillIntervalMs: 3_000,
    })
    .withClock(() => now)
    .build();

  const first = await limiter.check("fractional", { cost: 1.5 });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);

  const second = await limiter.check("fractional", { cost: 2 });
  assert.equal(second.allowed, false);
  assert.equal(second.retryAfterMs, 500);

  now = 500;
  const third = await limiter.check("fractional", { cost: 2 });
  assert.equal(third.allowed, true);
});

test("token bucket does not mint tokens when time moves backwards", async () => {
  let now = 1_000;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forTokenBucket({
      capacity: 2,
      refillRate: 2,
      refillIntervalMs: 2_000,
    })
    .withClock(() => now)
    .build();

  await limiter.check("clock");
  await limiter.check("clock");

  now = 500;
  const blocked = await limiter.check("clock");
  assert.equal(blocked.allowed, false);
});

test("sliding window preserves decision invariants across many timestamps", async () => {
  let now = 0;
  let seed = 17;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forSlidingWindow({ limit: 7, windowMs: 1_000 })
    .withClock(() => now)
    .build();

  for (let index = 0; index < 60; index += 1) {
    seed = (seed * 48271) % 0x7fffffff;
    now += seed % 400;
    const cost = (seed % 3) + 1;
    const decision = await limiter.check("fuzz-sliding", { cost });

    assert.equal(decision.used >= 0, true);
    assert.equal(decision.used <= decision.limit, true);
    assert.equal(decision.remaining >= 0, true);
    assert.equal(decision.remaining <= decision.limit, true);
    assert.equal(decision.resetAfterMs >= 0, true);
    assert.equal(decision.allowed || decision.retryAfterMs > 0, true);
  }
});

test("token bucket preserves decision invariants across bursty traffic", async () => {
  let now = 0;
  let seed = 23;
  const limiter = new RateLimiterBuilder()
    .withMemoryStore()
    .forTokenBucket({
      capacity: 5,
      refillRate: 5,
      refillIntervalMs: 2_000,
    })
    .withClock(() => now)
    .build();

  for (let index = 0; index < 60; index += 1) {
    seed = (seed * 48271) % 0x7fffffff;
    now += seed % 700;
    const cost = ((seed % 4) + 1) / 2;
    const decision = await limiter.check("fuzz-bucket", { cost });

    assert.equal(decision.used >= 0, true);
    assert.equal(decision.used <= decision.limit, true);
    assert.equal(decision.remaining >= 0, true);
    assert.equal(decision.remaining <= decision.limit, true);
    assert.equal(decision.resetAfterMs >= 0, true);
    assert.equal(decision.allowed || decision.retryAfterMs > 0, true);
  }
});
