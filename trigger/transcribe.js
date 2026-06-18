// Root job: transcribe, then run the pipeline SEQUENTIALLY —
//   transcribe-meeting → analyze-meeting → delete-audio
// Each step waits for the previous (triggerAndWait), so they show as a nested
// run tree and the audio is deleted only AFTER analysis succeeds (kept around
// for retry if analysis fails).
import { task } from "@trigger.dev/sdk";
import { upsertEntry, saveTranscript } from "../api/_lib/store.js";
import { transcribeAudio, parseDeepgram, formatTranscript } from "../api/_lib/deepgram.js";
import { analyzeMeeting } from "./analyze.js";
import { deleteAudio } from "./delete-audio.js";

export const transcribeMeeting = task({
  id: "transcribe-meeting",
  maxDuration: 900,
  // payload carries everything we need so we never depend on a possibly-stale
  // read of index.json right after /api/transcribe wrote it.
  run: async ({ id, audioUrl, title, createdAt, durationSec: prevDuration }) => {
    const dg = await transcribeAudio(audioUrl);
    const { durationSec, utterances, fallback, speakers, words } = parseDeepgram(dg);

    if (!utterances.length && !fallback.trim()) {
      await upsertEntry({ id, status: "failed", error: "Deepgram returned an empty transcript (no speech detected?)" });
      await deleteAudio.triggerAndWait({ id, audioUrl }); // useless audio — reclaim it
      return { ok: false, reason: "empty" };
    }

    const text = formatTranscript({ title, createdAt, durationSec, speakers, utterances, fallback });
    const tBlob = await saveTranscript(id, text);
    await upsertEntry({
      id,
      status: "transcribed",
      durationSec: durationSec || prevDuration || null,
      speakers,
      words,
      transcriptUrl: tBlob.url,
    });

    // Step 2 — analysis (sequential, wait for it).
    const analysis = await analyzeMeeting.triggerAndWait({ id });

    // Step 3 — delete the audio, but only once analysis has succeeded, so a
    // failed analysis can be retried from the still-present audio.
    if (analysis.ok) {
      await deleteAudio.triggerAndWait({ id, audioUrl });
      return { ok: true, words, speakers, analyzed: true };
    }
    return { ok: true, words, speakers, analyzed: false };
  },
});
