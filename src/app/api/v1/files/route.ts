import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { authorizeV1, corsPreflight, json } from "@/lib/batches/auth";
import { saveFile, listFiles, maxFileBytes, publicRecord } from "@/lib/batches/store";

export async function OPTIONS() {
  return corsPreflight("GET, POST, OPTIONS");
}

/** POST /v1/files — multipart upload (fields: file, purpose). */
export async function POST(request: Request) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Expected multipart/form-data body");
  }
  const file = form.get("file");
  const purpose = String(form.get("purpose") || "batch");
  if (!(file instanceof File)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing 'file' field");
  }
  if (file.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, "File is empty");
  if (file.size > maxFileBytes()) {
    return errorResponse(413, `File too large (max ${maxFileBytes()} bytes)`);
  }
  const data = Buffer.from(await file.arrayBuffer());
  const rec = saveFile({ filename: file.name, purpose, owner: auth.owner, data });
  return json(publicRecord(rec));
}

/** GET /v1/files — list the caller's files. */
export async function GET(request: Request) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  return json({ object: "list", data: listFiles(auth.owner).map(publicRecord) });
}
