export default function handler(req, res) {
  res.json({
    status: "ok",
    version: "0.1.0",
    endpoints: {
      "/api/health": "this endpoint",
      "/api/transcribe": "coming soon — accepts audio, returns transcript",
      "/api/summarize": "coming soon — accepts transcript, returns meeting notes"
    }
  });
}
