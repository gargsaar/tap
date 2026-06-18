# Tap. — Meeting Recorder

Record Google Meet (or any browser tab audio) + your microphone, transcribe it with speaker labels, and get AI meeting notes. Pure browser-based, no installs.

## Pipeline

```
record (browser) → upload to Vercel Blob → POST /api/transcribe
                      └─ enqueues a Trigger.dev job, returns immediately
   Trigger.dev runs durably (retries, no timeouts):
     transcribe-meeting  → Deepgram Nova-3 (diarized) → transcript.txt
        ├─ analyze-meeting → Llama 3.3 70B on Groq → insights.json
        └─ delete-audio    → removes the audio blob
   recording history page polls index.json
```

Background work runs on **Trigger.dev**, not Vercel functions — so there are no
callbacks, no 300s timeouts, and failed steps retry automatically. Audio is
kept only long enough to transcribe, then deleted. What persists is file-based
storage in Vercel Blob:

```
data/index.json            ← list of all recordings + metadata (one JSON file)
data/<id>/transcript.txt   ← formatted transcript (timestamps + speaker labels)
data/<id>/insights.json    ← summary, key points, decisions, minutes, action items
```

## Setup

### 1. Deploy

1. Push this repo to GitHub
2. [vercel.com/new](https://vercel.com/new) → import the repo → Framework Preset: **Other** → Deploy

### 2. Storage

In your Vercel project: **Storage → Create Database → Blob**. Connecting it injects `BLOB_READ_WRITE_TOKEN` automatically.

### 3. API keys (Project → Settings → Environment Variables)

| Variable | Where to get it | Cost |
|---|---|---|
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) | $200 free credit (~750 hrs) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | free tier |

Optional overrides: `DEEPGRAM_MODEL` (default `nova-3`), `GROQ_MODEL` (default `llama-3.3-70b-versatile`).

### 4. Trigger.dev (background jobs)

1. Create a project at [trigger.dev](https://trigger.dev) → copy the **project ref** (`proj_…`) into `trigger.config.ts`.
2. In the **Trigger.dev dashboard**, set env vars: `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `BLOB_READ_WRITE_TOKEN` (the jobs read/write blob + call the APIs).
3. In **Vercel**, set `TRIGGER_SECRET_KEY` (lets `/api/transcribe` enqueue jobs).
4. Deploy the jobs: `npx trigger.dev@latest deploy` (or connect the GitHub repo in the Trigger.dev dashboard for auto-deploy on push).

### 5. Passcode gate (optional but recommended)

Set **`APP_PASSCODE`** to any value to put the whole app — every page and API —
behind a single passcode. Edge middleware blocks all requests without a valid
auth cookie, so a URL won't even render until you sign in at `/login`. Leave
`APP_PASSCODE` unset to disable the gate.

Redeploy after adding env vars.

## How to use

1. Open your Google Meet in one Chrome tab, this app in another
2. **Arm sources** → grant mic → pick the Meet tab and tick **"Also share tab audio"**
3. **Record** → run the meeting → **Stop**
4. Per take: play back, **Download** the `.webm`, or **Transcribe** to run the full pipeline
5. Open **History** for transcripts, summaries, minutes and action items

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/upload` | POST | issues client-upload tokens for Vercel Blob (bypasses 4.5 MB body limit) |
| `/api/transcribe` | POST | Deepgram transcription → saves transcript.txt → deletes audio |
| `/api/analyze` | POST | Llama 3.3 analysis → saves insights.json (chunked map-reduce for 1–2 h meetings) |
| `/api/recordings` | GET / DELETE | list, detail (`?id=`), delete |
| `/api/health` | GET | liveness check |

## Roadmap

- [x] Transcription via Deepgram (`/api/transcribe`)
- [x] AI meeting notes via open-source LLM (`/api/analyze`)
- [x] Saved meeting history
- [x] Speaker diarization
- [x] Passcode gate (`APP_PASSCODE` + edge middleware)
- [ ] Per-user accounts (currently one shared passcode)
- [ ] Live transcription during the meeting

## Requirements

- Chrome or Edge (tab audio capture is not supported in Firefox/Safari)
- HTTPS (Vercel provides this automatically)

## Project structure

```
tap/
├── public/
│   ├── index.html       ← recorder UI
│   └── history.html     ← recording history, transcripts, insights
├── api/
│   ├── _lib/store.js    ← file-based storage helpers (Vercel Blob)
│   ├── upload.js        ← client-upload token handler
│   ├── transcribe.js    ← Deepgram → transcript.txt → delete audio
│   ├── analyze.js       ← Groq/Llama → insights.json
│   ├── recordings.js    ← list / detail / delete
│   └── health.js
├── vercel.json
└── package.json
```

## Privacy note

This is a prototype: blob URLs are public-but-unguessable and the API has no auth. Don't use it for sensitive meetings until auth is added.
