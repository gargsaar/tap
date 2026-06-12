// Job 1: transcribe. Runs Deepgram synchronously (no callback), saves the
// formatted transcript, then fans out to the analyze and delete-audio jobs.
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
      await deleteAudio.trigger({ id, audioUrl }); // still reclaim the audio
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

    // Fan out: separate jobs for analysis and audio cleanup.
    await analyzeMeeting.trigger({ id });
    await deleteAudio.trigger({ id, audioUrl });

    return { ok: true, words, speakers };
  },
});
