import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-resilience-"));
process.env.DATA_DIR = dir;

const core = await import("../../src/lib/db/core.ts");
const { getCircuitBreaker, getAllCircuitBreakerStatuses } =
  await import("../../src/shared/utils/circuitBreaker.ts");
const { POST } = await import("../../src/app/api/resilience/reset/route.ts");

const post = (body) =>
  POST(
    new Request("http://localhost/api/resilience/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

function trip(name) {
  const b = getCircuitBreaker(name, { failureThreshold: 1, resetTimeout: 60000 });
  b._onFailure();
  return b;
}

test("empty body still resets every breaker (backwards compatible)", async () => {
  const a = trip("t:a");
  const b = trip("t:b");
  assert.equal(a.canExecute(), false);
  const res = await post(undefined);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).resetCount >= 2);
  assert.equal(a.canExecute() && b.canExecute(), true);
});

test("a name resets only that breaker; unknown names return 404", async () => {
  const a = trip("t:only-a");
  const b = trip("t:only-b");
  const res = await post({ name: "t:only-a" });
  assert.equal((await res.json()).resetCount, 1);
  assert.equal(a.canExecute(), true);
  assert.equal(b.canExecute(), false);
  assert.equal((await post({ name: "nope" })).status, 404);
  assert.equal((await post({ bogus: 1 })).status, 400);
  assert.ok(getAllCircuitBreakerStatuses().some((s) => s.name === "t:only-b"));
});

test.after(() => {
  try {
    core.closeDbInstance?.();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
});
