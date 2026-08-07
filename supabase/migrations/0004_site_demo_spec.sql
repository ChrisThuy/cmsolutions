-- ===========================================================================
-- Keep the design spec, not just the rendered page.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0004_site_demo_spec.sql
--
-- The builder can edit everything the studio wrote — copy, palette, type,
-- chapter order, both languages — and re-render locally for nothing. But the
-- spec lived only in the page's memory, so closing the tab ended the ability
-- to edit forever. The expensive part was produced once and then thrown away
-- the moment somebody navigated away.
--
-- Storing it means the edit link keeps working: come back next week, change a
-- headline, save, and the same demo URL shows it. No regeneration, nothing
-- spent.
--
-- Rows that already exist keep a null spec. They can still be read and still
-- expire on schedule; they simply cannot be edited, because the design that
-- produced them was never kept.
-- ===========================================================================

begin;

alter table site_demos add column if not exists spec jsonb;

/* Stored with the page so the two cannot drift: a demo whose spec says one
   thing and whose html says another would put an editor in front of someone
   that silently disagrees with what they are looking at. */
create or replace function publish_site_demo(
  p_stem       text,
  p_brand_name text,
  p_concept    text,
  p_html       text,
  p_created_by text default null,
  p_spec       jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_stem text;
  v_slug text;
begin
  if p_html is null or length(p_html) = 0 then
    raise exception 'empty document';
  end if;

  v_stem := lower(regexp_replace(coalesce(p_stem, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_stem := trim(both '-' from v_stem);
  v_stem := left(v_stem, 40);
  if v_stem = '' or v_stem !~ '^[a-z0-9]' then
    v_stem := 'site';
  end if;

  v_slug := v_stem || '-' || encode(gen_random_bytes(4), 'hex');

  insert into site_demos (slug, brand_name, concept, html, created_by, spec)
  values (v_slug, coalesce(p_brand_name, 'Untitled'), p_concept, p_html, p_created_by, p_spec);

  return v_slug;
end;
$$;

/* Returns the design behind a demo, for the editor to load.
   Separate from read_site_demo because serving a page and handing back an
   editable design are different acts, and the page path is cached while this
   one must not be. */
create or replace function read_site_demo_spec(p_slug text)
returns table (brand_name text, spec jsonb, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select d.brand_name, d.spec, d.expires_at
      from site_demos d
     where d.slug = p_slug and d.expires_at > now();
end;
$$;

/* The saved page and the design that produced it, together. */
create or replace function update_site_demo(
  p_slug    text,
  p_html    text,
  p_concept text default null,
  p_spec    jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hit integer;
begin
  if p_html is null or length(p_html) = 0 then
    raise exception 'empty document';
  end if;

  update site_demos
     set html    = p_html,
         concept = coalesce(p_concept, site_demos.concept),
         spec    = coalesce(p_spec, site_demos.spec)
   where site_demos.slug = p_slug
     and site_demos.expires_at > now();

  get diagnostics v_hit = row_count;
  return v_hit = 1;
end;
$$;

revoke all on function publish_site_demo(text, text, text, text, text, jsonb) from public;
revoke all on function publish_site_demo(text, text, text, text, text, jsonb) from anon, authenticated;
grant execute on function publish_site_demo(text, text, text, text, text, jsonb) to anon;

revoke all on function read_site_demo_spec(text) from public;
revoke all on function read_site_demo_spec(text) from anon, authenticated;
grant execute on function read_site_demo_spec(text) to anon;

revoke all on function update_site_demo(text, text, text, jsonb) from public;
revoke all on function update_site_demo(text, text, text, jsonb) from anon, authenticated;
grant execute on function update_site_demo(text, text, text, jsonb) to anon;

commit;

-- ---------------------------------------------------------------------------
-- `create or replace` with a changed signature CREATES a second function
-- rather than replacing the first, so the five-argument publish and the
-- three-argument update survived alongside their successors. PostgREST picks
-- by the arguments sent, so the right one was being called — but two
-- overloads of a security-definer function is a resolution accident waiting
-- to happen, and the old ones cannot store a spec.
-- ---------------------------------------------------------------------------
drop function if exists publish_site_demo(text, text, text, text, text);
drop function if exists update_site_demo(text, text, text);
