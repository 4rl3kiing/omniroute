import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectSecurityWarnings } from "../../src/lib/securityWarnings.ts";

describe("collectSecurityWarnings", () => {
  it("reports every risky default for an empty environment", () => {
    const warnings = collectSecurityWarnings({});
    assert.equal(warnings.length, 5);
    assert.ok(warnings.some((w) => w.includes("REQUIRE_API_KEY")));
    assert.ok(warnings.some((w) => w.includes("STORAGE_ENCRYPTION_KEY")));
    assert.ok(warnings.some((w) => w.includes("OMNIROUTE_API_KEY")));
    assert.ok(warnings.some((w) => w.includes("CORS_ORIGIN")));
    assert.ok(warnings.some((w) => w.includes("MCP scope")));
  });

  it("returns nothing for a hardened environment", () => {
    const warnings = collectSecurityWarnings({
      REQUIRE_API_KEY: "true",
      STORAGE_ENCRYPTION_KEY: "k",
      OMNIROUTE_API_KEY: "k",
      CORS_ORIGIN: "https://app.example.com",
      OMNIROUTE_MCP_ENFORCE_SCOPES: "true",
    });
    assert.deepEqual(warnings, []);
  });

  it("flags disabled MITM TLS verification", () => {
    const warnings = collectSecurityWarnings({
      REQUIRE_API_KEY: "true",
      STORAGE_ENCRYPTION_KEY: "k",
      OMNIROUTE_API_KEY: "k",
      CORS_ORIGIN: "https://a.b",
      OMNIROUTE_MCP_ENFORCE_SCOPES: "true",
      MITM_DISABLE_TLS_VERIFY: "1",
    });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("MITM_DISABLE_TLS_VERIFY"));
  });

  it("can be silenced", () => {
    assert.deepEqual(collectSecurityWarnings({ OMNIROUTE_SUPPRESS_SECURITY_WARNINGS: "true" }), []);
  });
});
