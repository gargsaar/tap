// Deepgram helpers: submit an async (callback-based) job, and turn the
// result payload into a persistent, analysis-friendly transcript.
import { hms } from "./store.js";

export const DG_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";

// Transcribe synchronously — POST the audio URL and wait for the full result.
// No callback (and thus no callback-reachability problems): this runs inside a
// Trigger.dev task, which has no 300s function ceiling, so blocking is fine.
export async function transcribeAudio(audioUrl) {
  const params = new URLSearchParams({
    model: DG_MODEL,
    smart_format: "true",
    diarize: "true",
    utterances: "true",
    punctuate: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json(); // full transcript result
}

// Pull the bits we care about out of a Deepgram result payload.
export function parseDeepgram(dg) {
  const durationSec = Math.round(dg?.metadata?.duration || 0);
  const utterances = dg?.results?.utterances || [];
  const fallback = dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  const speakers = new Set(utterances.map(u => u.speaker)).size || 1;
  const words = utterances.length
    ? utterances.reduce((n, u) => n + (u.transcript?.split(/\s+/).filter(Boolean).length || 0), 0)
    : fallback.split(/\s+/).filter(Boolean).length;
  return { durationSec, utterances, fallback, speakers, words };
}

// Persistent transcript format — readable by humans, stable for LLM analysis:
// metadata header, then timestamped speaker turns. Consecutive utterances by
// the same speaker are merged, but blocks split on long pauses or length so
// timestamps stay useful in 2-hour meetings.
export function formatTranscript({ title, createdAt, durationSec, speakers, utterances, fallback }) {
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
