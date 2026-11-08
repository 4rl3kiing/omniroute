/**
 * Central place for the "must the caller authenticate?" policy.
 *
 * - REQUIRE_API_KEY=true  → every /v1/* request needs a valid API key (explicit, as before).
 * - OMNIROUTE_SECURE_MODE=true → opt-in preset that turns on the secure defaults in one switch:
 *   API key required on /v1/*, and the A2A endpoint refuses to run without OMNIROUTE_API_KEY.
 *   An explicit REQUIRE_API_KEY=false still wins, so existing setups never change by surprise.
 *
 * Nothing here changes behavior unless one of those variables is set.
 */

type Env = Record<string, string | undefined>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function readBool(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function isSecureMode(env: Env = process.env): boolean {
  return readBool(env.OMNIROUTE_SECURE_MODE) === true;
}

export function isApiKeyRequired(env: Env = process.env): boolean {
  const explicit = readBool(env.REQUIRE_API_KEY);
  if (explicit !== null) return explicit;
  return isSecureMode(env);
}
