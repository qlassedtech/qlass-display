# Task for Claude Code: publish Qlass Display and make display.qlass.in live

This folder is a **finished, working app**, not a design mock. Ship it as it is. Don't rewrite it.

- Express server: `server.js`
- Static pages: `public/` (no build step)
- Docker + Caddy deployment

## What it is
- `/` is the TV player. It loops the team's uploaded photos and videos, plus auto-generated "achiever" certificate slides from the Google results sheet.
- `/admin` is the upload portal, protected by a password. It has Playlist, Achievers and Settings tabs.
- `/studio` is the Social studio. It makes Instagram posts in 4:5, 9:16, 1:1 and 16:9, 15-second reels with generated music, and captions.
- `public/achiever-art.js` draws all the certificate artwork. The TV and the studio share it.
- `public/studio.html` is a bundled single file. Don't edit it by hand.

## Steps

1. **Push to GitHub.** The repo `qlassedtech/qlass-display` is currently empty.
   ```bash
   git init -b main
   git add .
   git commit -m "Qlass Display: TV player, portal, social studio"
   git remote add origin git@github.com:qlassedtech/qlass-display.git
   git push -u origin main
   ```
   Make sure `.env` and `data/` are **not** committed. Run `git status` and check `.gitignore`.

2. **Prepare the server once.** SSH into the host that display.qlass.in points to.
   - Install Docker with the Compose plugin if it's missing.
   - Clone into `~/qlass-display`. Or use `DEPLOY_PATH` if you set it in step 3.
   - Create the env file:
     ```bash
     cp .env.example .env
     ```
     - set `ADMIN_PASSWORD`; the user chooses it, so ask them
     - set `SESSION_SECRET` to the output of `openssl rand -hex 32`
     - `RESULTS_SHEET_URL` already defaults to the current results sheet
   - If an older Qlass-display install exists on the server, copy its `data/` folder into the new folder so existing uploads stay.
   - Make sure ports 80 and 443 are open; Caddy issues the HTTPS certificate automatically.
   - Make sure the DNS **A record** for `display.qlass.in` points to this server.
   - Run `docker compose up -d --build`. Then run `curl -fsS localhost:3000/healthz`.

3. **Turn on auto-deploy.** Every push to `main` deploys via `.github/workflows/deploy.yml`.
   - On the server, create a deploy key:
     ```bash
     ssh-keygen -t ed25519 -f ~/.ssh/qlass_deploy -N ""
     cat ~/.ssh/qlass_deploy.pub >> ~/.ssh/authorized_keys
     ```
   - Add these GitHub repo secrets, with `gh secret set <NAME>` or in Settings → Secrets → Actions:

     | Secret | Value |
     | --- | --- |
     | `DEPLOY_HOST` | server IP or hostname |
     | `DEPLOY_USER` | SSH user |
     | `DEPLOY_SSH_KEY` | contents of `~/.ssh/qlass_deploy` (the private key) |
     | `DEPLOY_PORT` | optional; default 22 |
     | `DEPLOY_PATH` | optional; default `~/qlass-display` |
   - If the repo is private, the server needs read access to it for `git fetch`. Add a read-only deploy key to the repo, or clone over SSH.
   - Trigger the workflow with `gh workflow run deploy.yml` and confirm it passes.

4. **Verify the live site.**
   - Open https://display.qlass.in. It should load the player. With nothing uploaded, it shows achiever slides or an empty-state message.
   - Open https://display.qlass.in/admin and sign in. The **Achievers** tab should show "Connected · N result rows".
   - Open https://display.qlass.in/studio. It should list the achievers. "Download this image" should produce a PNG.

## Don'ts
- Don't commit `.env`, `data/`, or any credentials.
- Don't edit `public/studio.html` by hand; it's generated.
- Don't change the Caddy domain unless the user asks.

## Pending from the user
- **Student photos.** Get the portal photo URL pattern by QLASS ID, e.g. `https://portal…/photos/{id}.jpg`. Set it in `/admin → Achievers`, or as `PHOTO_URL_PATTERN` in `.env`.
- **CORS on the portal.** The photo portal must send `Access-Control-Allow-Origin: https://display.qlass.in`. Without it, photos won't appear in downloaded posts and reels.
