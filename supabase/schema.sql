-- =====================================================================
-- Wishly database schema for Supabase (PostgreSQL 15+)
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query),
-- then run seed_places.sql.
--
-- Security model
--   * Every table has Row Level Security (RLS) switched on.
--   * Users read and change only their own private rows.
--   * Group data (trips, participants, reviews) is readable only by the
--     trip owner and participants who accepted.
--   * Anything that needs cross-user checks (invites, joining a trip,
--     reviews, exclusions caused by reviews) goes through the SECURITY
--     DEFINER functions below, which always use auth.uid() and never trust a
--     user id sent by the browser.
--   * Invitation tokens are random; only their SHA-256 hash is stored.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  display_name text check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now()
);

-- Private preferences: access needs, pets, budget, bank, starting area.
-- Never visible to friends or other participants.
create table if not exists public.profile_private (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 32768),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.friend_invites (
  id         uuid primary key default gen_random_uuid(),
  inviter    uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  max_uses   int not null default 10 check (max_uses between 1 and 50),
  uses       int not null default 0
);

create table if not exists public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users(id) on delete cascade,
  to_user      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  source       text not null default 'manual' check (source in ('manual','facebook','trip')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_user, to_user),
  check (from_user <> to_user)
);

-- ---------------------------------------------------------------------
-- Places and verification evidence
-- ---------------------------------------------------------------------
create table if not exists public.places (
  id                  text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  record_status       text not null check (record_status in ('demo','sourced','verified')),
  name_en             text not null,
  name_ar             text,
  category            text not null check (category in ('Shopping','Food','Experiences','Services','Travel','Learning')),
  kind                text,
  area                text not null,
  address_en          text,
  address_ar          text,
  lat                 double precision check (lat between -90 and 90),
  lng                 double precision check (lng between -180 and 180),
  coords_source       text,
  coords_checked_at   date,
  price_amount        numeric check (price_amount >= 0),
  price_basis         text check (price_basis in ('per_person','per_booking','per_item','per_visit')),
  includes_transport  text not null default 'unknown' check (includes_transport in ('included','excluded','unknown')),
  includes_taxes      text not null default 'unknown' check (includes_taxes in ('included','excluded','unknown')),
  pet_policy          text not null default 'unknown' check (pet_policy in ('allowed','not_allowed','unknown')),
  pet_types           text[] not null default '{}',
  pet_restrictions_en text,
  pet_restrictions_ar text,
  pet_source          text,
  pet_checked_at      date,
  wheelchair          jsonb not null default '{}'::jsonb,
  access_features     text[] not null default '{}',
  access_source       text,
  access_checked_at   date,
  contacts            jsonb not null default '{}'::jsonb,
  contacts_source     text,
  contacts_checked_at date,
  availability_en     text,
  availability_ar     text,
  availability_checked_at timestamptz,
  bank_offers         jsonb not null default '[]'::jsonb,
  provider_rating       numeric check (provider_rating between 0 and 5),
  provider_rating_count int,
  provider_rating_source text,
  tags                text[] not null default '{}',
  note_en             text,
  note_ar             text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  -- coordinates only with a source and a check date (no district centres)
  check ((lat is null) = (lng is null)),
  check (lat is null or (coords_source is not null and coords_checked_at is not null)),
  -- a non-demo pet or access claim always needs evidence
  check (record_status = 'demo' or pet_policy = 'unknown' or (pet_source is not null and pet_checked_at is not null)),
  check (record_status = 'demo' or wheelchair = '{}'::jsonb or (access_source is not null and access_checked_at is not null)),
  check (record_status = 'demo' or contacts = '{}'::jsonb or (contacts_source is not null and contacts_checked_at is not null))
);

create table if not exists public.place_evidence (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null references public.places(id) on delete cascade,
  field       text not null check (field in ('coords','pets','wheelchair','access','contacts','price','availability','bank_offer')),
  summary     text not null check (char_length(summary) <= 500),
  source_type text not null check (source_type in ('provider_call','provider_message','provider_website','site_visit','official_listing','community')),
  source_url  text,
  checked_at  date not null,
  checked_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Saved places, trips, participants, invites, reviews, exclusions
-- ---------------------------------------------------------------------
create table if not exists public.saved_places (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  place_id   text not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists public.trips (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  place_id          text not null references public.places(id),
  title             text check (char_length(title) <= 120),
  starts_at         timestamptz,
  time_zone         text not null default 'Africa/Cairo' check (time_zone = 'Africa/Cairo'),
  people            int not null default 1 check (people between 1 and 20),
  budget_per_person numeric check (budget_per_person >= 0),
  status            text not null default 'planned' check (status in ('planned','completed','cancelled')),
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.trip_participants (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','guest')),
  status     text not null check (status in ('accepted','declined')),
  visited_at timestamptz,
  joined_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.trip_invites (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  max_uses   int not null default 20 check (max_uses between 1 and 50),
  uses       int not null default 0
);

create table if not exists public.reviews (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.trips(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  place_id            text not null references public.places(id),
  place_rating        int not null check (place_rating between 1 and 5),
  organization_rating int check (organization_rating between 1 and 5),
  transport_rating    int check (transport_rating between 1 and 5),
  comment             text check (char_length(comment) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table if not exists public.exclusions (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  place_id   text not null references public.places(id) on delete cascade,
  reason     text not null check (reason in ('rating','manual')),
  review_id  uuid references public.reviews(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create index if not exists trip_participants_user_idx on public.trip_participants(user_id);
create index if not exists reviews_user_idx on public.reviews(user_id);
create index if not exists reviews_place_idx on public.reviews(place_id);

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies don't recurse)
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_trip_member(t uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.trips where id = t and owner_id = auth.uid())
      or exists (select 1 from public.trip_participants
                 where trip_id = t and user_id = auth.uid() and status = 'accepted');
$$;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.friendships
                 where user_a = least(a, b) and user_b = greatest(a, b));
$$;

-- Who may see someone's public card (username, display name)
create or replace function public.can_see_profile(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
       target = auth.uid()
    or public.are_friends(auth.uid(), target)
    or exists (select 1 from public.friend_requests
               where (from_user = auth.uid() and to_user = target)
                  or (to_user = auth.uid() and from_user = target))
    or exists (select 1 from public.trip_participants me
               join public.trip_participants other on other.trip_id = me.trip_id
               where me.user_id = auth.uid() and me.status = 'accepted'
                 and other.user_id = target and other.status = 'accepted')
  );
$$;

create or replace function public.new_token() returns text
language sql volatile set search_path = public, extensions, pg_temp as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
$$;

create or replace function public.hash_token(tok text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(coalesce(tok, ''), 'sha256'), 'hex');
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare wanted text := lower(coalesce(new.raw_user_meta_data->>'username', ''));
begin
  if wanted !~ '^[a-z0-9_.]{3,30}$'
     or exists (select 1 from public.profiles where username = wanted) then
    wanted := null;   -- the user picks one later; sign-up must not fail
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, wanted, left(coalesce(new.raw_user_meta_data->>'display_name',
                                        new.raw_user_meta_data->>'full_name', ''), 60))
  on conflict (id) do nothing;
  insert into public.profile_private (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.add_trip_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.trip_participants (trip_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'accepted');
  return new;
end $$;

drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips
  for each row execute function public.add_trip_owner();

create or replace function public.trips_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.owner_id <> old.owner_id or new.place_id <> old.place_id then
    raise exception 'trip_owner_and_place_are_fixed';
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trips_guard on public.trips;
create trigger trips_guard before update on public.trips
  for each row execute function public.trips_guard();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.profile_private   enable row level security;
alter table public.admins            enable row level security;
alter table public.friendships       enable row level security;
alter table public.friend_invites    enable row level security;
alter table public.friend_requests   enable row level security;
alter table public.places            enable row level security;
alter table public.place_evidence    enable row level security;
alter table public.saved_places      enable row level security;
alter table public.trips             enable row level security;
alter table public.trip_participants enable row level security;
alter table public.trip_invites      enable row level security;
alter table public.reviews           enable row level security;
alter table public.exclusions        enable row level security;

-- profiles: visible to self, friends, co-participants; editable only by self
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_see_profile(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- profile_private: only the owner
drop policy if exists private_all on public.profile_private;
create policy private_all on public.profile_private for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- admins: no policies = no API access at all

-- friendships: both people can see and remove; created only by functions
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (user_a, user_b));

drop policy if exists friend_invites_select on public.friend_invites;
create policy friend_invites_select on public.friend_invites for select to authenticated
  using (inviter = auth.uid());

drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select to authenticated
  using (auth.uid() in (from_user, to_user));

-- places: readable by everyone; only admins write
drop policy if exists places_read on public.places;
create policy places_read on public.places for select to anon, authenticated using (true);
drop policy if exists places_admin on public.places;
create policy places_admin on public.places for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists evidence_read on public.place_evidence;
create policy evidence_read on public.place_evidence for select to anon, authenticated using (true);
drop policy if exists evidence_admin on public.place_evidence;
create policy evidence_admin on public.place_evidence for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- saved places: own only
drop policy if exists saved_all on public.saved_places;
create policy saved_all on public.saved_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- trips: members read; owner creates/updates/deletes
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (owner_id = auth.uid());

-- participants: members of the trip read; all writes through functions
drop policy if exists participants_select on public.trip_participants;
create policy participants_select on public.trip_participants for select to authenticated
  using (public.is_trip_member(trip_id));

-- invites: only the trip owner can list them
drop policy if exists trip_invites_select on public.trip_invites;
create policy trip_invites_select on public.trip_invites for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()));

-- reviews: members of the trip read (shared participant ratings); writes via submit_review
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.is_trip_member(trip_id));

-- exclusions: personal; restore (delete) and manual hide allowed directly
drop policy if exists exclusions_select on public.exclusions;
create policy exclusions_select on public.exclusions for select to authenticated
  using (user_id = auth.uid());
drop policy if exists exclusions_delete on public.exclusions;
create policy exclusions_delete on public.exclusions for delete to authenticated
  using (user_id = auth.uid());
drop policy if exists exclusions_insert on public.exclusions;
create policy exclusions_insert on public.exclusions for insert to authenticated
  with check (user_id = auth.uid() and reason = 'manual' and review_id is null);

-- ---------------------------------------------------------------------
-- RPC functions called by the app
-- ---------------------------------------------------------------------
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(name) ~ '^[a-z0-9_.]{3,30}$'
     and not exists (select 1 from public.profiles where username = lower(name));
$$;

-- Friends --------------------------------------------------------------
create or replace function public.create_friend_invite() returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); tok text := public.new_token();
begin
  insert into public.friend_invites (inviter, token_hash) values (me, public.hash_token(tok));
  return tok;
end $$;

create or replace function public.revoke_friend_invite(invite_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  update public.friend_invites set revoked_at = now()
   where id = invite_id and inviter = me and revoked_at is null;
  if not found then raise exception 'invite_not_found'; end if;
end $$;

create or replace function public.accept_friend_invite(token text) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); inv public.friend_invites;
begin
  select * into inv from public.friend_invites where token_hash = public.hash_token(token) for update;
  if inv.id is null then raise exception 'invite_invalid'; end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up'; end if;
  if inv.inviter = me then raise exception 'invite_own'; end if;
  insert into public.friendships (user_a, user_b)
  values (least(me, inv.inviter), greatest(me, inv.inviter)) on conflict do nothing;
  update public.friend_invites set uses = uses + 1 where id = inv.id;
  return inv.inviter;
end $$;

-- A request can only go to someone you already shared an accepted trip with.
-- (Facebook-matched requests are inserted by the facebook-friends Edge
-- Function with the service role, after it has checked the friendship.)
create or replace function public.send_friend_request(target_user uuid) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); rid uuid;
begin
  if target_user = me then raise exception 'request_self'; end if;
  if public.are_friends(me, target_user) then raise exception 'already_friends'; end if;
  if not exists (
       select 1 from public.trip_participants a join public.trip_participants b on a.trip_id = b.trip_id
       where a.user_id = me and b.user_id = target_user and a.status = 'accepted' and b.status = 'accepted') then
    raise exception 'request_not_allowed';
  end if;
  insert into public.friend_requests (from_user, to_user, source) values (me, target_user, 'trip')
  on conflict (from_user, to_user) do update set status = 'pending', responded_at = null
  returning id into rid;
  return rid;
end $$;

create or replace function public.respond_friend_request(request_id uuid, accept boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); req public.friend_requests;
begin
  select * into req from public.friend_requests where id = request_id and to_user = me and status = 'pending' for update;
  if req.id is null then raise exception 'request_not_found'; end if;
  update public.friend_requests set status = case when accept then 'accepted' else 'declined' end,
         responded_at = now() where id = req.id;
  if accept then
    insert into public.friendships (user_a, user_b)
    values (least(me, req.from_user), greatest(me, req.from_user)) on conflict do nothing;
  end if;
end $$;

-- Trips ------------------------------------------------------------------
create or replace function public.create_trip_invite(trip uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); tok text := public.new_token();
begin
  if not exists (select 1 from public.trips where id = trip and owner_id = me) then
    raise exception 'trip_not_found';
  end if;
  insert into public.trip_invites (trip_id, token_hash, created_by) values (trip, public.hash_token(tok), me);
  return tok;
end $$;

create or replace function public.revoke_trip_invite(invite_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  update public.trip_invites i set revoked_at = now()
   where i.id = invite_id and i.revoked_at is null
     and exists (select 1 from public.trips t where t.id = i.trip_id and t.owner_id = me);
  if not found then raise exception 'invite_not_found'; end if;
end $$;

create or replace function public.check_trip_invite(token text) returns public.trip_invites
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inv public.trip_invites;
begin
  select * into inv from public.trip_invites where token_hash = public.hash_token(token);
  if inv.id is null then raise exception 'invite_invalid'; end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up'; end if;
  return inv;
end $$;
revoke all on function public.check_trip_invite(text) from public, anon, authenticated;

-- What an invited person sees before deciding: no private profile data
create or replace function public.preview_trip_invite(token text)
returns table (trip_id uuid, place_id text, place_name_en text, place_name_ar text, area text,
               starts_at timestamptz, people int, budget_per_person numeric, status text,
               organizer text, my_status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); inv public.trip_invites := public.check_trip_invite(token);
begin
  return query
    select t.id, p.id, p.name_en, p.name_ar, p.area, t.starts_at, t.people, t.budget_per_person, t.status,
           coalesce(pr.display_name, pr.username, ''),
           (select tp.status from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = me)
    from public.trips t join public.places p on p.id = t.place_id
    left join public.profiles pr on pr.id = t.owner_id
    where t.id = inv.trip_id;
end $$;

create or replace function public.respond_trip_invite(token text, accept boolean) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); inv public.trip_invites := public.check_trip_invite(token);
        t public.trips;
begin
  select * into t from public.trips where id = inv.trip_id;
  if t.owner_id = me then raise exception 'invite_own'; end if;
  if t.status = 'cancelled' then raise exception 'trip_cancelled'; end if;
  insert into public.trip_participants (trip_id, user_id, role, status)
  values (t.id, me, 'guest', case when accept then 'accepted' else 'declined' end)
  on conflict (trip_id, user_id) do update set status = excluded.status;
  if accept then update public.trip_invites set uses = uses + 1 where id = inv.id; end if;
  return t.id;
end $$;

create or replace function public.leave_trip(trip uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  update public.trip_participants set status = 'declined'
   where trip_id = trip and user_id = me and role = 'guest';
  if not found then raise exception 'not_a_guest'; end if;
end $$;

create or replace function public.remove_participant(trip uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.trips where id = trip and owner_id = me) then
    raise exception 'trip_not_found';
  end if;
  delete from public.trip_participants where trip_id = trip and user_id = member and role = 'guest';
end $$;

create or replace function public.mark_visited(trip uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  update public.trip_participants set visited_at = coalesce(visited_at, now())
   where trip_id = trip and user_id = me and status = 'accepted';
  if not found then raise exception 'not_a_member'; end if;
end $$;

-- Reviews: one per person per trip; personal exclusion for ratings 1-2
create or replace function public.submit_review(trip uuid, place_rating int, organization_rating int default null,
                                                transport_rating int default null, comment text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); t public.trips; part public.trip_participants; rid uuid;
begin
  select * into t from public.trips where id = trip;
  select * into part from public.trip_participants where trip_id = trip and user_id = me and status = 'accepted';
  if t.id is null or part.trip_id is null then raise exception 'not_a_member'; end if;
  if t.status <> 'completed' and part.visited_at is null then raise exception 'review_before_visit'; end if;
  if place_rating is null or place_rating not between 1 and 5 then raise exception 'rating_out_of_range'; end if;
  insert into public.reviews (trip_id, user_id, place_id, place_rating, organization_rating, transport_rating, comment)
  values (trip, me, t.place_id, place_rating, organization_rating, transport_rating, left(comment, 1000))
  on conflict (trip_id, user_id) do update
     set place_rating = excluded.place_rating, organization_rating = excluded.organization_rating,
         transport_rating = excluded.transport_rating, comment = excluded.comment, updated_at = now()
  returning id into rid;
  if place_rating <= 2 then
    insert into public.exclusions (user_id, place_id, reason, review_id)
    values (me, t.place_id, 'rating', rid)
    on conflict (user_id, place_id) do update set reason = 'rating', review_id = excluded.review_id;
  else
    delete from public.exclusions where user_id = me and place_id = t.place_id and reason = 'rating';
  end if;
  return jsonb_build_object('review_id', rid, 'excluded', place_rating <= 2);
end $$;

-- Participant ratings for group recommendations. SECURITY INVOKER on purpose:
-- RLS limits it to reviews the caller is already allowed to read.
create or replace function public.group_place_signals(trip uuid)
returns table (place_id text, avg_rating numeric, review_count bigint)
language sql stable set search_path = public, pg_temp as $$
  select r.place_id, round(avg(r.place_rating)::numeric, 1), count(*)
  from public.reviews r
  where public.is_trip_member(trip)
    and r.user_id in (select tp.user_id from public.trip_participants tp
                      where tp.trip_id = trip and tp.status = 'accepted')
  group by r.place_id;
$$;

-- Delete everything Wishly stores about the caller (the login itself is
-- removed separately, see SETUP.md)
create or replace function public.delete_my_data() returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  delete from public.exclusions where user_id = me;
  delete from public.reviews where user_id = me;
  delete from public.saved_places where user_id = me;
  delete from public.trip_participants where user_id = me;
  delete from public.trips where owner_id = me;
  delete from public.friend_requests where me in (from_user, to_user);
  delete from public.friend_invites where inviter = me;
  delete from public.friendships where me in (user_a, user_b);
  update public.profile_private set data = '{}'::jsonb, updated_at = now() where user_id = me;
  update public.profiles set display_name = null where id = me;
end $$;

-- Used only by the facebook-friends Edge Function (service role): maps
-- Facebook ids to Wishly users who signed in with Facebook.
create or replace function public.facebook_user_ids(fb_ids text[])
returns table (user_id uuid)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select i.user_id from auth.identities i
  where i.provider = 'facebook' and i.provider_id = any(fb_ids);
$$;

-- ---------------------------------------------------------------------
-- Privileges: only signed-in users run the functions; internal helpers stay private
-- ---------------------------------------------------------------------
revoke all on table public.admins from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.username_available(text),
  public.create_friend_invite(), public.revoke_friend_invite(uuid), public.accept_friend_invite(text),
  public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.create_trip_invite(uuid), public.revoke_trip_invite(uuid), public.preview_trip_invite(text),
  public.respond_trip_invite(text, boolean), public.leave_trip(uuid), public.remove_participant(uuid, uuid),
  public.mark_visited(uuid), public.submit_review(uuid, int, int, int, text),
  public.group_place_signals(uuid), public.delete_my_data(),
  public.is_trip_member(uuid), public.is_admin(), public.are_friends(uuid, uuid), public.can_see_profile(uuid)
to authenticated;
grant execute on function public.username_available(text) to anon;
revoke execute on function public.check_trip_invite(text), public.new_token(), public.hash_token(text),
  public.handle_new_user(), public.add_trip_owner(), public.trips_guard() from authenticated;
revoke execute on function public.facebook_user_ids(text[]) from public, anon, authenticated;
grant execute on function public.facebook_user_ids(text[]) to service_role;
