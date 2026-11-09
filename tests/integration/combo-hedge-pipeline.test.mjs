import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "./_chatPipelineHarness.mjs";

const harness = await createChatPipelineHarness("combo-hedge");
const {
  BaseExecutor,
  buildOpenAIResponse,
  buildRequest,
  combosDb,
  handleChat,
  resetStorage,
  seedConnection,
} = harness;

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  await resetStorage();
});
test.afterEach(async () => {
  await resetStorage();
});
test.after(async () => {
  await harness.cleanup();
});

async function setup(config) {
  await seedConnection("openai", { apiKey: "sk-openai-hedge" });
  await combosDb.createCombo({
    name: "hedged",
    strategy: "priority",
    models: ["openai/gpt-4o-mini", "openai/gpt-4o"],
    config,
  });
  const calls = [];
  globalThis.fetch = async (_url, init = {}) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    if (model === "gpt-4o-mini") await new Promise((r) => setTimeout(r, 250));
    return buildOpenAIResponse(`from-${model}`);
  };
  const res = await handleChat(
    buildRequest({
      body: { model: "hedged", stream: false, messages: [{ role: "user", content: "hi" }] },
    })
  );
  return { calls, json: await res.json(), status: res.status };
}

test("hedging disabled by default: the slow primary answers", async () => {
  const { calls, json, status } = await setup(undefined);
  assert.equal(status, 200);
  assert.deepEqual(calls, ["gpt-4o-mini"]);
  assert.equal(json.choices[0].message.content, "from-gpt-4o-mini");
});

test("hedgeAfterMs: the faster second model wins when the primary is slow", async () => {
  const { calls, json, status } = await setup({ hedgeAfterMs: 40 });
  assert.equal(status, 200);
  assert.ok(calls.includes("gpt-4o-mini") && calls.includes("gpt-4o"));
  assert.equal(json.choices[0].message.content, "from-gpt-4o");
});
