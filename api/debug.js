export default function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  res.status(200).json({
    hasBlobToken: !!token,
    tokenPrefix: token ? token.slice(0, 12) + "…" : null,
    blobEnvVars: Object.keys(process.env).filter(k => k.includes("BLOB")).sort(),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
}
