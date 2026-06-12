// GET    /api/recordings          → { recordings: [...] }   (data/index.json)
// GET    /api/recordings?id=...   → { entry, transcript, insights }
// DELETE /api/recordings?id=...   → removes transcript + insights + index entry
import {
  readIndex, getEntry, removeEntry, fetchText, fetchJson, deleteBlobs,
} from "./_lib/store.js";

export default async function handler(req, res) {
  const id = req.query?.id;
  res.setHeader("Cache-Control", "no-store"); // polling needs fresh status

  try {
    if (req.method === "GET") {
      if (!id) return res.status(200).json({ recordings: await readIndex() });

      const entry = await getEntry(id);
      if (!entry) return res.status(404).json({ error: `no recording ${id}` });

      let transcript = null, insights = null;
      if (entry.transcriptUrl) transcript = await fetchText(entry.transcriptUrl).catch(() => null);
      if (entry.insightsUrl) insights = await fetchJson(entry.insightsUrl).catch(() => null);
      return res.status(200).json({ entry, transcript, insights });
    }

    if (req.method === "DELETE") {
      if (!id) return res.status(400).json({ error: "id is required" });
      const entry = await removeEntry(id);
      if (!entry) return res.status(404).json({ error: `no recording ${id}` });
      await deleteBlobs([entry.transcriptUrl, entry.insightsUrl]).catch(() => {});
      return res.status(200).json({ deleted: id });
    }

    return res.status(405).json({ error: "GET or DELETE only" });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("BLOB_READ_WRITE_TOKEN")) {
      return res.status(500).json({
        error: "Blob store not connected. In Vercel: Storage → Create Blob Store → Connect to this project, then redeploy.",
      });
    }
    return res.status(500).json({ error: msg });
  }
}
