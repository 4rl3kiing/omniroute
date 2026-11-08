import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { secureCompare } from "../../src/shared/utils/secureCompare.ts";

describe("secureCompare", () => {
  it("returns true for identical strings", () => {
    assert.equal(secureCompare("sk-abc123", "sk-abc123"), true);
  });

  it("returns false for different strings, including different lengths", () => {
    assert.equal(secureCompare("sk-abc123", "sk-abc124"), false);
    assert.equal(secureCompare("short", "a-much-longer-secret"), false);
    assert.equal(secureCompare("", "x"), false);
  });

  it("returns false for non-string input", () => {
    assert.equal(secureCompare(undefined, "x"), false);
    assert.equal(secureCompare("x", null), false);
    assert.equal(secureCompare(1, 1), false);
  });
});
