// POST /api/login { passcode } — sets the auth cookie if the passcode matches
// APP_PASSCODE. The cookie is HMAC(passcode), so it reveals nothing and can't
// be forged without knowing the passcode.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return res.status(400).json({ error: "Auth is not configured (APP_PASSCODE unset)" });

  const submitted = (req.body && req.body.passcode ? String(req.body.passcode) : "");
  if (submitted !== passcode) return res.status(401).json({ error: "Incorrect passcode" });

  const token = await authToken(passcode);
  // No Max-Age/Expires → a session cookie: cleared when the browser closes,
  // so the passcode is required again on next launch.
  res.setHeader(
    "Set-Cookie",
    `tap_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`,
  );
  return res.status(200).json({ ok: true });
}

async function authToken(passcode) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("tap-auth-v1"));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
