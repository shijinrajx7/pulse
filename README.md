# PULSE – setup from a phone browser

Files (all flat, no folders): index.html, config.js, schema.sql, worker.js, README.md

## 1. Supabase (supabase.com)
1. New project (free). Wait until it finishes starting.
2. SQL Editor > New query > paste all of schema.sql > Run.
3. Project Settings > API: copy the Project URL and the anon / publishable key (for config.js),
   and the service_role / secret key (for the Worker only, never in GitHub).

## 2. GitHub + Vercel
1. Edit config.js: paste URL and anon key. Upload all 5 files to a new GitHub repo (Add file > Upload files).
2. vercel.com > Add New > Project > import the repo > Deploy (leave all settings default).

## 3. Cloudflare Worker (dash.cloudflare.com)
1. Workers & Pages > Create > Hello World > Deploy, then Edit code. Delete the sample, paste worker.js, Deploy.
2. Settings > Variables and Secrets, add:
   - SUPABASE_URL (Text) = your project URL
   - SUPABASE_SERVICE_KEY (Secret) = service_role / secret key
   - RUN_KEY (Secret) = any long random password
   - NVD_API_KEY (Secret, optional) = free key from NVD, raises rate limits
3. Settings > Trigger Events > Add Cron Trigger: */5 * * * *
4. Test now: open https://YOUR-WORKER.workers.dev/run?key=YOUR_RUN_KEY
   It returns JSON per source (items stored or the error). Then refresh the site.

## Managing sources
Supabase > Table Editor > sources. Add a row (type rss + feed URL + category + region + label),
or set enabled = false. Types: rss, cisa_kev, nvd, hackernews.

## Troubleshooting
- Site says "Connection problem": check config.js values, that schema.sql ran, project not paused.
- Source shows DEGRADED/OFFLINE: read its Last error in Source Monitor. A wrong feed URL gives HTTP 404.
- Worker JSON says "supabase 401/403": wrong SUPABASE_SERVICE_KEY.
- "Exceeded CPU" error: lower MAX_SOURCES_PER_RUN in worker.js, or disable the CISA KEV source (large file).
- Nothing updates: confirm the cron trigger exists; sources only run when their interval has elapsed.

## Limits (my understanding, verify on current pricing pages)
Cloudflare free Workers: about 50 subrequests and 10 ms CPU per run, so only 5 sources run per 5-minute tick.
Supabase free: 500 MB database, and projects can pause after about a week of inactivity.
The worker deletes events older than 30 days. Latency shown is source publication to PULSE detection,
and is limited by polling intervals (10-60 min), so this is NOT sub-10-second monitoring.

## Not included
AI summaries and Malayalam translation, event clustering, email/Telegram/push delivery, user accounts,
admin UI, map markers, X/Reddit/YouTube/Product Hunt/Mastodon connectors (they need API keys and new connector code).
