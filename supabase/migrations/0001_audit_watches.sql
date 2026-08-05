-- ===========================================================================
-- Website monitoring: watches, snapshots, and change detection.
--
-- Applies to the SHARED cmproposal Supabase stack. This repo owns the audit
-- feature, so it owns this schema — but the tables live alongside CM Proposal
-- AI's, because the audit tool has no user accounts and standing up a second
-- stack for four tables would be ceremony. See api/audit.mjs for the reasoning.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0001_audit_watches.sql
--
-- ── the threat this schema is shaped around ────────────────────────────────
--
-- This feature sends email to an address a stranger typed into a form. Done
-- carelessly, that is a spam cannon with our sending domain on it: type a
-- victim's address, confirm it yourself, and they receive weekly mail they
-- never asked for.
--
-- So the confirmation token is generated INSIDE the database and never
-- returned to a browser. Only a caller holding the service secret — which
-- lives in the serverless function's environment and nowhere a browser can
-- reach — can retrieve it in order to send the one confirmation email.
-- Everything else about a watch is inert until that email is clicked.
-- ===========================================================================

begin;

-- --------------------------------------------------------- the secret ----

/*
  A shared secret proving the caller is our serverless function rather than a
  browser holding the publishable key.

  RLS on, no policies: unreachable except through the security-definer
  functions below, which compare against it and never return it.
*/
create table service_secrets (
  name   text primary key,
  secret text not null
);

alter table service_secrets enable row level security;

-- ---------------------------------------------------------- the tables ---

create table audit_watches (
  id                 uuid primary key default gen_random_uuid(),
  url                text        not null,
  email              text        not null,

  -- Generated here, never returned to a browser. This is the whole consent
  -- mechanism: possession of the mailbox is what activates the watch.
  verify_token       text        not null unique default encode(gen_random_bytes(24), 'hex'),
  -- Separate from the verify token so an unsubscribe link, which travels in
  -- every email, can never be replayed to verify anything.
  unsubscribe_token  text        not null unique default encode(gen_random_bytes(24), 'hex'),

  verified_at        timestamptz,
  active             boolean     not null default true,

  created_at         timestamptz not null default now(),
  last_checked_at    timestamptz,
  last_notified_at   timestamptz,

  -- One watch per address per site. Re-submitting is not a way to send a
  -- second confirmation email to someone who ignored the first.
  constraint audit_watches_unique unique (url, email),
  constraint audit_watches_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint audit_watches_url_shape check (url ~ '^https?://')
);

create index audit_watches_due_idx
  on audit_watches (last_checked_at)
  where verified_at is not null and active;

alter table audit_watches enable row level security;

/*
  Each run's result, kept so change can be detected at all.

  `fingerprint` is a stable hash of the issue set. Comparing hashes rather than
  whole reports means a site that renders its nav in a different order does not
  read as a regression.
*/
create table audit_snapshots (
  id            bigserial primary key,
  watch_id      uuid        not null references audit_watches (id) on delete cascade,
  checked_at    timestamptz not null default now(),
  pages_checked integer     not null,
  fingerprint   text        not null,
  summary       jsonb       not null
);

create index audit_snapshots_watch_idx
  on audit_snapshots (watch_id, checked_at desc);

alter table audit_snapshots enable row level security;

-- No policies on either. Both hold an email address and a record of which
-- sites someone is watching; nothing reachable from a browser may read them.

-- ------------------------------------------------------- the functions ---

create or replace function public.check_service_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from service_secrets
     where name = 'audit'
       -- Length-independent comparison is not available here; the secret is
       -- 32 random bytes, so a timing oracle on equality is not a practical
       -- route to guessing it.
       and secret = p_secret
  );
$$;

/*
  Registers a watch and returns the confirmation token — but only to a caller
  proving it is our own serverless function.

  Returning the token is what lets the function send the confirmation email.
  Gating it on the service secret is what stops a browser doing the same and
  self-confirming a watch on somebody else's address.

  Re-submitting an existing, unverified watch returns the SAME token rather
  than issuing a new one, so a form submitted twice sends one email and the
  first link still works.
*/
create or replace function public.create_audit_watch(
  p_url    text,
  p_email  text,
  p_secret text
)
returns table (watch_id uuid, verify_token text, already_verified boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row audit_watches%rowtype;
begin
  if not check_service_secret(p_secret) then
    raise exception 'create_audit_watch: not authorised';
  end if;

  select * into v_row from audit_watches
   where url = p_url and email = lower(trim(p_email));

  if found then
    return query select v_row.id, v_row.verify_token, v_row.verified_at is not null;
    return;
  end if;

  insert into audit_watches (url, email)
  values (p_url, lower(trim(p_email)))
  returning * into v_row;

  return query select v_row.id, v_row.verify_token, false;
end;
$$;

/*
  Confirms a watch. Callable by anyone holding the token, because the token is
  the proof — it arrived in the mailbox being confirmed.
*/
create or replace function public.verify_audit_watch(p_token text)
returns table (ok boolean, url text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row audit_watches%rowtype;
begin
  update audit_watches
     set verified_at = coalesce(verified_at, now()),
         active = true
   where verify_token = p_token
  returning * into v_row;

  if not found then
    return query select false, null::text;
    return;
  end if;

  return query select true, v_row.url;
end;
$$;

/*
  Stops monitoring. One click, no confirmation step, no sign-in.

  Anything else is a dark pattern: the person receiving the mail did not sign
  up for an account and should not need one to make it stop.
*/
create or replace function public.unsubscribe_audit_watch(p_token text)
returns table (ok boolean, url text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row audit_watches%rowtype;
begin
  update audit_watches
     set active = false
   where unsubscribe_token = p_token
  returning * into v_row;

  if not found then
    return query select false, null::text;
    return;
  end if;

  return query select true, v_row.url;
end;
$$;

/** Watches due a re-check. Verified, active, and not checked in the window. */
create or replace function public.due_audit_watches(
  p_secret   text,
  p_interval interval default '7 days',
  p_limit    integer default 25
)
returns table (id uuid, url text, email text, unsubscribe_token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not check_service_secret(p_secret) then
    raise exception 'due_audit_watches: not authorised';
  end if;

  return query
    select w.id, w.url, w.email, w.unsubscribe_token
      from audit_watches w
     where w.verified_at is not null
       and w.active
       and (w.last_checked_at is null or w.last_checked_at < now() - p_interval)
     order by w.last_checked_at nulls first
     limit p_limit;
end;
$$;

/*
  Records a run and says whether anything changed since the last one.

  The caller uses that answer to decide whether to send anything at all. A
  weekly email saying "still fine" is how a monitoring service teaches people
  to ignore it, so silence is the default and mail is the exception.
*/
create or replace function public.record_audit_snapshot(
  p_secret      text,
  p_watch_id    uuid,
  p_pages       integer,
  p_fingerprint text,
  p_summary     jsonb
)
returns table (changed boolean, is_first boolean, previous_fingerprint text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_previous text;
begin
  if not check_service_secret(p_secret) then
    raise exception 'record_audit_snapshot: not authorised';
  end if;

  select fingerprint into v_previous
    from audit_snapshots
   where watch_id = p_watch_id
   order by checked_at desc
   limit 1;

  insert into audit_snapshots (watch_id, pages_checked, fingerprint, summary)
  values (p_watch_id, p_pages, p_fingerprint, p_summary);

  update audit_watches set last_checked_at = now() where id = p_watch_id;

  return query select
    v_previous is not null and v_previous is distinct from p_fingerprint,
    v_previous is null,
    v_previous;
end;
$$;

/** Marks that we actually sent something, so a failure does not look like silence. */
create or replace function public.mark_audit_notified(p_secret text, p_watch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not check_service_secret(p_secret) then
    raise exception 'mark_audit_notified: not authorised';
  end if;
  update audit_watches set last_notified_at = now() where id = p_watch_id;
end;
$$;

-- ------------------------------------------------------- privileges ------
--
-- Both revokes on everything. PUBLIC gets EXECUTE from CREATE FUNCTION, and
-- Supabase's default privileges grant it to anon and authenticated by name;
-- missing either leaves the other in place.

-- check_service_secret is an internal helper. The functions below call it
-- while running as the owner, so they reach it regardless of these grants.
revoke all on function public.check_service_secret(text) from public, anon, authenticated;

/*
  The secret-gated functions ARE callable by anon, and must be.

  Our serverless function authenticates to PostgREST with the publishable key,
  which is the anon role — the same role a browser gets. Revoking anon here
  would lock our own caller out. The authorisation is the secret argument,
  which lives only in the function's environment; without it every one of
  these raises before touching a row.

  The alternative was putting a service-role key in Vercel, which would put a
  key that can read every table in this database into a third party's
  environment to do a job a 32-byte shared secret does exactly as well.
*/
revoke all on function public.create_audit_watch(text, text, text) from public;
revoke all on function public.due_audit_watches(text, interval, integer) from public;
revoke all on function public.record_audit_snapshot(text, uuid, integer, text, jsonb) from public;
revoke all on function public.mark_audit_notified(text, uuid) from public;

grant execute on function public.create_audit_watch(text, text, text) to anon;
grant execute on function public.due_audit_watches(text, interval, integer) to anon;
grant execute on function public.record_audit_snapshot(text, uuid, integer, text, jsonb) to anon;
grant execute on function public.mark_audit_notified(text, uuid) to anon;

-- These two are token-gated rather than secret-gated: the token IS the proof,
-- and both are reached from a link in an email, so a browser must call them.
revoke all on function public.verify_audit_watch(text) from public;
revoke all on function public.unsubscribe_audit_watch(text) from public;
grant execute on function public.verify_audit_watch(text) to anon, authenticated;
grant execute on function public.unsubscribe_audit_watch(text) to anon, authenticated;

commit;
