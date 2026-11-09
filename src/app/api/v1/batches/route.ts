import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { v1BatchCreateSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { authorizeV1, corsPreflight, json } from "@/lib/batches/auth";
import { createBatch, getFile, listBatches, publicRecord } from "@/lib/batches/store";
import {
  loadInputText,
  parseBatchInput,
  startBatch,
  SUPPORTED_ENDPOINT,
} from "@/lib/batches/processor";

export async function OPTIONS() {
  return corsPreflight("GET, POST, OPTIONS");
}

/** POST /v1/batches — create and start a batch from an uploaded JSONL file. */
export async function POST(request: Request) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const validation = validateBody(v1BatchCreateSchema, rawBody);
  if (isValidationFailure(validation)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, validation.error.message);
  }
  const body = validation.data;

  if (!getFile(body.input_file_id, auth.owner)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "input_file_id not found");
  }
  const text = loadInputText(body.input_file_id, auth.owner);
  const parsed = parseBatchInput(text || "", SUPPORTED_ENDPOINT);
  if (!parsed.lines)
    return errorResponse(HTTP_STATUS.BAD_REQUEST, parsed.error || "Invalid input file");

  const batch = createBatch({
    endpoint: body.endpoint,
    inputFileId: body.input_file_id,
    completionWindow: body.completion_window,
    metadata: body.metadata ?? null,
    total: parsed.lines.length,
    owner: auth.owner,
  });
  // Fire and forget: the run is tracked in the store, not tied to this request.
  void startBatch(batch, parsed.lines, auth.authorization);
  return json(publicRecord(batch));
}

export async function GET(request: Request) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  return json({ object: "list", data: listBatches(auth.owner).map(publicRecord) });
}
