-- Paste into Supabase > SQL Editor > New query, then press Run.
-- Restores three app functions that need DELETE inside them.
create or replace function public.submit_review(trip uuid, place_rating int, organization_rating int default null,
  transport_rating int default null, comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user(); t public.trips; part public.trip_participants; rid uuid;
begin
  select * into t from public.trips where id = trip;
  select * into part from public.trip_participants where trip_id = trip and user_id = me and status = 'accepted';
  if t.id is null or part.trip_id is null then raise exception 'not_a_member'; end if;
  if t.status <> 'completed' and part.visited_at is null then raise exception 'review_before_visit'; end if;
  if place_rating is null or place_rating not between 1 and 5 then raise exception 'rating_out_of_range'; end if;
  insert into public.reviews (trip_id, user_id, place_id, place_rating, organization_rating, transport_rating, comment)
  values (trip, me, t.place_id, place_rating, organization_rating, transport_rating, left(comment, 1000))
  on conflict (trip_id, user_id) do update set place_rating = excluded.place_rating,
    organization_rating = excluded.organization_rating, transport_rating = excluded.transport_rating,
    comment = excluded.comment, updated_at = now()
  returning id into rid;
  if place_rating <= 2 then
    insert into public.exclusions (user_id, place_id, reason, review_id) values (me, t.place_id, 'rating', rid)
    on conflict (user_id, place_id) do update set reason = 'rating', review_id = excluded.review_id;
  else
    delete from public.exclusions where user_id = me and place_id = t.place_id and reason = 'rating';
  end if;
  return jsonb_build_object('review_id', rid, 'excluded', place_rating <= 2);
end $$;

create or replace function public.remove_participant(trip uuid, member uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.trips where id = trip and owner_id = me) then raise exception 'trip_not_found'; end if;
  delete from public.trip_participants where trip_id = trip and user_id = member and role = 'guest';
end $$;

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

revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
drop function if exists public.clear_rating_exclusion(uuid, text);
