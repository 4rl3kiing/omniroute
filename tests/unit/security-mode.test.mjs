import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApiKeyRequired, isSecureMode } from "../../src/shared/utils/securityMode.ts";
import { collectSecurityWarnings } from "../../src/lib/securityWarnings.ts";

describe("securityMode", () => {
  it("keeps today's behavior when nothing is set", () => {
    assert.equal(isSecureMode({}), false);
    assert.equal(isApiKeyRequired({}), false);
  });

  it("honors an explicit REQUIRE_API_KEY", () => {
    assert.equal(isApiKeyRequired({ REQUIRE_API_KEY: "true" }), true);
    assert.equal(isApiKeyRequired({ REQUIRE_API_KEY: "TRUE" }), true);
    assert.equal(isApiKeyRequired({ REQUIRE_API_KEY: "false" }), false);
  });

  it("secure mode requires an API key unless REQUIRE_API_KEY=false is explicit", () => {
    assert.equal(isApiKeyRequired({ OMNIROUTE_SECURE_MODE: "true" }), true);
    assert.equal(isApiKeyRequired({ OMNIROUTE_SECURE_MODE: "1", REQUIRE_API_KEY: "" }), true);
    assert.equal(
      isApiKeyRequired({ OMNIROUTE_SECURE_MODE: "true", REQUIRE_API_KEY: "false" }),
      false
    );
  });

  it("ignores unrecognized values", () => {
    assert.equal(isSecureMode({ OMNIROUTE_SECURE_MODE: "maybe" }), false);
    assert.equal(isApiKeyRequired({ REQUIRE_API_KEY: "maybe" }), false);
  });

  it("warnings recognize secure mode", () => {
    const warnings = collectSecurityWarnings({ OMNIROUTE_SECURE_MODE: "true" });
    assert.ok(!warnings.some((w) => w.startsWith("REQUIRE_API_KEY")));
    assert.ok(warnings.some((w) => w.includes("rejects all requests in secure mode")));
  });
});
