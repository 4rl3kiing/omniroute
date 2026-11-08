import test from "node:test";
import assert from "node:assert/strict";

const { sanitizeChatBodyInPlace } = await import("../../open-sse/handlers/chatCoreHelpers.ts");

test("max_output_tokens maps to max_tokens without overriding an existing max_tokens", () => {
  const a = sanitizeChatBodyInPlace({ max_output_tokens: 50 });
  assert.equal(a.max_tokens, 50);
  assert.equal("max_output_tokens" in a, false);
  const b = sanitizeChatBodyInPlace({ max_output_tokens: 50, max_tokens: 10 });
  assert.equal(b.max_tokens, 10);
  assert.equal("max_output_tokens" in b, false);
});

test("empty name fields are stripped from messages and input items only", () => {
  const body = sanitizeChatBodyInPlace({
    messages: [
      { role: "user", name: "", content: "x" },
      { role: "user", name: "bob", content: "y" },
    ],
    input: [
      { type: "message", name: "" },
      { type: "message", name: "n" },
    ],
  });
  assert.deepEqual(body.messages[0], { role: "user", content: "x" });
  assert.equal(body.messages[1].name, "bob");
  assert.equal("name" in body.input[0], false);
  assert.equal(body.input[1].name, "n");
});

test("tools with empty names are dropped; built-in typed tools are kept", () => {
  const body = sanitizeChatBodyInPlace({
    tools: [
      { type: "function", function: { name: "" } },
      { type: "function", function: { name: "  " } },
      { type: "function", function: { name: "ok" } },
      { name: "flat" },
      { name: "" },
      { type: "web_search" },
    ],
  });
  assert.deepEqual(
    body.tools.map((t) => t.function?.name ?? t.name ?? t.type),
    ["ok", "flat", "web_search"]
  );
});

test("mutates in place and is a no-op for bodies without those fields", () => {
  const body = { model: "m", stream: true };
  assert.equal(sanitizeChatBodyInPlace(body), body);
  assert.deepEqual(body, { model: "m", stream: true });
});
