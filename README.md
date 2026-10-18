# Wishly V4

"One wish. Every option. Your best match."
A wish-based recommendation app for Cairo, designed to serve persons with disabilities equally ("the 5%"). This is the graduation project build for the 22 October 2026 submission.

## Open it

- **Quick look:** open `index.html` in Chrome, Edge or Safari. It runs in guest mode, with everything saved on this device.
- **Full features** (location, copy and share, sign-in links): host the folder on any HTTPS address, for example GitHub Pages or Netlify. See `SETUP.md`.
- **Accounts, friends and group trips:** connect a free Supabase project (`SETUP.md`, about 20 minutes).
- **claude.ai review copy:** `dist/wishly-artifact.html` is the same app as one file. On claude.ai it saves each signed-in viewer's data privately. The earlier published version was not changed.

## What changed from V3

**Search you can check**
- The wish is read first. The fields it fills in (area, per-person budget, people, total, pet, wheelchair) are shown and editable before you press Search.
- Fields you set yourself win over the wish text, and any conflict is explained.
- 700 EGP per person × 2 people = 1,400 EGP is shown live. Per-person prices are kept apart from fixed prices. Transport and taxes are shown as included, not included or unknown.

**Requirements before ranking**
- Category, café type, area or radius, budget, pet, wheelchair, other access needs and your personal exclusions are all checked before the top results are picked.
- Results come in three groups:
  - **Matches your requirements**
  - **Ask before choosing**: something important is unknown
  - **ruled out**, with the reasons counted
- The area is only widened when you press the button that offers it.

**Wheelchair access in three states**
- The four facts are entrance (step-free or a suitable ramp), space inside, ground floor or lift, and accessible toilet. A ramp alone is not enough.
- **Suitable:** all four facts are confirmed, with a source and date.
- **Unsuitable:** any confirmed "no".
- **Needs confirmation:** anything else.

**Pets**
- Owning a pet, the pet type, and "a pet is coming on this outing" are separate settings.
- Unknown or demo pet policies are never treated as a yes.

**Location**
- Asked for only when you press the button, with accuracy shown and a refresh option.
- Handles denied, timeout, unavailable and too-imprecise positions.
- Expires after 5 minutes and is kept in memory only, unless you choose to save it.
- Radius search uses verified venue coordinates only. District centres are never used as a venue location.

**Place details and WishScore**
- A full details view: location, price basis, pets, access facts with source and date, contacts, menu, availability, bank offers (verified only) and fit for this search.
- WishScore shows every point it added or removed, and is labelled as different from a provider rating.

**Ask the place / «اسأل المكان»**
- Lists what to confirm and offers only verified contacts: call, WhatsApp text, SMS, website, social pages.
- Your access questions go into the message only if you tick the box.

**Getting there**
- Uber and Google Maps open only for verified coordinates.
- Careem gets a copy-address fallback, because there's no public destination link.
- No fares or bookings are claimed.

**Trip lifecycle**
- Recommendation → Saved → Planned trip (Cairo date and time, people, budget) → Visited or completed → Rated.
- Ratings are separate for the place, the organization and the transport.
- A place rating of 1–2 hides the place for that reviewer only, with an explanation. Restore it from **Excluded**; rating it 3 or more also restores it.

**Accounts (with the Wishly server)**
- Username, email and password, with verification, reset and show/hide password.
- Google and Facebook sign-in when configured, and deliberate account linking.
- Friends by invite link, and trip invites that can be revoked, accepted or declined.
- Participants share their ratings with each other, and group searches take those ratings into account.
- Without the server, the account screen honestly shows "Not connected". Instagram is not offered, because it has no supported personal sign-in.

**Arabic and English**
- The whole interface switches, with right-to-left layout in Arabic: screens, dialogs, errors, empty states and announcements.
- The interface language is separate from the voice language.

**Kept from V3**
- Six categories, Just Wish, ideas, picture wish, voice input, every accessibility setting, the profile, banking preferences, and Delete my data.

## Folder map

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | Page structure and styling (V3 branding kept) |
| `js/config.js` | Deployment settings; empty means guest mode |
| `js/i18n.js` | All interface text in English and Arabic |
| `js/places.js` | Demo place records (fictional, always labelled) and area names |
| `js/engine.js` | Matching: parsing, constraints, evaluation, WishScore, Cairo time |
| `js/stores.js` | Data stores: guest, Claude storage, Supabase server |
| `js/app.js` | Screens, dialogs and flows |
| `supabase/schema.sql` | Database, Row Level Security rules and functions |
| `supabase/seed_places.sql` | The demo places for the database |
| `supabase/add_verified_place_template.sql` | How to add a real, checked place |
| `supabase/functions/facebook-friends/` | Edge Function for permissioned Facebook friend matching |
| `tests/` | Database, unit and browser tests (`tests/run_all.sh`) |
| `tools/` | Builds the seed file, the single-file artifact and the test report |
| `dist/wishly-artifact.html` | Single-file build for claude.ai |

## Read next

- `STATUS.md`: what's implemented and tested, local-only, blocked by setup, or not implemented, plus the remaining risks.
- `TEST_RESULTS.md`: every test with expected vs actual and Pass / Fail / Blocked.
- `SETUP.md`: exact steps for Supabase, hosting, Google, Facebook and adding real places.
- `DEVELOPER_NOTES.md`: how the code fits together.
