# Guys of wisdom

Guys of wisdom takes woo woo koans and has a wise guy say them to you. First four are free, and then payments via addie for more.

## How it works

- You pick a category (koans, affirmations, astrology, pump-up). You don't pick the guy: each line already belongs to one persona, and people discover the guys by listening. The page keeps a "guys you've met" strip.
- `public/index.html` + `client/` — single page. The browser holds a [sessionless](../sessionless) key (localStorage) and signs every request; no accounts.
- `src/server.js` — picks an unheard line in the chosen category and charges a play (4 free, then credits, or unlocked). It serves pre-generated audio; **nothing is generated at request time**.
- allyabase: **BDO** stores the play/credit/unlock state; **Addie** (Stripe) takes payment. The server confirms a payment through
  addie's `GET /user/:uuid/processor/stripe/payment/:paymentIntentId/status` before granting anything.

Offers (`src/config.js`): $10 unlocks everything; $2 buys 10 more plays.

## Content

`content/{koans,affirmations,astrology,pumpup}.json` are the source of truth: each line has an `id`, `persona`, `text`, and
per-line Chatterbox settings (`exaggeration`, `cfg_weight`). Personas are cloned from `chatterbox/voices/<persona>.wav`.

Generation is a separate, offline step that needs a GPU (or a patient Mac):

```
# a Chatterbox service must be running (see chatterbox/server.py)
CHATTERBOX_TOKEN=... python3 scripts/generate.py
```

It is resumable. It keeps the WAV masters in `content/wav/` (git-ignored), writes 64 kbps mono MP3s to `content/audio/` (about 55 KB a clip, ~6 MB in all), and writes `content/manifest.json`. The MP3s and the manifest are all the web server needs. Needs `ffmpeg`.
`--convert-only` skips Chatterbox and just converts existing WAVs.
The web server refuses to start if the manifest or any clip is missing.

## Payments (local)

Payments go through addie, which needs real Stripe keys, so run allyabase in Docker:

```
cp docker/addie.env.template docker/addie.env     # add your Stripe TEST keys (git-ignored)
scripts/base-up.sh                                 # continuebee + fount + bdo + addie in Docker
BDO_URL=http://127.0.0.1:23003 ADDIE_URL=http://127.0.0.1:23005 npm start
```

`scripts/base-up.sh` starts Docker Desktop if needed, reuses the `allyabase` image, mounts the local addie source over the image's
(so the payment status route is present), and runs only the four services payments need, which keeps memory low. Host ports 23003 (BDO) and
23005 (addie) avoid clashing with other bases. `down` removes the container; data lives in `gow-*` volumes. In Stripe test mode, pay with card `4242 4242 4242 4242`.

Alternatively, point at an already-deployed base whose addie has Stripe test keys and the payment status route, e.g.
`ADDIE_URL=https://demo.allyabase.com/addie/` (verified working with test keys on 2026-10-16). The server creates its own addie user there on startup.

## Develop

```
npm install
npm run build        # bundles client/ into public/app.js
BDO_URL=... ADDIE_URL=... npm start
BDO_URL=http://localhost:3003 npm test   # needs a running bdo + continuebee (BDO started with LOCALHOST=1)
```

See `deploy/README.md` for DigitalOcean.
