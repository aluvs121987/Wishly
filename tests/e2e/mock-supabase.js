/* TEST ONLY. A small in-memory stand-in for supabase-js, served instead of the
 * CDN script during the e2e tests so the app's server-mode screens can be
 * exercised offline. It does NOT enforce Row Level Security: authorization is
 * tested against real PostgreSQL in tests/sql/. */
(function () {
  const KEY = "__mocksb";
  const blank = () => ({ users: [], profiles: [], profile_private: [], saved_places: [], trips: [], trip_participants: [], reviews: [], exclusions: [], trip_invites: [], friendships: [], friend_requests: [], friend_invites: [] });
  let db = JSON.parse(sessionStorage.getItem(KEY) || "null") || blank();
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(db));
  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const places = () => window.W.DEMO_PLACES.map((p) => ({ id: p.id, record_status: p.status, name_en: p.name.en, name_ar: p.name.ar, category: p.cat, kind: p.kind, area: p.area,
    price_amount: p.price.amount, price_basis: p.price.basis, includes_transport: p.includes.transport, includes_taxes: p.includes.taxes, pet_policy: p.pets.policy, pet_types: p.pets.types,
    wheelchair: { step_free: p.wheelchair.stepFree, accessible_toilet: p.wheelchair.toilet }, access_features: p.access, tags: p.tags, contacts: {}, bank_offers: [], lat: null, lng: null })).concat(window.__extraPlaces || []);
  let listeners = [];
  let session = JSON.parse(localStorage.getItem("__mocksession") || "null");
  const setSession = (s, ev) => { session = s; if (s) localStorage.setItem("__mocksession", JSON.stringify(s)); else localStorage.removeItem("__mocksession"); listeners.forEach((cb) => cb(ev, s)); };
  const me = () => session && session.user.id;
  const err = (message) => ({ data: null, error: { message } });

  function builder(table) {
    const q = { table, filters: [], op: "select", rows: null, patch: null, single: false, maybe: false, embed: [] };
    const api = {
      select(cols) { if (q.op === "select") q.op = "select"; if (cols && cols.includes("trip_participants(")) q.embed = ["trip_participants", "reviews"]; q.returning = true; return api; },
      eq(c, v) { q.filters.push((r) => r[c] === v); return api; },
      in(c, arr) { q.filters.push((r) => arr.includes(r[c])); return api; },
      order() { return api; }, limit() { return api; },
      maybeSingle() { q.maybe = true; return api; }, single() { q.single = true; return api; },
      insert(rows) { q.op = "insert"; q.rows = [].concat(rows); return api; },
      upsert(rows) { q.op = "upsert"; q.rows = [].concat(rows); return api; },
      update(p) { q.op = "update"; q.patch = p; return api; },
      delete() { q.op = "delete"; return api; },
      then(ok, fail) { return Promise.resolve(run(q)).then(ok, fail); }
    };
    return api;
  }
  const own = { saved_places: "user_id", exclusions: "user_id", profile_private: "user_id", profiles: "id" };
  function run(q) {
    if (q.table === "places") return { data: places(), error: null };
    const T = db[q.table]; const uid = me();
    let rows = T.filter((r) => q.filters.every((f) => f(r)));
    // crude visibility so one signed-in user only sees their own rows
    if (own[q.table]) rows = rows.filter((r) => r[own[q.table]] === uid);
    if (q.table === "trips") rows = rows.filter((t) => t.owner_id === uid || db.trip_participants.some((p) => p.trip_id === t.id && p.user_id === uid && p.status === "accepted"));
    if (q.op === "insert" || q.op === "upsert") {
      const out = [];
      for (const r0 of q.rows) {
        const r = Object.assign({}, r0);
        if (q.table === "trips") Object.assign(r, { id: uuid(), status: "planned", created_at: now(), time_zone: "Africa/Cairo", completed_at: null });
        const pk = q.table === "saved_places" || q.table === "exclusions" ? (x) => x.user_id === r.user_id && x.place_id === r.place_id : q.table === "profile_private" ? (x) => x.user_id === r.user_id : null;
        const ex = pk ? T.find(pk) : null;
        if (ex) Object.assign(ex, r); else T.push(r);
        if (q.table === "trips") db.trip_participants.push({ trip_id: r.id, user_id: r.owner_id, role: "owner", status: "accepted", visited_at: null });
        out.push(r);
      }
      save(); return { data: q.single ? out[0] : out, error: null };
    }
    if (q.op === "update") { rows.forEach((r) => { Object.assign(r, q.patch); if (q.table === "trips" && q.patch.status === "completed") r.completed_at = now(); }); save(); return { data: rows, error: null }; }
    if (q.op === "delete") { db[q.table] = T.filter((r) => !rows.includes(r)); save(); return { data: rows, error: null }; }
    let data = rows.map((r) => Object.assign({}, r));
    if (q.embed.length) data = data.map((t) => Object.assign(t, { trip_participants: db.trip_participants.filter((p) => p.trip_id === t.id), reviews: db.reviews.filter((x) => x.trip_id === t.id) }));
    if (q.single || q.maybe) data = data[0] || null;
    return { data, error: null };
  }
  const tok = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const RPC = {
    username_available: ({ name }) => !db.profiles.some((p) => p.username === name.toLowerCase()),
    is_admin: () => false,
    create_trip_invite: ({ trip }) => { const t = tok(); db.trip_invites.push({ id: uuid(), trip_id: trip, token: t, created_at: now(), expires_at: new Date(Date.now() + 864e6).toISOString(), revoked_at: null, uses: 0, max_uses: 20 }); return t; },
    revoke_trip_invite: ({ invite_id }) => { const i = db.trip_invites.find((x) => x.id === invite_id); if (!i) throw "invite_not_found"; i.revoked_at = now(); },
    preview_trip_invite: ({ token }) => { const i = db.trip_invites.find((x) => x.token === token); if (!i) throw "invite_invalid"; if (i.revoked_at) throw "invite_revoked"; const t = db.trips.find((x) => x.id === i.trip_id); const p = places().find((x) => x.id === t.place_id);
      return [{ trip_id: t.id, place_id: p.id, place_name_en: p.name_en, place_name_ar: p.name_ar, area: p.area, starts_at: t.starts_at, people: t.people, budget_per_person: t.budget_per_person, status: t.status, organizer: "Organizer", my_status: null }]; },
    mark_visited: ({ trip }) => { const p = db.trip_participants.find((x) => x.trip_id === trip && x.user_id === me()); if (!p) throw "not_a_member"; p.visited_at = now(); },
    submit_review: ({ trip, place_rating, organization_rating, transport_rating, comment }) => {
      const t = db.trips.find((x) => x.id === trip), p = db.trip_participants.find((x) => x.trip_id === trip && x.user_id === me());
      if (!t || !p) throw "not_a_member"; if (t.status !== "completed" && !p.visited_at) throw "review_before_visit";
      let r = db.reviews.find((x) => x.trip_id === trip && x.user_id === me());
      if (!r) { r = { id: uuid(), trip_id: trip, user_id: me(), place_id: t.place_id, created_at: now() }; db.reviews.push(r); }
      Object.assign(r, { place_rating, organization_rating, transport_rating, comment, updated_at: now() });
      db.exclusions = db.exclusions.filter((e) => !(e.user_id === me() && e.place_id === t.place_id && e.reason === "rating"));
      if (place_rating <= 2) db.exclusions.push({ user_id: me(), place_id: t.place_id, reason: "rating", created_at: now() });
      return { review_id: r.id, excluded: place_rating <= 2 };
    },
    group_place_signals: () => [], create_friend_invite: () => tok(), delete_my_data: () => {}
  };
  window.supabase = { createClient: () => ({
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password, options }) {
        if (db.users.some((u) => u.email === email)) return { data: { user: { identities: [] }, session: null }, error: null };
        const u = { id: uuid(), email, password, confirmed: false };
        db.users.push(u); const name = (options.data.username || "").toLowerCase();
        db.profiles.push({ id: u.id, username: db.profiles.some((p) => p.username === name) ? null : name, display_name: null });
        db.profile_private.push({ user_id: u.id, data: {} }); save();
        return { data: { user: { id: u.id }, session: null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return err("Invalid login credentials"); if (!u.confirmed) return err("Email not confirmed");
        const s = { user: { id: u.id, email, email_confirmed_at: now() } }; setSession(s, "SIGNED_IN"); return { data: s, error: null };
      },
      async signOut() { setSession(null, "SIGNED_OUT"); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async resend() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; },
      async getUserIdentities() { return { data: { identities: [{ provider: "email" }] }, error: null }; },
      async signInWithOAuth() { return err("provider is not enabled"); }, async linkIdentity() { return err("manual linking disabled"); }, async unlinkIdentity() { return { error: null }; }
    },
    from: (t) => builder(t),
    rpc: async (fn, args) => { try { const data = RPC[fn](args || {}); save(); return { data, error: null }; } catch (e) { return err(String(e)); } },
    functions: { invoke: async () => err("not deployed") }
  }) };
  window.__mockConfirm = (email) => { const u = db.users.find((x) => x.email === email); if (u) { u.confirmed = true; save(); } };
})();
