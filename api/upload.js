// Issues short-lived client-upload tokens so the browser can upload the
// recording directly to Vercel Blob (bypasses the 4.5 MB function body limit —
// a 2-hour meeting is far bigger than that).
import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["audio/webm", "video/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"],
        maximumSizeInBytes: 500 * 1024 * 1024, // ~9 hrs of 128 kbps opus
        addRandomSuffix: true,
      }),
      // Fired by Vercel after the upload lands; nothing to do — the client
      // drives the transcribe step itself.
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
