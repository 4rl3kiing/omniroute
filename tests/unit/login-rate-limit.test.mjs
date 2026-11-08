import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLoginRateLimiter,
  getLoginClientKey,
} from "../../src/shared/utils/loginRateLimit.ts";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("login rate limiter", () => {
  it("allows attempts below the limit and blocks at the limit", () => {
    const c = clock();
    const rl = createLoginRateLimiter({ maxAttempts: 3, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 2; i++) rl.recordFailure("1.1.1.1");
    assert.equal(rl.check("1.1.1.1").blocked, false);
    rl.recordFailure("1.1.1.1");
    const status = rl.check("1.1.1.1");
    assert.equal(status.blocked, true);
    assert.ok(status.retryAfterSeconds >= 1 && status.retryAfterSeconds <= 60);
  });

  it("tracks clients independently", () => {
    const rl = createLoginRateLimiter({ maxAttempts: 1 });
    rl.recordFailure("a");
    assert.equal(rl.check("a").blocked, true);
    assert.equal(rl.check("b").blocked, false);
  });

  it("unblocks after the window expires", () => {
    const c = clock();
    const rl = createLoginRateLimiter({ maxAttempts: 2, windowMs: 1000, now: c.now });
    rl.recordFailure("x");
    rl.recordFailure("x");
    assert.equal(rl.check("x").blocked, true);
    c.advance(1001);
    assert.equal(rl.check("x").blocked, false);
  });

  it("clears failures on success", () => {
    const rl = createLoginRateLimiter({ maxAttempts: 2 });
    rl.recordFailure("x");
    rl.recordSuccess("x");
    rl.recordFailure("x");
    assert.equal(rl.check("x").blocked, false);
  });

  it("bounds the number of tracked keys", () => {
    const rl = createLoginRateLimiter({ maxAttempts: 1, maxTrackedKeys: 2 });
    rl.recordFailure("a");
    rl.recordFailure("b");
    rl.recordFailure("c");
    assert.equal(rl.check("a").blocked, false); // evicted
    assert.equal(rl.check("c").blocked, true);
  });

  it("derives the client key from proxy headers", () => {
    const h = (map) => ({ get: (n) => map[n] ?? null });
    assert.equal(getLoginClientKey(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), "9.9.9.9");
    assert.equal(getLoginClientKey(h({ "x-real-ip": "8.8.8.8" })), "8.8.8.8");
    assert.equal(getLoginClientKey(h({})), "unknown");
  });
});
