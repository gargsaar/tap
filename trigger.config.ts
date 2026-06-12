import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_njxlgvvbfiwbnbeljmwf",
  dirs: ["./trigger"],
  // Long meetings: give tasks generous headroom (seconds).
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, factor: 2 },
  },
});
