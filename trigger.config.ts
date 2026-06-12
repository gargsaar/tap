import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // ⚠️ Replace with YOUR Trigger.dev project ref (dashboard → Project settings,
  // looks like "proj_abc123"). The CLI/deploy needs this to know where to ship.
  project: "proj_REPLACE_WITH_YOUR_REF",
  dirs: ["./trigger"],
  // Long meetings: give tasks generous headroom (seconds).
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, factor: 2 },
  },
});
