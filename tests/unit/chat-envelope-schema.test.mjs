import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatRequestEnvelopeSchema } from "../../src/shared/validation/schemas.ts";

describe("chatRequestEnvelopeSchema", () => {
  it("accepts OpenAI, Claude and Responses shaped bodies", () => {
    for (const body of [
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
      { model: "claude", system: "x", messages: [{ role: "user", content: [{ type: "text" }] }] },
      { model: "gpt-5", input: "hello", instructions: "be brief" },
      { model: "m", messages: [], tools: null, temperature: null, stream: null },
    ]) {
      assert.equal(chatRequestEnvelopeSchema.safeParse(body).success, true);
    }
  });

  it("keeps unknown fields untouched", () => {
    const parsed = chatRequestEnvelopeSchema.parse({ model: "m", custom_flag: { a: 1 } });
    assert.deepEqual(parsed.custom_flag, { a: 1 });
  });

  it("rejects wrongly typed core fields and non-object bodies", () => {
    for (const body of [
      { model: 42 },
      { model: "m", messages: "hi" },
      { model: "m", tools: {} },
      { model: "m", stream: "yes" },
      { model: "m", temperature: "hot" },
      "text",
      null,
      [],
    ]) {
      assert.equal(chatRequestEnvelopeSchema.safeParse(body).success, false);
    }
  });
});
