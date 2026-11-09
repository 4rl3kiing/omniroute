import test from "node:test";
import assert from "node:assert/strict";

const m = await import("../../src/lib/semanticSimilarity.ts");

test("threshold is disabled unless explicitly set within (0,1]", () => {
  assert.equal(m.getSimilarityThreshold({}), 0);
  assert.equal(m.getSimilarityThreshold({ SEMANTIC_CACHE_SIMILARITY: "0" }), 0);
  assert.equal(m.getSimilarityThreshold({ SEMANTIC_CACHE_SIMILARITY: "1.5" }), 0);
  assert.equal(m.getSimilarityThreshold({ SEMANTIC_CACHE_SIMILARITY: "abc" }), 0);
  assert.equal(m.getSimilarityThreshold({ SEMANTIC_CACHE_SIMILARITY: "0.93" }), 0.93);
});

test("near-duplicates match, unrelated prompts do not", () => {
  const idx = new m.SimilarityIndex();
  idx.add("s", "sigA", "What is the capital of France?");
  assert.equal(idx.find("s", "what is the capital of france", 0.9)?.signature, "sigA");
  assert.equal(idx.find("s", "Explain quantum entanglement in simple terms", 0.9), null);
});

test("different scope or different numbers never match", () => {
  const idx = new m.SimilarityIndex();
  idx.add("s1", "sigA", "What is 2 + 2?");
  assert.equal(idx.find("s2", "What is 2 + 2?", 0.5), null);
  assert.equal(idx.find("s1", "What is 2 + 3?", 0.5), null);
  assert.equal(idx.find("s1", "What is 2 + 2?", 0.99)?.signature, "sigA");
});

test("scope ignores only the last user message and rejects multimodal turns", () => {
  const base = (last) => ({
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: last },
    ],
  });
  const a = m.buildSimilarityScope("gpt", base("hello there"), 0, 1);
  const b = m.buildSimilarityScope("gpt", base("hello, there!"), 0, 1);
  const c = m.buildSimilarityScope("gpt2", base("hello there"), 0, 1);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(
    m.buildSimilarityScope(
      "gpt",
      { messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] },
      0,
      1
    ),
    null
  );
  assert.equal(m.buildSimilarityScope("gpt", { messages: [] }, 0, 1), null);
});

test("index is bounded and can drop entries", () => {
  const idx = new m.SimilarityIndex(3);
  for (let i = 0; i < 5; i++) idx.add("s", `sig${i}`, `prompt number ${"x".repeat(i)}`);
  assert.equal(idx.size, 3);
  idx.remove("sig4");
  assert.equal(idx.size, 2);
});
