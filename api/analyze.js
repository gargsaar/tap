// POST /api/analyze  { id }
// Manual (re-)run of the LLM analysis for an already-transcribed recording.
// The automatic run happens in the analyze-meeting Trigger.dev job.
import { upsertEntry } from "./_lib/store.js";
import { runAnalysis } from "./_lib/analyze.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const insights = await runAnalysis(id);
    return res.status(200).json({ id, insights });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("GROQ_API_KEY")) return res.status(500).json({ error: msg });
    await upsertEntry({ id, status: "analysis_failed", error: msg }).catch(() => {});
    return res.status(502).json({ error: msg });
  }
}
