# Qlass Display

A tiny signage system for `display.qlass.in`:

- **`/admin`** – password-protected upload portal. The team drops in photos and videos, reorders them, sets captions and per-item durations, and toggles items on/off.
- **`/`** – fullscreen TV player. Open it in the TV's browser and it loops through everything that's enabled: photos for N seconds, videos to the end, crossfading between them. It polls for changes, so new uploads start showing within ~30 seconds without touching the TV.

- **`/studio`** – Social studio (team login). Instagram posts in 4:5, 9:16, 1:1 and 16:9, 15-second reels (per student and an "Our Achievers" recap) and auto-written captions — one click per student or a ZIP of everything.
- **Achiever slides** – the server reads the Google results sheet every 2 minutes and mixes certificate slides for students at or above the minimum score (default 80%) into the TV loop, plus an "Our Achievers" summary. Set the sheet, minimum score, photo link, timings and which students to show under **/admin → Achievers**.

No database, no build step. Media lives on disk in `data/uploads/`, the playlist in `data/media.json`.

## Run locally

```bash
cp .env.example .env     # then set ADMIN_PASSWORD and SESSION_SECRET
npm install
npm start
```

Player: http://localhost:3000 · Portal: http://localhost:3000/admin

## Deploy to display.qlass.in

Any Linux VPS (Hetzner, DigitalOcean, Lightsail, etc.) with Docker works.

1. Point a DNS **A record** for `display.qlass.in` at the server's IP.
2. On the server:
   ```bash
   git clone <this repo> qlass-display && cd qlass-display
   cp .env.example .env
   nano .env            # set ADMIN_PASSWORD and a long random SESSION_SECRET
   docker compose up -d --build
   ```
3. Caddy fetches a Let's Encrypt certificate on first request. Open https://display.qlass.in/admin and sign in.

Generate a secret with:
```bash
openssl rand -hex 32
```

Uploads persist in `./data` on the host, so `docker compose up -d --build` after a code change keeps all media.

## Setting up the TV

- **Smart TV with a browser** (Samsung Tizen, LG webOS, Android TV with Chrome/TV Bro): open `https://display.qlass.in`, go fullscreen, and it starts on its own.
- **Best results**: a cheap Chromecast with Google TV / Fire TV Stick / Raspberry Pi running Chromium in kiosk mode:
  ```bash
  chromium --kiosk --autoplay-policy=no-user-gesture-required https://display.qlass.in
  ```
- Turn off the TV's screen saver / auto-sleep. The page also requests a screen wake lock where the browser supports it.
- Video **sound is muted by default** because most TV browsers block unmuted autoplay. Turn "Video sound" on in the portal if your TV allows it; the player falls back to muted automatically if it's blocked.
- The player reloads itself once a day to keep TV browsers from leaking memory.

## Achievers & student photos

- The results sheet must be shared as **Anyone with the link · Viewer**. Columns are matched by header: Name, Class, School, Subject, Test Name, Full Marks, Obtained Marks, Percentage, QLASS ID (and an optional Photo column with image links).
- Student photos come from the **photo link** setting, where `{id}` is replaced with the QLASS ID, e.g. `https://portal.qlass.in/photos/{id}.jpg`. The portal must allow the image to be loaded from display.qlass.in (CORS `Access-Control-Allow-Origin`) for photos to appear in downloaded posts/reels. Students without a photo show their initials.
- Reels are recorded in the browser in real time (15 s each). Chrome/Edge save MP4; other browsers save WebM. Add music inside Instagram.
- `achiever-art.js` draws all certificate artwork (TV, posts, reels) so they always match.

## Notes

- Supported uploads: JPG, PNG, GIF, WebP, AVIF, BMP, MP4, WebM, MOV. Max size per file is `MAX_UPLOAD_MB` (default 2 GB).
- For the smoothest playback on TVs, export videos as **H.264 MP4, 1080p**. MOV files from iPhones (HEVC) may not play in every TV browser.
- Login is a single shared team password; sessions last 30 days.
