/**
 * Filesystem-backed store for OpenAI-compatible Files and Batches.
 * Metadata and content live under <DATA_DIR>/batch-store. IDs are validated against a strict
 * pattern before touching the filesystem, and every record is scoped to its owning API key.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveDataDir } from "../dataPaths";

const ID_RE = /^(file|batch)-[0-9a-f]{32}$/;

export interface FileRecord {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  owner: string;
}

export interface BatchRecord {
  id: string;
  object: "batch";
  endpoint: string;
  errors: null | { object: "list"; data: Array<{ code: string; message: string }> };
  input_file_id: string;
  completion_window: string;
  status: "validating" | "in_progress" | "cancelling" | "cancelled" | "completed" | "failed";
  output_file_id: string | null;
  error_file_id: string | null;
  created_at: number;
  in_progress_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  cancelled_at: number | null;
  expires_at: number;
  request_counts: { total: number; completed: number; failed: number };
  metadata: Record<string, string> | null;
  owner: string;
}

export function ownerOf(apiKeyId: string | null | undefined): string {
  return apiKeyId ? String(apiKeyId) : "anonymous";
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

function baseDir(): string {
  const dir = path.join(resolveDataDir(), "batch-store");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newId(prefix: "file" | "batch"): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "")}`;
}

function metaPath(id: string) {
  return path.join(baseDir(), `${id}.json`);
}
function dataPath(id: string) {
  return path.join(baseDir(), `${id}.bin`);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function maxFileBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OMNIROUTE_FILES_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 100 * 1024 * 1024;
}

// ── Files ──

export function saveFile(input: {
  filename: string;
  purpose: string;
  owner: string;
  data: Buffer;
}): FileRecord {
  const id = newId("file");
  const record: FileRecord = {
    id,
    object: "file",
    bytes: input.data.length,
    created_at: Math.floor(Date.now() / 1000),
    filename: path.basename(input.filename || "upload.jsonl"),
    purpose: input.purpose,
    owner: input.owner,
  };
  fs.writeFileSync(dataPath(id), input.data);
  writeJsonAtomic(metaPath(id), record);
  return record;
}

export function getFile(id: string, owner: string): FileRecord | null {
  if (!isValidId(id) || !id.startsWith("file-")) return null;
  const rec = readJson<FileRecord>(metaPath(id));
  return rec && rec.owner === owner ? rec : null;
}

export function readFileContent(id: string, owner: string): Buffer | null {
  if (!getFile(id, owner)) return null;
  try {
    return fs.readFileSync(dataPath(id));
  } catch {
    return null;
  }
}

export function deleteFile(id: string, owner: string): boolean {
  if (!getFile(id, owner)) return false;
  fs.rmSync(metaPath(id), { force: true });
  fs.rmSync(dataPath(id), { force: true });
  return true;
}

function listRecords<T extends { owner: string; created_at: number }>(
  prefix: string,
  owner: string
) {
  const out: T[] = [];
  for (const name of fs.readdirSync(baseDir())) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const rec = readJson<T>(path.join(baseDir(), name));
    if (rec && rec.owner === owner) out.push(rec);
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

export function listFiles(owner: string): FileRecord[] {
  return listRecords<FileRecord>("file-", owner);
}

// ── Batches ──

/** Batches currently being processed by THIS process. */
const activeRuns = new Set<string>();
export function markBatchActive(id: string, active: boolean) {
  if (active) activeRuns.add(id);
  else activeRuns.delete(id);
}

export function createBatch(input: {
  endpoint: string;
  inputFileId: string;
  completionWindow: string;
  metadata: Record<string, string> | null;
  total: number;
  owner: string;
}): BatchRecord {
  const now = Math.floor(Date.now() / 1000);
  const rec: BatchRecord = {
    id: newId("batch"),
    object: "batch",
    endpoint: input.endpoint,
    errors: null,
    input_file_id: input.inputFileId,
    completion_window: input.completionWindow,
    status: "validating",
    output_file_id: null,
    error_file_id: null,
    created_at: now,
    in_progress_at: null,
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    expires_at: now + 24 * 3600,
    request_counts: { total: input.total, completed: 0, failed: 0 },
    metadata: input.metadata,
    owner: input.owner,
  };
  writeJsonAtomic(metaPath(rec.id), rec);
  return rec;
}

export function getBatch(id: string, owner: string): BatchRecord | null {
  if (!isValidId(id) || !id.startsWith("batch-")) return null;
  const rec = readJson<BatchRecord>(metaPath(id));
  if (!rec || rec.owner !== owner) return null;
  // A batch that claims to be running but is not owned by this process was interrupted.
  if (
    (rec.status === "in_progress" || rec.status === "validating" || rec.status === "cancelling") &&
    !activeRuns.has(rec.id)
  ) {
    rec.status = rec.status === "cancelling" ? "cancelled" : "failed";
    if (rec.status === "failed") {
      rec.failed_at = Math.floor(Date.now() / 1000);
      rec.errors = {
        object: "list",
        data: [{ code: "interrupted", message: "Batch was interrupted by a server restart." }],
      };
    } else {
      rec.cancelled_at = Math.floor(Date.now() / 1000);
    }
    writeJsonAtomic(metaPath(rec.id), rec);
  }
  return rec;
}

/** Internal read without the interruption check (used by the running processor). */
export function readBatchRaw(id: string): BatchRecord | null {
  if (!isValidId(id)) return null;
  return readJson<BatchRecord>(metaPath(id));
}

export function updateBatch(id: string, patch: Partial<BatchRecord>): BatchRecord | null {
  const current = readBatchRaw(id);
  if (!current) return null;
  const next = { ...current, ...patch } as BatchRecord;
  writeJsonAtomic(metaPath(id), next);
  return next;
}

export function listBatches(owner: string): BatchRecord[] {
  return listRecords<BatchRecord>("batch-", owner).map((b) => getBatch(b.id, owner) || b);
}

export function publicRecord<T extends { owner: string }>(rec: T): Omit<T, "owner"> {
  const { owner: _owner, ...rest } = rec;
  return rest;
}
