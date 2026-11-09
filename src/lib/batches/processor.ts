/**
 * Batch processor: runs each JSONL request through the normal chat pipeline, one at a time,
 * and writes an OpenAI-compatible output file (and an error file when something failed).
 *
 * Only /v1/chat/completions is supported. The caller's Authorization header is kept in memory
 * for the lifetime of the run (never persisted), so a restart interrupts running batches.
 */

import {
  getBatch,
  readBatchRaw,
  updateBatch,
  markBatchActive,
  readFileContent,
  saveFile,
  type BatchRecord,
} from "./store";

export const SUPPORTED_ENDPOINT = "/v1/chat/completions";

export interface BatchLine {
  custom_id: string;
  method: string;
  url: string;
  body: Record<string, unknown>;
}

export function maxBatchRequests(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OMNIROUTE_BATCH_MAX_REQUESTS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

/** Parses and validates a batch input file. Returns lines or a human-readable error. */
export function parseBatchInput(
  text: string,
  endpoint: string,
  limit = maxBatchRequests()
): { lines: BatchLine[] | null; error: string | null } {
  const raw = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (raw.length === 0) return { lines: null, error: "Input file is empty" };
  if (raw.length > limit) return { lines: null, error: `Too many requests (max ${limit})` };
  const seen = new Set<string>();
  const lines: BatchLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    let obj: any;
    try {
      obj = JSON.parse(raw[i]);
    } catch {
      return { lines: null, error: `Line ${i + 1}: invalid JSON` };
    }
    if (!obj || typeof obj !== "object")
      return { lines: null, error: `Line ${i + 1}: not an object` };
    if (typeof obj.custom_id !== "string" || !obj.custom_id)
      return { lines: null, error: `Line ${i + 1}: custom_id is required` };
    if (seen.has(obj.custom_id))
      return { lines: null, error: `Line ${i + 1}: duplicate custom_id "${obj.custom_id}"` };
    seen.add(obj.custom_id);
    if (String(obj.method || "").toUpperCase() !== "POST")
      return { lines: null, error: `Line ${i + 1}: method must be POST` };
    if (obj.url !== endpoint)
      return { lines: null, error: `Line ${i + 1}: url must be ${endpoint}` };
    if (!obj.body || typeof obj.body !== "object" || Array.isArray(obj.body))
      return { lines: null, error: `Line ${i + 1}: body must be an object` };
    lines.push({ custom_id: obj.custom_id, method: "POST", url: obj.url, body: obj.body });
  }
  return { lines, error: null };
}

export type ChatHandler = (request: Request) => Promise<Response>;

async function defaultHandler(): Promise<ChatHandler> {
  const { handleChat } = await import("@/sse/handlers/chat");
  return handleChat as ChatHandler;
}

export function startBatch(
  batch: BatchRecord,
  lines: BatchLine[],
  authorization: string | null,
  handler?: ChatHandler
): Promise<void> {
  markBatchActive(batch.id, true);
  const run = runBatch(batch, lines, authorization, handler)
    .catch((err) => {
      updateBatch(batch.id, {
        status: "failed",
        failed_at: Math.floor(Date.now() / 1000),
        errors: {
          object: "list",
          data: [
            { code: "processor_error", message: err instanceof Error ? err.message : "error" },
          ],
        },
      });
    })
    .finally(() => markBatchActive(batch.id, false));
  return run;
}

async function runBatch(
  batch: BatchRecord,
  lines: BatchLine[],
  authorization: string | null,
  handler?: ChatHandler
) {
  const handle = handler ?? (await defaultHandler());
  updateBatch(batch.id, { status: "in_progress", in_progress_at: Math.floor(Date.now() / 1000) });

  const out: string[] = [];
  const errs: string[] = [];
  let completed = 0;
  let failed = 0;

  for (const line of lines) {
    const current = readBatchRaw(batch.id);
    if (current?.status === "cancelling") break;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authorization) headers.Authorization = authorization;
    const body = { ...line.body, stream: false };
    let record: Record<string, unknown>;
    try {
      const res = await handle(
        new Request("http://localhost/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      );
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      record = {
        id: `batch_req_${completed + failed + 1}`,
        custom_id: line.custom_id,
        response: {
          status_code: res.status,
          request_id: res.headers.get("x-request-id") || null,
          body: parsed,
        },
        error: null,
      };
      if (res.ok) {
        completed++;
        out.push(JSON.stringify(record));
      } else {
        failed++;
        errs.push(JSON.stringify(record));
      }
    } catch (err) {
      failed++;
      errs.push(
        JSON.stringify({
          id: `batch_req_${completed + failed}`,
          custom_id: line.custom_id,
          response: null,
          error: { code: "request_failed", message: err instanceof Error ? err.message : "error" },
        })
      );
    }
    updateBatch(batch.id, { request_counts: { total: lines.length, completed, failed } });
  }

  const now = Math.floor(Date.now() / 1000);
  const wasCancelled = readBatchRaw(batch.id)?.status === "cancelling";
  const outputFile = out.length
    ? saveFile({
        filename: `${batch.id}_output.jsonl`,
        purpose: "batch_output",
        owner: batch.owner,
        data: Buffer.from(out.join("\n") + "\n"),
      })
    : null;
  const errorFile = errs.length
    ? saveFile({
        filename: `${batch.id}_errors.jsonl`,
        purpose: "batch_output",
        owner: batch.owner,
        data: Buffer.from(errs.join("\n") + "\n"),
      })
    : null;
  updateBatch(batch.id, {
    status: wasCancelled ? "cancelled" : "completed",
    ...(wasCancelled ? { cancelled_at: now } : { completed_at: now }),
    output_file_id: outputFile?.id ?? null,
    error_file_id: errorFile?.id ?? null,
    request_counts: { total: lines.length, completed, failed },
  });
}

export function requestCancel(id: string, owner: string): BatchRecord | null {
  const batch = getBatch(id, owner);
  if (!batch) return null;
  if (batch.status === "in_progress" || batch.status === "validating") {
    return updateBatch(id, { status: "cancelling" });
  }
  return batch;
}

export function loadInputText(fileId: string, owner: string): string | null {
  const buf = readFileContent(fileId, owner);
  return buf ? buf.toString("utf8") : null;
}
