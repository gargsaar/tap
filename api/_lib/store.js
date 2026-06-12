// Shared file-based storage helpers backed by Vercel Blob.
//
// Layout:
//   data/index.json            ← one JSON file: list of recordings + metadata
//   data/<id>/transcript.txt   ← formatted transcript (one txt per recording)
//   data/<id>/insights.json    ← LLM analysis (one json per recording)
//   audio/<...>.webm           ← uploaded audio, deleted right after transcription
import { put, del, list } from "@vercel/blob";

const INDEX_PATH = "data/index.json";

// Blob's CDN caches aggressively; a unique query param guarantees a fresh read.
async function freshFetch(url) {
  return fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
}

export async function readIndex() {
  try {
    const { blobs } = await list({ prefix: INDEX_PATH, limit: 1 });
    if (!blobs.length) return [];
    const res = await freshFetch(blobs[0].url);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    if (err.message?.includes("BLOB_READ_WRITE_TOKEN")) throw err;
    return [];
  }
}

export async function writeIndex(entries) {
  await put(INDEX_PATH, JSON.stringify(entries, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function getEntry(id) {
  return (await readIndex()).find(e => e.id === id) || null;
}

// Insert or update one entry; newest first.
// Partial updates ({id, status, ...}) may only MERGE into an existing entry.
// If a stale index read misses the entry, inserting the fragment would corrupt
// the list (and writing the stale list back would drop the real entry) — so we
// refuse and let the caller's retry/next poll see fresh data instead.
export async function upsertEntry(entry) {
  const entries = await readIndex();
  const i = entries.findIndex(e => e.id === entry.id);
  if (i >= 0) {
    entries[i] = { ...entries[i], ...entry };
  } else if (entry.createdAt) {
    entries.unshift(entry); // complete entry — genuine insert
  } else {
    throw new Error(`entry ${entry.id} not found in index (stale read?) — skipped partial update`);
  }
  await writeIndex(entries);
  return entries;
}

export async function removeEntry(id) {
  const entries = await readIndex();
  const entry = entries.find(e => e.id === id);
  await writeIndex(entries.filter(e => e.id !== id));
  return entry;
}

export async function saveTranscript(id, text) {
  return put(`data/${id}/transcript.txt`, text, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

export async function saveInsights(id, insights) {
  return put(`data/${id}/insights.json`, JSON.stringify(insights, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function fetchText(url) {
  const res = await freshFetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

export async function fetchJson(url) {
  const res = await freshFetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
}

export async function deleteBlobs(urls) {
  const real = urls.filter(Boolean);
  if (real.length) await del(real);
}

export function newId() {
  const t = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "").replace(/-/g, "");
  return `rec_${t}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hms(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
