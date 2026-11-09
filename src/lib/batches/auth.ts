import { isApiKeyRequired } from "@/shared/utils/securityMode";
import { CORS_ORIGIN } from "@/shared/utils/cors";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { ownerOf } from "./store";

export function corsPreflight(methods: string) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN },
  });
}

export interface V1Auth {
  /** When set, return this response immediately. */
  rejection: Response | null;
  owner: string;
  authorization: string | null;
}

/** Same auth contract as the other /v1 routes; returns the caller's owner scope. */
export async function authorizeV1(request: Request): Promise<V1Auth> {
  const reject = (response: Response): V1Auth => ({
    rejection: response,
    owner: ownerOf(null),
    authorization: null,
  });
  if (isApiKeyRequired()) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return reject(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key"));
    if (!(await isValidApiKey(apiKey)))
      return reject(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key"));
  }
  const policy = await enforceApiKeyPolicy(request, null);
  if (policy.rejection) return reject(policy.rejection);
  const apiKeyId = policy.apiKeyInfo?.id ? String(policy.apiKeyInfo.id) : null;
  return {
    rejection: null,
    owner: ownerOf(apiKeyId),
    authorization: request.headers.get("authorization"),
  };
}

export function notFound(what: string) {
  return errorResponse(HTTP_STATUS.NOT_FOUND ?? 404, `${what} not found`);
}
