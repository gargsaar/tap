// POST /api/transcribe  { audioUrl, title?, audioBytes? }
//
// 1. Sends the uploaded audio (by URL) to Deepgram Nova-3 with diarization
// 2. Formats a persistent, analysis-friendly transcript (.txt)
// 3. Saves data/<id>/transcript.txt and updates data/index.json
// 4. Deletes the audio blob — we keep only one recording in flight, ever
import {
  newId, hms, upsertEntry, saveTranscript, deleteBlobs,
} from "./_lib/store.js";

export const config = { maxDuration: 300 };

const DG_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: "DEEPGRAM_API_KEY is not set in Vercel env vars" });
  }

  const { audioUrl, title, audioBytes } = req.body || {};
  if (!audioUrl) return res.status(400).json({ error: "audioUrl is required" });

  const id = newId();
  const createdAt = new Date().toISOString();
  const cleanTitle = (title || "Untitled meeting").toString().slice(0, 120);

  try {
    // --- 1. Deepgram ---
    const params = new URLSearchParams({
      model: DG_MODEL,
      smart_format: "true",
      diarize: "true",
      utterances: "true",
      punctuate: "true",
    });
    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    });
    if (!dgRes.ok) {
      const detail = await dgRes.text();
      throw new Error(`Deepgram ${dgRes.status}: ${detail.slice(0, 300)}`);
    }
    const dg = await dgRes.json();

    const durationSec = Math.round(dg.metadata?.duration || 0);
    const utterances = dg.results?.utterances || [];
    const fallback = dg.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    if (!utterances.length && !fallback.trim()) {
      throw new Error("Deepgram returned an empty transcript (no speech detected?)");
    }

    // --- 2. Format transcript ---
    const speakers = new Set(utterances.map(u => u.speaker)).size || 1;
    const words = utterances.length
      ? utterances.reduce((n, u) => n + (u.transcript?.split(/\s+/).filter(Boolean).length || 0), 0)
      : fallback.split(/\s+/).filter(Boolean).length;
    const text = formatTranscript({
      title: cleanTitle, createdAt, durationSec, speakers, utterances, fallback,
    });

    // --- 3. Persist ---
    const tBlob = await saveTranscript(id, text);
    const entry = {
      id,
      title: cleanTitle,
      createdAt,
      durationSec,
      audioBytes: Number(audioBytes) || null,
      speakers,
      words,
      status: "transcribed",
      transcriptUrl: tBlob.url,
      insightsUrl: null,
    };
    await upsertEntry(entry);

    // --- 4. Delete the audio (best effort — transcript is already safe) ---
    let audioDeleted = true;
    try { await deleteBlobs([audioUrl]); } catch { audioDeleted = false; }

    return res.status(200).json({ id, entry, audioDeleted });
  } catch (err) {
    // Don't leave orphaned audio behind on failure either.
    try { await deleteBlobs([audioUrl]); } catch {}
    return res.status(502).json({ error: err.message });
  }
}

// Persistent transcript format — readable by humans, stable for LLM analysis:
// metadata header, then timestamped speaker turns. Consecutive utterances by
// the same speaker are merged, but blocks split on long pauses or length so
// timestamps stay useful in 2-hour meetings.
function formatTranscript({ title, createdAt, durationSec, speakers, utterances, fallback }) {
  const header = [
    "# Tap. meeting transcript",
    `# Title:    ${title}`,
    `# Date:     ${createdAt}`,
    `# Duration: ${hms(durationSec)}`,
    `# Speakers: ${speakers}`,
    `# Engine:   Deepgram ${DG_MODEL} (diarized)`,
    "# " + "-".repeat(60),
    "",
  ].join("\n");

  if (!utterances.length) return header + fallback.trim() + "\n";

  const blocks = [];
  for (const u of utterances) {
    const t = (u.transcript || "").trim();
    if (!t) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === u.speaker && u.start - last.end <= 15 && last.text.length < 700) {
      last.text += " " + t;
      last.end = u.end;
    } else {
      blocks.push({ speaker: u.speaker, start: u.start, end: u.end, text: t });
    }
  }

  return header + blocks
    .map(b => `[${hms(b.start)}] Speaker ${b.speaker}:\n${b.text}\n`)
    .join("\n");
}
