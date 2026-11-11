-- PULSE database. Paste into Supabase > SQL Editor > Run.
create table if not exists sources(
  id bigint generated always as identity primary key,
  name text not null,
  type text not null check (type in ('rss','cisa_kev','nvd','hackernews')),
  url text not null,
  category text not null default 'news',   -- news, ai, tech, company, cyber, social
  region text not null default 'GLOBAL',   -- GLOBAL, IN, IN-KL ...
  label text not null default 'PUBLICLY REPORTED', -- OFFICIALLY ANNOUNCED | PUBLICLY REPORTED | COMMUNITY DISCUSSION
  interval_min int not null default 15,
  enabled boolean not null default true,
  status text not null default 'awaiting', -- awaiting, operational, degraded, offline, rate_limited
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failures int not null default 0,
  last_latency_ms int,
  items_last_run int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists events(
  id bigint generated always as identity primary key,
  source_id bigint references sources(id) on delete cascade,
  url text not null,
  url_hash text not null unique,           -- canonical-URL hash = duplicate detection
  title text not null,
  summary text,
  category text,
  region text,
  label text,
  platform text,
  severity text check (severity in ('CRITICAL','HIGH','MEDIUM','LOW','INFORMATIONAL')),
  score numeric,
  published_at timestamptz,                -- when the source published it
  detected_at timestamptz not null default now(), -- when PULSE first saw it
  processed_at timestamptz,                -- when PULSE stored it
  meta jsonb not null default '{}'::jsonb
);
create index if not exists ev_pub on events(published_at desc nulls last);
create index if not exists ev_cat on events(category, published_at desc);
create index if not exists ev_det on events(detected_at desc);

alter table sources enable row level security;
alter table events enable row level security;
-- Public read only. Writes need the service key (used only by the Worker).
drop policy if exists "read sources" on sources;
drop policy if exists "read events" on events;
create policy "read sources" on sources for select to anon, authenticated using (true);
create policy "read events" on events for select to anon, authenticated using (true);

-- Seed sources. URLs are not verified by the author: the Source Monitor shows real status.
insert into sources(name,type,url,category,region,label,interval_min) values
('CISA Known Exploited Vulnerabilities','cisa_kev','https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json','cyber','GLOBAL','OFFICIALLY ANNOUNCED',60),
('NIST NVD – new CVEs (24h)','nvd','https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=30','cyber','GLOBAL','OFFICIALLY ANNOUNCED',30),
('Hacker News front page','hackernews','https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30','social','GLOBAL','COMMUNITY DISCUSSION',10),
('The Hacker News (security)','rss','https://feeds.feedburner.com/TheHackersNews','cyber','GLOBAL','PUBLICLY REPORTED',20),
('TechCrunch','rss','https://techcrunch.com/feed/','news','GLOBAL','PUBLICLY REPORTED',15),
('Ars Technica','rss','https://feeds.arstechnica.com/arstechnica/index','tech','GLOBAL','PUBLICLY REPORTED',20),
('OpenAI news','rss','https://openai.com/news/rss.xml','ai','GLOBAL','OFFICIALLY ANNOUNCED',15),
('NVIDIA blog','rss','https://blogs.nvidia.com/feed/','company','GLOBAL','OFFICIALLY ANNOUNCED',30),
('Google AI blog','rss','https://blog.google/technology/ai/rss/','ai','GLOBAL','OFFICIALLY ANNOUNCED',30),
('The Hindu – Technology','rss','https://www.thehindu.com/sci-tech/technology/feeder/default.rss','news','IN','PUBLICLY REPORTED',20);
