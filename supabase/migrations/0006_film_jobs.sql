-- ===========================================================================
-- Film jobs: the queue that lets a button start something that takes an hour.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0006_film_jobs.sql
--
-- A seven-shot film is about thirty-five minutes of generation. A Vercel
-- function is killed at three hundred seconds. That is not a policy to argue
-- with, it is arithmetic — so the button cannot do the work, it can only ask
-- for it.
--
-- The endpoint writes a row here and returns. A worker on the Hetzner box —
-- where nothing is killed at five minutes — takes the row, does the work, and
-- writes progress back. The page polls the row.
--
-- One job per demo at a time, enforced by a partial unique index rather than
-- by the endpoint remembering to check: a client who clicks twice should not
-- be billed twice, and the database is the only place that can promise it.
-- ===========================================================================

begin;

create table if not exists film_jobs (
  id           text primary key,
  slug         text not null,

  -- The film spec: shots with their world already folded in, ready to render.
  film_spec    jsonb not null,
  resolution   text not null default '480p',

  status       text not null default 'queued',
  -- queued -> running -> done | failed | cancelled
  progress     text,
  step         integer not null default 0,
  of_steps     integer not null default 0,

  film_url     text,
  poster_url   text,
  error        text,

  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  expires_at   timestamptz not null default now() + interval '30 days',

  constraint status_is_known check (status in ('queued','running','done','failed','cancelled')),
  constraint resolution_is_known check (resolution in ('480p','720p','1080p')),
  constraint job_id_is_sane check (id ~ '^[a-z0-9]{16,48}$')
);

create index if not exists film_jobs_status_idx on film_jobs (status, created_at);
-- One live job per demo. A second click while one is running must not queue
-- a second film, and this is the only place that can be guaranteed.
create unique index if not exists film_jobs_one_live_per_slug
  on film_jobs (slug) where status in ('queued','running');

alter table film_jobs enable row level security;

/* Asking for a film. Returns the job id, or the id of the one already
   running — never a second job, and never an error a visitor has to read. */
create or replace function request_film(p_slug text, p_spec jsonb, p_resolution text default '480p')
returns table (id text, status text, existing boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text;
  v_existing record;
begin
  select f.id, f.status into v_existing
    from film_jobs f
   where f.slug = p_slug and f.status in ('queued','running')
   limit 1;

  if found then
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  v_id := encode(gen_random_bytes(12), 'hex');
  insert into film_jobs (id, slug, film_spec, resolution)
  values (v_id, p_slug, p_spec, coalesce(p_resolution, '480p'));
  return query select v_id, 'queued'::text, false;
end;
$$;

/* What the page polls. Deliberately does not return film_spec — it is large,
   it changes nothing, and a poll every few seconds should be cheap. */
create or replace function film_job_status(p_id text)
returns table (status text, progress text, step integer, of_steps integer, film_url text, error text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select f.status, f.progress, f.step, f.of_steps, f.film_url, f.error
      from film_jobs f where f.id = p_id;
end;
$$;

-- --------------------------------------------------------- the worker ----

/* Claims one queued job. The update is what makes the claim, so two workers
   racing cannot both take the same row. */
create or replace function claim_film_job(p_secret text)
returns table (id text, slug text, film_spec jsonb, resolution text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or p_secret <> (select secret from service_secrets where name = 'audit') then
    raise exception 'not authorised';
  end if;

  return query
    update film_jobs f
       set status = 'running', started_at = now()
     where f.id = (
       select f2.id from film_jobs f2
        where f2.status = 'queued'
        order by f2.created_at
        limit 1
        for update skip locked
     )
    returning f.id, f.slug, f.film_spec, f.resolution;
end;
$$;

create or replace function film_job_progress(p_secret text, p_id text, p_progress text, p_step integer, p_of integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or p_secret <> (select secret from service_secrets where name = 'audit') then
    raise exception 'not authorised';
  end if;
  update film_jobs set progress = p_progress, step = coalesce(p_step, step), of_steps = coalesce(p_of, of_steps)
   where id = p_id;
end;
$$;

create or replace function finish_film_job(p_secret text, p_id text, p_film_url text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or p_secret <> (select secret from service_secrets where name = 'audit') then
    raise exception 'not authorised';
  end if;
  update film_jobs
     set status = case when p_error is null then 'done' else 'failed' end,
         film_url = p_film_url, error = p_error, finished_at = now()
   where id = p_id;
end;
$$;

-- ------------------------------------------------------------- grants ----

revoke all on function request_film(text, jsonb, text) from public;
revoke all on function request_film(text, jsonb, text) from anon, authenticated;
grant execute on function request_film(text, jsonb, text) to anon;

revoke all on function film_job_status(text) from public;
revoke all on function film_job_status(text) from anon, authenticated;
grant execute on function film_job_status(text) to anon;

/* The worker functions take the service secret and are never granted to anon.
   A visitor must not be able to claim a job, report progress on someone
   else's, or mark a film finished. */
revoke all on function claim_film_job(text) from public;
revoke all on function claim_film_job(text) from anon, authenticated;
revoke all on function film_job_progress(text, text, text, integer, integer) from public;
revoke all on function film_job_progress(text, text, text, integer, integer) from anon, authenticated;
revoke all on function finish_film_job(text, text, text, text) from public;
revoke all on function finish_film_job(text, text, text, text) from anon, authenticated;

commit;
