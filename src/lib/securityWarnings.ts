/**
 * Startup security posture check.
 *
 * Pure function over an env map so it can be unit-tested. It never changes
 * behavior: it only reports risky-but-valid configurations so operators notice
 * them. Set OMNIROUTE_SUPPRESS_SECURITY_WARNINGS=true to silence the output.
 */

type Env = Record<string, string | undefined>;

const isTrue = (value: string | undefined) =>
  ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());

export function collectSecurityWarnings(env: Env = process.env): string[] {
  if (isTrue(env.OMNIROUTE_SUPPRESS_SECURITY_WARNINGS)) return [];

  const warnings: string[] = [];

  if (!isTrue(env.REQUIRE_API_KEY)) {
    warnings.push(
      "REQUIRE_API_KEY is not enabled: /v1/* endpoints accept requests without an API key. " +
        "Set REQUIRE_API_KEY=true before exposing OmniRoute beyond localhost."
    );
  }
  if (!env.STORAGE_ENCRYPTION_KEY) {
    warnings.push(
      "STORAGE_ENCRYPTION_KEY is not set: provider API keys and OAuth tokens are stored in plaintext."
    );
  }
  if (!env.OMNIROUTE_API_KEY) {
    warnings.push(
      "OMNIROUTE_API_KEY is not set: the A2A endpoint (/a2a) accepts unauthenticated requests."
    );
  }
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim() === "*") {
    warnings.push(
      "CORS_ORIGIN allows any origin (*). Set CORS_ORIGIN to your trusted origin if browsers call the API."
    );
  }
  if (!isTrue(env.OMNIROUTE_MCP_ENFORCE_SCOPES)) {
    warnings.push(
      "MCP scope enforcement is off: set OMNIROUTE_MCP_ENFORCE_SCOPES=true to restrict MCP tools per scope."
    );
  }
  if (isTrue(env.MITM_DISABLE_TLS_VERIFY)) {
    warnings.push(
      "MITM_DISABLE_TLS_VERIFY is enabled: upstream TLS certificates are not verified."
    );
  }

  return warnings;
}

export function logSecurityWarnings(env: Env = process.env): void {
  for (const warning of collectSecurityWarnings(env)) {
    console.warn(`[SECURITY] ${warning}`);
  }
}
