// Supabase Edge Function: facebook-friends
//
// Called by the app right after the person signs in (or links) with Facebook
// and grants the `user_friends` permission. It:
//   1. verifies the caller's Wishly session,
//   2. asks the Facebook Graph API for /me/friends with the provider token the
//      browser received once (the token is used here and never stored),
//   3. keeps only friends who also signed in to Wishly with Facebook,
//   4. creates pending friend requests (source = 'facebook') that the other
//      person must accept. No friendship is created automatically and nobody
//      else is imported.
//
// Facebook only returns friends who ALSO use this app and also granted
// user_friends, and Meta must approve user_friends (App Review) before it
// works for people outside your test roles. An empty list is a normal result.
//
// Deploy:  supabase functions deploy facebook-friends
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//          provided to Edge Functions by Supabase automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("WISHLY_SITE_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. who is calling (verified by Supabase Auth, not by anything the browser claims)
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "not_authenticated" }, 401);
  const me = who.user;
  const myFacebook = (me.identities ?? []).find((i) => i.provider === "facebook");
  if (!myFacebook) return json({ error: "facebook_not_linked" }, 400);

  let body: { provider_token?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const token = body.provider_token;
  if (!token || typeof token !== "string") return json({ error: "missing_provider_token" }, 400);

  // 2. the token must belong to the same Facebook account linked to this user
  const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id&access_token=${encodeURIComponent(token)}`);
  if (!meRes.ok) return json({ error: "facebook_token_invalid" }, 400);
  const fbMe = await meRes.json();
  if (String(fbMe.id) !== String(myFacebook.id ?? myFacebook.identity_data?.sub ?? myFacebook.identity_data?.provider_id)) {
    return json({ error: "facebook_account_mismatch" }, 403);
  }

  // 3. friends who also use Wishly (Facebook only returns those)
  const fbIds: string[] = [];
  let next: string | null = `https://graph.facebook.com/v19.0/me/friends?fields=id&limit=100&access_token=${encodeURIComponent(token)}`;
  for (let page = 0; next && page < 20; page++) {
    const r = await fetch(next);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return json({ error: "facebook_friends_failed", detail: e?.error?.message ?? r.status }, 502);
    }
    const d = await r.json();
    for (const f of d.data ?? []) fbIds.push(String(f.id));
    next = d.paging?.next ?? null;
  }
  if (!fbIds.length) return json({ matched: 0, requested: 0 });

  // 4. map Facebook ids to Wishly users and create pending requests
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: ids, error: idErr } = await admin.rpc("facebook_user_ids", { fb_ids: fbIds });
  if (idErr) return json({ error: "lookup_failed" }, 500);
  const others = [...new Set((ids ?? []).map((i: { user_id: string }) => i.user_id).filter((u: string) => u !== me.id))];
  let requested = 0;
  for (const other of others) {
    const a = me.id < other ? me.id : other, b = me.id < other ? other : me.id;
    const { data: fr } = await admin.from("friendships").select("user_a").eq("user_a", a).eq("user_b", b).maybeSingle();
    if (fr) continue;
    const { error } = await admin.from("friend_requests")
      .upsert({ from_user: me.id, to_user: other, source: "facebook", status: "pending" }, { onConflict: "from_user,to_user", ignoreDuplicates: true });
    if (!error) requested++;
  }
  return json({ matched: others.length, requested });
});
