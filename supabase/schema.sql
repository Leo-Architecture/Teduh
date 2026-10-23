-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- It creates the table that stores resident reports.

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  edge_id    text not null,
  type       text not null,   -- the server checks the type; it also stores paths, accounts and clearances here
  note       text,
  lat        double precision,
  lon        double precision,
  ai         jsonb,
  cleared    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reports_open_idx on public.reports (cleared, created_at);
create index if not exists reports_edge_idx on public.reports (edge_id);

-- Lock the table. With no policies, the public (anon) key can read and write nothing.
-- Only the server, which holds the secret service_role key, can use it.
alter table public.reports enable row level security;

-- If you created the table with an older version of this file, run this once so paths, team accounts and clearances can be saved:
--   alter table public.reports drop constraint if exists reports_type_check;
