// POST /api/transcribe  { audioUrl, title?, audioBytes?, durationSec? }
//
// Submits an async Deepgram job and returns immediately (HTTP 202). The actual
// transcription happens on Deepgram's infra; when done it POSTs the result to
// /api/deepgram-callback. State lives in data/index.json, so the browser is
// free to refresh or close — the job is not tied to this request.
import { newId, upsertEntry, deleteBlobs } from "./_lib/store.js";
import { submitDeepgramJob } from "./_lib/deepgram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: "DEEPGRAM_API_KEY is not set in Vercel env vars" });
  }

  const { audioUrl, title, audioBytes, durationSec } = req.body || {};
  if (!audioUrl) return res.status(400).json({ error: "audioUrl is required" });

  const id = newId();
  const entry = {
    id,
    title: (title || "Untitled meeting").toString().slice(0, 120),
    createdAt: new Date().toISOString(),
    durationSec: Math.round(Number(durationSec) || 0) || null,
    audioBytes: Number(audioBytes) || null,
    audioUrl,
    speakers: null,
    words: null,
    status: "processing",
    transcriptUrl: null,
    insightsUrl: null,
  };

  // Deepgram needs an absolute, publicly reachable callback URL. If this
  // deployment is behind Vercel Deployment Protection, the bypass secret must
  // ride along or the callback is rejected with a 401 and jobs hang forever.
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  let callbackUrl = `${proto}://${host}/api/deepgram-callback?id=${id}`;
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    callbackUrl += `&x-vercel-protection-bypass=${process.env.VERCEL_AUTOMATION_BYPASS_SECRET}`;
  }

  try {
    // Index is written exactly once before returning — blob reads can be stale
    // for a few seconds after a write, so back-to-back read-modify-writes of
    // index.json are not safe within one request.
    await upsertEntry(entry);
    await submitDeepgramJob(audioUrl, callbackUrl);
    return res.status(202).json({ id, status: "processing" });
  } catch (err) {
    try { await deleteBlobs([audioUrl]); } catch {}
    await upsertEntry({ ...entry, audioUrl: null, status: "failed", error: err.message }).catch(() => {});
    return res.status(502).json({ error: err.message });
  }
}
