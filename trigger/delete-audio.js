// Job 3: delete the audio blob once it's no longer needed, and drop the
// reference from the index. Kept as its own job so cleanup retries
// independently of transcription/analysis.
import { task } from "@trigger.dev/sdk";
import { deleteBlobs, upsertEntry } from "../api/_lib/store.js";

export const deleteAudio = task({
  id: "delete-audio",
  run: async ({ id, audioUrl }) => {
    if (audioUrl) await deleteBlobs([audioUrl]);
    await upsertEntry({ id, audioUrl: null }).catch(() => {});
    return { ok: true };
  },
});
