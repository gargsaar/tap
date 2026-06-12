// TEMPORARY diagnostic — checks that BLOB_READ_WRITE_TOKEN actually belongs to
// the connected blob store. A mismatch here = 400 on the upload PUT.
export default function handler(req, res) {
  const rw = process.env.BLOB_READ_WRITE_TOKEN || "";
  const parts = rw.split("_"); // vercel_blob_rw_<storeId>_<secret>
  const tokenStoreId = parts[3] || null;
  const realStoreId = process.env.BLOB_STORE_ID || null;
  res.status(200).json({
    hasBlobToken: !!rw,
    tokenLooksCanonical: rw.startsWith("vercel_blob_rw_"),
    tokenStoreId,
    realStoreId,
    storeIdsMatch: !!tokenStoreId && tokenStoreId === realStoreId,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
