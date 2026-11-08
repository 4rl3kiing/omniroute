import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getHeaderValueCaseInsensitive,
  getSkillsProviderForFormat,
  toPositiveNumber,
  extractMemoryTextFromResponse,
  shouldUseNativeCodexPassthrough,
} from "../../open-sse/handlers/chatCoreHelpers.ts";
import * as chatCore from "../../open-sse/handlers/chatCore.ts";

describe("chatCore helpers", () => {
  it("finds headers case-insensitively and ignores blanks", () => {
    assert.equal(
      getHeaderValueCaseInsensitive({ "User-Agent": " curl/8 " }, "user-agent"),
      "curl/8"
    );
    assert.equal(getHeaderValueCaseInsensitive({ "x-a": "   " }, "x-a"), null);
    assert.equal(getHeaderValueCaseInsensitive(null, "x"), null);
  });

  it("normalizes positive numbers", () => {
    assert.equal(toPositiveNumber(5), 5);
    assert.equal(toPositiveNumber(0), 0);
    assert.equal(toPositiveNumber(-1), 0);
    assert.equal(toPositiveNumber(Number.NaN), 0);
    assert.equal(toPositiveNumber("5"), 0);
  });

  it("maps formats to a skills provider", () => {
    assert.equal(getSkillsProviderForFormat("claude"), "anthropic");
    assert.equal(getSkillsProviderForFormat("gemini"), "google");
    assert.equal(getSkillsProviderForFormat("openai"), "openai");
  });

  it("extracts memory text from OpenAI-shaped responses", () => {
    assert.equal(extractMemoryTextFromResponse(null), "");
    assert.equal(
      extractMemoryTextFromResponse({ choices: [{ message: { content: "hello" } }] }),
      "hello"
    );
  });

  it("keeps shouldUseNativeCodexPassthrough exported from chatCore", () => {
    assert.equal(chatCore.shouldUseNativeCodexPassthrough, shouldUseNativeCodexPassthrough);
    assert.equal(
      shouldUseNativeCodexPassthrough({
        provider: "codex",
        sourceFormat: "openai-responses",
        endpointPath: "/v1/responses/",
      }),
      true
    );
    assert.equal(shouldUseNativeCodexPassthrough({ provider: "openai" }), false);
  });
});
