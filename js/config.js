/* Wishly deployment settings. See SETUP.md.
 *
 * Leave supabaseUrl empty to run without the Wishly server: the app then
 * works in guest mode (this device only) or, on claude.ai, with the viewer's
 * private Claude storage. Accounts, friends and group trips need the server.
 *
 * The Supabase "anon" (publishable) key is designed to be public: it only
 * allows what the database's Row Level Security rules allow. NEVER put the
 * service_role key, OAuth client secrets or any password in this file.
 */
window.WISHLY_CONFIG = {
  supabaseUrl: "https://mxvrwlathmwqtcasjzjp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnJ3bGF0aG13cXRjYXNqempwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzgyNDgsImV4cCI6MjEwNzkxNDI0OH0.WAjzXkGpsUOw2_aWgE8aH5Fmz_sOMI5dfFNPHsQbQ5k",  // public anon key; RLS protects the data
  siteUrl: "https://aluvs121987.github.io/wishly/",
  providers: {              // switch on only after the provider is configured in Supabase (SETUP.md §4)
    google: false,
    facebook: false
  },
  manualLinking: false,     // Supabase: Authentication > Sign In / Providers > "Allow manual linking"
  facebookFriends: false,   // needs the facebook-friends Edge Function and Meta approval of user_friends
  uberClientId: ""          // optional: your Uber developer client_id for ride links
};
