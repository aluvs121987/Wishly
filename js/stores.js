/* Wishly data stores.
 *
 *   GuestStore   browser localStorage. One person, this device only.
 *   ClaudeStore  claude.ai artifact storage, the viewer's private
 *                data/users/<id>/ document. Signed-in, private, cross-device,
 *                but single-person: no friends or shared trips.
 *   ServerStore  Supabase (Postgres + Auth). Real accounts, friends, shared
 *                trips, invitations and participant ratings, protected by the
 *                Row Level Security rules in supabase/schema.sql.
 *
 * All three expose the same async methods so the UI does not care which one
 * is active. `caps` says what the active store can really do.
 */
(function (W) {
  "use strict";

  const DEFAULT_PROFILE = () => ({ name: "", prefs: [], needs: [], area: "New Cairo", startCoords: null, petOwner: false, petType: "dog",
    bringPetByDefault: false, budgetPerPerson: 0, groupSize: 1, bank: "", cardTier: "" });
  const PREFS = ["Good value", "Quiet places", "Within 30 min", "For two", "Family friendly", "Outdoors", "Celebrations", "Learning something new"];
  const NEED_IDS = ["mobility", "vision", "hearing", "speech", "cognitive"];

  function cleanProfile(d) {
    const p = DEFAULT_PROFILE(); d = d || {};
    if (typeof d.name === "string") p.name = d.name.slice(0, 40);
    if (Array.isArray(d.prefs)) p.prefs = d.prefs.filter((x) => PREFS.includes(x));
    if (Array.isArray(d.needs)) p.needs = d.needs.filter((x) => NEED_IDS.includes(x));
    if ((W.AREAS || []).includes(d.area)) p.area = d.area;
    if (d.startCoords && Number.isFinite(+d.startCoords.lat) && Number.isFinite(+d.startCoords.lng)) p.startCoords = { lat: +d.startCoords.lat, lng: +d.startCoords.lng, savedAt: String(d.startCoords.savedAt || "") };
    p.petOwner = d.petOwner === true;
    p.petType = ["dog", "cat", "other"].includes(d.petType) ? d.petType : "dog";
    p.bringPetByDefault = p.petOwner && (d.bringPetByDefault === true || d.bringPet === true);
    const pp = +d.budgetPerPerson; p.budgetPerPerson = Number.isFinite(pp) ? Math.max(0, Math.min(1000000, pp)) : 0;
    const g = Math.round(+d.groupSize); p.groupSize = Number.isFinite(g) ? Math.max(1, Math.min(20, g)) : 1;
    p.bank = ["NBE", "CIB", "Banque Misr", "Other"].includes(d.bank) ? d.bank : "";
    p.cardTier = ["Classic", "Gold", "Platinum", "Signature"].includes(d.cardTier) ? d.cardTier : "";
    return p;
  }
  const uid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : "t" + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const nowISO = () => new Date().toISOString();
  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  class StoreError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }

  /* ------------------------------------------------------------------
   * DocStore: everything in one JSON document (guest + claude)
   * ------------------------------------------------------------------ */
  class DocStore {
    constructor() { this.state = DocStore.empty(); }
    static empty() { return { v: 4, profile: DEFAULT_PROFILE(), saved: {}, trips: {}, reviews: {}, exclusions: {} }; }
    static clean(s) {
      const e = DocStore.empty(); if (!s || typeof s !== "object") return e;
      e.profile = cleanProfile(s.profile);
      for (const k of ["saved", "trips", "reviews", "exclusions"]) if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) e[k] = s[k];
      return e;
    }
    async persist() { /* subclass */ }
    async places() { return W.DEMO_PLACES; }
    async getProfile() { return Object.assign({}, this.state.profile); }
    async saveProfile(p) { this.state.profile = cleanProfile(p); await this.persist(); }
    async listSaved() { return Object.keys(this.state.saved); }
    async setSaved(placeId, on) { if (on) this.state.saved[placeId] = nowISO(); else delete this.state.saved[placeId]; await this.persist(); }
    async listTrips() {
      return Object.values(this.state.trips).map((t) => {
        const r = this.state.reviews[t.id];
        const me = { userId: "me", me: true, role: "owner", status: "accepted", visitedAt: t.visitedAt || null };
        return Object.assign({}, t, { role: "owner", myVisitedAt: t.visitedAt || null, participants: [me],
          reviews: r ? [Object.assign({ userId: "me", me: true }, r)] : [], myReview: r || null });
      }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    }
    async createTrip(d) {
      const t = { id: uid(), placeId: d.placeId, title: (d.title || "").slice(0, 120), startsAt: d.startsAt || null, people: d.people || 1,
        budgetPerPerson: d.budgetPerPerson || null, status: "planned", createdAt: nowISO(), completedAt: null, visitedAt: null };
      this.state.trips[t.id] = t; await this.persist(); return t;
    }
    async updateTrip(id, patch) {
      const t = this.state.trips[id]; if (!t) throw new StoreError("trip_not_found");
      for (const k of ["title", "startsAt", "people", "budgetPerPerson", "status"]) if (k in patch) t[k] = patch[k];
      if (patch.status === "completed" && !t.completedAt) t.completedAt = nowISO();
      await this.persist();
    }
    async deleteTrip(id) { delete this.state.trips[id]; delete this.state.reviews[id]; await this.persist(); }
    async markVisited(id) { const t = this.state.trips[id]; if (!t) throw new StoreError("not_a_member"); t.visitedAt = t.visitedAt || nowISO(); await this.persist(); }
    async submitReview(tripId, r) {
      const t = this.state.trips[tripId]; if (!t) throw new StoreError("not_a_member");
      if (t.status !== "completed" && !t.visitedAt) throw new StoreError("review_before_visit");
      const place = Math.round(+r.place); if (!(place >= 1 && place <= 5)) throw new StoreError("rating_out_of_range");
      const opt = (v) => { v = Math.round(+v); return v >= 1 && v <= 5 ? v : null; };
      const prev = this.state.reviews[tripId];
      this.state.reviews[tripId] = { place, org: opt(r.org), transport: opt(r.transport), comment: String(r.comment || "").slice(0, 1000),
        createdAt: prev ? prev.createdAt : nowISO(), updatedAt: nowISO() };
      const ex = this.state.exclusions[t.placeId];
      if (place <= 2) this.state.exclusions[t.placeId] = { reason: "rating", at: nowISO(), tripId };
      else if (ex && ex.reason === "rating") delete this.state.exclusions[t.placeId];
      await this.persist();
      return { excluded: place <= 2 };
    }
    async listExclusions() { return Object.entries(this.state.exclusions).map(([placeId, e]) => Object.assign({ placeId }, e)); }
    async restoreExclusion(placeId) { delete this.state.exclusions[placeId]; await this.persist(); }
    async hidePlace(placeId) { this.state.exclusions[placeId] = { reason: "manual", at: nowISO() }; await this.persist(); }
    async groupSignals() { return {}; }
    async exportGuestData() { return JSON.parse(JSON.stringify(this.state)); }
  }

  class GuestStore extends DocStore {
    constructor() { super(); this.kind = "guest"; this.caps = { accounts: false, friends: false, invites: false, sharedRatings: false }; }
    async init() {
      const s = lsGet("wishly.v4");
      if (s) this.state = DocStore.clean(s);
      else this.migrateV3();
      return this;
    }
    // One-time import of the V3 browser data, so earlier testing isn't lost
    migrateV3() {
      const p = lsGet("wishly.profile"), old = lsGet("wishly.trips.v3");
      if (p) this.state.profile = cleanProfile(Object.assign({}, p, { budgetPerPerson: 0, bringPetByDefault: p.bringPet }));
      if (old && typeof old === "object") for (const [placeId, t] of Object.entries(old)) {
        if (!(W.DEMO_PLACES || []).some((x) => x.id === placeId)) continue;
        if (t.saved) this.state.saved[placeId] = nowISO();
        if (t.visited || t.rating) {
          const id = uid(); this.state.trips[id] = { id, placeId, title: "", startsAt: null, people: 1, budgetPerPerson: null, status: "completed", createdAt: t.visitedAt || nowISO(), completedAt: t.visitedAt || nowISO(), visitedAt: t.visitedAt || nowISO() };
          if (t.rating >= 1 && t.rating <= 5) this.state.reviews[id] = { place: t.rating, org: null, transport: null, comment: "", createdAt: t.ratedAt || nowISO(), updatedAt: t.ratedAt || nowISO() };
        }
        if (t.excluded) this.state.exclusions[placeId] = { reason: t.rating <= 2 ? "rating" : "manual", at: nowISO() };
      }
      if (p || old) this.persist();
    }
    async persist() { if (!lsSet("wishly.v4", this.state)) throw new StoreError("storage_unavailable"); }
    async deleteAll() { this.state = DocStore.empty(); for (const k of ["wishly.v4", "wishly.profile", "wishly.trips.v3", "wishly.lang", "wishly.settings"]) lsDel(k); }
    static hasData() { const s = lsGet("wishly.v4"); return !!(s && (Object.keys(s.saved || {}).length || Object.keys(s.trips || {}).length || Object.keys(s.exclusions || {}).length || (s.profile && s.profile.name))); }
  }

  class ClaudeStore extends DocStore {
    constructor(db, userId) { super(); this.kind = "claude"; this.db = db; this.userId = userId; this.caps = { accounts: false, friends: false, invites: false, sharedRatings: false };
      this.ref = db.doc("data/users/" + userId + "/wishly"); this.chain = Promise.resolve(); }
    async init() {
      const snap = await this.ref.get();
      if (snap.exists) this.state = DocStore.clean(snap.data());
      // prove we can write (view-only viewers cannot); caller falls back to guest
      await this.ref.set(JSON.parse(JSON.stringify(this.state)));
      return this;
    }
    persist() {
      const body = JSON.parse(JSON.stringify(this.state));
      this.chain = this.chain.catch(() => {}).then(() => this.ref.set(body)); // one write at a time
      return this.chain.catch((e) => { throw new StoreError(e && e.code === "quota_exceeded" ? "storage_full" : "save_failed", e); });
    }
    async deleteAll() { this.state = DocStore.empty(); await this.ref.delete(); }
  }

  /* ------------------------------------------------------------------
   * ServerStore: Supabase
   * ------------------------------------------------------------------ */
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = () => fail(new StoreError("server_unreachable")); document.head.appendChild(s); });
  }
  // supabase-js keeps its session in localStorage. This wrapper removes the
  // social provider's own OAuth tokens before anything is written, so Google
  // or Facebook access tokens are never stored by the browser.
  const strippedStorage = {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { const o = JSON.parse(v); if (o && typeof o === "object") { delete o.provider_token; delete o.provider_refresh_token; if (o.currentSession) { delete o.currentSession.provider_token; delete o.currentSession.provider_refresh_token; } v = JSON.stringify(o); } } catch (e) { /* not JSON */ } try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    removeItem: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function rowToPlace(r) {
    const wc = r.wheelchair || {};
    const date = (d) => d || null;
    return {
      id: r.id, status: r.record_status, name: { en: r.name_en, ar: r.name_ar || r.name_en }, cat: r.category, kind: r.kind, area: r.area,
      address: r.address_en || r.address_ar ? { en: r.address_en || r.address_ar, ar: r.address_ar || r.address_en } : null,
      coords: r.lat !== null && r.lat !== undefined ? { lat: r.lat, lng: r.lng, source: r.coords_source, checked: date(r.coords_checked_at) } : null,
      price: r.price_amount !== null && r.price_amount !== undefined ? { amount: +r.price_amount, basis: r.price_basis || "per_person", min: r.price_min !== null && r.price_min !== undefined ? +r.price_min : null, open: r.price_open === true } : null,
      includes: { transport: r.includes_transport, taxes: r.includes_taxes },
      pets: { policy: r.pet_policy, types: r.pet_types || [], restrictions: r.pet_restrictions_en || r.pet_restrictions_ar ? { en: r.pet_restrictions_en || "", ar: r.pet_restrictions_ar || r.pet_restrictions_en || "" } : null, source: r.pet_source, checked: date(r.pet_checked_at) },
      wheelchair: { stepFree: wc.step_free, ramp: wc.ramp, interior: wc.interior, groundFloor: wc.ground_floor, lift: wc.lift, toilet: wc.accessible_toilet, reachable: wc.reachable,
        restrictions: wc.restrictions_en || wc.restrictions_ar ? { en: wc.restrictions_en || "", ar: wc.restrictions_ar || wc.restrictions_en || "" } : null },
      access: r.access_features || [], accessSource: r.access_source, accessChecked: date(r.access_checked_at),
      contacts: r.contacts || {}, contactsSource: r.contacts_source, contactsChecked: date(r.contacts_checked_at),
      availability: r.availability_en || r.availability_ar ? { en: r.availability_en || r.availability_ar, ar: r.availability_ar || r.availability_en, checked: r.availability_checked_at } : null,
      bankOffers: Array.isArray(r.bank_offers) ? r.bank_offers.filter((o) => o && o.source && o.checked_at) : [],
      providerRating: r.provider_rating !== null && r.provider_rating !== undefined ? { value: +r.provider_rating, count: r.provider_rating_count, source: r.provider_rating_source } : null,
      tags: r.tags || [], note: r.note_en || r.note_ar ? { en: r.note_en || r.note_ar, ar: r.note_ar || r.note_en } : null,
      comesToYou: r.area === "Delivered" || r.area === "Comes to you"
    };
  }
  function errCode(e) {
    const m = String((e && (e.message || e.error_description || e.msg)) || e || "");
    const known = ["invite_invalid", "invite_revoked", "invite_expired", "invite_used_up", "invite_own", "trip_not_found", "not_a_member", "review_before_visit",
      "rating_out_of_range", "request_not_allowed", "request_not_found", "already_friends", "request_self", "trip_cancelled", "not_a_guest", "not_authenticated", "trip_owner_and_place_are_fixed"];
    for (const k of known) if (m.includes(k)) return k;
    if (/Invalid login credentials/i.test(m)) return "auth_invalid";
    if (/Email not confirmed/i.test(m)) return "auth_unconfirmed";
    if (/Password should be|weak password|password.*characters/i.test(m)) return "auth_weak_password";
    if (/rate limit|too many/i.test(m)) return "auth_rate_limited";
    if (/User already registered/i.test(m)) return "auth_exists";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "server_unreachable";
    return "server_error";
  }

  class ServerStore {
    constructor(cfg) { this.kind = "server"; this.cfg = cfg; this.caps = { accounts: true, friends: true, invites: true, sharedRatings: true }; this.user = null; this._places = null; this._names = {}; }
    async init() {
      if (!window.supabase || !window.supabase.createClient) await loadScript(SUPABASE_JS);
      this.sb = window.supabase.createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: strippedStorage, storageKey: "wishly.auth" }
      });
      const { data } = await this.sb.auth.getSession();
      this.user = data && data.session ? data.session.user : null;
      return this;
    }
    onAuth(cb) { this.sb.auth.onAuthStateChange((event, session) => { this.user = session ? session.user : null; cb(event, session); }); }
    get signedIn() { return !!this.user; }
    siteUrl() { return this.cfg.siteUrl || (location.origin + location.pathname); }
    async q(p) { const { data, error } = await p; if (error) throw new StoreError(errCode(error), error); return data; }
    async rpc(fn, args) { return this.q(this.sb.rpc(fn, args || {})); }
    need() { if (!this.user) throw new StoreError("not_authenticated"); }

    // auth -----------------------------------------------------------
    async usernameAvailable(name) { return this.rpc("username_available", { name }); }
    async signUp({ username, email, password }) {
      const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: this.siteUrl() } });
      if (error) throw new StoreError(errCode(error), error);
      return { needsConfirmation: !data.session };
    }
    async signIn(email, password) { return this.q(this.sb.auth.signInWithPassword({ email, password })); }
    async signOut() { await this.sb.auth.signOut(); this.user = null; }
    async resetPassword(email) { return this.q(this.sb.auth.resetPasswordForEmail(email, { redirectTo: this.siteUrl() })); }
    async updatePassword(password) { return this.q(this.sb.auth.updateUser({ password })); }
    async resendVerification(email) { return this.q(this.sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: this.siteUrl() } })); }
    async signInWith(provider, scopes) { return this.q(this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: this.siteUrl(), scopes } })); }
    async linkIdentity(provider, scopes) { return this.q(this.sb.auth.linkIdentity({ provider, options: { redirectTo: this.siteUrl(), scopes } })); }
    async identities() { const d = await this.q(this.sb.auth.getUserIdentities()); return (d && d.identities) || []; }
    async unlinkIdentity(identity) { return this.q(this.sb.auth.unlinkIdentity(identity)); }
    async myCard() { this.need(); const d = await this.q(this.sb.from("profiles").select("id,username,display_name").eq("id", this.user.id).maybeSingle()); return d || {}; }
    async setUsername(username) { this.need(); return this.q(this.sb.from("profiles").update({ username }).eq("id", this.user.id)); }
    async names(ids) {
      const missing = ids.filter((id) => !(id in this._names)); if (missing.length) {
        const rows = await this.q(this.sb.from("profiles").select("id,username,display_name").in("id", missing));
        for (const r of rows || []) this._names[r.id] = r.display_name || (r.username ? "@" + r.username : "");
        for (const id of missing) if (!(id in this._names)) this._names[id] = "";
      }
      const o = {}; for (const id of ids) o[id] = this._names[id]; return o;
    }

    // places ---------------------------------------------------------
    async places() {
      if (!this._places) { const rows = await this.q(this.sb.from("places").select("*").order("id")); this._places = (rows || []).map(rowToPlace); }
      return this._places;
    }
    async addPlace(row, evidence) { this.need(); await this.q(this.sb.from("places").upsert(row)); if (evidence && evidence.length) await this.q(this.sb.from("place_evidence").insert(evidence)); this._places = null; }
    async isAdmin() { return this.user ? this.rpc("is_admin") : false; }

    // profile --------------------------------------------------------
    async getProfile() {
      if (!this.user) return DEFAULT_PROFILE();
      const [card, priv] = await Promise.all([this.myCard(), this.q(this.sb.from("profile_private").select("data").eq("user_id", this.user.id).maybeSingle())]);
      const p = cleanProfile(priv && priv.data); if (!p.name && card.display_name) p.name = card.display_name; return p;
    }
    async saveProfile(p) {
      this.need(); const clean = cleanProfile(p);
      await this.q(this.sb.from("profile_private").upsert({ user_id: this.user.id, data: clean, updated_at: nowISO() }));
      await this.q(this.sb.from("profiles").update({ display_name: clean.name || null }).eq("id", this.user.id));
    }
    async listSaved() { if (!this.user) return []; return (await this.q(this.sb.from("saved_places").select("place_id"))).map((r) => r.place_id); }
    async setSaved(placeId, on) { this.need(); if (on) await this.q(this.sb.from("saved_places").upsert({ user_id: this.user.id, place_id: placeId })); else await this.q(this.sb.from("saved_places").delete().eq("place_id", placeId)); }

    // trips ----------------------------------------------------------
    async listTrips() {
      if (!this.user) return [];
      const rows = await this.q(this.sb.from("trips").select("*, trip_participants(*), reviews(*)").order("created_at", { ascending: false }));
      const ids = [...new Set(rows.flatMap((t) => t.trip_participants.map((p) => p.user_id)))];
      const names = ids.length ? await this.names(ids) : {};
      return rows.map((t) => {
        const me = t.trip_participants.find((p) => p.user_id === this.user.id) || {};
        const reviews = t.reviews.map((r) => ({ userId: r.user_id, me: r.user_id === this.user.id, name: names[r.user_id] || "", place: r.place_rating, org: r.organization_rating, transport: r.transport_rating, comment: r.comment || "", updatedAt: r.updated_at }));
        return { id: t.id, placeId: t.place_id, title: t.title || "", startsAt: t.starts_at, people: t.people, budgetPerPerson: t.budget_per_person !== null ? +t.budget_per_person : null,
          status: t.status, createdAt: t.created_at, completedAt: t.completed_at, role: t.owner_id === this.user.id ? "owner" : "guest", myVisitedAt: me.visited_at || null,
          participants: t.trip_participants.map((p) => ({ userId: p.user_id, me: p.user_id === this.user.id, name: names[p.user_id] || "", role: p.role, status: p.status, visitedAt: p.visited_at })),
          reviews, myReview: reviews.find((r) => r.me) || null };
      });
    }
    async createTrip(d) {
      this.need();
      const row = await this.q(this.sb.from("trips").insert({ owner_id: this.user.id, place_id: d.placeId, title: d.title || null, starts_at: d.startsAt || null, people: d.people || 1, budget_per_person: d.budgetPerPerson || null }).select().single());
      return { id: row.id };
    }
    async updateTrip(id, patch) {
      const m = {}; if ("title" in patch) m.title = patch.title || null; if ("startsAt" in patch) m.starts_at = patch.startsAt; if ("people" in patch) m.people = patch.people;
      if ("budgetPerPerson" in patch) m.budget_per_person = patch.budgetPerPerson; if ("status" in patch) m.status = patch.status;
      await this.q(this.sb.from("trips").update(m).eq("id", id));
    }
    async deleteTrip(id) { await this.q(this.sb.from("trips").delete().eq("id", id)); }
    async markVisited(id) { await this.rpc("mark_visited", { trip: id }); }
    async submitReview(tripId, r) {
      const res = await this.rpc("submit_review", { trip: tripId, place_rating: Math.round(+r.place), organization_rating: r.org ? Math.round(+r.org) : null,
        transport_rating: r.transport ? Math.round(+r.transport) : null, comment: r.comment || null });
      return { excluded: !!(res && res.excluded) };
    }
    async leaveTrip(id) { await this.rpc("leave_trip", { trip: id }); }
    async removeParticipant(trip, member) { await this.rpc("remove_participant", { trip, member }); }
    async createInvite(tripId) { const tok = await this.rpc("create_trip_invite", { trip: tripId }); return this.siteUrl() + "#invite=" + encodeURIComponent(tok); }
    async listInvites(tripId) { return this.q(this.sb.from("trip_invites").select("id,created_at,expires_at,revoked_at,uses,max_uses").eq("trip_id", tripId).order("created_at", { ascending: false })); }
    async revokeInvite(id) { await this.rpc("revoke_trip_invite", { invite_id: id }); }
    async previewInvite(token) { const rows = await this.rpc("preview_trip_invite", { token }); return rows && rows[0]; }
    async respondInvite(token, accept) { return this.rpc("respond_trip_invite", { token, accept }); }
    async groupSignals(tripId) {
      if (!this.user || !tripId) return {};
      const rows = await this.rpc("group_place_signals", { trip: tripId }); const o = {};
      for (const r of rows || []) o[r.place_id] = { avg: +r.avg_rating, count: +r.review_count }; return o;
    }

    // exclusions -------------------------------------------------------
    async listExclusions() { if (!this.user) return []; return (await this.q(this.sb.from("exclusions").select("*"))).map((e) => ({ placeId: e.place_id, reason: e.reason, at: e.created_at })); }
    async restoreExclusion(placeId) { await this.q(this.sb.from("exclusions").delete().eq("place_id", placeId)); }
    async hidePlace(placeId) { this.need(); await this.q(this.sb.from("exclusions").upsert({ user_id: this.user.id, place_id: placeId, reason: "manual" })); }

    // friends ---------------------------------------------------------
    async friends() {
      if (!this.user) return { friends: [], incoming: [], outgoing: [], invites: [] };
      const [fs, reqs, invs] = await Promise.all([this.q(this.sb.from("friendships").select("*")), this.q(this.sb.from("friend_requests").select("*").eq("status", "pending")),
        this.q(this.sb.from("friend_invites").select("id,created_at,expires_at,revoked_at,uses,max_uses").order("created_at", { ascending: false }))]);
      const other = (f) => (f.user_a === this.user.id ? f.user_b : f.user_a);
      const ids = [...new Set([...fs.map(other), ...reqs.map((r) => (r.from_user === this.user.id ? r.to_user : r.from_user))])];
      const names = ids.length ? await this.names(ids) : {};
      return { friends: fs.map((f) => ({ userId: other(f), name: names[other(f)] || "", since: f.created_at })),
        incoming: reqs.filter((r) => r.to_user === this.user.id).map((r) => ({ id: r.id, userId: r.from_user, name: names[r.from_user] || "", source: r.source })),
        outgoing: reqs.filter((r) => r.from_user === this.user.id).map((r) => ({ id: r.id, userId: r.to_user, name: names[r.to_user] || "", source: r.source })), invites: invs };
    }
    async createFriendInvite() { const tok = await this.rpc("create_friend_invite"); return this.siteUrl() + "#friend=" + encodeURIComponent(tok); }
    async revokeFriendInvite(id) { await this.rpc("revoke_friend_invite", { invite_id: id }); }
    async acceptFriendInvite(token) { return this.rpc("accept_friend_invite", { token }); }
    async sendFriendRequest(userId) { return this.rpc("send_friend_request", { target_user: userId }); }
    async respondFriendRequest(id, accept) { return this.rpc("respond_friend_request", { request_id: id, accept }); }
    async removeFriend(userId) { const a = this.user.id < userId ? this.user.id : userId, b = this.user.id < userId ? userId : this.user.id; await this.q(this.sb.from("friendships").delete().eq("user_a", a).eq("user_b", b)); }
    async facebookFriends(providerToken) {
      const { data, error } = await this.sb.functions.invoke("facebook-friends", { body: { provider_token: providerToken } });
      if (error) throw new StoreError("facebook_failed", error);
      return data || { matched: 0, requested: 0 };
    }

    async importGuest(doc) {
      this.need();
      const cur = await this.getProfile();
      const merged = Object.assign({}, doc.profile, { name: cur.name || doc.profile.name });
      await this.saveProfile(merged);
      const placeIds = new Set((await this.places()).map((p) => p.id));
      for (const id of Object.keys(doc.saved || {})) if (placeIds.has(id)) await this.setSaved(id, true);
      for (const [id, e] of Object.entries(doc.exclusions || {})) if (placeIds.has(id)) await this.hidePlace(id);
    }
    async deleteAll() { await this.rpc("delete_my_data"); }
  }

  W.stores = { GuestStore, ClaudeStore, ServerStore, StoreError, cleanProfile, DEFAULT_PROFILE, PREFS, NEED_IDS, rowToPlace, errCode, lsGet, lsSet, lsDel };
})(window.W = window.W || {});
