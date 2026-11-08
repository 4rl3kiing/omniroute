#!/usr/bin/env node
/**
 * Micro-benchmark for per-request hot paths.
 *
 * Run: node --import tsx/esm scripts/bench-hot-paths.mjs
 *
 * Uses a throwaway DATA_DIR so it never touches real data. Numbers are indicative (they depend on
 * the machine); use them to compare before/after a change, not as absolute targets.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-bench-"));
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENCRYPTION_KEY ||= "bench-key";

const { generateSignature } = await import("../src/lib/semanticCache.ts");
const { chatRequestEnvelopeSchema } = await import("../src/shared/validation/schemas.ts");
const { isApiKeyRequired } = await import("../src/shared/utils/securityMode.ts");
const { secureCompare } = await import("../src/shared/utils/secureCompare.ts");
const { createLoginRateLimiter } = await import("../src/shared/utils/loginRateLimit.ts");
const { getSettings } = await import("../src/lib/db/settings.ts");
const { getCombos } = await import("../src/lib/db/combos.ts");
const { getCachedSettings } = await import("../src/lib/db/readCache.ts");

const body = {
  model: "gpt-4o",
  stream: false,
  temperature: 0,
  tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
  messages: Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `message number ${i} `.repeat(30),
  })),
};

async function bench(name, fn, iterations = 20000) {
  for (let i = 0; i < Math.min(500, iterations); i++) await fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const perCallUs = ((performance.now() - start) / iterations) * 1000;
  console.log(`${name.padEnd(46)} ${perCallUs.toFixed(2).padStart(9)} µs/call`);
}

const limiter = createLoginRateLimiter();

console.log("Per-request hot paths");
await bench("chatRequestEnvelopeSchema.safeParse(body)", () =>
  chatRequestEnvelopeSchema.safeParse(body)
);
await bench("generateSignature(messages)", () =>
  generateSignature(body.model, body.messages, body.temperature, 1)
);
await bench("generateSignature(messages + tools extras)", () =>
  generateSignature(body.model, body.messages, body.temperature, 1, body)
);
await bench("isApiKeyRequired()", () => isApiKeyRequired());
await bench("secureCompare(32B secrets)", () =>
  secureCompare("a".repeat(32), "a".repeat(31) + "b")
);
await bench("loginRateLimiter.check()", () => limiter.check("1.2.3.4"));
await bench("getSettings() (SQLite, uncached)", () => getSettings(), 5000);
await bench("getCachedSettings() (5s TTL cache)", () => getCachedSettings(), 5000);
await bench("getCombos() (SQLite, uncached)", () => getCombos(), 5000);

fs.rmSync(dataDir, { recursive: true, force: true });
