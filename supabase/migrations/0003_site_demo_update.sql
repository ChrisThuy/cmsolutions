-- ===========================================================================
-- Replacing the page behind an existing demo.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0003_site_demo_update.sql
--
-- The builder now lets someone edit the design and re-render it in their own
-- browser. This is how that edited page reaches the live link.
--
-- Replace only, never create. A function that could insert at a caller-chosen
-- slug would let anyone plant a document at a guessable address on our
-- origin; this one can only overwrite a row that already exists and has not
-- expired, so the worst it can do is change a demo whose unguessable slug the
-- caller already holds.
-- ===========================================================================

begin;

create or replace function update_site_demo(
  p_slug    text,
  p_html    text,
  p_concept text default null
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
         concept = coalesce(p_concept, site_demos.concept)
   where site_demos.slug = p_slug
     and site_demos.expires_at > now();

  get diagnostics v_hit = row_count;
  -- The expiry is deliberately not extended. A demo is a thirty-day sales
  -- artefact; editing it should not quietly turn it into hosting.
  return v_hit = 1;
end;
$$;

revoke all on function update_site_demo(text, text, text) from public;
revoke all on function update_site_demo(text, text, text) from anon, authenticated;
grant execute on function update_site_demo(text, text, text) to anon;

commit;
