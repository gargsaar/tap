// Job 2: analyze. Runs the open-source LLM (Llama 3.3 on Groq) over the saved
// transcript → insights.json, and flips status to "analyzed".
import { task } from "@trigger.dev/sdk";
import { upsertEntry } from "../api/_lib/store.js";
import { runAnalysis } from "../api/_lib/analyze.js";

export const analyzeMeeting = task({
  id: "analyze-meeting",
  maxDuration: 900,
  run: async ({ id }) => {
    try {
      const insights = await runAnalysis(id); // saves insights + sets "analyzed"
      return { ok: true, actionItems: insights.action_items?.length ?? 0 };
    } catch (e) {
      await upsertEntry({ id, status: "analysis_failed", error: String(e?.message || e) }).catch(() => {});
      throw e; // let Trigger record the failure / retry per policy
    }
  },
});
