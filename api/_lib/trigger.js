// Enqueue a Trigger.dev task via its REST API — using plain fetch rather than
// importing @trigger.dev/sdk keeps the Vercel serverless functions small so
// they bundle/deploy cleanly (the SDK only belongs in the /trigger task files,
// which deploy to Trigger.dev, not Vercel).
export async function triggerTask(taskId, payload) {
  const key = process.env.TRIGGER_SECRET_KEY;
  if (!key) throw new Error("TRIGGER_SECRET_KEY is not set in Vercel env vars");

  const res = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Trigger.dev ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json(); // { id: "run_..." }
}
