# Tap. — Meeting Recorder

Record Google Meet (or any browser tab audio) + your microphone into a single downloadable file. Pure browser-based, no installs.

## Deploy to Vercel

### Option A: GitHub (recommended)

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo → Vercel auto-detects the config
4. Click Deploy — done. You get an HTTPS URL instantly.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
cd meeting-recorder
vercel deploy
```

## How to use

1. Open your Google Meet in one Chrome tab
2. Open this app in another Chrome tab
3. Click **Arm sources** → grant mic → pick the Meet tab and tick **"Also share tab audio"**
4. Click **Record** → run the meeting
5. Click **Stop** → play back or download the `.webm` file

## Roadmap

- [ ] Transcription via Whisper / Deepgram (`/api/transcribe`)
- [ ] AI meeting notes via Claude (`/api/summarize`)
- [ ] Saved meeting history
- [ ] Speaker diarization

## Requirements

- Chrome or Edge (tab audio capture is not supported in Firefox/Safari)
- HTTPS (Vercel provides this automatically)

## Project structure

```
meeting-recorder/
├── public/
│   └── index.html      ← the entire frontend (single file)
├── api/
│   └── health.js       ← serverless API (placeholder)
├── vercel.json         ← routing + headers config
├── package.json
└── README.md
```
