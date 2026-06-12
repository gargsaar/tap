// POST /api/analyze  { id }
//
// Loads data/<id>/transcript.txt, runs it through an open-source LLM
// (Llama 3.3 70B on Groq's free API), and saves data/<id>/insights.json:
// summary + meeting minutes + action items + decisions.
//
// Long meetings (1-2 h ≈ 20-30k tokens) exceed free-tier per-request limits,
// so the transcript is map-reduced: each chunk → condensed notes → final pass.
import { getEntry, upsertEntry, saveInsights, fetchText } from "./_lib/store.js";

export const config = { maxDuration: 300 };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const CHUNK_CHARS = 20000; // ≈5k tokens — safely under free-tier TPM limits

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set in Vercel env vars" });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });

  const entry = await getEntry(id);
  if (!entry) return res.status(404).json({ error: `no recording ${id}` });
  if (!entry.transcriptUrl) return res.status(409).json({ error: "recording has no transcript yet" });

  try {
    const transcript = await fetchText(entry.transcriptUrl);

    // Map: condense each chunk. Reduce: produce the final structured JSON.
    const chunks = chunkText(transcript, CHUNK_CHARS);
    let source;
    if (chunks.length === 1) {
      source = chunks[0];
    } else {
      const notes = [];
      for (let i = 0; i < chunks.length; i++) {
        notes.push(await condenseChunk(chunks[i], i + 1, chunks.length));
      }
      source = "Condensed notes from a long meeting, in order:\n\n" + notes.join("\n\n---\n\n");
    }

    const parsed = await finalAnalysis(source, entry);
    const insights = {
      id,
      title: entry.title,
      recordedAt: entry.createdAt,
      generatedAt: new Date().toISOString(),
      model: MODEL,
      summary: parsed.summary || "",
      key_points: arr(parsed.key_points),
      decisions: arr(parsed.decisions),
      meeting_minutes: arr(parsed.meeting_minutes),
      action_items: arr(parsed.action_items),
    };

    const iBlob = await saveInsights(id, insights);
    await upsertEntry({ id, status: "analyzed", insightsUrl: iBlob.url });

    return res.status(200).json({ id, insights });
  } catch (err) {
    await upsertEntry({ id, status: "analysis_failed" }).catch(() => {});
    return res.status(502).json({ error: err.message });
  }
}

const arr = v => (Array.isArray(v) ? v : []);

// Split on line boundaries so speaker turns stay intact.
function chunkText(text, max) {
  if (text.length <= max) return [text];
  const chunks = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > max && cur) { chunks.push(cur); cur = ""; }
    cur += line + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

async function condenseChunk(chunk, n, total) {
  return groqChat([
    { role: "system", content: "You condense meeting transcript segments into dense factual notes. Preserve: topics discussed, who said what (by speaker label), decisions, commitments, deadlines, numbers, names. No fluff, no interpretation." },
    { role: "user", content: `Segment ${n} of ${total} of a meeting transcript:\n\n${chunk}\n\nWrite dense bullet-point notes for this segment.` },
  ]);
}

async function finalAnalysis(source, entry) {
  const raw = await groqChat(
    [
      {
        role: "system",
        content: `You are a meticulous meeting analyst. Respond with ONLY valid JSON matching exactly this schema:
{
  "summary": "2-3 paragraph executive summary",
  "key_points": ["important point", ...],
  "decisions": ["decision made", ...],
  "meeting_minutes": [{"topic": "agenda topic", "discussion": ["what was discussed/said", ...]}, ...],
  "action_items": [{"task": "what must be done", "owner": "Speaker N or name if mentioned, else 'unassigned'", "due": "deadline if mentioned, else null"}, ...]
}
Use only information present in the input. Empty arrays are fine where nothing applies.`,
      },
      {
        role: "user",
        content: `Meeting: "${entry.title}" (recorded ${entry.createdAt}, duration ${entry.durationSec}s, ${entry.speakers} speaker(s)).\n\n${source}\n\nProduce the JSON analysis.`,
      },
    ],
    { json: true },
  );
  return JSON.parse(stripFences(raw));
}

function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}

// Groq call with retry on 429/5xx — free-tier rate limits are real.
async function groqChat(messages, { json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (r.ok) {
      const data = await r.json();
      return data.choices?.[0]?.message?.content || "";
    }
    lastErr = `Groq ${r.status}: ${(await r.text()).slice(0, 300)}`;
    if (r.status === 429 || r.status >= 500) {
      const retryAfter = Number(r.headers.get("retry-after")) || 2 ** attempt * 5;
      await new Promise(ok => setTimeout(ok, Math.min(retryAfter, 60) * 1000));
      continue;
    }
    break; // 4xx other than 429 won't improve on retry
  }
  throw new Error(lastErr || "Groq request failed");
}
