// Edge middleware — gates the ENTIRE app (pages + APIs) behind a single
// passcode. Runs before any page or function, so a URL won't even render
// without a valid auth cookie.
//
// Auth is OFF when APP_PASSCODE is unset, so a missing env var can never
// brick the app — set APP_PASSCODE in Vercel to turn the gate on.
import { next } from "@vercel/edge";

// Reachable without a passcode:
//  /login, /api/login      → the gate itself
//  /api/deepgram-callback  → Deepgram posts here server-to-server (no cookie)
const PUBLIC_PATHS = ["/login", "/api/login", "/api/deepgram-callback"];

export const config = {
  matcher: ["/((?!_vercel|favicon.ico).*)"],
};

export default async function middleware(req) {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return next(); // gate disabled

  const url = new URL(req.url);
  const { pathname } = url;
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    return next();
  }

  const cookie = parseCookie(req.headers.get("cookie") || "").tap_auth;
  const expected = await authToken(passcode);
  if (cookie && timingSafeEqual(cookie, expected)) return next();

  // Unauthenticated: APIs get a clean 401, pages bounce to /login.
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname + url.search);
  return Response.redirect(login, 302);
}

// HMAC(passcode) over a constant — proves knowledge of the passcode without
// storing it in the cookie. Same impl as /api/login so the values match.
async function authToken(passcode) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("tap-auth-v1"));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseCookie(header) {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
