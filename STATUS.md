# Wishly V4: implementation status

This page sorts every requirement into one of five honest buckets. "Tested" means a test in `TEST_RESULTS.md` ran and passed. Nothing is counted as tested if it only looked right.

## Database and sign-in: where things stand

**What runs today, without any setup**

| Mode | Where the data lives | Who can see it | Status |
|---|---|---|---|
| **Guest** | This browser's localStorage | Anyone using this device | Implemented and tested. It is labelled "this device only" everywhere and is never called an account. |
| **Claude storage** (only when the page is opened on claude.ai) | The viewer's private `data/users/<id>/` document in the artifact's database | Only that signed-in viewer, across their devices | Implemented and tested with a stand-in runtime. On the live review artifact the page created the owner's private document, which was read back; saving and reloading there was not exercised. Single person only: no friends or shared trips. People who can only view the artifact can't save, so they stay in guest mode. |

**What runs after setup**

| Mode | Where the data lives | Who can see it | Status |
|---|---|---|---|
| **Wishly server** (Supabase Auth + Postgres) | Supabase | As the Row Level Security rules allow | The database and its rules are implemented and tested on real PostgreSQL (91/91). The account screens are tested against a stand-in client (17/17). **Blocked** until a Supabase project is created (SETUP.md). |

**What I checked before choosing.** I tested the existing claude.ai database and user capabilities against your requirements:

- **Signed-in identity:** yes, a real one.
- **Each person's own records private:** yes.
- **Rules based on trip membership** (only a trip's participants can read it): no. Rules can only follow the sharing level of the whole artifact.
- **Writes from people outside your organization:** no. On a personal plan, outside viewers can only read.

So claude.ai storage is used only for private, single-person data. Supabase supplies everything multi-person: maintained auth (email verification, password reset, Google, Facebook, identity linking) and database rules that can check trip membership.

## Requirement by requirement

**Status key**
- **Tested**: implemented and tested
- **Implemented**: implemented but not tested
- **Local-only**: works on this device or in private storage only
- **Blocked**: blocked by external setup
- **Not implemented**

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Inspect persistence and capabilities | **Tested** | See the table above and T11 |
| 2 | Username / email / password registration, with validation and errors | **Tested** with the stand-in client, then **Blocked** | T13.1–T13.5; live once Supabase is set up |
| 2 | Login, logout, persistent session | **Tested** with the stand-in client, then **Blocked** | T13.6, T13.14–T13.16 |
| 2 | Show / hide password | **Tested** | T13.2 |
| 2 | Email verification and password reset | **Implemented** (UI and calls), then **Blocked** | Emails are sent by Supabase Auth (SETUP.md §3) |
| 2 | Google / Facebook sign-in | **Implemented**, then **Blocked** | Shown as "Not connected" until configured (T8.1) |
| 2 | Deliberate account linking | **Implemented**, then **Blocked** | Link and unlink in the Account dialog; needs "Allow manual linking" |
| 2 | Instagram | **Not implemented, on purpose** | No supported consumer sign-in exists. The app says so (T8.1) |
| 2 | No raw passwords or OAuth tokens in HTML or localStorage | **Tested** | T13.7; provider tokens are stripped before the session is saved |
| 2 | Guest vs account clearly separated | **Tested** | T8.2, T13.15 |
| 3 | Wishly friends via invite links (create, revoke, accept) | **Tested** at database level, **Implemented** in the UI, then **Blocked** | SQL 71–81 |
| 3 | Facebook friend discovery (permissioned, no fake imports) | **Implemented**, then **Blocked** | Edge Function plus Meta App Review for `user_friends` |
| 3 | Trip plan from a recommendation, with Cairo date and time, group size and budget | **Tested** | T5.2; 19:30 Cairo is stored as 16:30 UTC |
| 3 | Revocable invite link; accept / decline; only participants see the trip | **Tested** at database level, and in the UI with the stand-in client | SQL 28–49, T13.9–T13.12 |
| 3 | Share by device sharing or copy; no automatic posting | **Tested** (copy) | Native share sheet not tested on a phone |
| 3 | No location, profile, access needs or credentials in URLs | **Tested** | T7.7, T13.9 |
| 4 | Lifecycle: recommendation → saved → trip → visited → rated | **Tested** | T5 (guest), T13 (account) |
| 4 | One rating per person per trip; separate place, organization and transport ratings | **Tested** | T5.8–T5.9, SQL 54, 63 |
| 4 | Rating 1–2 hides the place for that reviewer only, with an explanation; Restore; a rating above 2 removes the exclusion | **Tested** | T5.3–T5.8, SQL 51–66 |
| 4 | Participants' ratings shared on the trip | **Tested** at database level | SQL 58–59 |
| 4 | Participant ratings in group recommendations | **Tested** at database level and in the engine | SQL 69–70, unit tests |
| 4 | Guest ratings | **Local-only** | Friends can't see them, and the app says so |
| 5 | Location: requested on click only; accuracy shown; refresh; denied, timeout and unavailable handled; poor accuracy rejected; expires after 5 min; coordinates kept in memory only | **Tested** | T4.1–T4.9 |
| 5 | Radius uses verified venue coordinates only; district centres never used | **Tested** | T4.2, T7.6 |
| 5 | The area is never expanded silently | **Tested** | T1.5 |
| 5 | On claude.ai, device location | **Blocked** | The artifact frame blocks location. Works when hosted on your own HTTPS site |
| 6 | Per person × people = total; Arabic digits; structured fields win; shown and editable before searching | **Tested** | T1, T2 |
| 6 | Per-person vs fixed prices; transport and taxes included / excluded / unknown | **Tested** | Unit test, details dialog |
| 7 | Pet owner, type, accompanying; owning a pet doesn't force pet-friendly results; unknown policy goes to "Ask before choosing" | **Tested** | T6 |
| 8 | Wheelchair three states (entrance or ramp, interior, floor or lift, toilet); a ramp alone isn't enough; source and date shown | **Tested** | T3 |
| 8 | Access needs are never shown to friends or places without consent | **Tested** | T7.2–T7.3, SQL 5 |
| 9 | Ask the place: verified contacts only, click-to-call, WhatsApp / SMS text, what to confirm, honest "no contact details" | **Tested** | T7.1–T7.3 |
| 10 | Details view, WishScore explanation, provider rating vs WishScore, demo labels | **Tested** | T3.5, T7 |
| 10 | Bank offers | **Implemented** (only verified offers shown) | No verified offers exist in the data |
| 11 | Maps and Uber to verified coordinates only; Careem fallback; no fake fares or bookings | **Tested** | T7.4–T7.6 |
| 12 | Full Arabic / English with RTL, separate from voice language | **Tested** | T9 |
| 12 | Keyboard, labels, focus, mobile layout, no dead buttons | **Tested** (automated) | T10. A screen-reader pass was not executed |
| 12 | Existing features: home, six categories, Just Wish, profile, pets, budget, bank, visual settings, picture wish, voice | **Tested** (smoke) | Voice depends on the browser and is blocked inside the artifact frame |
| 13 | Database model and authorization | **Tested** | 91 checks on PostgreSQL 16 |
| — | Real venue data | **Partly done (sourced, not verified)** | 65 cafés and restaurants (Maadi, New Cairo, Zamalek, Downtown, Dokki) imported on 21 Oct 2026 from their public Google Maps listings: pin, address, phone (52), menu link (11), dog policy (13), wheelchair facts (30), price range. Status "Sourced", nobody has called them. Demo places are hidden from results once real places load. T14.1–T14.8. Data: `data/places_google_2026-10-21.json`, `supabase/real_places.sql` |
| — | AI ranking | **Not implemented**, on purpose | V3's AI ranking stays off so results are reproducible and every exclusion can be explained |
| — | Live fares, bookings, ride handoff confirmation | **Not implemented** | The app opens Uber and Maps and never claims a booking |
| — | Self-service deletion of the sign-in itself | **Not implemented** | Delete my data removes all Wishly data; the project owner removes the login (SETUP.md §11) |

## Remaining defects and risks

1. **The Supabase client calls have not run against a real project.** They follow the supabase-js 2.45 API and pass against the stand-in client. Run SETUP.md's two-person check right after setup and fix anything that fails before the 22nd.
2. **Real places are "Sourced" from Google Maps listings, not phone-checked.** A listing that says "Dogs allowed" says nothing about cats (those go to Ask), and Google's three accessibility facts (entrance, seating, restroom) are treated as the full wheelchair check only when all three are listed.
3. **The sign-in session is kept in localStorage** (Supabase's default for apps without their own server). Provider tokens are removed. For stricter security, move to cookie sessions (see SETUP.md).
4. **Inside the claude.ai artifact the frame blocks** device location, the microphone, the share sheet, and often `tel:` / `sms:` links. Phone numbers are always shown as text. Host on your own HTTPS site to use all of these.
5. **Travel times from the profile area are rough estimates** between district centres. They are labelled "rough estimate" and never used to filter.
6. **Free-text reading is rule-based**, so unusual phrasing can be misread. That's why the understood fields are shown and editable before every search.
7. **The Arabic wording has not been proof-read by a native reviewer**, and no screen reader has been tested.
8. **Guest trips can't have other participants**, because that needs accounts. The app explains this where invites would appear.
