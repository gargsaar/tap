// POST /api/transcribe  { audioUrl, title?, audioBytes?, durationSec? }
//
// Submits an async Deepgram job and returns immediately (HTTP 202). The actual
// transcription happens on Deepgram's infra; when done it POSTs the result to
// /api/deepgram-callback. State lives in data/index.json, so the browser is
// free to refresh or close — the job is not tied to this request.
import { newId, upsertEntry } from "./_lib/store.js";
import { submitDeepgramJob } from "./_lib/deepgram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: "DEEPGRAM_API_KEY is not set in Vercel env vars" });
  }

  const { audioUrl, title, audioBytes, durationSec } = req.body || {};
  if (!audioUrl) return res.status(400).json({ error: "audioUrl is required" });

  const id = newId();
  const createdAt = new Date().toISOString();
  const cleanTitle = (title || "Untitled meeting").toString().slice(0, 120);

  // Deepgram needs an absolute, publicly reachable callback URL.
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const callbackUrl = `${proto}://${host}/api/deepgram-callback?id=${id}`;

  try {
    await upsertEntry({
      id,
      title: cleanTitle,
      createdAt,
      durationSec: Math.round(Number(durationSec) || 0) || null,
      audioBytes: Number(audioBytes) || null,
      audioUrl,
      speakers: null,
      words: null,
      status: "processing",
      transcriptUrl: null,
      insightsUrl: null,
    });

    const { request_id } = await submitDeepgramJob(audioUrl, callbackUrl);
    await upsertEntry({ id, deepgramRequestId: request_id || null });

    return res.status(202).json({ id, status: "processing" });
  } catch (err) {
    await upsertEntry({ id, status: "failed", error: err.message }).catch(() => {});
    return res.status(502).json({ error: err.message });
  }
}
