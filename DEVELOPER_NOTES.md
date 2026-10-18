# Developer notes

The app is plain HTML, CSS and JavaScript: no build step and no framework. Each file is a classic script that adds to `window.W`, so the app also runs from `file://`. The only external dependencies are the Google Font (it falls back to system fonts) and, only when configured, supabase-js 2.45.4 from jsDelivr.

## Flow of a search

1. **`understandWish(text)`** (app.js): `engine.parseWish()` reads the free text, in English or Egyptian Arabic, including Arabic digits. `engine.buildConstraints()` merges it with the search fields.
   - A field the person set themselves (`data-src="user"`) always wins, and any conflict is reported.
   - Fields the wish filled are marked "from your wish".
   - Nothing is searched yet.
2. **`runSearch()`**: builds the constraints again from the fields exactly as they are now, then calls `engine.search(places, constraints, ctx)`.
3. **`engine.evaluatePlace()`** checks every hard requirement and returns `confirmed`, `ask` or `excluded`. Each comes with coded reasons (`met`, `unknowns`, `failures`) that the UI translates.
   - **Evidence rule:** a fact counts as confirmed only on a non-demo record with a source and a check date (`evidenceOk`).
   - **Wheelchair rule:** `wheelchairCheck` needs entrance (step-free or ramp), interior, ground floor or lift, and a toilet for places where people stay. Any `false` means unsuitable.
4. **`engine.wishScore()`** scores only the places that are not excluded, and returns every part of the score so it can be explained. Missing information lowers the score. Participants' ratings (`ctx.groupSignals`) raise or lower it.
5. The UI shows up to 5 confirmed results and up to 6 "ask" results, the counts of ruled-out places by reason, and an expansion button only when some places were ruled out by area alone.

## Data stores (stores.js)

All three share the same async interface:
- **Profile:** `getProfile` / `saveProfile`
- **Saved places:** `listSaved` / `setSaved`
- **Trips:** `listTrips` / `createTrip` / `updateTrip` / `deleteTrip` / `markVisited`
- **Ratings:** `submitReview`
- **Exclusions:** `listExclusions` / `restoreExclusion` / `hidePlace`
- **Groups:** `groupSignals`
- **Everything:** `deleteAll`

`caps` says what each store supports (`friends`, `invites`, `sharedRatings`).

**Which store is used** (`boot()`)
1. When `js/config.js` has a Supabase URL and key, the app uses `ServerStore` once someone signs in, and `GuestStore` until then.
2. Otherwise, on claude.ai, it uses `ClaudeStore`. It first proves it can write the viewer's private document; if it can't, it falls back.
3. Otherwise it uses `GuestStore`. The first time, it imports V3's local data.

## Database (supabase/schema.sql)

**Tables**
- **Profiles:** `profiles` (public card) and `profile_private` (needs, pets, budget, bank; owner only)
- **Friends:** `friendships`, `friend_invites`, `friend_requests`
- **Places:** `places`, `place_evidence`
- **Trips:** `trips`, `trip_participants`, `trip_invites`
- **Your own records:** `saved_places`, `reviews`, `exclusions`
- **Admins:** `admins`

**Where the rules live**
- **Row Level Security** controls every read and every simple write.
- **SECURITY DEFINER functions** handle every cross-user action. They always act as `auth.uid()`:
  - invites: `create_trip_invite`, `respond_trip_invite`, `revoke_trip_invite`
  - reviews: `submit_review`, which also manages exclusions
  - friends: `accept_friend_invite`, `send_friend_request`
- **Tokens:** random 24 bytes; only the SHA-256 hash is stored.

**Tests:** `tests/sql/test_rls.sql` runs as several users against real PostgreSQL, using `tests/sql/supabase_shim.sql`, which stands in for Supabase's auth schema and roles.

## Adding or changing interface text

Add the same key to both `en` and `ar` in `js/i18n.js`. Then:
- **Static markup:** use `data-t="key"` for text and `data-t-attr="attr:key"` for attributes.
- **Generated content:** call `t("key", {vars})`.

`node tests/unit/i18n.test.cjs` fails if a key is missing in either language or the placeholders differ.

## Buttons

Every clickable control has `data-action="name"`, handled by `ACTIONS.name` in app.js. The end-to-end test T10.4 fails if any action in the UI has no handler.

## Rebuilding after edits

```bash
node tools/make_seed.cjs           # after changing js/places.js
node tools/build_artifact.cjs      # refresh dist/wishly-artifact.html
tests/run_all.sh -h localhost -U postgres
node tools/make_test_report.cjs    # refresh TEST_RESULTS.md from saved results
```
