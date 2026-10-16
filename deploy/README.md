# Deploying to DigitalOcean

The site itself is small: no GPU, no TTS. Audio is generated ahead of time (see the main README) and shipped with the app.

| Droplet | Runs | Size |
|---|---|---|
| `gow-web` | nginx, guysofwisdom (Node), allyabase bdo + continuebee + fount + addie | small (2 GB+) |
| generation host | Chatterbox + `scripts/generate.py`, run when content changes | any GPU machine, powered on only while generating |

## 1. Web droplet
1. Create it, then install allyabase with the scripts in `allyabase/deployment/digitalocean/` (bdo, continuebee, fount, addie).
   Addie needs `STRIPE_KEY` and `STRIPE_PUBLISHING_KEY` (see `addie/STRIPE-REGISTRATION.md`) and **must include the
   `/user/:uuid/processor/:processor/payment/:paymentIntentId/status` route**, which guysofwisdom added to addie.
2. Copy `src/`, `public/`, `package*.json`, `content/manifest.json` and `content/audio/` to `/opt/guysofwisdom`
   (not `chatterbox/` or `scripts/`), then `npm ci --omit=dev`. `public/app.js` is committed; `npm run build` regenerates it.
3. `/etc/guysofwisdom.env`:
   ```
   PORT=3030
   DATA_DIR=/var/lib/guysofwisdom      # holds keys.json and the audio-secret: back this up
   BDO_URL=http://localhost:3003
   ADDIE_URL=http://localhost:3005
   ```
4. Install `guysofwisdom.service` and `nginx.conf`, point DNS at the droplet, run certbot.

## 2. Generating content (when koans change)
On any machine with a GPU (a DO GPU droplet, or locally):
1. Python 3.11 venv, `pip install -r chatterbox/requirements.txt` (see the chatterbox-tts project for the CUDA torch build).
2. Put the reference clips in `chatterbox/voices/` (`marky.wav`, `johnny.wav`, `leo.wav`, `raff.wav`).
3. Start `chatterbox/server.py` with `CHATTERBOX_TOKEN` set (`chatterbox.service` is an example unit; bind to localhost or a private address).
4. Run `scripts/generate.py` (needs `ffmpeg`), then copy `content/manifest.json` and `content/audio/` to the web droplet and restart the app.

Shut the GPU machine down afterwards.
