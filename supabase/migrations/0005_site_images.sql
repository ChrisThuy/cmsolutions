-- ===========================================================================
-- Generated hero images, stored separately from the page.
--
--   docker exec -i supabase-cmproposal-db-1 \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/0005_site_images.sql
--
-- A generated image arrives as roughly 1.7 MB of base64, and site_demos.html
-- is capped at 400 KB — deliberately, because that column holds a document
-- and a document that size is a symptom. So the image lives in its own row
-- and the page references it by URL.
--
-- That ordering matters: the image is stored FIRST, which yields the id the
-- renderer needs, and only then is the page rendered and published. Trying to
-- do it the other way round needs the demo's slug before the demo exists.
--
-- Same expiry as a demo. An image whose page has gone is nothing but storage.
-- ===========================================================================

begin;

create table if not exists site_images (
  id         text primary key,
  mime       text        not null default 'image/png',
  data       text        not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',

  -- Roughly 4 MB of base64. Generous for one hero image and a hard stop on
  -- anything trying to use this as free file hosting.
  constraint image_is_bounded check (length(data) <= 6000000),
  constraint image_id_is_sane check (id ~ '^[a-z0-9]{16,48}$')
);

create index if not exists site_images_expires_idx on site_images (expires_at);

alter table site_images enable row level security;

/* Stores one image and returns its id. The id is generated here so it is
   unguessable and unique as a property of the database, not a promise made
   by a serverless function. */
create or replace function store_site_image(p_data text, p_mime text default 'image/png')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text;
begin
  if p_data is null or length(p_data) = 0 then
    raise exception 'empty image';
  end if;
  v_id := encode(gen_random_bytes(12), 'hex');
  insert into site_images (id, mime, data) values (v_id, coalesce(p_mime, 'image/png'), p_data);
  return v_id;
end;
$$;

create or replace function read_site_image(p_id text)
returns table (mime text, data text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select i.mime, i.data from site_images i
     where i.id = p_id and i.expires_at > now();
end;
$$;

create or replace function sweep_site_images()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_removed integer;
begin
  delete from site_images where expires_at < now() - interval '2 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function store_site_image(text, text) from public;
revoke all on function store_site_image(text, text) from anon, authenticated;
grant execute on function store_site_image(text, text) to anon;

revoke all on function read_site_image(text) from public;
revoke all on function read_site_image(text) from anon, authenticated;
grant execute on function read_site_image(text) to anon;

revoke all on function sweep_site_images() from public;
revoke all on function sweep_site_images() from anon, authenticated;

commit;
