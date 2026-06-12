// POST /api/deepgram-callback?id=<recordingId>
//
// Deepgram POSTs the finished transcript here. We save the transcript
// SYNCHRONOUSLY (before responding) so it can never be lost to a function that
// gets frozen after the HTTP response — that's a fast handful of blob ops, well
// within Deepgram's callback timeout. Only the slow LLM analysis runs in the
// background via waitUntil; if that's ever dropped, the transcript is still
// saved and "Re-run analysis" recovers it.
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

  let transcribed = false;
  try {
    await saveTranscriptStage(id, entry, req.body);
    transcribed = true;
  } catch (err) {
    await upsertEntry({ id, status: "failed", error: String(err.message || err) }).catch(() => {});
    try { await deleteBlobs([entry.audioUrl]); } catch {}
  }

  // Transcript is now safely persisted. Run analysis in the background so we
  // ack Deepgram quickly (analysis can take a minute on long meetings).
  if (transcribed) waitUntil(analyzeStage(id));
  return res.status(200).json({ ok: transcribed });
}

// Synchronous, fast: parse → format → save transcript → delete audio → mark
// transcribed. Throws on empty transcript so the caller marks it failed.
async function saveTranscriptStage(id, entry, dg) {
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

  let audioDeleted = false;
  try {
    await deleteBlobs([entry.audioUrl]);
    audioDeleted = true;
  } catch { /* transcript is safe; orphaned audio is non-fatal */ }

  await upsertEntry({
    id,
    status: "transcribed",
    durationSec: durationSec || entry.durationSec,
    speakers,
    words,
    transcriptUrl: tBlob.url,
    ...(audioDeleted ? { audioUrl: null } : {}),
  });
}

async function analyzeStage(id) {
  try {
    await runAnalysis(id);
  } catch (e) {
    await upsertEntry({ id, status: "analysis_failed", error: String(e.message || e) }).catch(() => {});
  }
}
