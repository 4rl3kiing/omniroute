import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "./_chatPipelineHarness.mjs";

const harness = await createChatPipelineHarness("semantic-similarity");
const {
  BaseExecutor,
  buildOpenAIResponse,
  buildRequest,
  handleChat,
  resetStorage,
  seedConnection,
} = harness;

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  delete process.env.SEMANTIC_CACHE_SIMILARITY;
  await resetStorage();
});
test.afterEach(async () => {
  delete process.env.SEMANTIC_CACHE_SIMILARITY;
  await resetStorage();
});
test.after(async () => {
  await harness.cleanup();
});

function chat(content) {
  return handleChat(
    buildRequest({
      body: {
        model: "openai/gpt-4o-mini",
        stream: false,
        temperature: 0,
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content },
        ],
      },
    })
  );
}

async function run(first, second) {
  await seedConnection("openai", { apiKey: "sk-openai-sim" });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return buildOpenAIResponse(`answer-${fetchCount}`);
  };
  const r1 = await chat(first);
  await r1.json();
  const r2 = await chat(second);
  const j2 = await r2.json();
  return { fetchCount, r2, j2 };
}

test("similarity is OFF by default: a near-duplicate still goes upstream", async () => {
  const { fetchCount } = await run(
    "Please tell me the capital city of France",
    "please tell me the capital city of france!"
  );
  assert.equal(fetchCount, 2);
});

test("with a threshold set, a near-duplicate is served from cache", async () => {
  process.env.SEMANTIC_CACHE_SIMILARITY = "0.9";
  const { fetchCount, r2, j2 } = await run(
    "Please tell me the capital city of Spain",
    "please tell me the capital city of spain!"
  );
  assert.equal(fetchCount, 1);
  assert.equal(r2.headers.get("X-OmniRoute-Cache"), "HIT");
  assert.equal(j2.choices[0].message.content, "answer-1");
});

test("prompts that differ in numbers never reuse a cached answer", async () => {
  process.env.SEMANTIC_CACHE_SIMILARITY = "0.5";
  const { fetchCount } = await run("What is 17 times 23 please", "What is 17 times 24 please");
  assert.equal(fetchCount, 2);
});
