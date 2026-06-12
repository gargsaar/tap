// POST /api/retry { id } — re-submit an existing recording's audio to Deepgram.
// Recovers recordings stuck at "processing" or "failed" (e.g. a callback that
// was blocked) WITHOUT re-uploading, as long as the audio blob still exists
// (it's only deleted after a successful transcription).
import { getEntry, upsertEntry } from "./_lib/store.js";
import { submitDeepgramJob } from "./_lib/deepgram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: "DEEPGRAM_API_KEY is not set in Vercel env vars" });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });

  const entry = await getEntry(id);
  if (!entry) return res.status(404).json({ error: `no recording ${id}` });
  if (!entry.audioUrl) {
    return res.status(409).json({ error: "audio was already deleted (transcription previously succeeded) — nothing to retry" });
  }

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  let callbackUrl = `${proto}://${host}/api/deepgram-callback?id=${id}`;
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    callbackUrl += `&x-vercel-protection-bypass=${process.env.VERCEL_AUTOMATION_BYPASS_SECRET}`;
  }

  try {
    await submitDeepgramJob(entry.audioUrl, callbackUrl);
    await upsertEntry({ id, status: "processing", error: null });
    return res.status(202).json({ id, status: "processing" });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
