# PULSE – setup guide

PULSE is a technology intelligence dashboard with a hooded startup intro, multi-theme UI, English/Hindi/Malayalam controls, a Cesium 3D Earth, live earthquake and volcano feeds, browser notifications, keyword watches, and an optional AI helper.

## Upload to GitHub and deploy

Upload the project files and keep the folders `api/` and `assets/`. Do not upload `node_modules/`. The important additions for this update are:

- `index.html`
- `api/assistant.js`
- `package.json` and `package-lock.json`
- `assets/anime.umd.min.js` and `assets/ANIMEJS-LICENSE.md`

Keep your existing `config.js`, `schema.sql`, `worker.js`, `pulse-intro.png`, and Google verification file. In `config.js`, use only the Supabase public/anon key. Never commit a Supabase service key or NVIDIA API key.

In Vercel, import or reconnect the GitHub repository and deploy it. Vercel uses `api/assistant.js` as a serverless API route. Opening `index.html` directly from the computer (`file://`) displays the dashboard but cannot run the AI API.

## Set up Supabase

1. Create a Supabase project and wait for it to finish starting.
2. Open SQL Editor, paste `schema.sql`, and run it.
3. In Project Settings → API, copy the Project URL and anon/publishable key into `config.js`.
4. For the Cloudflare Worker only, use the service role/secret key as a Cloudflare secret. Never put it in GitHub or `config.js`.

## Set up the news worker

1. In Cloudflare Workers & Pages, create a Worker, deploy it, then edit its code and paste `worker.js`.
2. Add these Worker variables/secrets: `SUPABASE_URL` (text), `SUPABASE_SERVICE_KEY` (secret), `RUN_KEY` (secret random password), and optionally `NVD_API_KEY` (secret).
3. Add a Cron Trigger: `*/5 * * * *`.
4. Test `https://YOUR-WORKER.workers.dev/run?key=YOUR_RUN_KEY`, then refresh PULSE.

Manage news sources in Supabase → Table Editor → `sources`. Add RSS rows with a feed URL, category, region, and label, or disable a row with `enabled = false`. Supported worker types include `rss`, `cisa_kev`, `nvd`, and `hackernews`.

## Connect PULSE Copilot (NVIDIA NIM)

Copilot can search up to 600 recent reports already stored in PULSE, prepare matching headlines as a `.txt` file, open dashboard sections, switch the color theme, and add a local keyword watch. It is restricted to those PULSE actions and does not independently crawl the whole internet. Saving is started by your click; in browsers that support folder access, you choose a parent folder and PULSE creates a `PULSE` subfolder there. Other browsers offer a normal Save As/download flow.

1. Create an NVIDIA API key at [build.nvidia.com](https://build.nvidia.com/) and check that the selected model is available to your account.
2. In Vercel → Project → Settings → Environment Variables, add `NVIDIA_API_KEY` and paste the key as a secret.
3. Optionally set `NVIDIA_MODEL` to another model name supported by your NVIDIA account. The current default is `nvidia/nemotron-3.5-lightning-30b-a3b` in `api/assistant.js`.
4. Redeploy, open the live HTTPS site, and press **PULSE Copilot**. Keep the key private; never add it to `config.js` or a GitHub file.

NVIDIA model availability and free endpoint access can change. If the default model is unavailable, set `NVIDIA_MODEL` to one currently enabled for your API key and redeploy.

## Notifications, language, and map

- The EN / हिन्दी / മലയാളം selector translates common dashboard labels. News stays in the publisher's language.
- Desktop alerts require the live HTTPS site and browser permission. PULSE checks for new events while the page is open, displays importance-colored notices, and groups desktop notifications. The browser/operating system controls desktop notification appearance. There is no background push when PULSE is closed.
- A keyword watch looks for that word or phrase in report titles and summaries, without case sensitivity. Watches are saved only in that browser; they are not a whole-internet search.
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

The worker's source polling intervals mean PULSE is not sub-10-second monitoring. The worker deletes events older than 30 days. Email, Telegram, user accounts, and push alerts while the page is closed are not configured.
