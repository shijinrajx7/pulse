# PULSE – setup guide

PULSE is an editorial technology intelligence publication with warm-paper and charcoal art direction, English/Hindi/Malayalam controls, original synthesized soundtracks, a Cesium 3D Earth, live earthquake and volcano feeds, source-led reporting, a background Web Push notification centre, and an optional AI helper.

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

The Story Posters section uses Supabase email accounts and allows up to 10 successful poster generations per account. Run `api/poster-usage.sql` once in the Supabase SQL Editor to create the private quota table and server-only quota functions. The server uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `NVIDIA_API_KEY` Vercel environment variables. Add `PULSE_ADMIN_PASSWORD`, `PULSE_ADMIN_HOUSE_NAME`, and a long random `PULSE_ADMIN_SESSION_SECRET` as **Sensitive** production environment variables in Vercel, then redeploy. Never add these values to `config.js` or GitHub. Admin access is checked by the server and uses a short-lived session. The poster studio includes 24 layouts with editable colors. It searches for a real image attached to the report or publisher article, shows the source link and preview, and only includes it after the user confirms permission. Users can alternatively upload their own permitted image; it stays in that browser. Email account creation uses a signup confirmation link; email login uses a passwordless, single-use magic link. Both return to PULSE and then require Supabase TOTP MFA: first successful sign-in enrolls an authenticator app, then each login requires its six-digit code. GitHub and Google sign-ins also require TOTP MFA. The poster API accepts only the resulting AAL2 session. In Supabase Authentication → Emails, configure both Confirm signup and Magic Link templates to use `{{ .ConfirmationURL }}`. In Authentication → URL Configuration, set the Site URL to `https://pulsex-phi.vercel.app` and allow `https://pulsex-phi.vercel.app/**` as a redirect URL. Enable Confirm email under Authentication → Sign In / Providers. Upload `api/poster-image.js` as well as `api/poster.js` and `index.html` when updating GitHub.

## PULSE email confirmation links and MFA

The Story Posters email flow uses Supabase confirmation links instead of email OTP entry:

- Signup: users choose an email and password, then confirm the address from the signup email.
- Login: users enter their email and request a single-use magic sign-in link. No email code is entered.
- After either link returns to PULSE, the app verifies the session and requires Supabase TOTP MFA. First-time users enroll an authenticator; later logins challenge the verified factor.
- GitHub and Google OAuth continue through the same TOTP MFA gate. The poster API still requires an AAL2 session.

In Supabase Dashboard:

1. Authentication → Sign In / Providers → Email: enable Email and **Confirm email**.
2. Authentication → URL Configuration: set Site URL to `https://pulsex-phi.vercel.app` and add `https://pulsex-phi.vercel.app/**` to Redirect URLs. Add any other exact production domains you actively use.
3. Authentication → Emails → Templates → Confirm signup: use `{{ .ConfirmationURL }}` as the confirmation button destination.
4. Authentication → Emails → Templates → Magic Link: use `{{ .ConfirmationURL }}` as the sign-in button destination. Do not use `{{ .Token }}` in either template, because that renders a code rather than a link.
5. Keep the TOTP factor enabled under Authentication → Multi-Factor Authentication.

Suggested Confirm signup body:

```html
<h2>Confirm your PULSE email</h2>
<p>Thanks for creating a PULSE account. Confirm your email address to continue.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm my email</a></p>
<p>If you did not create this account, you can ignore this message.</p>
```

Suggested Magic Link body:

```html
<h2>Your PULSE sign-in link</h2>
<p>Use the secure link below to sign in to PULSE. It is single-use and expires.</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to PULSE</a></p>
<p>If you did not request this link, you can ignore this message.</p>
```

Email links depend on working SMTP delivery. If custom SMTP is enabled, complete and save the provider credentials first. Supabase's built-in email sender is intended for limited testing, not unrestricted public transactional delivery.

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


## Editorial redesign and zero-budget Web Push

The redesign keeps the existing single-page application and data routes. \`design.css\` applies the warm ivory / charcoal / acid-lime visual system; \`manifest.webmanifest\`, \`service-worker.js\`, and the SVG assets provide the PWA shell and priority-specific notification artwork. The notification system uses browser Web Push, a self-generated VAPID key pair, the existing Supabase project, the existing ingestion Worker, and a small Vercel proxy. It does not use OneSignal, Firebase Cloud Messaging, paid notification APIs, paid AI calls, or notification credits.

### One-time setup

1. Apply \`supabase/migrations/202611170001_push_notifications.sql\` in the existing Supabase project's SQL Editor. It adds device-owned subscriptions and a delivery history table. Legacy subscription rows without an ownership token are disabled, not deleted.
2. Generate a VAPID pair locally from the repository root:

   \`\`\`sh
   node scripts/generate-vapid-keys.mjs
   \`\`\`

   Keep the private key out of GitHub, browser code, screenshots, and chat. Use a real contact address for \`VAPID_SUBJECT\`.
3. Install the Supabase CLI if it is not already installed, link this existing project, then deploy the two functions:

   ```sh
   supabase link --project-ref pxcmtgnqqmzposkdkatr
   supabase functions deploy push-client --no-verify-jwt
   supabase functions deploy push-dispatch
   ```

   Store the generated VAPID pair in Supabase Vault (run these statements once in the SQL Editor, substituting your generated values):

   ```sql
   select vault.create_secret('YOUR_PUBLIC_KEY', 'PULSE_VAPID_PUBLIC_KEY', 'PULSE public VAPID key');
   select vault.create_secret('YOUR_PRIVATE_KEY', 'PULSE_VAPID_PRIVATE_KEY', 'PULSE private VAPID key');
   select vault.create_secret('mailto:YOUR_CONTACT_EMAIL', 'PULSE_VAPID_SUBJECT', 'PULSE VAPID contact');
   ```

   The public `push-client` function validates a random per-browser ownership token before changing subscriptions or reading history. The internal `push-dispatch` function requires the Supabase service-role JWT. The VAPID private key stays in Vault and is never returned to the browser. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
5. In the existing Vercel \`pulsex\` project, add these Production environment variables (the anon/publishable key is safe for browser-facing use; never put a service-role key here):

   - \`SUPABASE_URL\` — the existing project URL
   - \`SUPABASE_ANON_KEY\` — the existing Supabase publishable/anon key

   Redeploy after adding or changing environment variables.
6. In the existing Cloudflare ingestion Worker, add \`PULSE_PUSH_SECRET\` as a secret with the exact same value used in Supabase. Keep its existing \`SUPABASE_URL\` and \`SUPABASE_SERVICE_KEY\` secrets/variables configured. The Worker calls \`push-dispatch\` only for rows actually inserted into \`events\`; duplicate URL hashes are ignored and do not generate repeat alerts.

### Notification behaviour and platform limits

- Breaking priority is reserved for an explicit \`meta.pulse_priority = "breaking"\` override. The classifier does not promote ordinary articles to breaking. Known-exploited and critical/high CVE signals are classified as important; social discussion is low priority; other articles default to general.
- Users can enable/disable each priority, choose categories, configure quiet hours and a time zone, mute individual priority sounds where the platform supports \`silent\`, choose how low-priority updates are grouped, send a test push, and view/clear this device's delivery history.
- Low-priority grouping is performed per ingestion batch; it is not a scheduled once-a-day digest. A scheduled digest would need a separate scheduler and should only be added if it fits the existing free quotas.
- Web Notifications do not expose a cross-platform custom sound-file setting or arbitrary background-colour setting. The service worker uses priority-specific icons and supported \`silent\`, \`tag\`, \`badge\`, and \`requireInteraction\` options. The browser and operating system still control final notification appearance and sound.
- Background delivery requires HTTPS, permission, a valid subscription, a functioning browser push service, and operating-system support. Force-quit, power-saving, offline, and vendor-specific restrictions can delay or prevent delivery. Closing the tab is supported; guaranteed delivery after the browser or device is fully stopped is not.
- The subscription is device-scoped and protected by a random browser ownership token. It is not currently linked to a PULSE account because the existing sign-in is scoped to Story Posters, not the main news reader.
- No paid plan or automatic upgrade is part of this implementation. Stay within Supabase Free, Vercel Hobby, and the existing Cloudflare Worker free allowance; check provider usage dashboards and pause ingestion if limits are close. Free tiers have quotas and are not an unlimited delivery guarantee.

### Verification checklist

Use the Notifications page on the deployed HTTPS site. Enable push explicitly, then send a test notification. Publish/ingest a genuinely new event to exercise the Worker-to-Edge-Function dispatch path. Test tab closed, browser minimized, and installed-PWA behaviour separately on each target device. Check \`push_deliveries\` and Supabase Edge Function logs for server-side results. Do not interpret a successful push-service response as proof that the operating system displayed the alert. Test quiet hours, priority filters, unsubscribe, and duplicate suppression before relying on alerts operationally.
