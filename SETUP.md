# Wishly: connecting real accounts, friends and group trips

Without this setup Wishly runs in **guest mode**: everything is saved in the browser on that one device. On claude.ai it can also use the viewer's private Claude storage. Accounts, friends, invitations and shared ratings need the **Wishly server**, which is a Supabase project (a free Postgres database plus a maintained sign-in service).

Allow about 20 minutes for steps 1–5 (email and password accounts). Google and Facebook are optional extras (steps 6–8).

---

## 1. Create the Supabase project

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it `wishly`. Choose a strong database password and keep it in your password manager. It never goes into the app.
3. Region: **Central EU (Frankfurt)**, the closest to Egypt.
4. Wait about 2 minutes for the project to start.

## 2. Create the database

1. Open **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It should finish with "Success. No rows returned".
3. Open a new query, paste `supabase/seed_places.sql` and click **Run**. This adds the 18 demo places, marked `demo`.
4. Check it: **Table Editor → places** shows 18 rows, all with `record_status = demo`.

`schema.sql` turns on Row Level Security for every table and creates the database functions the app calls. The same file was tested against PostgreSQL 16 with 91 authorization checks (see `TEST_RESULTS.md`).

## 3. Set up sign-in by email

Open **Authentication**:

1. **Sign In / Providers → Email**: keep it enabled, and switch **Confirm email** on.
2. **Password settings** (on the same page, or under **Authentication → Policies** depending on the dashboard version): set the minimum length to **10** and require **letters and digits**. The app checks the same rule.
3. **URL Configuration**:
   - **Site URL**: the public HTTPS address where you host Wishly (step 5), for example `https://samaa.github.io/wishly/`.
   - **Redirect URLs**: add the same address. Confirmation, password-reset and social sign-in links only return to addresses listed here.
4. **Emails**: Supabase's built-in email sender is for testing only. It sends only a few emails per hour and only to addresses on your team. For the graduation demo, either:
   - add each examiner's email under **Organization → Team**, or
   - connect your own SMTP service under **Authentication → Emails → SMTP Settings** (for example Brevo or Resend, both of which have free tiers).

## 4. Connect the app to the project

1. Open **Project Settings → API** (or **Data API**).
2. Copy the **Project URL** and the **anon / publishable** key.
3. Edit `js/config.js`:

```js
window.WISHLY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLISHABLE-KEY",
  siteUrl: "https://YOUR-HOSTING-ADDRESS/",
  providers: { google: false, facebook: false },
  manualLinking: false,
  facebookFriends: false,
  uberClientId: ""
};
```

The anon key is designed to be public. It can only do what the Row Level Security rules allow. **Never** put the `service_role` key, a database password or any OAuth client secret in `config.js` or anywhere else in the app.

## 5. Host the app on HTTPS

Any static host works. The app is plain HTML, CSS and JavaScript with no build step.

- **GitHub Pages**: create a repository, upload the project folder, then **Settings → Pages → Deploy from branch**.
- **Netlify** or **Cloudflare Pages**: drag and drop the folder.

Then put the final address into `siteUrl` (step 4) and into Supabase **Site URL** and **Redirect URLs** (step 3).

HTTPS is required for sign-in links, device location, copy and share buttons, and voice input.

**Check the setup:** open the site, then **Account → Create account**. Confirm the email and sign in. The header should show `@yourname`.

## 6. Google sign-in (optional)

1. In <https://console.cloud.google.com>, create a project, then go to **APIs & Services → OAuth consent screen**. Choose **External** and fill in the app name, support email and authorized domain (your hosting domain).
2. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins**: your site address.
   - **Authorized redirect URI**: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
3. Copy the client ID and client secret into Supabase **Authentication → Sign In / Providers → Google**, then enable it. The secret stays in Supabase.
4. In `js/config.js`, set `providers.google: true`.

While the consent screen is in "Testing", only the test users you add can sign in. Publish it for everyone.

## 7. Facebook sign-in (optional)

1. In <https://developers.facebook.com>, go to **My Apps → Create app**, then choose **Authenticate and request data from users with Facebook Login**.
2. Under **Facebook Login → Settings**, set **Valid OAuth Redirect URIs** to `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
3. Copy the App ID and App Secret into Supabase **Authentication → Sign In / Providers → Facebook**, then enable it.
4. In `js/config.js`, set `providers.facebook: true`.
5. Until the Meta app is **Live**, which needs a privacy policy URL and possibly business verification, only people with a role on the app can sign in.

## 8. Linking sign-in methods (optional)

- **Automatic**: Supabase joins a Google or Facebook sign-in to an existing account that has the **same verified email**.
- **Deliberate (manual) linking**: a signed-in person adds another sign-in method from **Account → Link Google / Link Facebook**. Turn on **Authentication → Sign In / Providers → Allow manual linking**, then set `manualLinking: true` in `config.js`. Supabase marks manual linking as beta.

## 9. Facebook friend discovery (optional, needs Meta approval)

Facebook shares only friends who **also** use Wishly through Facebook and who granted `user_friends`. The app then shows those friends as requests to accept. It never imports friends automatically.

1. In the Meta app, request the **user_friends** permission under **App Review**. Without approval it only works for people with a role on the app.
2. Install the Supabase CLI, then deploy the function from the project folder:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy facebook-friends
   supabase secrets set WISHLY_SITE_ORIGIN=https://YOUR-HOSTING-ADDRESS
   ```
3. In `config.js`, set `facebookFriends: true`.

The Facebook access token is used once by the function and never stored. The app also removes provider tokens before saving the sign-in session.

## 10. Adding real, checked places

The demo places can never become "verified". To add a real place:

1. Make yourself an admin: run `insert into public.admins (user_id) values ('<your user id>');`. Find the id under **Authentication → Users**.
2. Copy `supabase/add_verified_place_template.sql`, fill in only the facts you confirmed (with source and date), and run it.

The database rejects pet, access, contact or coordinate claims that have no source and check date. A place with exact coordinates becomes eligible for "Use my current location" searches and gets map and ride links.

For the Maadi pet-friendly café test, for example: call two or three Maadi cafés. Note what they say about dogs, the entrance, the inside space, the floor and the toilet. Add those records, and the same search will return them as confirmed.

## 11. Removing an account

**Profile → Delete my data** removes everything Wishly stores about the person: profile details, saved places, trips, ratings, friends and invites. Removing the sign-in itself is done by the project owner in **Authentication → Users → Delete user**, which also deletes any remaining rows. A self-service "delete my login" would need an Edge Function with the service role. That function is not included.

---

## Settings and secrets

| Name | Where it lives | Public? |
|---|---|---|
| `supabaseUrl` | `js/config.js` | Yes |
| `supabaseAnonKey` (anon / publishable key) | `js/config.js` | Yes, by design; protected by RLS |
| `siteUrl` | `js/config.js` and Supabase URL Configuration | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase only (given to Edge Functions automatically) | **No, never in the app** |
| Database password | Your password manager | **No** |
| Google client secret | Supabase → Providers → Google | **No** |
| Facebook app secret | Supabase → Providers → Facebook | **No** |
| `WISHLY_SITE_ORIGIN` | Edge Function secret (step 9) | Yes |
| `uberClientId` (optional) | `js/config.js` | Yes |

## Security notes

- Passwords go only to Supabase Auth. Wishly never sees or stores them.
- Supabase keeps a short-lived session token (1 hour, auto-refreshed) in the browser's localStorage. This is the standard setup for apps without their own server. Google and Facebook tokens are removed before anything is saved.
  - **Stricter option:** serve the app from a small server using `@supabase/ssr` so the session lives in an HttpOnly cookie.
- Invitation links contain only a random token. The database stores only its SHA-256 hash, and links can be revoked or expire after 14 days.
- Access needs live in `profile_private`, which only the owner can read. Friends and trip participants see only the username and display name.

## Quick check with two people

1. Person A creates an account, saves a place, plans a trip and creates an invite link.
2. Person B opens the link in another browser, creates an account and accepts.
3. B sees the trip and A's username, but not A's saved places, profile details or access needs.
4. A marks the trip completed. Both rate it. Each sees the other's rating on the trip.
5. B rates the place 2: the place disappears from B's results only.
6. A revokes the link. Person C opening it sees "This invitation link was revoked".
