import { describe, it, expect, afterEach } from "vitest";
import { InMemoryJtiStore, RedisJtiStore } from "../src/jti-store.js";
import { generateJti } from "../src/auth.js";

describe("InMemoryJtiStore", () => {
  let store: InMemoryJtiStore;

  afterEach(() => {
    store?.dispose();
  });

  it("allows first consume and rejects replay", () => {
    store = new InMemoryJtiStore({ sweepIntervalMs: 0 });
    const jti = generateJti();
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(store.consume(jti, exp)).toBe(true);
    expect(store.consume(jti, exp)).toBe(false);
    expect(store.consume(jti, exp)).toBe(false);
    expect(store.size()).toBe(1);
  });

  it("treats distinct jtis independently", () => {
    store = new InMemoryJtiStore({ sweepIntervalMs: 0 });
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(store.consume(generateJti(), exp)).toBe(true);
    expect(store.consume(generateJti(), exp)).toBe(true);
    expect(store.size()).toBe(2);
  });

  it("concurrent double-use only one wins", () => {
    store = new InMemoryJtiStore({ sweepIntervalMs: 0 });
    const jti = generateJti();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const results = Array.from({ length: 20 }, () => store.consume(jti, exp));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("RedisJtiStore", () => {
  it("SET NX semantics via mock client", async () => {
    const keys = new Map<string, string>();
    const client = {
      async set(
        key: string,
        value: string,
        ...args: Array<string | number>
      ): Promise<string | null> {
        // Parse EX ttl NX
        expect(args).toContain("NX");
        expect(args).toContain("EX");
        if (keys.has(key)) return null;
        keys.set(key, value);
        return "OK";
      },
    };

    const store = new RedisJtiStore({ client });
    const jti = generateJti();
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(await store.consume(jti, exp)).toBe(true);
    expect(await store.consume(jti, exp)).toBe(false);
    expect(keys.has(`relay:v1:jti:${jti}`)).toBe(true);
  });
});
