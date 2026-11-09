import { CORS_ORIGIN } from "@/shared/utils/cors";
import { authorizeV1, corsPreflight, notFound } from "@/lib/batches/auth";
import { readFileContent } from "@/lib/batches/store";

export async function OPTIONS() {
  return corsPreflight("GET, OPTIONS");
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeV1(request);
  if (auth.rejection) return auth.rejection;
  const { id } = await props.params;
  const data = readFileContent(id, auth.owner);
  if (!data) return notFound("File");
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Access-Control-Allow-Origin": CORS_ORIGIN,
    },
  });
}
