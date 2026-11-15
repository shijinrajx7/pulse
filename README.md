# PULSE – setup guide

PULSE is a technology intelligence dashboard with a hooded startup intro, eight color themes, English/Hindi/Malayalam controls, original synthesized soundtracks, a Cesium 3D Earth, live earthquake and volcano feeds, important-event alerts, and an optional AI helper.

## Upload to GitHub and deploy

Upload the project files and keep the folders `api/` and `assets/`. Do not upload `node_modules/`. The important additions for this update are:

- `index.html`
- `api/poster.js`
- `api/poster-image.js`
- `api/poster-usage.sql`
- `api/assistant.js`
- `api/push.js`
- `api/push-subscriptions.sql`
- `service-worker.js`
- `assets/pulse-alert-critical.svg`, `assets/pulse-alert-high.svg`, `assets/pulse-badge.svg`
- `scripts/generate-vapid-keys.mjs`
- `package.json` and `package-lock.json`
- `assets/anime.umd.min.js` and `assets/ANIMEJS-LICENSE.md`

Keep your existing `config.js`, `schema.sql`, `worker.js`, `pulse-intro.png`, and Google verification file. In `config.js`, use only the Supabase public/anon key. Never commit a Supabase service key or NVIDIA API key.

In Vercel, import or reconnect the GitHub repository and deploy it. Vercel uses `api/assistant.js` as a serverless API route. Opening `index.html` directly from the computer (`file://`) displays the dashboard but cannot run the AI API.

## Story poster sign-in and limits

The Story Posters section uses Supabase email accounts and allows up to 10 successful poster generations per account. Run `api/poster-usage.sql` once in the Supabase SQL Editor to create the private quota table and server-only quota functions. The server uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `NVIDIA_API_KEY` Vercel environment variables. Add `PULSE_ADMIN_PASSWORD`, `PULSE_ADMIN_HOUSE_NAME`, and a long random `PULSE_ADMIN_SESSION_SECRET` as **Sensitive** production environment variables in Vercel, then redeploy. Never add these values to `config.js` or GitHub. Admin access is checked by the server and uses a short-lived session. The poster studio includes 24 layouts with editable colors. It searches for a real image attached to the report or publisher article, shows the source link and preview, and only includes it after the user confirms permission. Users can alternatively upload their own permitted image; it stays in that browser. Email sign-in requires Supabase TOTP MFA: first sign-in enrolls an authenticator app, then each login requires its six-digit code. The poster API accepts only the resulting AAL2 session. Upload `api/poster-image.js` as well as `api/poster.js` and `index.html` when updating GitHub.

## Set up Supabase

1. Create a Supabase project and wait for it to finish starting.
2. Open SQL Editor, paste `schema.sql`, and run it.
3. In Project Settings → API, copy the Project URL and anon/publishable key into `config.js`.
4. In Supabase SQL Editor, also run `api/push-subscriptions.sql` once. For the Cloudflare Worker, use the service role/secret key as a Cloudflare secret. Never put it in GitHub or `config.js`.

## Set up the news worker

1. In Cloudflare Workers & Pages, create a Worker, deploy it, then edit its code and paste `worker.js`.
2. Add these Worker variables/secrets: `SUPABASE_URL` (text), `SUPABASE_SERVICE_KEY` (secret), `RUN_KEY` (secret random password), `PULSE_PUSH_URL` (`https://pulsex-phi.vercel.app/api/push`), `PULSE_PUSH_SECRET` (secret matching Vercel), and optionally `NVD_API_KEY` (secret).
3. Add a Cron Trigger: `*/5 * * * *`.
4. Test `https://YOUR-WORKER.workers.dev/run?key=YOUR_RUN_KEY`, then refresh PULSE.

Manage news sources in Supabase → Table Editor → `sources`. Add RSS rows with a feed URL, category, region, and label, or disable a row with `enabled = false`. Supported worker types include `rss`, `cisa_kev`, `nvd`, and `hackernews`.

To add the seven curated security and technology publisher feeds to an existing database, open Supabase → SQL Editor and run `api/additional-sources.sql` once. The worker will fetch these official AWS, Google, Microsoft, Mozilla, Cloudflare, Ubuntu, and UK NCSC feeds on its next polling runs; check Source Monitor for actual feed status.

## Connect PULSE Copilot (NVIDIA NIM)

Copilot can search up to 600 recent reports already stored in PULSE, analyze an individual report, prepare matching headlines as a `.txt` file, open dashboard sections, and switch the color theme. It is restricted to those PULSE actions and does not independently crawl the whole internet. Saving is started by your click; in browsers that support folder access, you choose a parent folder and PULSE creates a `PULSE` subfolder there. Other browsers offer a normal Save As/download flow.

1. Create an NVIDIA API key at [build.nvidia.com](https://build.nvidia.com/) and check that the selected model is available to your account.
2. In Vercel → Project → Settings → Environment Variables, add `NVIDIA_API_KEY` and paste the key as a secret.
3. Optionally set `NVIDIA_MODEL` to another model name supported by your NVIDIA account. The current default is `nvidia/nemotron-3.5-lightning-30b-a3b` in `api/assistant.js`.
4. Redeploy, open the live HTTPS site, and press **PULSE Copilot**. Keep the key private; never add it to `config.js` or a GitHub file.

## Enable alerts while PULSE is closed

1. Run `node scripts/generate-vapid-keys.mjs` on your computer. Keep the private key secret; do not upload generated keys to GitHub.
2. In Vercel → Project → Settings → Environment Variables, add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:you@example.com`), `PULSE_PUSH_SECRET` (a long random secret), `PUBLIC_APP_URL` (`https://pulsex-phi.vercel.app`), `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY`. The service key and VAPID private key must be server secrets. Redeploy after saving these settings.
3. Set the same `PULSE_PUSH_SECRET` and the Vercel API address as Cloudflare Worker variables. Upload the updated `worker.js`.
4. On PULSE, open Notifications and press **Enable closed-tab alerts**. Allow browser notifications on each device you want to receive them on.

The Worker sends only newly stored critical/high-impact events. Clicking an alert opens the matching PULSE section and highlights the story. Push delivery depends on the browser's push service and device notification settings. PULSE's in-page alerts have a red background; operating systems control the desktop popup's own background color, so the push also includes a red alert image/icon.

NVIDIA model availability and free endpoint access can change. If the default model is unavailable, set `NVIDIA_MODEL` to one currently enabled for your API key and redeploy.

## Notifications, language, and map

- The EN / हिन्दी / മലയാളം selector translates common dashboard labels. News stays in the publisher's language.
- Closed-tab push alerts require the live HTTPS site, the one-time push setup above, and browser permission. Enable them on each device from Notifications. PULSE also displays red in-page alerts when open.
- PULSE alerts only for events it classifies as critical or high impact. Choose the threshold in Notifications. Red in-page notices and the optional short sound work while PULSE is open; browser and operating-system settings control desktop popup colors and sounds.
- The soundtrack picker offers three original Web Audio loops: Signal Bloom, Night Shift, and Deep Focus. No external music files or copyrighted songs are used. Press the music button once to start playback; browsers require this user gesture.
- The theme button cycles System, Light, Dark, Violet, Ocean, Forest, Sunset, and Crimson.
- Earthquake, volcano, and coordinate-backed PULSE markers show their details in PULSE, animate the globe camera to that point, and include a Google Maps location link. Google Maps 3D imagery varies by location, device, and account.
- `animejs` is bundled in `assets/` under its MIT license. The site respects the device's reduced-motion preference.

## Troubleshooting

- **Connection problem:** check `config.js`, confirm `schema.sql` ran, and check whether the Supabase project is paused.
- **AI not connected:** add `NVIDIA_API_KEY` in Vercel and redeploy. Use the HTTPS deployed site, not `file://`.
- **Alerts do not appear:** press **Enable desktop alerts** on Notifications and choose Allow. If Firefox already blocked it, use Firefox Settings → Privacy & Security → Permissions → Notifications to change the site setting, then reload.
- **Source offline or delayed:** read its Last error in Source Monitor; check the feed URL and Cloudflare Worker settings.
- **Worker says Supabase 401/403:** correct `SUPABASE_SERVICE_KEY` in Cloudflare.
- **Worker exceeds CPU:** lower `MAX_SOURCES_PER_RUN` in `worker.js` or disable a large source.
- **No new events:** confirm the Cloudflare cron trigger is enabled and each source's polling interval has elapsed.

## Data and delivery limits

The worker's source polling intervals mean PULSE is not sub-10-second monitoring. The worker deletes events older than 30 days. Email, Telegram, and user accounts are not configured.
