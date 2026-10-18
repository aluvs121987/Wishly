-- Authorization tests for supabase/schema.sql, run as three different
-- signed-in users (A, B, C), an admin (D) and an anonymous visitor.
-- Run with tests/sql/run.sh.  Every check writes a row to t.results.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

\set A '\'aaaaaaaa-0000-0000-0000-00000000000a\''
\set B '\'bbbbbbbb-0000-0000-0000-00000000000b\''
\set C '\'cccccccc-0000-0000-0000-00000000000c\''
\set D '\'dddddddd-0000-0000-0000-00000000000d\''
\set as_A 'reset role; select set_config(\'request.jwt.claim.sub\', ' :A ', false); set role authenticated;'
\set as_B 'reset role; select set_config(\'request.jwt.claim.sub\', ' :B ', false); set role authenticated;'
\set as_C 'reset role; select set_config(\'request.jwt.claim.sub\', ' :C ', false); set role authenticated;'
\set as_D 'reset role; select set_config(\'request.jwt.claim.sub\', ' :D ', false); set role authenticated;'
\set as_anon 'reset role; select set_config(\'request.jwt.claim.sub\', \'\', false); set role anon;'
\set as_admin 'reset role;'

-- test helpers -------------------------------------------------------------
create schema t;
create table t.results (n serial primary key, name text, ok boolean, detail text);
create table t.vars (k text primary key, v text);
grant usage on schema t to anon, authenticated, service_role;
grant all on t.results, t.vars to anon, authenticated, service_role;
grant usage on sequence t.results_n_seq to anon, authenticated, service_role;
create function t.ok(name text, cond boolean, detail text default '') returns void language plpgsql as $$
begin insert into t.results(name, ok, detail) values (name, coalesce(cond, false), detail); end $$;
create function t.err(name text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into t.results(name, ok, detail) values (name, false, 'expected error "' || expect || '" but statement succeeded');
exception when others then
  insert into t.results(name, ok, detail) values (name, position(expect in sqlerrm) > 0, sqlerrm);
end $$;
create function t.count(stmt text) returns bigint language plpgsql as $$
declare c bigint; begin execute 'select count(*) from (' || stmt || ') s' into c; return c; end $$;
create function t.set(k text, v text) returns void language sql as $$
  insert into t.vars values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.get(k text) returns text language sql as $$ select v from t.vars where k = $1 $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- users sign up (Supabase Auth inserts into auth.users) ---------------------
:as_admin
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@example.test', '{"username":"samaa","display_name":"Samaa"}'),
  (:B, 'b@example.test', '{"username":"nour"}'),
  (:C, 'c@example.test', '{"username":"samaa"}'),       -- duplicate username
  (:D, 'd@example.test', '{"username":"admin.d"}');
insert into public.admins values (:D);
select t.ok('signup creates a profile with the chosen username', (select username from public.profiles where id = :A) = 'samaa');
select t.ok('duplicate username does not block sign-up (left empty)', (select username is null from public.profiles where id = :C));
select t.ok('signup creates an empty private profile', exists (select 1 from public.profile_private where user_id = :B));

-- private profile data -------------------------------------------------------
:as_A
update public.profile_private set data = '{"needs":["mobility"],"pet":{"owner":true}}' where user_id = auth.uid();
select t.ok('A can read own private profile', (select data->'needs'->>0 from public.profile_private) = 'mobility');
:as_B
select t.ok('B cannot read A''s private profile (access needs stay private)', t.count('select * from public.profile_private where user_id <> auth.uid()') = 0);
update public.profile_private set data = '{}' where user_id <> auth.uid();
select t.err('B cannot create a private row for A', format('insert into public.profile_private(user_id) values (%L)', 'aaaaaaaa-0000-0000-0000-00000000000a'), 'row-level security');
:as_admin
select t.ok('B''s update of other people''s private data changed nothing', (select data->'needs'->>0 from public.profile_private where user_id = :A) = 'mobility');

-- public profile cards -------------------------------------------------------
:as_C
select t.ok('C (stranger) cannot see A''s profile card', t.count('select * from public.profiles where username = ''samaa''') = 0);
select t.ok('C can see own profile card', t.count('select * from public.profiles where id = auth.uid()') = 1);
select t.ok('username_available: taken name', not public.username_available('samaa'));
select t.ok('username_available: free name', public.username_available('mona_2026'));
update public.profiles set username = 'mona_2026' where id = auth.uid();
select t.ok('C can set own username', (select username from public.profiles where id = auth.uid()) = 'mona_2026');
update public.profiles set display_name = 'hacked' where id <> auth.uid();
select t.err('C cannot move own profile to another id', format('update public.profiles set id = %L where id = auth.uid()', 'aaaaaaaa-0000-0000-0000-00000000000a'), '');
:as_admin
select t.ok('C could not edit anyone else''s profile', not exists (select 1 from public.profiles where display_name = 'hacked'));

-- places -----------------------------------------------------------------------
:as_admin
\i supabase/seed_places.sql
:as_anon
select t.ok('anonymous visitors can read places', t.count('select * from public.places') = 18);
select t.ok('all seeded places are demo records', t.count('select * from public.places where record_status <> ''demo''') = 0);
:as_A
select t.err('a normal user cannot add places', 'insert into public.places(id, record_status, name_en, category, area) values (''x1'', ''verified'', ''Fake'', ''Food'', ''Maadi'')', 'row-level security');
update public.places set record_status = 'verified' where id = 'c1';
:as_admin
select t.ok('demo place still demo after user update attempt', (select record_status from public.places where id = 'c1') = 'demo');
:as_D
select t.err('even an admin cannot add a verified pet policy without evidence',
  'insert into public.places(id, record_status, name_en, category, area, pet_policy) values (''v1'', ''verified'', ''Test'', ''Food'', ''Maadi'', ''allowed'')', 'check constraint');
select t.err('coordinates need a source and check date',
  'insert into public.places(id, record_status, name_en, category, area, lat, lng) values (''v2'', ''sourced'', ''Test'', ''Food'', ''Maadi'', 29.96, 31.25)', 'check constraint');
insert into public.places(id, record_status, name_en, category, kind, area, lat, lng, coords_source, coords_checked_at,
  pet_policy, pet_types, pet_source, pet_checked_at, price_amount, price_basis)
values ('v3', 'verified', 'Evidence Test Café', 'Food', 'cafe', 'Maadi', 29.9600, 31.2570, 'site visit', '2026-10-18',
  'allowed', array['dog'], 'phone call with manager', '2026-10-18', 300, 'per_person');
select t.ok('admin can add a verified place with evidence', t.count('select * from public.places where id = ''v3''') = 1);
insert into public.place_evidence(place_id, field, summary, source_type, checked_at, checked_by)
values ('v3', 'pets', 'Manager confirmed dogs allowed on the terrace', 'provider_call', '2026-10-18', auth.uid());
:as_A
select t.ok('everyone can read evidence', t.count('select * from public.place_evidence where place_id = ''v3''') = 1);
select t.err('a normal user cannot add evidence', 'insert into public.place_evidence(place_id, field, summary, source_type, checked_at) values (''v3'',''pets'',''x'',''community'',''2026-10-18'')', 'row-level security');
:as_admin
delete from public.places where id = 'v3';

-- saved places -------------------------------------------------------------------
:as_A
insert into public.saved_places(place_id) values ('c1'), ('c3');
select t.ok('A saved two places', t.count('select * from public.saved_places') = 2);
:as_B
select t.ok('B cannot see A''s saved places', t.count('select * from public.saved_places') = 0);
select t.err('B cannot save a place as A', format('insert into public.saved_places(user_id, place_id) values (%L, ''c2'')', 'aaaaaaaa-0000-0000-0000-00000000000a'), 'row-level security');
delete from public.saved_places;
:as_admin
select t.ok('B''s delete did not touch A''s saved places', (select count(*) from public.saved_places where user_id = :A) = 2);

-- trips and invitations ---------------------------------------------------------
:as_A
insert into public.trips(place_id, title, starts_at, people, budget_per_person)
values ('c1', 'Coffee with Nour', '2026-10-24 17:00:00+03', 2, 700) returning t.set('trip', id::text);
select t.ok('owner is added as an accepted participant', t.count(format('select * from public.trip_participants where trip_id = %L and role = ''owner''', t.get('trip'))) = 1);
select t.set('tok1', public.create_trip_invite(t.get('trip')::uuid));
select t.ok('invite token is random and long', length(t.get('tok1')) >= 30);
:as_admin
select t.ok('only a hash of the invite token is stored', not exists (select 1 from public.trip_invites where token_hash = t.get('tok1')));
:as_B
select t.ok('B cannot see A''s private trip before joining', t.count('select * from public.trips') = 0);
select t.err('B cannot create an invite for A''s trip', format('select public.create_trip_invite(%L)', t.get('trip')), 'trip_not_found');
select t.ok('B can preview the invitation with the token',
  (select place_name_en from public.preview_trip_invite(t.get('tok1'))) = 'Garden Courtyard Café');
select t.err('invalid invite token is rejected', 'select * from public.preview_trip_invite(''not-a-real-token'')', 'invite_invalid');
select t.err('B cannot add himself as a participant directly',
  format('insert into public.trip_participants(trip_id, user_id, role, status) values (%L, auth.uid(), ''guest'', ''accepted'')', t.get('trip')), 'row-level security');
select t.err('B cannot create a trip owned by A',
  format('insert into public.trips(owner_id, place_id) values (%L, ''c2'')', 'aaaaaaaa-0000-0000-0000-00000000000a'), 'row-level security');
select public.respond_trip_invite(t.get('tok1'), true);
select t.ok('after accepting, B sees the trip', t.count('select * from public.trips') = 1);
select t.ok('after accepting, B sees both participants', t.count('select * from public.trip_participants') = 2);
select t.ok('B can now see A''s profile card (co-participant)', t.count('select * from public.profiles where id <> auth.uid()') = 1);
update public.trips set status = 'cancelled';
:as_admin
select t.ok('B (guest) could not change the trip status', (select status from public.trips where id = t.get('trip')::uuid) = 'planned');
:as_C
select t.ok('C (not invited) cannot see the trip', t.count('select * from public.trips') = 0);
select t.ok('C cannot see the trip participants', t.count('select * from public.trip_participants') = 0);
:as_A
select t.ok('owner can list invites', t.count('select * from public.trip_invites') = 1);
select public.revoke_trip_invite((select id from public.trip_invites limit 1));
:as_C
select t.err('revoked invite cannot be previewed', format('select * from public.preview_trip_invite(%L)', t.get('tok1')), 'invite_revoked');
select t.err('revoked invite cannot be used to join', format('select public.respond_trip_invite(%L, true)', t.get('tok1')), 'invite_revoked');
:as_B
select t.ok('revoking the link keeps people who already joined', t.count('select * from public.trips') = 1);
:as_A
select t.set('tok2', public.create_trip_invite(t.get('trip')::uuid));
:as_admin
update public.trip_invites set expires_at = now() - interval '1 minute' where token_hash = public.hash_token(t.get('tok2'));
:as_C
select t.err('expired invite is rejected', format('select public.respond_trip_invite(%L, true)', t.get('tok2')), 'invite_expired');
:as_A
select t.set('tok3', public.create_trip_invite(t.get('trip')::uuid));
select t.err('owner cannot change the trip''s place after creating it', format('update public.trips set place_id = ''c2'' where id = %L', t.get('trip')), 'trip_owner_and_place_are_fixed');
:as_C
select public.respond_trip_invite(t.get('tok3'), false);
select t.ok('declining does not give access to the trip', t.count('select * from public.trips') = 0);

-- reviews and personal exclusions -------------------------------------------------
:as_B
select t.err('B cannot review before visiting', format('select public.submit_review(%L, 4)', t.get('trip')), 'review_before_visit');
select public.mark_visited(t.get('trip')::uuid);
select t.ok('rating 2 hides the place for the reviewer',
  (public.submit_review(t.get('trip')::uuid, 2, 4, 3, 'Too loud for us')->>'excluded')::boolean);
select t.ok('B''s exclusion list now has the place', t.count('select * from public.exclusions where place_id = ''c1'' and reason = ''rating''') = 1);
select t.err('rating outside 1-5 is rejected', format('select public.submit_review(%L, 6)', t.get('trip')), 'rating_out_of_range');
select t.err('B cannot write a review row directly',
  format('insert into public.reviews(trip_id, user_id, place_id, place_rating) values (%L, auth.uid(), ''c1'', 5)', t.get('trip')), 'row-level security');
select t.err('B cannot create a rating-type exclusion directly', 'insert into public.exclusions(place_id, reason) values (''c2'', ''rating'')', 'row-level security');
select t.err('B cannot hide a place for A', format('insert into public.exclusions(user_id, place_id, reason) values (%L, ''c2'', ''manual'')', 'aaaaaaaa-0000-0000-0000-00000000000a'), 'row-level security');
:as_A
select t.ok('a friend''s low rating does not hide the place for A', t.count('select * from public.exclusions') = 0);
select t.ok('A (participant) can read B''s shared rating', (select place_rating from public.reviews where user_id <> auth.uid()) = 2);
:as_C
select t.ok('C cannot read the trip reviews', t.count('select * from public.reviews') = 0);
select t.err('C cannot review a trip they are not in', format('select public.submit_review(%L, 1)', t.get('trip')), 'not_a_member');
select t.err('C cannot mark someone else''s trip visited', format('select public.mark_visited(%L)', t.get('trip')), 'not_a_member');
:as_B
select t.ok('updating to 4 removes the rating-based exclusion',
  not (public.submit_review(t.get('trip')::uuid, 4, 4, 3, 'Better on a weekday')->>'excluded')::boolean
  and t.count('select * from public.exclusions') = 0);
select t.ok('still exactly one review per person per trip', t.count(format('select * from public.reviews where trip_id = %L and user_id = auth.uid()', t.get('trip'))) = 1);
select public.submit_review(t.get('trip')::uuid, 1);
select t.ok('rating 1 hides it again', t.count('select * from public.exclusions') = 1);
delete from public.exclusions where place_id = 'c1';
select t.ok('restore removes the exclusion', t.count('select * from public.exclusions') = 0);
insert into public.exclusions(place_id, reason) values ('c5', 'manual');
select t.ok('a user can hide a place manually', t.count('select * from public.exclusions where reason = ''manual''') = 1);
:as_A
update public.trips set status = 'completed' where id = t.get('trip')::uuid;
select t.ok('completing a trip records the time', (select completed_at is not null from public.trips where id = t.get('trip')::uuid));
select t.ok('after completion the owner can review without marking visited',
  not (public.submit_review(t.get('trip')::uuid, 5, 5, 4)->>'excluded')::boolean);
select t.ok('group signal averages participants'' visible ratings',
  (select avg_rating from public.group_place_signals(t.get('trip')::uuid) where place_id = 'c1') = 3.0);
:as_C
select t.ok('group signal is empty for non-members', t.count(format('select * from public.group_place_signals(%L)', t.get('trip'))) = 0);

-- friends ------------------------------------------------------------------------
:as_A
select t.set('ftok', public.create_friend_invite());
select t.err('you cannot accept your own friend invite', format('select public.accept_friend_invite(%L)', t.get('ftok')), 'invite_own');
:as_C
select t.err('invalid friend invite is rejected', 'select public.accept_friend_invite(''nope'')', 'invite_invalid');
select public.accept_friend_invite(t.get('ftok'));
select t.ok('accepting a friend invite creates the friendship', t.count('select * from public.friendships') = 1);
select t.ok('friends can see each other''s profile card', t.count('select * from public.profiles where username = ''samaa''') = 1);
select t.err('friendships cannot be created directly',
  format('insert into public.friendships(user_a, user_b) values (%L, %L)', 'bbbbbbbb-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000c'), 'row-level security');
select t.err('a friend request needs a shared trip', format('select public.send_friend_request(%L)', 'bbbbbbbb-0000-0000-0000-00000000000b'), 'request_not_allowed');
:as_B
select t.ok('B cannot see C''s profile (no connection)', t.count('select * from public.profiles where username = ''mona_2026''') = 0);
select t.ok('B cannot see A and C''s friendship', t.count('select * from public.friendships') = 0);
select t.set('req', public.send_friend_request('aaaaaaaa-0000-0000-0000-00000000000a')::text);
select t.err('B cannot accept his own request', format('select public.respond_friend_request(%L, true)', t.get('req')), 'request_not_found');
:as_A
select public.respond_friend_request(t.get('req')::uuid, true);
select t.ok('accepted request creates the friendship', t.count('select * from public.friendships') = 2);
select public.revoke_friend_invite((select id from public.friend_invites limit 1));
:as_B
select t.err('revoked friend invite cannot be used', format('select public.accept_friend_invite(%L)', t.get('ftok')), 'invite_revoked');

-- leaving and removing -----------------------------------------------------------
:as_B
select public.leave_trip(t.get('trip')::uuid);
select t.ok('after leaving, B no longer sees the trip', t.count('select * from public.trips') = 0);
select t.err('B cannot rejoin with a revoked link', format('select public.respond_trip_invite(%L, true)', t.get('tok1')), 'invite_revoked');
select t.err('a guest cannot remove participants', format('select public.remove_participant(%L, %L)', t.get('trip'), 'aaaaaaaa-0000-0000-0000-00000000000a'), 'trip_not_found');

-- anonymous visitors ------------------------------------------------------------------
:as_anon
select t.err('anonymous visitors cannot call trip functions', format('select public.submit_review(%L, 5)', t.get('trip')), 'permission denied');
select t.ok('anonymous visitors see no trips', t.count('select * from public.trips') = 0);
select t.ok('anonymous visitors see no profiles', t.count('select * from public.profiles') = 0);

-- facebook matching helper is service-role only -------------------------------
:as_admin
insert into auth.identities(user_id, provider, provider_id) values (:A, 'facebook', 'fb-111');
:as_A
select t.err('signed-in users cannot call the Facebook lookup helper', 'select * from public.facebook_user_ids(array[''fb-111''])', 'permission denied');
reset role; set role service_role;
select t.ok('the Edge Function (service role) can map Facebook ids', (select count(*) from public.facebook_user_ids(array['fb-111','fb-999'])) = 1);

-- delete my data ------------------------------------------------------------------------
:as_B
select public.delete_my_data();
:as_admin
select t.ok('delete_my_data removes B''s reviews, exclusions and memberships',
  (select count(*) from public.reviews where user_id = :B) = 0
  and (select count(*) from public.exclusions where user_id = :B) = 0
  and (select count(*) from public.trip_participants where user_id = :B) = 0
  and (select count(*) from public.friendships where :B in (user_a, user_b)) = 0);
select t.ok('delete_my_data does not touch A''s trip', (select count(*) from public.trips where owner_id = :A) = 1);

-- report ------------------------------------------------------------------------------
\pset tuples_only off
\pset format aligned
select n, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from t.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
