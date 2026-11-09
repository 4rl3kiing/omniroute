import test from "node:test";
import assert from "node:assert/strict";

import { createChatPipelineHarness } from "./_chatPipelineHarness.mjs";

const harness = await createChatPipelineHarness("sysprompt-context");
const {
  BaseExecutor,
  buildOpenAIResponse,
  buildRequest,
  handleChat,
  resetStorage,
  seedConnection,
  settingsDb,
} = harness;
const { setSystemPromptConfig } = await import("../../open-sse/services/systemPrompt.ts");
const { invalidateDbCache } = await import("../../src/lib/db/readCache.ts");

function reset() {
  setSystemPromptConfig({ enabled: false, prompt: "" });
  delete process.env.OMNIROUTE_CONTEXT_COMPRESSION;
  delete process.env.CONTEXT_LENGTH_OPENAI;
}

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  reset();
  await resetStorage();
});
test.afterEach(async () => {
  reset();
  await resetStorage();
});
test.after(async () => {
  await harness.cleanup();
});

async function send(messages) {
  let upstream = null;
  globalThis.fetch = async (_url, init = {}) => {
    upstream = JSON.parse(init.body);
    return buildOpenAIResponse("ok");
  };
  const res = await handleChat(
    buildRequest({ body: { model: "openai/gpt-4o-mini", stream: false, messages } })
  );
  assert.equal(res.status, 200);
  return upstream;
}

test("persisted global system prompt is injected into upstream requests", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-sp" });
  await settingsDb.updateSettings({ systemPrompt: { enabled: true, prompt: "GLOBAL RULES" } });
  invalidateDbCache();
  const upstream = await send([{ role: "user", content: "hello" }]);
  assert.equal(upstream.messages[0].role, "system");
  assert.match(upstream.messages[0].content, /GLOBAL RULES/);
});

test("without configuration nothing is injected", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-nosp" });
  const upstream = await send([{ role: "user", content: "hello" }]);
  assert.equal(upstream.messages.length, 1);
});

test("context compression is off by default and trims tool output when enabled", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-ctx" });
  process.env.CONTEXT_LENGTH_OPENAI = "20000";
  const huge = "x".repeat(60000);
  const messages = [
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "t", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_1", content: huge },
    { role: "user", content: "summarize" },
  ];

  const untouched = await send(messages);
  assert.equal(untouched.messages.find((m) => m.role === "tool").content.length, 60000);

  process.env.OMNIROUTE_CONTEXT_COMPRESSION = "true";
  // A different last turn so the semantic cache cannot answer without going upstream.
  const compressed = await send([
    ...messages.slice(0, -1),
    { role: "user", content: "summarize again" },
  ]);
  const tool = compressed.messages.find((m) => m.role === "tool");
  assert.ok(tool.content.length < 3000);
  assert.match(tool.content, /\[truncated\]$/);
});
