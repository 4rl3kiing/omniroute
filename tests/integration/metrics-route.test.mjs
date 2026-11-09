import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-metrics-"));
process.env.DATA_DIR = dir;

const core = await import("../../src/lib/db/core.ts");
const { GET } = await import("../../src/app/api/metrics/route.ts");

test("GET /api/metrics returns Prometheus text from real tables", async () => {
  const db = core.getDbInstance();
  db.prepare(
    `INSERT INTO usage_history (provider, model, api_key_id, tokens_input, tokens_output, success, latency_ms, timestamp)
     VALUES ('openai','gpt-4o','k1',10,5,1,120,?)`
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT INTO domain_cost_history (api_key_id, cost, timestamp) VALUES ('k1', 0.25, ?)`
  ).run(Date.now());

  const res = await GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain; version=0\.0\.4/);
  const text = await res.text();
  assert.match(
    text,
    /omniroute_requests_total\{provider="openai",model="gpt-4o",outcome="success"\} 1/
  );
  assert.match(text, /omniroute_api_key_cost_usd_total\{api_key_id="k1"\} 0.25/);
});

test.after(() => {
  try {
    core.closeDbInstance?.();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
});
