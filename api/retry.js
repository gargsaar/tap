// POST /api/retry { id } — re-enqueue the transcribe pipeline for a recording
// whose audio is still present (e.g. it failed or got stuck). No re-upload.
import { triggerTask } from "./_lib/trigger.js";
import { getEntry, upsertEntry } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return res.status(500).json({ error: "TRIGGER_SECRET_KEY is not set in Vercel env vars" });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });

  const entry = await getEntry(id);
  if (!entry) return res.status(404).json({ error: `no recording ${id}` });
  if (!entry.audioUrl) {
    return res.status(409).json({ error: "audio was already deleted (transcription previously succeeded) — nothing to retry" });
  }

  try {
    const run = await triggerTask("transcribe-meeting", {
      id,
      audioUrl: entry.audioUrl,
      title: entry.title,
      createdAt: entry.createdAt,
      durationSec: entry.durationSec,
    });
    await upsertEntry({ id, status: "processing", error: null, triggerRunId: run.id });
    return res.status(202).json({ id, status: "processing", runId: run.id });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
