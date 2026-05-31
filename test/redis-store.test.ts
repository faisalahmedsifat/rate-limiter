import test from "node:test";
import assert from "node:assert/strict";

import { UnsupportedStoreError } from "../src/errors.js";
import {
  createIORedisExecutor,
  createNodeRedisExecutor,
  RedisStore,
} from "../src/stores/redis-store.js";
import { SlidingWindowStrategy } from "../src/strategies/sliding-window-strategy.js";

test("redis store delegates to strategy redis program", async () => {
  const calls: {
    args: string[];
    key: string;
    script: string;
  }[] = [];

  const store = new RedisStore({
    async del() {},
    async eval(script: string, key: string, args: string[]) {
      calls.push({ script, key, args });
      return [
        JSON.stringify({
          currentCount: 1,
          currentWindowStart: 0,
          previousCount: 0,
          previousWindowStart: -1_000,
        }),
        "1",
        "1",
        "4",
        "1000",
        "0",
        "2000",
      ];
    },
  });

  const strategy = new SlidingWindowStrategy({ limit: 5, windowMs: 1_000 });
  const result = await store.consume("client", strategy, { now: 0, cost: 1 });

  assert.equal(typeof calls[0]?.script, "string");
  assert.equal(calls[0]?.key, "client");
  assert.deepEqual(calls[0]?.args, ["0", "1", "5", "1000"]);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 4);
});

test("redis store reset delegates to del", async () => {
  const deleted: string[] = [];
  const store = new RedisStore({
    async del(key: string) {
      deleted.push(key);
    },
    async eval() {
      throw new Error("not used");
    },
  });

  await store.reset("abc");
  assert.deepEqual(deleted, ["abc"]);
});

test("redis store rejects strategies without redis support", async () => {
  const store = new RedisStore({
    async del() {},
    async eval() {
      return [];
    },
  });

  await assert.rejects(
    () =>
      store.consume(
        "key",
        {
          kind: "custom",
          limit: 1,
          policy: "1;w=1",
          initialState: () => ({}),
          evaluate: () => ({
            state: {},
            allowed: true,
            used: 0,
            remaining: 1,
            resetAt: 0,
            retryAfterMs: 0,
            ttlMs: 1_000,
          }),
        },
        { now: 0, cost: 1 },
      ),
    {
      name: "UnsupportedStoreError",
    },
  );
});

test("node-redis executor adapts eval and del calls", async () => {
  const observed: {
    del: string[];
    eval:
      | {
          options: { arguments: string[]; keys: string[] };
          script: string;
        }
      | undefined;
  } = {
    del: [],
    eval: undefined,
  };

  const executor = createNodeRedisExecutor({
    async del(key: string) {
      observed.del.push(key);
    },
    async eval(script: string, options) {
      observed.eval = { script, options };
      return "ok";
    },
  });

  await executor.del("node-key");
  const result = await executor.eval("return 1", "node-key", ["a", "b"]);

  assert.deepEqual(observed.del, ["node-key"]);
  assert.deepEqual(observed.eval, {
    script: "return 1",
    options: {
      keys: ["node-key"],
      arguments: ["a", "b"],
    },
  });
  assert.equal(result, "ok");
});

test("ioredis executor adapts eval and del calls", async () => {
  const observed: {
    del: string[];
    eval: string[] | undefined;
  } = {
    del: [],
    eval: undefined,
  };

  const executor = createIORedisExecutor({
    async del(key: string) {
      observed.del.push(key);
    },
    async eval(script: string, numKeys: number, ...args: string[]) {
      observed.eval = [script, String(numKeys), ...args];
      return "ok";
    },
  });

  await executor.del("io-key");
  const result = await executor.eval("return 1", "io-key", ["x", "y"]);

  assert.deepEqual(observed.del, ["io-key"]);
  assert.deepEqual(observed.eval, ["return 1", "1", "io-key", "x", "y"]);
  assert.equal(result, "ok");
});

test("unsupported store error uses the package error type", () => {
  const error = new UnsupportedStoreError("bad");
  assert.equal(error.name, "UnsupportedStoreError");
});
