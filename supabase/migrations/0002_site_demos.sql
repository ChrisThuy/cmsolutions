-- ===========================================================================
-- Generated site demos: a live, shareable URL for a site the builder made.
--
-- Applies to the SHARED cmproposal Supabase stack, same as 0001.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0002_site_demos.sql
--
-- ── what this is for ───────────────────────────────────────────────────────
--
-- The builder used to hand over the HTML file. That is the product, given
-- away, and it left nothing to sell. Instead the page is stored here and
-- served from /demo/<slug> on our own domain, so a prospect gets something
-- they can open and send to a colleague, and "put it on your own domain, with
-- us hosting it" remains a real thing to buy.
--
-- ── the threat this schema is shaped around ────────────────────────────────
--
-- Anyone can reach the builder, so anyone can write a row here, and each row
-- holds a full HTML document that we later serve back. Two consequences:
--
--   · it is a storage-exhaustion target, so rows expire and are capped in
--     size, and the write path is rate limited before it ever gets here;
--   · it is a stored-XSS target *if* the HTML were ever served on an origin
--     that mattered. It is served from /demo/, and api/demo.mjs sends it with
--     a sandbox CSP and nosniff so it cannot reach anything of ours. The
--     generator's own escaping is the first line; that header is the second.
--
-- Slugs are unguessable on purpose. A demo is not secret, but it should not
-- be enumerable either — a competitor should not be able to walk the list of
-- every pitch in flight.
-- ===========================================================================

begin;

create table if not exists site_demos (
  -- The public identifier. Readable stem from the brand name, plus random
  -- suffix so two roasteries called Tidewater do not collide and nobody can
  -- guess the next one.
  slug         text primary key,

  brand_name   text        not null,
  concept      text,
  html         text        not null,

  created_at   timestamptz not null default now(),
  -- A demo is a sales artefact, not hosting. It goes away on its own; that
  -- expiry is also the thing being upgraded when someone pays.
  expires_at   timestamptz not null default now() + interval '30 days',

  views        integer     not null default 0,
  -- Coarse attribution only. Never the full address: this table is readable
  -- by a function holding the publishable key, and a stranger's IP is not
  -- ours to keep for a marketing demo.
  created_by   text,

  constraint html_is_bounded check (length(html) <= 400000),
  constraint slug_is_sane    check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$')
);

create index if not exists site_demos_expires_idx on site_demos (expires_at);

alter table site_demos enable row level security;

-- No policies. Everything goes through the security-definer functions below,
-- so the publishable key can neither list the table nor read a demo it has
-- not been given the slug for.

-- ------------------------------------------------------------ writing ----

/*
  Stores a generated page and returns its slug.

  Takes the readable stem and appends randomness here rather than trusting a
  caller-supplied slug, so the uniqueness and the unguessability are both
  properties of the database instead of promises made by a serverless
  function.
*/
create or replace function publish_site_demo(
  p_stem       text,
  p_brand_name text,
  p_concept    text,
  p_html       text,
  p_created_by text default null
)
returns text
language plpgsql
security definer
-- pgcrypto is installed in `extensions` here, not `public`. Pinning the path
-- to public alone made gen_random_bytes unresolvable at call time — the
-- function created cleanly and failed only when someone used it.
set search_path = public, extensions
as $$
declare
  v_stem text;
  v_slug text;
begin
  if p_html is null or length(p_html) = 0 then
    raise exception 'empty document';
  end if;

  -- Reduce the stem to something URL-safe and bounded, then guarantee it is
  -- non-empty: a brand name of only punctuation would otherwise produce a
  -- slug that is just the random suffix, which is fine, but "site" reads
  -- better than a bare hex string.
  v_stem := lower(regexp_replace(coalesce(p_stem, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_stem := trim(both '-' from v_stem);
  v_stem := left(v_stem, 40);
  if v_stem = '' or v_stem !~ '^[a-z0-9]' then
    v_stem := 'site';
  end if;

  v_slug := v_stem || '-' || encode(gen_random_bytes(4), 'hex');

  insert into site_demos (slug, brand_name, concept, html, created_by)
  values (v_slug, coalesce(p_brand_name, 'Untitled'), p_concept, p_html, p_created_by);

  return v_slug;
end;
$$;

-- ------------------------------------------------------------ reading ----

/*
  Returns a demo by slug, or nothing.

  Expired rows are invisible here rather than deleted on read, so a sweep can
  remove them on its own schedule without a visitor's page load depending on
  a write succeeding.
*/
create or replace function read_site_demo(p_slug text)
returns table (brand_name text, concept text, html text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Qualified: expires_at is also an output column of this function, so an
  -- unqualified reference here is ambiguous and the statement is rejected.
  update site_demos
     set views = views + 1
   where site_demos.slug = p_slug and site_demos.expires_at > now();

  return query
    select d.brand_name, d.concept, d.html, d.expires_at
      from site_demos d
     where d.slug = p_slug and d.expires_at > now();
end;
$$;

/* Housekeeping. Called by the cron that already runs for audits. */
create or replace function sweep_site_demos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  delete from site_demos where expires_at < now() - interval '2 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- ------------------------------------------------------------- grants ----

/*
  Both revokes are required.

  PUBLIC is not the same set as the named roles: revoking only PUBLIC leaves
  anon and authenticated holding their own grants, and the function stays
  callable by anyone with the publishable key. This bit has been got wrong
  before in this estate.
*/
revoke all on function publish_site_demo(text, text, text, text, text) from public;
revoke all on function publish_site_demo(text, text, text, text, text) from anon, authenticated;
grant execute on function publish_site_demo(text, text, text, text, text) to anon;

revoke all on function read_site_demo(text) from public;
revoke all on function read_site_demo(text) from anon, authenticated;
grant execute on function read_site_demo(text) to anon;

revoke all on function sweep_site_demos() from public;
revoke all on function sweep_site_demos() from anon, authenticated;

commit;
