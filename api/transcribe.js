// POST /api/transcribe  { audioUrl, title?, audioBytes?, durationSec? }
//
// Records the meeting in the index and enqueues the Trigger.dev pipeline
// (transcribe → analyze → delete-audio), then returns immediately. All the
// heavy/long work runs durably on Trigger.dev — no callbacks, no function
// timeouts, automatic retries.
import { tasks } from "@trigger.dev/sdk";
import { newId, upsertEntry, deleteBlobs } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return res.status(500).json({ error: "TRIGGER_SECRET_KEY is not set in Vercel env vars" });
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

  try {
    await upsertEntry(entry);
    const handle = await tasks.trigger("transcribe-meeting", {
      id,
      audioUrl,
      title: entry.title,
      createdAt: entry.createdAt,
      durationSec: entry.durationSec,
    });
    await upsertEntry({ id, triggerRunId: handle.id });
    return res.status(202).json({ id, status: "processing", runId: handle.id });
  } catch (err) {
    try { await deleteBlobs([audioUrl]); } catch {}
    await upsertEntry({ ...entry, audioUrl: null, status: "failed", error: err.message }).catch(() => {});
    return res.status(502).json({ error: err.message });
  }
}
