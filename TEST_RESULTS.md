# Wishly V4: test results

Run on 18 October 2026 in this build environment: headless Chromium 141 through Playwright 1.56, Node 22 and PostgreSQL 16.
Every result below comes from a test that actually ran. Tests that could not run are listed under **Blocked or not executed**; none of them is counted as passed.

| Suite | What it exercises | Result |
|---|---|---|
| Database authorization | `supabase/schema.sql` on real PostgreSQL, as 3 signed-in users, an admin, an anonymous visitor and the service role | **91 / 91 PASS** |
| Browser end-to-end | The real UI, driven through its controls (`tests/e2e/e2e.cjs`) | **82 / 82 PASS** |
| Matching engine | Parsing, constraints, three-state access, Cairo time (`tests/unit/engine.test.cjs`) | **44 / 44 PASS** |
| Text | English and Arabic have the same 711 keys, with matching placeholders | **PASS** |

Re-run everything with `tests/run_all.sh -h localhost -U postgres`.

**How to read the results**
- **Fixture:** Some browser tests add a test-only "verified" café in Maadi (`fx1`) so that the positive paths can be checked. These are confirmed results, radius search, map and ride links, and Ask the place with real contact buttons. The fixture is not part of the app.
- **T13 (stand-in sign-in service):** The T13 tests run the account screens against a stand-in for the Supabase client, because Supabase can't be reached from this environment. They check the app's own handling: validation, messages, sessions, invites and ratings. **They do not test Row Level Security.** That is what the database suite does, on real PostgreSQL.

## Required scenario: Maadi, pet-friendly café, 700 EGP per person, 2 people, pet coming

| Check | Expected | Actual | Result |
|---|---|---|---|
| Total | 700 × 2 = 1,400 EGP | "EGP 700 per person × 2 = EGP 1,400 total" | PASS (T1.2) |
| Area respected | Maadi only, no silent expansion | 0 results outside Maadi; "Search all areas" offered as a button | PASS (T1.5) |
| Café + pet enforced | Only cafés; pet policy must be confirmed | 16 non-cafés ruled out; no demo pet claim accepted | PASS (T1.3, T1.4) |
| Outcome with demo data | Honest no-match | "No confirmed match", with the reasons counted | PASS (T1.4) |
| Outcome with a verified record | Confirmed, priced for 2 | Fixture café confirmed, EGP 300 × 2 = EGP 600 | PASS (T1.6) |
| Arabic version with Arabic digits | Same fields filled | Maadi / 700 / 2 / dog | PASS (T2.3) |

## Browser end-to-end

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| T1.1 | Maadi scenario: wish fills editable fields before searching | area Maadi, 700 pp, 2 people, pet ticked, still on the search screen | as expected | PASS |
| T1.2 | Recognises 700 × 2 = 1,400 EGP total | EGP 700 per person × 2 = EGP 1,400 total | as expected | PASS |
| T1.3 | Search uses Maadi, café, pet and 1,400 total | chips: Area: Maadi, Café, Dog coming, 1,400 | as expected | PASS |
| T1.4 | Honest no-match with demo data (no fictional place confirmed) | 0 confirmed + 'No confirmed match' | as expected | PASS |
| T1.5 | Area not silently expanded (expansion offered as a button only) | no results outside Maadi; 'Search all areas' button shown | as expected | PASS |
| T1.6 | With a verified Maadi pet-friendly café (test fixture) it is confirmed, priced for 2 | fx1 confirmed, EGP 300 × 2 = EGP 600 | as expected | PASS |
| T1.7 | No page errors | no errors | as expected | PASS |
| T2.1 | Selected area wins over text area and the conflict is shown | area stays Zamalek, note explains | as expected | PASS |
| T2.2 | Results use the structured area | chip Area: Zamalek | as expected | PASS |
| T2.3 | Arabic wish with Arabic digits fills Maadi, 700/person, 2 people, dog | Maadi / 700 / 2 / dog | as expected | PASS |
| T2.4 | Group total → per person derived (1,500 / 3 = 500) | per person 500 | as expected | PASS |
| T3.1 | Wheelchair: no demo place shown as confirmed accessible | 0 confirmed | as expected | PASS |
| T3.2 | Unknown access goes to 'Ask before choosing' with what to confirm | ask list with 'Wheelchair access not confirmed' | as expected | PASS |
| T3.3 | Place with steps at the entrance (felucca) is excluded | c5 absent, reason listed | as expected | PASS |
| T3.4 | Three states: verified full access → confirmed; ramp only → needs confirmation; upstairs no lift → excluded | fx1 confirmed, fx2 ask, fx3 excluded | as expected | PASS |
| T3.5 | Details show access facts, 'ramp alone' rule and demo source | facts + ramp note + source | as expected | PASS |
| T4.1 | Location requested only on click; accuracy shown | idle before click; '~20 m' after | as expected | PASS |
| T4.2 | Radius search uses only verified venue coordinates (fixture within 5 km; demo left out and counted) | only fx1; note about places without exact location | as expected | PASS |
| T4.3 | Precise coordinates are not written to storage | no coordinates in localStorage | as expected | PASS |
| T4.4 | Stale location (over 5 min) expires and asks for refresh | expired message, device cleared | as expected | PASS |
| T4.5 | Location denied handled with manual-area fallback | message + area selectable | as expected | PASS |
| T4.6 | Location unavailable handled with manual-area fallback | message + area selectable | as expected | PASS |
| T4.7 | Location timeout handled with manual-area fallback | message + area selectable | as expected | PASS |
| T4.8 | Inaccurate location (4.8 km) is rejected, not silently used | imprecise message, no device location | as expected | PASS |
| T4.9 | Real browser permission not granted → denied state | denied (or unavailable) message | as expected | PASS |
| T5.1 | Zamalek café (demo) appears as a requirement match | c1 in results | as expected | PASS |
| T5.2 | Saved → planned trip with Cairo time (19:30 Cairo = 16:30 UTC in October 2026) | trip listed 7:30 pm Cairo; stored 16:30Z; total 600 | as expected | PASS |
| T5.3 | Visited → rating 2 explains and creates a personal exclusion | exclusion c1 (rating); toast explains | as expected | PASS |
| T5.4 | Excluded section lists the place with Restore | listed + Restore | as expected | PASS |
| T5.5 | Excluded place is gone from the reviewer's next search | c1 absent + note | as expected | PASS |
| T5.6 | Refresh keeps saved place, trip, rating and exclusion | saved c1, excluded c1, 1 trip | as expected | PASS |
| T5.7 | Restore → eligible again | c1 back | as expected | PASS |
| T5.8 | Updating rating above 2 removes the exclusion; still one rating per trip | no exclusion, 1 review = 4 | as expected | PASS |
| T5.9 | Separate place / organization / transport ratings stored | fields place, org, transport | as expected | PASS |
| T5.10 | Guest mode is honest about invites (no fake invite button) | no invite button in guest mode | as expected | PASS |
| T5.11 | No page errors | none | as expected | PASS |
| T6.1 | Owning a pet does not tick 'pet is coming' | unticked | as expected | PASS |
| T6.2 | Default can be overridden per outing ('without my dog') | ticked by default, unticked by the wish | as expected | PASS |
| T6.3 | Unknown / demo pet policy goes to 'Ask before choosing', not confirmed | c1 in ask | as expected | PASS |
| T7.1 | Ask the place: verified contacts only, click-to-call and WhatsApp text | tel: + wa.me with text | as expected | PASS |
| T7.2 | Access questions stay out of the message without consent | no access questions; pet question present | as expected | PASS |
| T7.3 | With consent, access questions are added | access questions included | as expected | PASS |
| T7.4 | Uber link carries venue coordinates and name; Maps uses venue coordinates | dropoff lat/lng + nickname; google destination | as expected | PASS |
| T7.5 | Careem: honest copy-address fallback (no fake deep link) | fallback text, no careem link | as expected | PASS |
| T7.6 | Demo place: no map pin or ride link (district centre never used) | no links; explanation + Ask the place | as expected | PASS |
| T7.7 | Share text has name, area, price basis and total, demo note; no access needs or location | name/price/demo note, nothing private | as expected | PASS |
| T8.1 | Account dialog: honest 'Not connected' status, no fake login form | status table; no password input | as expected | PASS |
| T8.2 | Guest is clearly labelled as device-only, not an account | guest label + explanation | as expected | PASS |
| T8.3 | Invite link without the server: explained, token removed from the address bar | message + clean URL | as expected | PASS |
| T9.1 | Arabic switches the whole page to RTL | rtl / ar | as expected | PASS |
| T9.2 | No untranslated English in Arabic screens, dialogs, empty states | no stray English words | as expected | PASS |
| T9.3 | No missing translation keys at run time | 0 | as expected | PASS |
| T9.4 | Voice language is separate from interface language | UI ar, voice en-US | as expected | PASS |
| T9.5 | Language choice persists after refresh | rtl | as expected | PASS |
| T9.6 | No page errors in Arabic flows | none | as expected | PASS |
| T10.1 | First Tab reaches the skip link | skip link focused | as expected | PASS |
| T10.2 | Visible focus outline on keyboard focus | solid 3px | as expected | PASS |
| T10.3 | Dialog opens from keyboard, Escape closes and focus returns | returns to Accessibility button | as expected | PASS |
| T10.4 | No dead buttons: every action in the UI has a handler | 0 unhandled actions | as expected | PASS |
| T10.5 | All visible controls are labelled | 0 unlabeled | as expected | PASS |
| T10.6a | Mobile 360 px (en): no horizontal scrolling | overflow 0 on every screen | as expected | PASS |
| T10.6b | Mobile 360 px (ar): no horizontal scrolling | overflow 0 on every screen | as expected | PASS |
| T11.1 | On claude.ai the viewer's private document is used (mocked runtime) | saved in data/users/<id>/wishly, not localStorage | as expected | PASS |
| T11.2 | Persists across reloads in that mode (mocked runtime) | c1 still saved | as expected | PASS |
| T12.1 | Delete my data needs two taps and clears the device data | armed, then cleared | as expected | PASS |
| T13.1 | Sign-up validates username and password with clear messages | username rule, then password rule | as expected | PASS |
| T13.2 | Show / hide password toggles the field | type=text, pressed | as expected | PASS |
| T13.3 | Successful sign-up asks to confirm the email (no instant fake login) | check-email notice; still guest | as expected | PASS |
| T13.4 | Sign-in before confirming shows the reason and a resend button | message + resend | as expected | PASS |
| T13.5 | Wrong password gives a useful error | wrong credentials message | as expected | PASS |
| T13.6 | After confirming, sign-in switches to the account (header shows @username) | @samaa_test | as expected | PASS |
| T13.7 | No password stored in the browser | password absent from localStorage | as expected | PASS |
| T13.8 | Account mode: saved place and trip go to the server store | 1 trip; server mode text | as expected | PASS |
| T13.9 | Invite link is created with only a token (no private data in the URL) | https://wishly.example/#invite=<token> | as expected | PASS |
| T13.10 | Owner can revoke an invite link | link shows Revoked | as expected | PASS |
| T13.11 | Opening a revoked invite shows the revoked message | revoked message | as expected | PASS |
| T13.12 | Opening an invalid invite shows the invalid message | invalid message | as expected | PASS |
| T13.13 | Account mode: rating 1 creates the reviewer's exclusion | c1 excluded | as expected | PASS |
| T13.14 | Session persists across refresh; data reloads from the account | trip + saved after reload | as expected | PASS |
| T13.15 | Sign out returns to guest; account data is not shown as guest data | Guest, 0 trips | as expected | PASS |
| T13.16 | Log back in: account data is back | 1 trip | as expected | PASS |
| T13.17 | No page errors in server-mode flows | none | as expected | PASS |

## Database authorization (real PostgreSQL 16)

These run as users A, B and C and check what each one can and cannot read or change.

| # | Check | Result |
|---|---|---|
| 1 | signup creates a profile with the chosen username | PASS |
| 2 | duplicate username does not block sign-up (left empty) | PASS |
| 3 | signup creates an empty private profile | PASS |
| 4 | A can read own private profile | PASS |
| 5 | B cannot read A's private profile (access needs stay private) | PASS |
| 6 | B cannot create a private row for A | PASS |
| 7 | B's update of other people's private data changed nothing | PASS |
| 8 | C (stranger) cannot see A's profile card | PASS |
| 9 | C can see own profile card | PASS |
| 10 | username_available: taken name | PASS |
| 11 | username_available: free name | PASS |
| 12 | C can set own username | PASS |
| 13 | C cannot move own profile to another id | PASS |
| 14 | C could not edit anyone else's profile | PASS |
| 15 | anonymous visitors can read places | PASS |
| 16 | all seeded places are demo records | PASS |
| 17 | a normal user cannot add places | PASS |
| 18 | demo place still demo after user update attempt | PASS |
| 19 | even an admin cannot add a verified pet policy without evidence | PASS |
| 20 | coordinates need a source and check date | PASS |
| 21 | admin can add a verified place with evidence | PASS |
| 22 | everyone can read evidence | PASS |
| 23 | a normal user cannot add evidence | PASS |
| 24 | A saved two places | PASS |
| 25 | B cannot see A's saved places | PASS |
| 26 | B cannot save a place as A | PASS |
| 27 | B's delete did not touch A's saved places | PASS |
| 28 | owner is added as an accepted participant | PASS |
| 29 | invite token is random and long | PASS |
| 30 | only a hash of the invite token is stored | PASS |
| 31 | B cannot see A's private trip before joining | PASS |
| 32 | B cannot create an invite for A's trip | PASS |
| 33 | B can preview the invitation with the token | PASS |
| 34 | invalid invite token is rejected | PASS |
| 35 | B cannot add himself as a participant directly | PASS |
| 36 | B cannot create a trip owned by A | PASS |
| 37 | after accepting, B sees the trip | PASS |
| 38 | after accepting, B sees both participants | PASS |
| 39 | B can now see A's profile card (co-participant) | PASS |
| 40 | B (guest) could not change the trip status | PASS |
| 41 | C (not invited) cannot see the trip | PASS |
| 42 | C cannot see the trip participants | PASS |
| 43 | owner can list invites | PASS |
| 44 | revoked invite cannot be previewed | PASS |
| 45 | revoked invite cannot be used to join | PASS |
| 46 | revoking the link keeps people who already joined | PASS |
| 47 | expired invite is rejected | PASS |
| 48 | owner cannot change the trip's place after creating it | PASS |
| 49 | declining does not give access to the trip | PASS |
| 50 | B cannot review before visiting | PASS |
| 51 | rating 2 hides the place for the reviewer | PASS |
| 52 | B's exclusion list now has the place | PASS |
| 53 | rating outside 1-5 is rejected | PASS |
| 54 | B cannot write a review row directly | PASS |
| 55 | B cannot create a rating-type exclusion directly | PASS |
| 56 | B cannot hide a place for A | PASS |
| 57 | a friend's low rating does not hide the place for A | PASS |
| 58 | A (participant) can read B's shared rating | PASS |
| 59 | C cannot read the trip reviews | PASS |
| 60 | C cannot review a trip they are not in | PASS |
| 61 | C cannot mark someone else's trip visited | PASS |
| 62 | updating to 4 removes the rating-based exclusion | PASS |
| 63 | still exactly one review per person per trip | PASS |
| 64 | rating 1 hides it again | PASS |
| 65 | restore removes the exclusion | PASS |
| 66 | a user can hide a place manually | PASS |
| 67 | completing a trip records the time | PASS |
| 68 | after completion the owner can review without marking visited | PASS |
| 69 | group signal averages participants' visible ratings | PASS |
| 70 | group signal is empty for non-members | PASS |
| 71 | you cannot accept your own friend invite | PASS |
| 72 | invalid friend invite is rejected | PASS |
| 73 | accepting a friend invite creates the friendship | PASS |
| 74 | friends can see each other's profile card | PASS |
| 75 | friendships cannot be created directly | PASS |
| 76 | a friend request needs a shared trip | PASS |
| 77 | B cannot see C's profile (no connection) | PASS |
| 78 | B cannot see A and C's friendship | PASS |
| 79 | B cannot accept his own request | PASS |
| 80 | accepted request creates the friendship | PASS |
| 81 | revoked friend invite cannot be used | PASS |
| 82 | after leaving, B no longer sees the trip | PASS |
| 83 | B cannot rejoin with a revoked link | PASS |
| 84 | a guest cannot remove participants | PASS |
| 85 | anonymous visitors cannot call trip functions | PASS |
| 86 | anonymous visitors see no trips | PASS |
| 87 | anonymous visitors see no profiles | PASS |
| 88 | signed-in users cannot call the Facebook lookup helper | PASS |
| 89 | the Edge Function (service role) can map Facebook ids | PASS |
| 90 | delete_my_data removes B's reviews, exclusions and memberships | PASS |
| 91 | delete_my_data does not touch A's trip | PASS |

## Matching engine

| Check | Result |
|---|---|
| EN: 700 per person parsed | PASS |
| EN: 2 people parsed | PASS |
| EN: Maadi parsed | PASS |
| EN: café kind parsed | PASS |
| EN: pet accompanying parsed | PASS |
| 700 × 2 = 1,400 total | PASS |
| AR + Arabic digits: 700 per person × 2 = 1,400 | PASS |
| AR: المعادي → Maadi | PASS |
| AR: كلب → dog accompanying | PASS |
| AR: كافيه → café | PASS |
| headcount, hours and year are not read as budget | PASS |
| 'under' = hard cap | PASS |
| 'total' basis recognised | PASS |
| structured area wins over text area | PASS |
| structured per-person budget wins | PASS |
| conflicts are reported | PASS |
| owning a pet does not force pet-friendly | PASS |
| 'without my dog' turns accompanying off | PASS |
| Maadi pet-friendly café: no confirmed match from demo data | PASS |
| Maadi pet-friendly café: nothing outside Maadi offered as Ask | PASS |
| Maadi pet-friendly café: non-cafés never appear | PASS |
| Zamalek demo café with a demo 'pets allowed' claim → Ask, not confirmed | PASS |
| verified Maadi pet café with evidence → confirmed | PASS |
| its group cost is 300 × 2 = 600 | PASS |
| dog-only place is unsuitable for a cat | PASS |
| ramp alone is not enough (interior, level, toilet unknown) | PASS |
| all wheelchair facts true + evidence → confirmed | PASS |
| interior not usable → excluded | PASS |
| upper floor without lift → excluded | PASS |
| all true but demo record → needs confirmation | PASS |
| demo 'steps at entrance' → excluded (a no is respected) | PASS |
| wheelchair search over demo data: no confirmed results | PASS |
| felucca with steps is excluded for wheelchair users | PASS |
| radius search uses only venue coordinates (demo has none) | PASS |
| place outside radius is excluded, offered only as expansion | PASS |
| excluded place never appears | PASS |
| restored place is eligible again | PASS |
| budget applied before top results (nothing over 300 total) | PASS |
| fixed-price items are not multiplied | PASS |
| missing info lowers the score and is listed | PASS |
| low participant ratings lower the group score | PASS |
| Cairo winter time (UTC+2): 2026-12-01 17:00 → 15:00Z | PASS |
| Cairo summer time (UTC+3): 2026-07-01 17:00 → 14:00Z | PASS |
| round trip back to the Cairo input value | PASS |

## Blocked or not executed

| Test | Status | Why | What it needs |
|---|---|---|---|
| Two real people signing in from two browsers against a live Supabase project | **Blocked** | No Supabase project exists yet, and this environment can't reach supabase.co | SETUP.md steps 1–5, then the two-person check at the end of SETUP.md. Isolation itself is tested at database level (checks 5–8, 25–27, 31–42, 57–59, 77–78) |
| Email verification and password-reset emails actually arriving | **Blocked** | Needs a live project and email delivery | SETUP.md step 3 |
| Google sign-in | **Blocked** | Needs a Google Cloud OAuth client | SETUP.md step 6 |
| Facebook sign-in and Facebook friend discovery | **Blocked** | Needs a Meta app, plus App Review for `user_friends` | SETUP.md steps 7 and 9 |
| Supabase client calls against the real API (`js/stores.js` ServerStore) | **Not executed** | Exercised only against the stand-in client (T13) | First run after SETUP.md |
| Edge Function `facebook-friends` | **Not executed** | Needs deployment and a Facebook token | SETUP.md step 9 |
| Private Claude storage on the live claude.ai artifact | **Partly executed** | After publishing, the page ran on claude.ai and created the owner's private document `data/users/<id>/wishly` (read back on 18 Oct 2026: version 1, empty profile). Saving and reloading by a person was not executed. The logic passed with a stand-in runtime (T11) | Open the review artifact, save a place, reload |
| Real phone GPS, and the native share sheet on a phone | **Not executed** | Simulated with Chromium's location override and errors (T4) | Test on a phone over HTTPS |
| Screen readers (NVDA, VoiceOver, TalkBack) | **Not executed** | Only automated checks ran (labels, focus, keyboard: T10) | A manual pass before the submission |
| Arabic wording reviewed by a native speaker | **Not executed** | Written for Egyptian users, not proof-read by a person | Samaa or a colleague |
