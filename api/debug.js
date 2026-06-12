// TEMPORARY diagnostic — does a server-side blob upload. The server can read
// the real error body that the browser's CORS-opaque 400 hides.
import { put } from "@vercel/blob";

export default async function handler(req, res) {
  const rw = process.env.BLOB_READ_WRITE_TOKEN || "";
  const out = {
    hasBlobToken: !!rw,
    tokenStoreId: rw.split("_")[3] || null,
    realStoreId: process.env.BLOB_STORE_ID || null,
    vercelEnv: process.env.VERCEL_ENV || null,
  };
  try {
    const r = await put(`debug/test-${Date.now()}.txt`, "hello from server", {
      access: "public",
      addRandomSuffix: true,
      contentType: "text/plain",
    });
    out.serverPut = "OK";
    out.url = r.url;
  } catch (e) {
    out.serverPut = "FAILED";
    out.error = String(e?.message || e);
    out.errorName = e?.name || null;
  }
  res.status(200).json(out);
}
