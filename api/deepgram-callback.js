// POST /api/deepgram-callback?id=<recordingId>
//
// Deepgram POSTs the finished transcript here. We ACK immediately, then (via
// waitUntil, which keeps the function alive after the response) format & save
// the transcript, delete the audio, and run LLM analysis. None of this is tied
// to the user's browser — it runs whether or not the tab is still open.
import { waitUntil } from "@vercel/functions";
import { getEntry, upsertEntry, saveTranscript, deleteBlobs } from "./_lib/store.js";
import { parseDeepgram, formatTranscript } from "./_lib/deepgram.js";
import { runAnalysis } from "./_lib/analyze.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "id is required" });

  const entry = await getEntry(id);
  if (!entry) return res.status(404).json({ error: `unknown id ${id}` });

  // Process in the background; respond to Deepgram right away so it doesn't
  // retry on a slow analysis pass.
  waitUntil(handleResult(id, entry, req.body));
  return res.status(200).json({ received: true });
}

async function handleResult(id, entry, dg) {
  try {
    const { durationSec, utterances, fallback, speakers, words } = parseDeepgram(dg);
    if (!utterances.length && !fallback.trim()) {
      throw new Error("Deepgram returned an empty transcript (no speech detected?)");
    }

    const text = formatTranscript({
      title: entry.title,
      createdAt: entry.createdAt,
      durationSec,
      speakers,
      utterances,
      fallback,
    });
    const tBlob = await saveTranscript(id, text);

    // Audio is no longer needed — delete it before the single index update.
    let audioDeleted = false;
    try {
      await deleteBlobs([entry.audioUrl]);
      audioDeleted = true;
    } catch { /* transcript is safe; orphaned audio is non-fatal */ }

    // One consolidated write — blob reads can be stale for a few seconds after
    // a write, so sequential read-modify-writes of index.json are not safe.
    await upsertEntry({
      id,
      status: "transcribed",
      durationSec: durationSec || entry.durationSec,
      speakers,
      words,
      transcriptUrl: tBlob.url,
      ...(audioDeleted ? { audioUrl: null } : {}),
    });

    // Analysis failure must not undo a good transcript.
    try {
      await runAnalysis(id);
    } catch (e) {
      await upsertEntry({ id, status: "analysis_failed", error: String(e.message || e) }).catch(() => {});
    }
  } catch (err) {
    await upsertEntry({ id, status: "failed", error: String(err.message || err) }).catch(() => {});
    try { await deleteBlobs([entry.audioUrl]); } catch {}
  }
}
