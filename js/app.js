/* Wishly app: UI, wiring and flows. Depends on config.js, i18n.js,
 * places.js, engine.js and stores.js (all classic scripts on window.W). */
(function (W) {
  "use strict";
  const E = W.engine, ST = W.stores, CFG = window.WISHLY_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- state ---------------- */
  const S = {
    lang: "en", set: { size: 0, contrast: false, dark: false, read: false, simple: false, spacing: false, motion: false, vlang: "en-US" },
    store: null, server: null, claudeStore: null, places: W.DEMO_PLACES, profile: ST.DEFAULT_PROFILE(),
    saved: new Set(), exclusions: [], trips: [], friends: null,
    device: null, loc: "idle", locAccuracy: null, budgetEntered: null,
    results: null, lastConstraints: null, groupTrip: null, groupSignals: {}, tripTab: "trips", pic: {}, busy: false,
    recovery: false, pendingFacebook: false
  };
  W.app = { S };

  /* ---------------- i18n ---------------- */
  W.missingKeys = new Set();
  function t(key, vars) {
    const d = W.I18N[S.lang] || W.I18N.en;
    let s = d[key]; if (s === undefined) { s = W.I18N.en[key]; W.missingKeys.add(S.lang + ":" + key); }
    if (s === undefined) { W.missingKeys.add("en:" + key); s = key; }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  }
  const nf = () => new Intl.NumberFormat(S.lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 0 });
  const num = (n) => nf().format(Math.round(n));
  const num1 = (n) => new Intl.NumberFormat(S.lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 1 }).format(n);
  const egp = (n) => t("egp", { n: num(n) });
  const pn = (p) => (p.name && (p.name[S.lang] || p.name.en)) || p.id;
  const an = (a) => (S.lang === "ar" ? (W.AREA_AR[a] || a) : a);
  const loc = (o) => (o ? (o[S.lang] || o.en || "") : "");
  const byId = (id) => S.places.find((p) => p.id === id);
  const dateOnly = (d) => (d ? new Intl.DateTimeFormat(S.lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d)) : "");

  function announce(msg) { const l = $("#live"); l.textContent = ""; setTimeout(() => { l.textContent = msg; }, 60); }
  let toastT;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 3600); }
  function errMsg(e) { const code = (e && e.code) || "server_error"; const k = "err_" + code; return (W.I18N.en[k] ? t(k) : t("err_server_error")); }

  /* ---------------- settings ---------------- */
  function applySettings() {
    const h = document.documentElement, st = S.set;
    h.dataset.size = String(st.size);
    if (st.contrast) h.dataset.contrast = "high"; else delete h.dataset.contrast;
    // only remove a theme this app set itself, never one chosen by the host page
    if (st.dark) { h.dataset.theme = "dark"; h.dataset.wishlyTheme = "1"; } else if (h.dataset.wishlyTheme) { delete h.dataset.theme; delete h.dataset.wishlyTheme; }
    h.dataset.simple = st.simple ? "on" : "off"; h.dataset.spacing = st.spacing ? "on" : "off"; h.dataset.motion = st.motion ? "reduce" : "auto";
    $$("[data-action=size]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.size === st.size)));
    $$("[data-action=vlang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vlang === st.vlang)));
    $$(".switch").forEach((b) => b.setAttribute("aria-checked", String(!!st[b.dataset.set])));
    ST.lsSet("wishly.settings", st);
  }

  function localize() {
    const ar = S.lang === "ar", h = document.documentElement;
    h.lang = ar ? "ar" : "en"; h.dir = ar ? "rtl" : "ltr";
    document.title = t("docTitle");
    $("#langBtn").textContent = ar ? "English" : "العربية"; $("#langBtn").lang = ar ? "en" : "ar";
    $("#langBtn").setAttribute("aria-label", t("switchLang"));
    $$("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    $$("[data-t-attr]").forEach((el) => el.dataset.tAttr.split(";").forEach((pair) => { const [a, k] = pair.split(":"); el.setAttribute(a, t(k)); }));
    renderAreaSelects(); renderGreeting(); renderCats(); renderIdeas(); renderPic(); renderProfile(); renderAccountButton();
    updateTotalLine(); renderLocStatus(); renderNeedsNote();
    if (S.understood) renderUnderstood(S.understood);
    if (S.results) renderMatches();
    if (!$("#view-trips").hidden) renderTrips();
  }

  /* ---------------- views ---------------- */
  function go(view, opts) {
    ["wish", "matches", "trips", "profile"].forEach((v) => { $("#view-" + v).hidden = v !== view; });
    $$("[data-action=go]").forEach((b) => { if (b.closest(".topnav,.tabbar")) b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"); });
    if (view === "trips") renderTrips();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
    const hd = $("#view-" + view + " h1"); if (hd && !(opts && opts.noFocus)) { hd.setAttribute("tabindex", "-1"); hd.focus({ preventScroll: true }); }
  }

  /* ---------------- dialogs ---------------- */
  let lastFocus = null;
  function openDialog(title, html, opts) {
    const d = $("#dlg");
    if (!d.open) lastFocus = document.activeElement;
    $("#dlgTitle").textContent = title; $("#dlgBody").innerHTML = html;
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
    const first = opts && opts.focus ? $(opts.focus, d) : null; if (first) first.focus();
    return d;
  }
  function closeDialog(d) { d = d || $("#dlg"); if (d.close) d.close(); else d.removeAttribute("open"); }
  ["#dlg", "#a11yDlg"].forEach((s) => $(s).addEventListener("close", () => { if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); lastFocus = null; }));

  /* ---------------- boot: choose the data store ---------------- */
  async function boot() {
    const st = ST.lsGet("wishly.settings"); if (st) Object.assign(S.set, st);
    if (!["en-US", "ar-EG"].includes(S.set.vlang)) S.set.vlang = "en-US";
    S.lang = ST.lsGet("wishly.lang") === "ar" ? "ar" : "en";
    applySettings();
    S.store = await new ST.GuestStore().init();
    await loadData();
    localize();
    if (!Rec) $("#micBtn").setAttribute("aria-label", t("speakWishUnavailable"));
    // Wishly server (Supabase)
    if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
      try {
        S.server = await new ST.ServerStore(CFG).init();
        S.server.onAuth(onAuthEvent);
        try { S.places = await S.server.places(); S.realCatalog = S.places.some((p) => p.status !== "demo"); } catch (e) { bootNotice(t("serverPlacesFailed")); }
        if (S.server.signedIn) await useServer(); else localize();
      } catch (e) { S.server = null; bootNotice(t("serverUnreachable")); }
    } else {
      // claude.ai: the viewer's private storage, if this page is hosted there
      tryClaude();
    }
    handleHash();
    setInterval(checkLocationExpiry, 30000);
  }
  function bootNotice(msg) { $("#bootNotice").innerHTML = `<div class="notice" role="status">${esc(msg)}</div>`; }
  async function tryClaude() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (!db || !user) return;
      const id = await user.id(); if (!id) return;
      const cs = await new ST.ClaudeStore(db, id).init();
      const hadGuest = ST.GuestStore.hasData();
      S.claudeStore = cs; S.store = cs; await loadData(); localize();
      if (hadGuest) toast(t("claudeGuestNote"));
    } catch (e) { /* view-only viewers or unavailable storage: stay in guest mode */ }
  }
  async function useServer() { S.store = S.server; await loadData(); localize(); }
  async function useGuest() { S.store = S.claudeStore || await new ST.GuestStore().init(); await loadData(); localize(); }
  async function loadData() {
    try {
      S.profile = await S.store.getProfile();
      S.saved = new Set(await S.store.listSaved());
      S.exclusions = await S.store.listExclusions();
      S.trips = await S.store.listTrips();
    } catch (e) { toast(errMsg(e)); }
    applyProfileDefaultsToForm();
  }
  async function refreshTrips() { try { S.trips = await S.store.listTrips(); S.exclusions = await S.store.listExclusions(); } catch (e) { toast(errMsg(e)); } }
  function excludedSet() { return new Set(S.exclusions.map((e) => e.placeId)); }

  async function onAuthEvent(event, session) {
    if (event === "PASSWORD_RECOVERY") { S.recovery = true; openAccount(); return; }
    if (event === "SIGNED_IN" && session) {
      if (sessionStorage.getItem("wishly.fbFriends") === "1" && session.provider_token) {
        sessionStorage.removeItem("wishly.fbFriends");
        const token = session.provider_token; // used once, never stored
        S.server.facebookFriends(token).then((r) => toast(t("fbResult", { n: num(r.matched || 0) }))).catch((e) => toast(errMsg(e)));
      }
      if (S.store !== S.server) { await useServer(); const pending = sessionStorage.getItem("wishly.pendingHash"); if (pending) { sessionStorage.removeItem("wishly.pendingHash"); handleHash(pending); } }
      if ($("#dlg").open && $("#dlgTitle").textContent === t("accountTitle")) openAccount();
    }
    if (event === "SIGNED_OUT") { await useGuest(); }
  }

  /* ---------------- invitation links (#invite=, #friend=) ---------------- */
  function handleHash(raw) {
    const h = raw || location.hash;
    const m = /^#(invite|friend)=([A-Za-z0-9_\-%]+)$/.exec(h || "");
    if (!m) return;
    if (!raw) history.replaceState(null, "", location.pathname + location.search); // don't leave the token in the address bar
    const kind = m[1], token = decodeURIComponent(m[2]);
    if (!S.server) { openDialog(t(kind === "invite" ? "inviteTitle" : "friendInviteTitle"), `<p role="status">${esc(t("inviteNeedsServer"))}</p>`); return; }
    if (!S.server.signedIn) {
      sessionStorage.setItem("wishly.pendingHash", "#" + kind + "=" + encodeURIComponent(token));
      openDialog(t(kind === "invite" ? "inviteTitle" : "friendInviteTitle"), `<p>${esc(t("inviteSignInFirst"))}</p><div class="row"><button class="btn primary" data-action="account">${esc(t("signIn"))}</button></div>`);
      return;
    }
    if (kind === "invite") showInvite(token); else showFriendInvite(token);
  }
  async function showInvite(token) {
    try {
      const p = await S.server.previewInvite(token);
      const place = byId(p.place_id);
      openDialog(t("inviteTitle"), `<p>${esc(t("inviteFrom", { name: p.organizer || t("someone") }))}</p>
        <div class="dest"><b>${esc(S.lang === "ar" ? (p.place_name_ar || p.place_name_en) : p.place_name_en)}</b><small>${esc(an(p.area))}${p.starts_at ? " · " + esc(E.formatCairo(p.starts_at, S.lang)) + " " + esc(t("cairoTime")) : ""} · ${esc(ppl(p.people))}${p.budget_per_person ? " · " + esc(t("ppShort", { v: egp(p.budget_per_person) })) : ""}</small></div>
        ${place && place.status === "demo" ? `<p class="demo-banner">${esc(t("demoPlaceNote"))}</p>` : ""}
        ${p.my_status ? `<p>${esc(t("inviteYourStatus", { s: t("pstatus_" + p.my_status) }))}</p>` : ""}
        <p class="mini">${esc(t("invitePrivacy"))}</p>
        <div class="row"><button class="btn primary" data-action="inviteRespond" data-token="${esc(token)}" data-accept="1">${esc(t("accept"))}</button><button class="btn" data-action="inviteRespond" data-token="${esc(token)}" data-accept="0">${esc(t("decline"))}</button></div>`);
    } catch (e) { openDialog(t("inviteTitle"), `<p role="alert" class="err">${esc(errMsg(e))}</p>`); }
  }
  async function showFriendInvite(token) {
    openDialog(t("friendInviteTitle"), `<p>${esc(t("friendInviteBody"))}</p><div class="row"><button class="btn primary" data-action="friendAccept" data-token="${esc(token)}">${esc(t("accept"))}</button><button class="btn" data-action="closeDialog">${esc(t("notNow"))}</button></div>`);
  }

  /* ---------------- greeting, chips, ideas, picture wish ---------------- */
  function renderGreeting() {
    const hr = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const part = t(hr < 12 ? "goodMorning" : hr < 18 ? "goodAfternoon" : "goodEvening");
    const n = (S.profile.name || "").trim();
    $("#greet").textContent = n ? part + (S.lang === "ar" ? "، " : ", ") + n : part;
    const ini = n ? n[0].toUpperCase() : t("me"); $("#bigAv").textContent = ini;
  }
  const CAT_IC = { Shopping: "🛍️", Food: "🍽️", Experiences: "✨", Services: "🧰", Travel: "✈️", Learning: "📚" };
  function renderCats() { $("#cats").innerHTML = E.CATS.map((c) => `<button class="chip" data-action="cat" data-cat="${c}"><span class="ic" aria-hidden="true">${CAT_IC[c]}</span>${esc(t("cat_" + c))}</button>`).join(""); }
  const IDEAS = ["idea1", "idea2", "idea3", "idea4"];
  function renderIdeas() { $("#ideas").innerHTML = IDEAS.map((k) => `<button class="idea" data-action="idea" data-idea="${k}"><small>${esc(t(k + "Tag"))}</small><b>${esc(t(k + "Title"))}</b><span>${esc(t(k + "Meta"))}</span></button>`).join(""); }
  const PIC = { what: [["food", "🍽️"], ["outing", "✨"], ["gift", "🎁"], ["learn", "📚"], ["trip", "✈️"], ["relax", "🛁"]], who: [["me", "🙋"], ["two", "👫"], ["family", "👨‍👩‍👧"], ["friends", "🎉"]],
    budget: [["low", "💵"], ["mid", "💵💵"], ["high", "💵💵💵"]], feel: [["calm", "😌"], ["happy", "😄"], ["curious", "🤔"], ["special", "💖"]] };
  function renderPic() { $$(".tiles").forEach((el) => { const g = el.dataset.group; el.innerHTML = PIC[g].map(([v, e]) => `<button type="button" class="tile" data-action="tile" data-g="${g}" data-v="${v}" aria-pressed="${S.pic[g] === v}"><span class="em" aria-hidden="true">${e}</span>${esc(t("pic_" + g + "_" + v))}</button>`).join(""); }); }
  function picText() {
    const p = S.pic, parts = [t("picI")];
    parts.push(p.what ? t("pict_what_" + p.what) : t("pict_something"));
    if (p.who) parts.push(t("pict_who_" + p.who)); if (p.budget) parts.push(t("pict_budget_" + p.budget)); if (p.feel) parts.push(t("pict_feel_" + p.feel));
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /* ---------------- search panel ---------------- */
  function renderAreaSelects() {
    const cur = $("#fArea").value, pcur = S.profile.area;
    $("#fArea").innerHTML = `<option value="">${esc(t("anyArea"))}</option>` + W.AREAS.map((a) => `<option value="${esc(a)}">${esc(an(a))}</option>`).join("");
    $("#fArea").value = cur;
    $("#pArea").innerHTML = `<option value="">${esc(t("areaNotSet"))}</option>` + W.AREAS.map((a) => `<option value="${esc(a)}">${esc(an(a))}</option>`).join(""); $("#pArea").value = pcur;
  }
  function setSrc(el, src) { el.dataset.src = src || ""; const lab = el.closest("label"); if (!lab) return; let m = $(".from-text", lab); if (src === "text") { if (!m) { m = document.createElement("span"); m.className = "from-text"; lab.appendChild(m); } m.textContent = t("fromWish"); } else if (m) m.remove(); }
  function applyProfileDefaultsToForm() {
    const p = S.profile;
    if (!$("#fPeople").dataset.src || $("#fPeople").dataset.src === "profile") { $("#fPeople").value = p.groupSize || 1; $("#fPeople").dataset.src = "profile"; }
    if (!S.budgetEntered && p.budgetPerPerson > 0) { $("#fPP").value = p.budgetPerPerson; $("#fPP").dataset.src = "profile"; }
    if (!$("#fPet").dataset.src || $("#fPet").dataset.src === "profile") { $("#fPet").checked = !!(p.petOwner && p.bringPetByDefault); $("#fPet").dataset.src = "profile"; }
    $("#fPetType").value = p.petType || "dog"; $("#fPetTypeWrap").hidden = !$("#fPet").checked;
    if (!$("#fWheel").dataset.src || $("#fWheel").dataset.src === "profile") { $("#fWheel").checked = p.needs.includes("mobility"); $("#fWheel").dataset.src = "profile"; }
    updateTotalLine(); renderNeedsNote();
  }
  function peopleVal() { const v = Math.round(+$("#fPeople").value); return v >= 1 && v <= 20 ? v : null; }
  function updateTotalLine() {
    const people = peopleVal() || 1, pp = +$("#fPP").value, tot = +$("#fTotal").value;
    if (S.budgetEntered === "total" && tot > 0) $("#fPP").value = Math.round(tot / people);
    else if (pp > 0) $("#fTotal").value = Math.round(pp * people);
    const ppv = +$("#fPP").value, tv = +$("#fTotal").value;
    $("#totalLine").textContent = ppv > 0 ? t("totalLine", { pp: egp(S.budgetEntered === "total" ? tv / people : ppv), n: num(people), total: egp(S.budgetEntered === "total" ? tv : ppv * people) }) : t("noBudget", { n: num(people) });
  }
  function renderNeedsNote() {
    const other = S.profile.needs.filter((n) => n !== "mobility");
    $("#needsNote").textContent = other.length ? t("profileNeedsApplied", { list: other.map((n) => t("need_" + n)).join(S.lang === "ar" ? "، " : ", ") }) : "";
  }
  function readForm(includeText) {
    const ok = (el) => el.dataset.src === "user" || (includeText && el.dataset.src === "text");
    const people = peopleVal();
    const f = {
      areaSet: ok($("#fArea")), area: $("#fArea").value,
      locationMode: S.device ? "device" : "area", device: S.device, radiusKm: +$("#fRadius").value || 5,
      peopleSet: ok($("#fPeople")) && !!people, people: people || 1,
      budgetMode: $("#fMode").value,
      perPersonSet: S.budgetEntered === "pp" && ok($("#fPP")) && +$("#fPP").value > 0, perPerson: +$("#fPP").value,
      totalSet: S.budgetEntered === "total" && ok($("#fTotal")) && +$("#fTotal").value > 0, total: +$("#fTotal").value,
      petSet: ok($("#fPet")), petAccompanying: $("#fPet").checked, petType: $("#fPetType").value,
      wheelchairSet: ok($("#fWheel")), wheelchair: $("#fWheel").checked
    };
    // a profile budget shown in the field counts only as a default
    if ($("#fPP").dataset.src === "profile") { f.perPersonSet = false; }
    return f;
  }
  function validateForm() {
    const errs = [];
    if ($("#fPeople").value && !peopleVal()) errs.push(t("vPeople"));
    if (+$("#fPP").value < 0 || +$("#fTotal").value < 0) errs.push(t("vBudget"));
    return errs;
  }

  /* Step 1: read the wish, fill the empty fields, show what was understood */
  function understandWish(text) {
    text = (text || "").trim();
    const parsed = E.parseWish(text);
    const c = E.buildConstraints(parsed, readForm(false), S.profile);
    // write values from the wish into fields the person has not set themselves
    if (c.fromText.area && $("#fArea").dataset.src !== "user" && !S.device) { $("#fArea").value = c.fromText.area; setSrc($("#fArea"), "text"); }
    if (c.fromText.people && $("#fPeople").dataset.src !== "user") { $("#fPeople").value = c.fromText.people; setSrc($("#fPeople"), "text"); }
    if (c.fromText.budget) {
      if (c.fromText.budget.basis === "per_person") { S.budgetEntered = "pp"; $("#fPP").value = c.fromText.budget.amount; setSrc($("#fPP"), "text"); setSrc($("#fTotal"), ""); }
      else { S.budgetEntered = "total"; $("#fTotal").value = c.fromText.budget.amount; setSrc($("#fTotal"), "text"); setSrc($("#fPP"), ""); }
      $("#fMode").value = c.fromText.budget.mode === "over" ? "over" : c.fromText.budget.mode === "around" ? "around" : "cap";
    }
    if ("pet" in c.fromText && $("#fPet").dataset.src !== "user") { $("#fPet").checked = c.fromText.pet; setSrc($("#fPet"), "text"); $("#fPetTypeWrap").hidden = !$("#fPet").checked; if (c.pet.type) $("#fPetType").value = c.pet.type; }
    if (parsed.needs.includes("mobility") && $("#fWheel").dataset.src !== "user") { $("#fWheel").checked = true; setSrc($("#fWheel"), "text"); }
    updateTotalLine();
    S.understood = { text, parsed, conflicts: c.conflicts, basisAssumed: c.budget && c.budget.basisAssumed };
    renderUnderstood(S.understood);
    $("#searchPanel").classList.add("review");
    const h = $("#h-search"); h.textContent = t("checkTitle"); h.focus();
    announce(t("checkAnnounce"));
  }
  function renderUnderstood(u) {
    const chips = [];
    u.parsed.cats.forEach((c) => chips.push(t("cat_" + c)));
    if (u.parsed.kind) chips.push(t("kind_" + u.parsed.kind));
    u.parsed.moods.forEach((m) => chips.push(t("mood_" + m)));
    u.parsed.needs.forEach((n) => chips.push(t("need_" + n)));
    let html = u.text ? `<p><b>${esc(t("understoodTitle"))}</b> <q dir="auto">${esc(u.text)}</q></p>` : "";
    if (chips.length) html += `<div class="understood" aria-label="${esc(t("understoodTitle"))}">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>`;
    if (u.basisAssumed) html += `<p class="conflict">${esc(t("basisAssumed"))}</p>`;
    html += u.conflicts.map((c) => `<p class="conflict">${esc(conflictText(c))}</p>`).join("");
    $("#understood").innerHTML = html;
  }
  function conflictText(c) {
    if (c.field === "area") return t("conflictArea", { text: an(c.text), used: c.used === "device" ? t("deviceLocation") : c.used === "any" ? t("anyArea") : an(c.used) });
    if (c.field === "people") return t("conflictPeople", { text: num(c.text), used: num(c.used) });
    if (c.field === "budget") return t("conflictBudget", { text: egp(c.text), used: egp(c.used) });
    if (c.field === "pet") return t(c.used ? "conflictPetOn" : "conflictPetOff");
    return "";
  }

  /* Step 2: search with exactly what the fields say */
  async function runSearch(opts) {
    if (S.busy) return;
    const errs = validateForm(); if (errs.length) { toast(errs.join(" ")); return; }
    if (S.device && Date.now() - S.device.at > LOC_MAX_AGE) { expireLocation(); toast(t("locExpired")); return; }
    S.busy = true; $("#searchBtn").disabled = true;
    try {
      const text = $("#wish").value.trim();
      const c = E.buildConstraints(E.parseWish(text), readForm(true), S.profile);
      if (opts && opts.expand === "any") c.where = { mode: "any" };
      if (opts && opts.radius && c.where.mode === "device") c.where.radiusKm = opts.radius;
      const ctx = { excluded: excludedSet(), groupSignals: S.groupTrip ? S.groupSignals : {} };
      const r = E.search(searchPool(), c, ctx);
      S.results = Object.assign(r, { c, text, expandedFrom: opts && opts.expandedFrom });
      S.lastConstraints = c;
      if (!(opts && opts.stay)) go("matches");
      renderMatches();
    } catch (e) {
      $("#matchArea").innerHTML = `<div class="status" role="alert">${esc(t("searchFailed"))}</div>`;
      console.error(e);
    } finally { S.busy = false; $("#searchBtn").disabled = false; }
  }

  /* ---------------- results ---------------- */
  // once real (sourced or verified) places exist, the fictional demo records stay out of results
  function searchPool() { if (!S.realCatalog) return S.places; const real = S.places.filter((p) => p.status !== "demo"); return real.length ? real : S.places; }
  function ppl(n) { return n === 1 ? t("peopleOne") : n === 2 && S.lang === "ar" ? t("peopleTwo") : t("peopleN", { n: num(n) }); }
  function costLine(cost) {
    if (!cost) return t("priceUnknown");
    if (cost.perPerson && (cost.open || cost.min !== null)) {
      // Google lists ranges like "E£1–200": a lower end of 1 just means "up to 200"
      const lo = cost.open ? cost.unit : cost.min > 1 ? cost.min : null, one = cost.people === 1;
      const v = { min: num(lo || 0), max: num(cost.unit), n: num(cost.people), minTotal: num((lo || 0) * cost.people), total: num(cost.total) };
      const key = cost.open ? "costFrom" : lo ? "costRange" : "costUpTo";
      return t(key + (one ? "1" : ""), v);
    }
    if (cost.perPerson) return t("costPP", { unit: egp(cost.unit), n: num(cost.people), total: egp(cost.total) });
    return t("costFixed", { unit: egp(cost.unit), basis: t("basis_" + cost.basis) });
  }
  function includesLine(p) { const inc = p.includes || {}; return t("includesLine", { transport: t("inc_" + (inc.transport || "unknown")), taxes: t("inc_" + (inc.taxes || "unknown")) }); }
  function reqText(x) {
    const v = x.v;
    switch (x.code) {
      case "category": return t("req_category", { v: t("cat_" + v) });
      case "kind": return t("req_kind", { v: t("kind_" + v) });
      case "area": return t("req_area", { v: an(v) });
      case "radius": return t("req_radius", { km: num1(v) });
      case "comes_to_you": return t("req_comes");
      case "comes_to_you_access": return t("req_comes_access");
      case "budget": return t("req_budget", { v: egp(v) });
      case "budget_min": return t("req_budget_min", { v: egp(v) });
      case "pets_ok": return t(x.listed ? "req_pets_listed" : "req_pets_ok", { v: t(v === "other" ? "otherPet" : v) });
      case "wheelchair_ok": return t(x.listed ? "req_wheel_listed" : "req_wheel_ok");
      case "access_ok": return t(x.listed ? "req_access_listed" : "req_access_ok", { v: t("need_" + v) });
      case "pets_unconfirmed": return t({ type: "unk_pets_type", claimed: "unk_pets_claimed" }[v] || "unk_pets");
      case "wheelchair_unconfirmed": return t("unk_wheel", { list: v.map((k) => t(k)).join(S.lang === "ar" ? "، " : ", ") });
      case "access_unconfirmed": return t(x.claimed ? "unk_access_claimed" : "unk_access", { v: t("need_" + v) });
      case "price_unknown": return t("unk_price");
      default: return t("fail_" + x.code);
    }
  }
  function reqList(ev) {
    const li = (cls, mark, text, sr) => `<li><span class="st ${cls}" aria-hidden="true">${mark}</span><span><span class="sr-only">${esc(sr)}: </span>${esc(text)}</span></li>`;
    return `<ul class="reqs" aria-label="${esc(t("reqsLabel"))}">${ev.met.map((x) => li("met", "✓", reqText(x), t("srMet"))).join("")}${ev.unknowns.map((x) => li("unknown", "?", reqText(x), t("srUnknown"))).join("")}${ev.failures.map((x) => li("fail", "✗", t("fail_" + x.code), t("srFailed"))).join("")}</ul>`;
  }
  function partText(p) {
    const v = p.v;
    switch (p.code) {
      case "category": return t("part_category", { v: t("cat_" + v) });
      case "kind": return t("part_kind", { v: t("kind_" + v) });
      case "mood": return t("part_mood", { v: v.map((m) => t("mood_" + m)).join(S.lang === "ar" ? "، " : ", ") });
      case "pref": return t("part_pref", { v: t("pref_" + v) });
      case "pref_near": return t("part_near", { v: num(v) });
      case "budget_fit": return t("part_budget_fit");
      case "budget_under": return t("part_budget_under");
      case "distance": return t("part_distance", { km: num1(v) });
      case "access_extra": return t("part_access_extra", { n: num(v) });
      case "group_rating": return t("part_group", { avg: num1(v.avg), n: num(v.count) });
      case "missing_info": return t("part_missing", { n: num(v) });
      default: return t("part_" + p.code);
    }
  }
  function whyBlock(x) {
    const p = x.place;
    return `<details class="why"><summary>${esc(t("whyScore", { s: num(x.score) }))}</summary>
      <ul class="parts">${x.parts.map((pt) => `<li><span>${esc(partText(pt))}</span><b dir="ltr">${pt.pts > 0 ? "+" : ""}${pt.pts}</b></li>`).join("")}</ul>
      <p class="mini">${esc(t("scoreVsRating"))} ${p.providerRating ? esc(t("providerRating", { v: num1(p.providerRating.value), n: num(p.providerRating.count || 0), src: p.providerRating.source || "" })) : esc(t("noProviderRating"))}</p></details>`;
  }
  function distLine(x, c) {
    if (x.ev.distance !== null) return t("kmAway", { km: num1(x.ev.distance) });
    if (x.place.comesToYou) return t(x.place.area === "Delivered" ? "deliveredToYou" : "comesToYou");
    const est = E.areaEstimate(x.place, c.startArea || S.profile.area);
    return est ? t("estimateFrom", { mins: num(est.mins), area: an(c.startArea || S.profile.area) }) : "";
  }
  function canNavigate(p) { return !!(p.coords && E.evidenceOk(p, "coords")) || !!(p.contacts && p.contacts.mapUrl && p.status !== "demo"); }
  function card(x, label, cls, ask) {
    const p = x.place, c = S.results.c;
    return `<li class="card${ask ? " ask-card" : ""}">
      <div class="score ${cls}" aria-hidden="true"><b>${num(x.score)}</b><small>${esc(label)}</small></div>
      <div>
        <h3>${esc(pn(p))} ${p.status === "demo" ? `<span class="badge demo">${esc(t("demoBadge"))}</span>` : `<span class="badge ok">${esc(t("status_" + p.status))}</span>`}<span class="sr-only">. ${esc(label)}, ${esc(t("wishScoreSr", { s: num(x.score) }))}</span></h3>
        <p class="meta">${esc(t("cat_" + p.cat))} · ${esc(an(p.area))} · ${esc(costLine(x.ev.cost))}${distLine(x, c) ? " · " + esc(distLine(x, c)) : ""}</p>
        ${reqList(x.ev)}
        ${S.set.simple ? "" : whyBlock(x)}
        <div class="row" style="margin-top:4px">
          <button class="btn small primary" data-action="details" data-id="${p.id}">${esc(t("details"))}</button>
          ${ask || x.ev.unknowns.length ? `<button class="btn small" data-action="ask" data-id="${p.id}">${esc(t("askPlace"))}</button>` : ""}
          <button class="btn small" data-action="save" data-id="${p.id}" aria-pressed="${S.saved.has(p.id)}">${esc(t(S.saved.has(p.id) ? "saved" : "save"))}</button>
          <button class="btn small" data-action="plan" data-id="${p.id}">${esc(t("planTrip"))}</button>
          <button class="btn small" data-action="ride" data-id="${p.id}">${esc(t(canNavigate(p) ? "getThere" : "locationUnverified"))}</button>
          <button class="btn small advanced" data-action="speak" data-id="${p.id}"><span aria-hidden="true">🔊</span> ${esc(t("readAloudBtn"))}</button>
        </div>
      </div></li>`;
  }
  function constraintChips(c) {
    const chips = [];
    if (c.where.mode === "area") chips.push(t("chipArea", { v: an(c.where.area) }));
    else if (c.where.mode === "device") chips.push(t("chipRadius", { km: num(c.where.radiusKm) }));
    else chips.push(t("anyArea"));
    chips.push(ppl(c.people));
    if (c.budget) chips.push(t(c.budget.mode === "over" ? "chipBudgetMin" : c.budget.mode === "around" ? "chipBudgetAround" : "chipBudget", { pp: egp(c.budget.perPerson), n: num(c.people), total: egp(c.budget.total) }));
    c.cats.forEach((x) => chips.push(t("cat_" + x))); if (c.kind) chips.push(t("kind_" + c.kind));
    if (c.pet.accompanying) chips.push(t("chipPet", { v: t(c.pet.type === "other" ? "otherPet" : c.pet.type) }));
    c.needs.forEach((n) => chips.push(t(n === "mobility" ? "chipWheel" : "chipNeed", { v: t("need_" + n) })));
    return chips;
  }
  function renderMatches() {
    const r = S.results; if (!r) return; const c = r.c;
    const label = (x, i) => (i === 0 ? [t("bestFit"), ""] : x.id === valueId ? [t("bestValue"), "value"] : [t("goodOption"), "other"]);
    const rest = r.confirmed.slice(1);
    const valueId = rest.length ? rest.reduce((a, b) => ((a.ev.cost ? a.ev.cost.total : 1e12) <= (b.ev.cost ? b.ev.cost.total : 1e12) ? a : b)).place.id : null;
    r.confirmed.forEach((x) => { x.id = x.place.id; });
    let html = `<div class="query">${r.text ? `<q dir="auto">${esc(r.text)}</q>` : `<b>${esc(t("searchNoText"))}</b>`}<div class="intent" aria-label="${esc(t("usedConstraints"))}">${constraintChips(c).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
    html += c.conflicts.map((x) => `<p class="conflict">${esc(conflictText(x))}</p>`).join("");
    if (S.groupTrip) { const g = S.trips.find((x) => x.id === S.groupTrip); html += `<div class="notice" role="note"><b>${esc(t("groupContext"))}</b>${esc(t("groupContextBody", { place: g ? pn(byId(g.placeId) || { id: "" }) : "" }))} <button class="inline-btn" data-action="endGroup">${esc(t("endGroup"))}</button></div>`; }
    const pool = searchPool();
    if (pool.some((p) => p.status === "demo")) html += `<p class="demo-banner">${esc(t(pool.every((p) => p.status === "demo") ? "demoAll" : "demoSome"))}</p>`;
    else if (pool.some((p) => p.status === "sourced")) html += `<p class="notice">${esc(t("sourcedNote"))}</p>`;
    if (c.where.mode === "device") html += `<p class="engine">${esc(t("radiusNote", { n: num(r.excludedCounts.no_coords || 0) }))}</p>`;
    html += `<p class="engine">${esc(t("engineNote"))}</p>`;
    html += `<div class="group-h"><h2>${esc(t("confirmedTitle", { n: num(r.confirmed.length) }))}</h2></div>`;
    if (!r.confirmed.length) {
      html += `<div class="notice" role="status"><b>${esc(t("noMatchTitle"))}</b>${esc(t("noMatchBody"))}</div>`;
      const reasons = Object.entries(r.excludedCounts).filter(([k]) => k !== "excluded_by_you").sort((a, b) => b[1] - a[1]);
      if (reasons.length) html += `<p>${esc(t("whyNone"))}</p><ul class="reasons">${reasons.map(([k, n]) => `<li>${esc(t("fail_" + k))}: ${esc(num(n))}</li>`).join("")}</ul>`;
    } else {
      html += `<ol class="cards">${r.confirmed.map((x, i) => { const [l, cl] = label(x, i); return card(x, l, cl, false); }).join("")}</ol>`;
    }
    if (r.expandable) {
      html += `<div class="row">`;
      if (c.where.mode === "area") html += `<button class="btn" data-action="expandAny">${esc(t("expandAny", { n: num(r.expandable) }))}</button>`;
      if (c.where.mode === "device" && c.where.radiusKm < 50) html += `<button class="btn" data-action="expandRadius">${esc(t("expandRadius", { km: num(nextRadius(c.where.radiusKm)) }))}</button>`;
      html += `</div><p class="mini">${esc(t("expandNote"))}</p>`;
    }
    if (r.ask.length) {
      html += `<div class="group-h"><h2>${esc(t("askTitle", { n: num(r.ask.length) }))}</h2></div><p>${esc(t("askHelp"))}</p>`;
      html += `<ol class="cards">${r.ask.map((x) => card(x, t("needsCheck"), "other", true)).join("")}</ol>`;
    }
    if (r.personalExcluded.length) html += `<p class="engine">${esc(t("personalExcludedNote", { n: num(r.personalExcluded.length) }))} <button class="inline-btn" data-action="tripTab" data-tab="excluded">${esc(t("manageExcluded"))}</button></p>`;
    $("#matchArea").innerHTML = html;
    const msg = r.confirmed.length ? t("resultsAnnounce", { n: num(r.confirmed.length), top: pn(r.confirmed[0].place), s: num(r.confirmed[0].score) }) : t("noMatchAnnounce", { n: num(r.ask.length) });
    announce(msg);
    if (S.set.read) speak(msg);
  }
  function nextRadius(km) { return [1, 2, 5, 10, 20, 50].find((x) => x > km) || 50; }

  /* ---------------- place details ---------------- */
  function triState(v) { return v === true ? t("yes") : v === false ? t("no") : t("unknown"); }
  const SRC_KEYS = { "Google Maps listing": "srcGoogleListing" };
  function srcLine(source, checked) { return source && checked ? t("sourceLine", { src: SRC_KEYS[source] ? t(SRC_KEYS[source]) : source, date: dateOnly(checked) }) : t("noSource"); }
  function openDetails(id) {
    const p = byId(id); if (!p) return;
    const c = S.lastConstraints || E.buildConstraints(E.parseWish(""), readForm(true), S.profile);
    const ev = E.evaluatePlace(p, c, { excluded: excludedSet() });
    const w = p.wheelchair || {}, demo = p.status === "demo", pets = p.pets || { policy: "unknown" };
    const ct = p.contacts || {};
    const html = `
      <p>${esc(t("cat_" + p.cat))}${p.kind ? " · " + esc(t("kind_" + p.kind)) : ""} · ${demo ? `<span class="badge demo">${esc(t("demoBadge"))}</span>` : `<span class="badge ok">${esc(t("status_" + p.status))}</span>`}</p>
      ${demo ? `<p class="demo-banner">${esc(t("demoPlaceNote"))}</p>` : ""}
      ${p.note ? `<p>${esc(loc(p.note))}</p>` : ""}
      <div class="facts">
        <section class="fact"><h3>${esc(t("fLocation"))}</h3>
          <p>${esc(an(p.area))}${p.address ? " — " + esc(loc(p.address)) : ""}</p>
          <p>${canNavigate(p) ? esc(t({ verified: "coordsVerified" }[p.status] || "coordsListed")) : esc(t("coordsUnverified"))}</p>
          ${!demo && ct.mapUrl && safeUrl(ct.mapUrl) ? `<p><a href="${esc(safeUrl(ct.mapUrl))}" target="_blank" rel="noopener noreferrer">${esc(t("openListing"))}</a></p>` : ""}
          ${p.coords ? `<p class="src">${esc(srcLine(p.coords.source, p.coords.checked))}</p>` : ""}</section>
        <section class="fact"><h3>${esc(t("fPrice"))}</h3>
          <p>${esc(costLine(ev.cost))}</p><p>${esc(includesLine(p))}</p>${demo ? `<p class="src">${esc(t("demoPrice"))}</p>` : ""}</section>
        <section class="fact"><h3>${esc(t("fPets"))}</h3>
          <p>${esc(t("petPolicy_" + (pets.policy || "unknown")))}${pets.types && pets.types.length ? " (" + esc(pets.types.map((x) => t(x === "other" ? "otherPet" : x)).join(S.lang === "ar" ? "، " : ", ")) + ")" : ""}</p>
          ${pets.restrictions ? `<p>${esc(loc(pets.restrictions))}</p>` : ""}
          <p class="src">${esc(demo ? t("demoClaim") : srcLine(pets.source, pets.checked))}</p></section>
        <section class="fact"><h3>${esc(t("fAccess"))}</h3>
          <ul class="reqs">
            <li><span class="st" aria-hidden="true">•</span><span>${esc(t("wc_entrance"))}: ${esc(w.stepFree === true ? t("yes") : w.ramp === true ? t("rampOnly") : triState(w.stepFree))}</span></li>
            <li><span class="st" aria-hidden="true">•</span><span>${esc(t("wc_interior"))}: ${esc(triState(w.interior))}</span></li>
            <li><span class="st" aria-hidden="true">•</span><span>${esc(t("wc_level"))}: ${esc(w.groundFloor === true ? t("groundFloor") : w.lift === true ? t("liftYes") : w.reachable === true ? t("reachableYes") : w.groundFloor === false && w.lift === false ? t("no") : t("unknown"))}</span></li>
            <li><span class="st" aria-hidden="true">•</span><span>${esc(t("wc_toilet"))}: ${esc(triState(w.toilet))}</span></li>
          </ul>
          ${w.restrictions ? `<p>${esc(loc(w.restrictions))}</p>` : ""}
          ${(p.access || []).length ? `<p>${esc(t("featuresClaimed"))}: ${esc(p.access.map((a) => t("feat_" + a)).join(S.lang === "ar" ? "، " : ", "))}</p>` : ""}
          <p class="src">${esc(demo ? t("demoClaim") : srcLine(p.accessSource, p.accessChecked))}</p>
          <p class="mini">${esc(t("rampNote"))}</p></section>
        <section class="fact"><h3>${esc(t("fContact"))}</h3>${contactButtons(p, false) || `<p>${esc(t("noContacts"))}</p>`}
          ${ct.menu && safeUrl(ct.menu) ? `<p><a href="${esc(safeUrl(ct.menu))}" target="_blank" rel="noopener noreferrer">${esc(t("menu"))}</a></p>` : ""}
          ${p.contactsSource ? `<p class="src">${esc(srcLine(p.contactsSource, p.contactsChecked))}</p>` : ""}</section>
        <section class="fact"><h3>${esc(t("fAvailability"))}</h3><p>${p.availability ? esc(loc(p.availability)) + (p.availability.checked ? " — " + esc(t("checkedAt", { d: E.formatCairo(p.availability.checked, S.lang) })) : "") : esc(t("noAvailability"))}</p></section>
        <section class="fact"><h3>${esc(t("fBank"))}</h3>${(p.bankOffers || []).length ? p.bankOffers.map((o) => `<p>${esc(o.bank)}: ${esc(S.lang === "ar" ? (o.text_ar || o.text_en) : o.text_en)} <span class="src">${esc(srcLine(o.source, o.checked_at))}</span></p>`).join("") : `<p>${esc(t("noBankOffers"))}</p>`}</section>
        <section class="fact"><h3>${esc(t("fScore"))}</h3>${reqList(ev)}<p class="mini">${esc(t("scoreVsRating"))} ${p.providerRating ? esc(t("providerRating", { v: num1(p.providerRating.value), n: num(p.providerRating.count || 0), src: p.providerRating.source || "" })) : esc(t("noProviderRating"))}</p></section>
      </div>
      <div class="row">
        <button class="btn primary" data-action="plan" data-id="${p.id}">${esc(t("planTrip"))}</button>
        <button class="btn" data-action="save" data-id="${p.id}" aria-pressed="${S.saved.has(p.id)}">${esc(t(S.saved.has(p.id) ? "saved" : "save"))}</button>
        <button class="btn" data-action="ask" data-id="${p.id}">${esc(t("askPlace"))}</button>
        <button class="btn" data-action="ride" data-id="${p.id}">${esc(t(canNavigate(p) ? "getThere" : "locationUnverified"))}</button>
        <button class="btn" data-action="share" data-id="${p.id}">${esc(t("share"))}</button>
        <button class="btn" data-action="hide" data-id="${p.id}">${esc(t("hidePlace"))}</button>
      </div>`;
    openDialog(pn(p), html);
  }
  function safeUrl(u) { try { const x = new URL(u); return ["https:", "http:"].includes(x.protocol) ? x.href : null; } catch (e) { return null; } }
  function contactButtons(p, withMessage) {
    if (p.status === "demo") return "";
    const ct = p.contacts || {}, out = [];
    const phone = typeof ct.phone === "string" && /^\+?[\d ()-]{6,25}$/.test(ct.phone) ? ct.phone : null;
    const wa = typeof ct.whatsapp === "string" && /^\+?\d{6,16}$/.test(ct.whatsapp) ? ct.whatsapp.replace(/^\+/, "") : null;
    const sms = ct.sms === true && phone;
    const msg = withMessage ? encodeURIComponent(askMessage(p, withMessage.includeAccess)) : "";
    if (wa) out.push(`<a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(wa)}${msg ? "?text=" + msg : ""}">${esc(t("whatsappText"))}</a>`);
    if (sms) out.push(`<a class="btn" href="sms:${esc(phone.replace(/[ ()-]/g, ""))}${msg ? "?body=" + msg : ""}">${esc(t("smsText"))}</a>`);
    if (phone) out.push(`<a class="btn" href="tel:${esc(phone.replace(/[ ()-]/g, ""))}">${esc(t("call", { n: "\u2066" + phone + "\u2069" }))}</a>`);
    const web = safeUrl(ct.website); if (web) out.push(`<a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(web)}">${esc(t("website"))}</a>`);
    for (const s of Array.isArray(ct.social) ? ct.social : []) { const u = safeUrl(s.url); if (u) out.push(`<a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(u)}">${esc(s.label || t("socialPage"))}</a>`); }
    return out.length ? `<div class="row">${out.join("")}</div>` : "";
  }

  /* ---------------- ask the place ---------------- */
  function askItems(p) {
    const c = S.lastConstraints || E.buildConstraints(E.parseWish(""), readForm(true), S.profile);
    const ev = E.evaluatePlace(p, c, {});
    const items = [], seen = new Set();
    const add = (text, access) => { if (!seen.has(text)) { seen.add(text); items.push({ text, access }); } };
    for (const u of ev.unknowns) {
      if (u.code === "wheelchair_unconfirmed") (u.v || []).forEach((k) => add(t("ask_" + k), true));
      else if (u.code === "pets_unconfirmed") add(t("ask_pets", { v: t(c.pet.type === "other" ? "otherPet" : c.pet.type) }), false);
      else if (u.code === "access_unconfirmed") add(t("ask_access_" + u.v), true);
      else if (u.code === "price_unknown") add(t("ask_price"), false);
    }
    add(t("ask_price_avail"), false);
    return items;
  }
  // Access questions reveal a need, so they go into the message only with consent
  function askMessage(p, includeAccess) {
    const items = askItems(p).filter((x) => includeAccess || !x.access).map((x) => x.text);
    return t("askGreeting", { place: pn(p) }) + "\n- " + items.join("\n- ") + "\n" + t("askThanks");
  }
  function openAsk(id) {
    const p = byId(id); if (!p) return;
    const items = askItems(p);
    const hasContacts = !!contactButtons(p, false);
    openDialog(t("askTitleDlg", { place: pn(p) }), `
      <p>${esc(t("askIntro"))}</p><ul class="reasons">${items.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>
      ${p.status === "demo" ? `<p role="status" class="notice">${esc(t("askDemo"))}</p>` : hasContacts ? `
        <label class="check"><input type="checkbox" id="askIncludeAccess"><span>${esc(t("askConsent"))}</span></label>
        <p class="mini">${esc(t("askConsentHelp"))}</p>
        <label class="field">${esc(t("askMessage"))}<textarea id="askMsg" readonly rows="6" class="form" style="width:100%">${esc(askMessage(p, false))}</textarea></label>
        <div id="askContacts">${contactButtons(p, { includeAccess: false })}</div>
        <div class="row"><button class="btn" data-action="copyText" data-target="#askMsg">${esc(t("copyMessage"))}</button></div>` : `<p role="status" class="notice">${esc(t("noContacts"))}</p>`}
      <p class="mini">${esc(t("askNoReplies"))}</p>`);
    const cb = $("#askIncludeAccess");
    if (cb) cb.addEventListener("change", () => { $("#askMsg").value = askMessage(p, cb.checked); $("#askContacts").innerHTML = contactButtons(p, { includeAccess: cb.checked }); });
  }

  /* ---------------- get there ---------------- */
  function rideNote(needs) {
    return needs.filter((n) => ["mobility", "vision", "hearing", "speech", "cognitive"].includes(n)).map((n) => t("driver_" + n)).join(" ");
  }
  function openRide(id) {
    const p = byId(id); if (!p) return;
    if (p.comesToYou) { openDialog(t("getThere"), `<p>${esc(t(p.area === "Delivered" ? "deliveredToYou" : "comesToYou"))}. ${esc(t("noRideNeeded"))}</p>`); return; }
    if (!canNavigate(p)) {
      openDialog(t("getThere"), `<p role="status" class="notice"><b>${esc(t("locationUnverified"))}</b>${esc(t("noNavBody"))}</p><div class="row"><button class="btn primary" data-action="ask" data-id="${p.id}">${esc(t("askPlace"))}</button></div>`);
      return;
    }
    const la = p.coords ? p.coords.lat : null, lo = p.coords ? p.coords.lng : null;
    const name = pn(p), addr = p.address ? loc(p.address) : an(p.area);
    const opts = [];
    if (la !== null) {
      const u = new URL("https://m.uber.com/ul/"); u.searchParams.set("action", "setPickup"); u.searchParams.set("pickup", "my_location");
      if (CFG.uberClientId) u.searchParams.set("client_id", CFG.uberClientId);
      u.searchParams.set("dropoff[latitude]", la); u.searchParams.set("dropoff[longitude]", lo); u.searchParams.set("dropoff[nickname]", name); u.searchParams.set("dropoff[formatted_address]", addr);
      opts.push({ em: "🚗", t: "Uber", d: t("uberDesc"), u: u.href });
      const gm = (m) => `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=${m}`;
      opts.push({ em: "🧭", t: t("driveSelf"), d: t("driveDesc"), u: gm("driving") });
      opts.push({ em: "🚇", t: t("transit"), d: t("transitDesc"), u: gm("transit") });
      opts.push({ em: "🚶", t: t("walk"), d: t("walkDesc"), u: gm("walking") });
    } else { const u = safeUrl(p.contacts.mapUrl); if (u) opts.push({ em: "🗺️", t: t("officialMap"), d: t("officialMapDesc"), u }); }
    const note = rideNote(S.lastConstraints ? S.lastConstraints.needs : S.profile.needs);
    openDialog(t("getThere"), `
      <div class="dest"><small>${esc(t("destination"))}</small><b>${esc(name)}</b><small>${esc(addr)}</small></div>
      <ul class="rides">${opts.map((o) => `<li><a class="ride" href="${esc(o.u)}" target="_blank" rel="noopener noreferrer"><span class="em" aria-hidden="true">${o.em}</span><span><b>${esc(o.t)}</b><small>${esc(o.d)}</small></span><span class="go" aria-hidden="true">${esc(t("open"))}</span><span class="sr-only">, ${esc(t("newWindow"))}</span></a></li>`).join("")}</ul>
      <div class="tipbox"><b>Careem</b><p>${esc(t("careemNote"))}</p><label class="field">${esc(t("addressToPaste"))}<input id="rideAddr" readonly value="${esc(name + ", " + addr)}"></label><div class="row"><button class="btn small" data-action="copyText" data-target="#rideAddr">${esc(t("copyAddress"))}</button></div></div>
      ${note ? `<div class="tipbox"><b>${esc(t("driverNote"))}</b><p>${esc(t("driverNoteHelp"))}</p><span class="drvnote" id="drvNote">${esc(note)}</span><div class="row"><button class="btn small" data-action="copyText" data-target="#drvNote">${esc(t("copy"))}</button></div></div>` : ""}
      <p class="engine" style="margin-top:14px">${esc(t("rideHonesty"))}</p>`);
  }

  /* ---------------- share a recommendation ---------------- */
  function shareText(p, trip) {
    const people = trip ? trip.people : (S.lastConstraints ? S.lastConstraints.people : 1);
    const cost = E.groupCost(p, people);
    const lines = [`Wishly: ${pn(p)}`, `${an(p.area)}${p.address ? " — " + loc(p.address) : ""}`, costLine(cost)];
    if (trip && trip.startsAt) lines.push(t("whenLine", { d: E.formatCairo(trip.startsAt, S.lang) }));
    const web = p.contacts && safeUrl(p.contacts.website); if (web && p.status !== "demo") lines.push(web);
    if (canNavigate(p) && p.coords) lines.push(`https://www.google.com/maps/search/?api=1&query=${p.coords.lat},${p.coords.lng}`);
    if (p.status === "demo") lines.push(t("demoShareNote"));
    return lines.join("\n");
  }
  function openShare(id, tripId) {
    const p = byId(id); if (!p) return;
    const trip = tripId ? S.trips.find((x) => x.id === tripId) : null;
    openDialog(t("shareTitle"), `<p>${esc(t("shareHelp"))}</p>
      <label class="field">${esc(t("shareDetails"))}<textarea id="shareText" readonly rows="7" style="width:100%">${esc(shareText(p, trip))}</textarea></label>
      <div class="row"><button class="btn primary" data-action="copyText" data-target="#shareText">${esc(t("copy"))}</button>${navigator.share ? `<button class="btn" data-action="nativeShare" data-target="#shareText">${esc(t("shareApps"))}</button>` : ""}</div>`);
  }

  /* ---------------- plan a trip ---------------- */
  function openPlan(id, tripId) {
    const p = byId(id), trip = tripId ? S.trips.find((x) => x.id === tripId) : null;
    if (!p) return;
    const c = S.lastConstraints;
    const people = trip ? trip.people : (peopleVal() || (c ? c.people : S.profile.groupSize) || 1);
    const pp = trip ? (trip.budgetPerPerson || "") : (+$("#fPP").value || (c && c.budget ? Math.round(c.budget.perPerson) : "") || "");
    openDialog(t(trip ? "editTrip" : "planTitle"), `
      <p><b>${esc(pn(p))}</b> · ${esc(an(p.area))} · ${esc(costLine(E.groupCost(p, people)))}</p>
      ${p.status === "demo" ? `<p class="demo-banner">${esc(t("demoPlaceNote"))}</p>` : ""}
      <form class="form" id="planForm" novalidate>
        <label>${esc(t("tripName"))}<input id="planTitle" maxlength="120" value="${esc(trip ? trip.title : "")}"></label>
        <label>${esc(t("dateTimeCairo"))}<input id="planWhen" type="datetime-local" value="${esc(trip ? E.utcToCairoInput(trip.startsAt) : "")}" aria-describedby="planWhenHelp"><span class="hint-s" id="planWhenHelp">${esc(t("cairoHelp"))}</span></label>
        <div class="fields">
          <label>${esc(t("people"))}<input id="planPeople" type="number" min="1" max="20" required value="${esc(people)}"></label>
          <label>${esc(t("perPerson"))}<input id="planPP" type="number" min="0" step="50" value="${esc(pp)}"></label>
        </div>
        <p class="total-line" id="planTotal"></p>
        <p class="err" id="planErr" role="alert"></p>
        <button class="btn primary" type="submit">${esc(t(trip ? "saveChanges" : "createTrip"))}</button>
      </form>`, { focus: "#planWhen" });
    const upd = () => { const n = Math.round(+$("#planPeople").value) || 1, v = +$("#planPP").value; const cost = E.groupCost(p, n);
      $("#planTotal").textContent = (v > 0 ? t("totalLine", { pp: egp(v), n: num(n), total: egp(v * n) }) + " · " : "") + t("placeCost", { v: costLine(cost) }); };
    $("#planPeople").addEventListener("input", upd); $("#planPP").addEventListener("input", upd); upd();
    $("#planForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = Math.round(+$("#planPeople").value), v = $("#planPP").value === "" ? null : +$("#planPP").value;
      if (!(n >= 1 && n <= 20)) { $("#planErr").textContent = t("vPeople"); $("#planPeople").focus(); return; }
      if (v !== null && !(v >= 0)) { $("#planErr").textContent = t("vBudget"); return; }
      const when = $("#planWhen").value ? E.cairoToUTC($("#planWhen").value) : null;
      const data = { placeId: p.id, title: $("#planTitle").value.trim(), startsAt: when, people: n, budgetPerPerson: v };
      try {
        if (trip) await S.store.updateTrip(trip.id, data); else await S.store.createTrip(data);
        if (!trip && !S.saved.has(p.id)) { /* planning implies interest, but saving stays a separate choice */ }
        await refreshTrips(); closeDialog(); S.tripTab = "trips"; go("trips"); toast(t(trip ? "tripUpdated" : "tripCreated"));
      } catch (err) { $("#planErr").textContent = errMsg(err); }
    });
  }

  /* ---------------- rating ---------------- */
  function stars(name, current, required) {
    return `<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" ${current === n ? "checked" : ""} ${required && n === 1 ? "required" : ""}><span>${num(n)}</span><span class="sr-only"> ${esc(t("ofFive"))}</span></label>`).join("")}</div>`;
  }
  function openRate(tripId) {
    const trip = S.trips.find((x) => x.id === tripId); if (!trip) return;
    const p = byId(trip.placeId) || { id: trip.placeId, name: { en: trip.placeId } };
    if (trip.status !== "completed" && !trip.myVisitedAt) { toast(t("err_review_before_visit")); return; }
    const r = trip.myReview || {};
    openDialog(t("rateTitle"), `<p><b>${esc(pn(p))}</b>${trip.startsAt ? " · " + esc(E.formatCairo(trip.startsAt, S.lang)) : ""}</p>
      <p class="notice">${esc(t("rateRule"))}</p>
      <form class="form" id="rateForm" novalidate>
        <fieldset class="rate"><legend>${esc(t("ratePlace"))} *</legend>${stars("rPlace", r.place, true)}</fieldset>
        <fieldset class="rate"><legend>${esc(t("rateOrg"))}</legend>${stars("rOrg", r.org)}</fieldset>
        <fieldset class="rate"><legend>${esc(t("rateTransport"))}</legend>${stars("rTrans", r.transport)}</fieldset>
        <label>${esc(t("rateComment"))}<textarea id="rComment" maxlength="1000">${esc(r.comment || "")}</textarea></label>
        ${S.store.caps.sharedRatings ? `<p class="mini">${esc(t("rateShared"))}</p>` : `<p class="mini">${esc(t("rateLocal"))}</p>`}
        <p class="err" id="rateErr" role="alert"></p>
        <button class="btn primary" type="submit">${esc(t(trip.myReview ? "updateRating" : "saveRating"))}</button>
      </form>`, { focus: "input[name=rPlace]" });
    $("#rateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = (n) => { const x = $(`input[name=${n}]:checked`); return x ? +x.value : null; };
      const place = val("rPlace"); if (!place) { $("#rateErr").textContent = t("vRatePlace"); $("input[name=rPlace]").focus(); return; }
      try {
        const res = await S.store.submitReview(trip.id, { place, org: val("rOrg"), transport: val("rTrans"), comment: $("#rComment").value });
        await refreshTrips(); closeDialog();
        const msg = res.excluded ? t("ratedExcluded", { place: pn(p) }) : (r.place && r.place <= 2 ? t("ratedRestored", { place: pn(p) }) : t("rated"));
        toast(msg); announce(msg); S.tripTab = "experiences"; renderTrips();
        if (S.results) runSearch({ stay: true });
      } catch (err) { $("#rateErr").textContent = errMsg(err); }
    });
  }

  /* ---------------- invites (server) ---------------- */
  async function openInvites(tripId) {
    const trip = S.trips.find((x) => x.id === tripId); if (!trip || !S.store.caps.invites) return;
    let list = [];
    try { list = await S.store.listInvites(tripId); } catch (e) { toast(errMsg(e)); }
    const now = Date.now();
    openDialog(t("inviteFriends"), `<p>${esc(t("inviteHelp"))}</p>
      <div class="row"><button class="btn primary" data-action="newInvite" data-trip="${trip.id}">${esc(t("newInviteLink"))}</button></div>
      <div id="inviteOut"></div>
      <h3 style="margin-top:16px">${esc(t("inviteLinks"))}</h3>
      ${list.length ? `<ul class="list">${list.map((i) => { const st = i.revoked_at ? "revoked" : Date.parse(i.expires_at) < now ? "expired" : i.uses >= i.max_uses ? "used" : "active";
        return `<li class="item"><p>${esc(t("linkCreated", { d: dateOnly(i.created_at) }))} · ${esc(t("linkUses", { n: num(i.uses), max: num(i.max_uses) }))} · <b>${esc(t("link_" + st))}</b></p>${st === "active" ? `<button class="btn small danger" data-action="revokeInvite" data-id="${i.id}" data-trip="${trip.id}">${esc(t("revoke"))}</button>` : ""}</li>`; }).join("")}</ul>` : `<p>${esc(t("noInviteLinks"))}</p>`}
      <p class="mini">${esc(t("invitePrivacy"))}</p>`);
  }

  /* ---------------- trips view ---------------- */
  const TABS = ["trips", "saved", "experiences", "excluded", "friends"];
  function renderTrips() {
    const kind = S.store.kind;
    $("#tripsMode").textContent = t(kind === "server" ? "modeServer" : kind === "claude" ? "modeClaude" : "modeGuest");
    $("#tripTabs").innerHTML = TABS.map((k) => `<button role="tab" id="tab-${k}" aria-selected="${S.tripTab === k}" aria-controls="tripArea" data-action="tripTab" data-tab="${k}">${esc(t("tab_" + k))}</button>`).join("");
    $("#tripArea").setAttribute("aria-labelledby", "tab-" + S.tripTab);
    const f = { trips: renderTripList, saved: renderSaved, experiences: renderExperiences, excluded: renderExcluded, friends: renderFriends }[S.tripTab];
    f();
  }
  function participantsLine(trip) {
    if (trip.participants.length <= 1 && S.store.kind !== "server") return "";
    return `<div class="people" aria-label="${esc(t("participants"))}">${trip.participants.map((pp) => `<span>${esc(pp.me ? t("you") : (pp.name || t("someone")))}${pp.role === "owner" ? " · " + esc(t("organizer")) : ""} · ${esc(t("pstatus_" + pp.status))}${pp.visitedAt ? " · " + esc(t("visited")) : ""}</span>`).join("")}</div>`;
  }
  function tripCard(trip) {
    const p = byId(trip.placeId) || { id: trip.placeId, name: { en: trip.placeId }, area: "", cat: "Food" };
    const owner = trip.role === "owner", visited = !!trip.myVisitedAt, done = trip.status === "completed";
    const cost = E.groupCost(p, trip.people);
    const btn = (action, label, extra) => `<button class="btn small${extra ? " " + extra : ""}" data-action="${action}" data-trip="${trip.id}" data-id="${p.id}">${esc(t(label))}</button>`;
    const acts = [];
    if (trip.status !== "cancelled") {
      if (!visited && !done) acts.push(btn("visited", "markVisited"));
      if (visited || done) acts.push(btn("rate", trip.myReview ? "editRating" : "rate", "primary"));
      if (owner && !done) acts.push(btn("complete", "markCompleted"));
      if (owner && S.store.caps.invites) acts.push(btn("invites", "inviteFriends"));
      if (owner && S.store.caps.sharedRatings && trip.participants.filter((x) => x.status === "accepted").length > 1) acts.push(btn("groupSearch", "groupAlternatives"));
      if (owner && !done) acts.push(btn("editTrip", "edit"));
      acts.push(btn("shareTrip", "share"));
      if (owner && !done) acts.push(btn("cancelTrip", "cancelTrip"));
      if (!owner) acts.push(btn("leaveTrip", "leaveTrip"));
    }
    if (owner) acts.push(btn("deleteTrip", "deleteTrip", "danger"));
    const others = trip.reviews.filter((r) => !r.me);
    return `<li class="item">
      <h3>${esc(trip.title || pn(p))} <span class="badge ${done ? "ok" : "muted"}">${esc(t("tstatus_" + trip.status))}</span>${p.status === "demo" ? ` <span class="badge demo">${esc(t("demoBadge"))}</span>` : ""}</h3>
      <p class="meta">${trip.title ? esc(pn(p)) + " · " : ""}${esc(an(p.area))} · ${trip.startsAt ? esc(E.formatCairo(trip.startsAt, S.lang)) + " " + esc(t("cairoTime")) : esc(t("noDate"))}</p>
      <p class="meta">${esc(ppl(trip.people))}${trip.budgetPerPerson ? " · " + esc(t("totalLine", { pp: egp(trip.budgetPerPerson), n: num(trip.people), total: egp(trip.budgetPerPerson * trip.people) })) : ""} · ${esc(t("placeCost", { v: costLine(cost) }))}</p>
      ${trip.myVisitedAt ? `<p class="meta">${esc(t("visitedOn", { d: dateOnly(trip.myVisitedAt) }))}</p>` : ""}
      ${participantsLine(trip)}
      ${trip.myReview ? `<p>${esc(t("myRatingLine", { p: num(trip.myReview.place), o: trip.myReview.org ? num(trip.myReview.org) : "–", tr: trip.myReview.transport ? num(trip.myReview.transport) : "–" }))}</p>` : ""}
      ${others.length ? `<ul class="reasons">${others.map((r) => `<li>${esc(r.name || t("someone"))}: ${esc(t("myRatingLine", { p: num(r.place), o: r.org ? num(r.org) : "–", tr: r.transport ? num(r.transport) : "–" }))}${r.comment ? " — “" + esc(r.comment) + "”" : ""}</li>`).join("")}</ul>` : ""}
      ${owner && !S.store.caps.invites ? `<p class="mini">${esc(t("invitesNeedServer"))}</p>` : ""}
      <div class="row">${acts.join("")}</div></li>`;
  }
  function renderTripList() {
    const list = S.trips.filter((x) => x.status !== "completed" || !x.myReview);
    $("#tripArea").innerHTML = `<p>${esc(t("lifecycle"))}</p>` + (list.length ? `<ul class="list">${list.map(tripCard).join("")}</ul>` : `<p class="status">${esc(t("noTrips"))}</p>`);
  }
  function renderSaved() {
    const ids = [...S.saved].filter(byId);
    $("#tripArea").innerHTML = ids.length ? `<ul class="list">${ids.map((id) => { const p = byId(id); return `<li class="item"><h3>${esc(pn(p))}${p.status === "demo" ? ` <span class="badge demo">${esc(t("demoBadge"))}</span>` : ""}</h3><p class="meta">${esc(t("cat_" + p.cat))} · ${esc(an(p.area))}</p>
      <div class="row"><button class="btn small primary" data-action="plan" data-id="${p.id}">${esc(t("planTrip"))}</button><button class="btn small" data-action="details" data-id="${p.id}">${esc(t("details"))}</button><button class="btn small" data-action="save" data-id="${p.id}" aria-pressed="true">${esc(t("unsave"))}</button></div></li>`; }).join("")}</ul>` : `<p class="status">${esc(t("noSaved"))}</p>`;
  }
  function renderExperiences() {
    const list = S.trips.filter((x) => x.myReview || (x.status === "completed"));
    $("#tripArea").innerHTML = list.length ? `<ul class="list">${list.map(tripCard).join("")}</ul>` : `<p class="status">${esc(t("noExperiences"))}</p>`;
  }
  function renderExcluded() {
    const list = S.exclusions.filter((e) => byId(e.placeId));
    $("#tripArea").innerHTML = `<p>${esc(t("excludedHelp"))}</p>` + (list.length ? `<ul class="list">${list.map((e) => { const p = byId(e.placeId); return `<li class="item"><h3>${esc(pn(p))}</h3><p class="meta">${esc(t(e.reason === "rating" ? "excludedByRating" : "excludedManual"))}${e.at ? " · " + esc(dateOnly(e.at)) : ""}</p><div class="row"><button class="btn small primary" data-action="restore" data-id="${p.id}">${esc(t("restore"))}</button></div></li>`; }).join("")}</ul>` : `<p class="status">${esc(t("noExcluded"))}</p>`);
  }
  async function renderFriends() {
    const area = $("#tripArea");
    if (!S.store.caps.friends) { area.innerHTML = `<div class="notice" role="status"><b>${esc(t("friendsUnavailable"))}</b>${esc(t(S.server ? "friendsSignIn" : "friendsNeedServer"))}</div>${S.server ? `<div class="row"><button class="btn primary" data-action="account">${esc(t("signIn"))}</button></div>` : ""}`; return; }
    area.innerHTML = `<div class="status"><div class="spinner" aria-hidden="true"></div>${esc(t("loading"))}</div>`;
    try {
      const f = await S.store.friends(); S.friends = f;
      area.innerHTML = `
        <div class="row"><button class="btn primary" data-action="friendInvite">${esc(t("friendInviteLink"))}</button>${CFG.facebookFriends && CFG.providers && CFG.providers.facebook ? `<button class="btn" data-action="facebookFriends">${esc(t("findFacebook"))}</button>` : ""}</div>
        <div id="friendOut"></div>
        <p class="mini">${esc(t(CFG.facebookFriends ? "facebookNote" : "facebookOff"))}</p>
        ${f.incoming.length ? `<h2 style="margin-top:16px">${esc(t("friendRequests"))}</h2><ul class="list">${f.incoming.map((r) => `<li class="item"><p>${esc(r.name || t("someone"))}${r.source === "facebook" ? " · Facebook" : ""}</p><div class="row"><button class="btn small primary" data-action="friendRespond" data-id="${r.id}" data-accept="1">${esc(t("accept"))}</button><button class="btn small" data-action="friendRespond" data-id="${r.id}" data-accept="0">${esc(t("decline"))}</button></div></li>`).join("")}</ul>` : ""}
        <h2 style="margin-top:16px">${esc(t("yourFriends", { n: num(f.friends.length) }))}</h2>
        ${f.friends.length ? `<ul class="list">${f.friends.map((x) => `<li class="item"><p>${esc(x.name || t("someone"))}</p><button class="btn small danger" data-action="removeFriend" data-user="${x.userId}">${esc(t("removeFriend"))}</button></li>`).join("")}</ul>` : `<p>${esc(t("noFriends"))}</p>`}
        ${f.invites.filter((i) => !i.revoked_at).length ? `<h3 style="margin-top:16px">${esc(t("inviteLinks"))}</h3><ul class="list">${f.invites.filter((i) => !i.revoked_at).map((i) => `<li class="item"><p>${esc(t("linkCreated", { d: dateOnly(i.created_at) }))} · ${esc(t("linkUses", { n: num(i.uses), max: num(i.max_uses) }))}</p><button class="btn small danger" data-action="revokeFriendInvite" data-id="${i.id}">${esc(t("revoke"))}</button></li>`).join("")}</ul>` : ""}`;
    } catch (e) { area.innerHTML = `<p role="alert" class="err">${esc(errMsg(e))}</p>`; }
  }

  /* ---------------- account ---------------- */
  function renderAccountButton() {
    const b = $("#acctBtn"), kind = S.store ? S.store.kind : "guest";
    b.dataset.mode = kind;
    let label = t("guest");
    if (kind === "server") label = S.serverCard && S.serverCard.username ? "@" + S.serverCard.username : t("signedIn");
    if (kind === "claude") label = t("claudeAccount");
    $("#acctLabel").textContent = label; b.setAttribute("aria-label", t("accountBtnLabel", { v: label }));
    $("#profileWhere").textContent = t(kind === "server" ? "whereServer" : kind === "claude" ? "whereClaude" : "whereGuest");
    $("#dataWhere").textContent = t(kind === "server" ? "dataServer" : kind === "claude" ? "dataClaude" : "dataGuest");
    if (kind === "server" && !S.serverCard && S.server) S.server.myCard().then((c) => { S.serverCard = c; renderAccountButton(); }).catch(() => {});
  }
  function providerTable() {
    const row = (name, state, note) => `<tr><th scope="row">${esc(name)}</th><td>${esc(state)}</td><td class="mini">${esc(note)}</td></tr>`;
    const on = (k) => S.server && CFG.providers && CFG.providers[k];
    return `<table class="status-table"><caption class="sr-only">${esc(t("providersCaption"))}</caption>
      <thead><tr><th scope="col">${esc(t("method"))}</th><th scope="col">${esc(t("statusCol"))}</th><th scope="col">${esc(t("notes"))}</th></tr></thead><tbody>
      ${row(t("emailPassword"), S.server ? t("connected") : t("notConnected"), S.server ? t("emailNote") : t("needsServer"))}
      ${row("Google", on("google") ? t("connected") : t("notConnected"), on("google") ? "" : t("googleNeeds"))}
      ${row("Facebook", on("facebook") ? t("connected") : t("notConnected"), on("facebook") ? "" : t("facebookNeeds"))}
      ${row("Instagram", t("notOffered"), t("instagramWhy"))}
      ${row(t("claudeSignIn"), S.store.kind === "claude" ? t("inUse") : t("onlyOnClaude"), t("claudeSignInNote"))}
      </tbody></table>`;
  }
  async function openAccount() {
    const s = S.server;
    if (S.recovery && s) {
      openDialog(t("accountTitle"), `<form class="form" id="newPwForm" novalidate><p>${esc(t("setNewPassword"))}</p>${pwField("newPw", "new-password")}<p class="err" id="acctErr" role="alert"></p><button class="btn primary" type="submit">${esc(t("savePassword"))}</button></form>`, { focus: "#newPw" });
      $("#newPwForm").addEventListener("submit", async (e) => { e.preventDefault(); const pw = $("#newPw").value; const v = pwProblem(pw); if (v) { $("#acctErr").textContent = v; return; }
        try { await s.updatePassword(pw); S.recovery = false; closeDialog(); toast(t("passwordSaved")); } catch (err) { $("#acctErr").textContent = errMsg(err); } });
      return;
    }
    if (!s) {
      openDialog(t("accountTitle"), `<p role="status">${esc(t(S.store.kind === "claude" ? "acctClaude" : "acctGuest"))}</p>${providerTable()}<p>${esc(t("acctSetupHint"))}</p>`);
      return;
    }
    if (!s.signedIn) {
      const social = ["google", "facebook"].filter((k) => CFG.providers && CFG.providers[k]);
      openDialog(t("accountTitle"), `
        <p>${esc(t("acctSignedOut"))}</p>
        <div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-action="authTab" data-tab="in" id="atab-in">${esc(t("signIn"))}</button><button role="tab" aria-selected="false" data-action="authTab" data-tab="up" id="atab-up">${esc(t("createAccount"))}</button><button role="tab" aria-selected="false" data-action="authTab" data-tab="reset" id="atab-reset">${esc(t("forgotPassword"))}</button></div>
        <div id="authPane"></div>
        ${social.length ? `<h3 style="margin-top:16px">${esc(t("orContinue"))}</h3><div class="row">${social.map((k) => `<button class="btn" data-action="oauth" data-provider="${k}">${esc(t("continueWith", { p: k === "google" ? "Google" : "Facebook" }))}</button>`).join("")}</div>` : ""}
        ${providerTable()}`);
      authPane("in");
      return;
    }
    let card = {}, ids = [];
    try { [card, ids] = await Promise.all([s.myCard(), s.identities()]); S.serverCard = card; } catch (e) { toast(errMsg(e)); }
    const email = s.user.email, verified = !!s.user.email_confirmed_at;
    const linked = new Set(ids.map((i) => i.provider));
    const linkable = ["google", "facebook"].filter((k) => CFG.providers && CFG.providers[k] && !linked.has(k));
    openDialog(t("accountTitle"), `
      <p><b>${card.username ? "@" + esc(card.username) : esc(t("noUsername"))}</b> · ${esc(email || "")} ${verified ? `<span class="badge ok">${esc(t("emailVerified"))}</span>` : `<span class="badge demo">${esc(t("emailPending"))}</span>`}</p>
      ${!card.username ? `<form class="form" id="unameForm" novalidate><label>${esc(t("username"))}<input id="uname" autocomplete="username" maxlength="30" aria-describedby="unameHelp"><span class="hint-s" id="unameHelp">${esc(t("usernameRule"))}</span></label><p class="err" id="unameErr" role="alert"></p><button class="btn" type="submit">${esc(t("saveUsername"))}</button></form>` : ""}
      <h3 style="margin-top:14px">${esc(t("linkedSignIns"))}</h3>
      <ul class="reasons">${ids.map((i) => `<li>${esc(i.provider === "email" ? t("emailPassword") : i.provider)}${CFG.manualLinking && ids.length > 1 && i.provider !== "email" ? ` <button class="inline-btn" data-action="unlink" data-provider="${esc(i.provider)}">${esc(t("unlink"))}</button>` : ""}</li>`).join("") || `<li>${esc(t("emailPassword"))}</li>`}</ul>
      ${CFG.manualLinking && linkable.length ? `<div class="row">${linkable.map((k) => `<button class="btn small" data-action="link" data-provider="${k}">${esc(t("linkProvider", { p: k === "google" ? "Google" : "Facebook" }))}</button>`).join("")}</div><p class="mini">${esc(t("linkingNote"))}</p>` : `<p class="mini">${esc(t(CFG.manualLinking ? "linkingNote" : "autoLinkNote"))}</p>`}
      ${ST.GuestStore.hasData() ? `<div class="notice"><b>${esc(t("guestDataFound"))}</b>${esc(t("guestDataHelp"))}<div class="row"><button class="btn small" data-action="importGuest">${esc(t("copyGuestData"))}</button></div></div>` : ""}
      <div class="row"><button class="btn" data-action="signOut">${esc(t("signOut"))}</button></div>`);
    const uf = $("#unameForm");
    if (uf) uf.addEventListener("submit", async (e) => { e.preventDefault(); const u = $("#uname").value.trim().toLowerCase();
      if (!/^[a-z0-9_.]{3,30}$/.test(u)) { $("#unameErr").textContent = t("usernameRule"); return; }
      try { if (!(await s.usernameAvailable(u))) { $("#unameErr").textContent = t("usernameTaken"); return; } await s.setUsername(u); S.serverCard = null; renderAccountButton(); openAccount(); } catch (err) { $("#unameErr").textContent = errMsg(err); } });
  }
  function pwField(id, ac) {
    return `<label>${esc(t("password"))}<span class="pw"><input id="${id}" type="password" autocomplete="${ac}" minlength="10" required aria-describedby="${id}Help"><button type="button" class="btn small" data-action="togglePw" data-target="#${id}" aria-pressed="false">${esc(t("showPassword"))}</button></span><span class="hint-s" id="${id}Help">${esc(t("passwordRule"))}</span></label>`;
  }
  function pwProblem(pw) { return pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? t("passwordRule") : ""; }
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  function authPane(tab) {
    $$("[data-action=authTab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const pane = $("#authPane"), s = S.server;
    if (tab === "in") {
      pane.innerHTML = `<form class="form" id="inForm" novalidate><label>${esc(t("email"))}<input id="inEmail" type="email" autocomplete="email" required></label>${pwField("inPw", "current-password")}<p class="err" id="acctErr" role="alert"></p><button class="btn primary" type="submit">${esc(t("signIn"))}</button><div id="resendBox"></div></form>`;
      $("#inForm").addEventListener("submit", async (e) => { e.preventDefault(); const em = $("#inEmail").value.trim(), pw = $("#inPw").value;
        if (!emailOk(em)) { $("#acctErr").textContent = t("vEmail"); $("#inEmail").focus(); return; } if (!pw) { $("#acctErr").textContent = t("vPassword"); return; }
        try { await s.signIn(em, pw); closeDialog(); toast(t("signedInToast")); }
        catch (err) { $("#acctErr").textContent = errMsg(err); if (err.code === "auth_unconfirmed") $("#resendBox").innerHTML = `<button type="button" class="btn small" data-action="resend" data-email="${esc(em)}">${esc(t("resendEmail"))}</button>`; } });
    } else if (tab === "up") {
      pane.innerHTML = `<form class="form" id="upForm" novalidate>
        <label>${esc(t("username"))}<input id="upUser" autocomplete="username" maxlength="30" required aria-describedby="upUserHelp"><span class="hint-s" id="upUserHelp">${esc(t("usernameRule"))}</span></label>
        <label>${esc(t("email"))}<input id="upEmail" type="email" autocomplete="email" required></label>
        ${pwField("upPw", "new-password")}
        <p class="mini">${esc(t("signupPrivacy"))}</p>
        <p class="err" id="acctErr" role="alert"></p><button class="btn primary" type="submit">${esc(t("createAccount"))}</button></form>`;
      $("#upForm").addEventListener("submit", async (e) => { e.preventDefault();
        const u = $("#upUser").value.trim().toLowerCase(), em = $("#upEmail").value.trim(), pw = $("#upPw").value, er = $("#acctErr");
        if (!/^[a-z0-9_.]{3,30}$/.test(u)) { er.textContent = t("usernameRule"); $("#upUser").focus(); return; }
        if (!emailOk(em)) { er.textContent = t("vEmail"); $("#upEmail").focus(); return; }
        const pp = pwProblem(pw); if (pp) { er.textContent = pp; $("#upPw").focus(); return; }
        try { if (!(await s.usernameAvailable(u))) { er.textContent = t("usernameTaken"); return; }
          const r = await s.signUp({ username: u, email: em, password: pw });
          pane.innerHTML = `<p role="status" class="notice">${esc(t(r.needsConfirmation ? "checkEmailConfirm" : "signedInToast"))}</p>`; }
        catch (err) { er.textContent = errMsg(err); } });
    } else {
      pane.innerHTML = `<form class="form" id="resetForm" novalidate><p>${esc(t("resetHelp"))}</p><label>${esc(t("email"))}<input id="rsEmail" type="email" autocomplete="email" required></label><p class="err" id="acctErr" role="alert"></p><button class="btn primary" type="submit">${esc(t("sendResetLink"))}</button></form>`;
      $("#resetForm").addEventListener("submit", async (e) => { e.preventDefault(); const em = $("#rsEmail").value.trim();
        if (!emailOk(em)) { $("#acctErr").textContent = t("vEmail"); return; }
        try { await s.resetPassword(em); pane.innerHTML = `<p role="status" class="notice">${esc(t("resetSent"))}</p>`; } catch (err) { $("#acctErr").textContent = errMsg(err); } });
    }
  }

  /* ---------------- profile ---------------- */
  const PREFS = ST.PREFS;
  function renderProfile() {
    const p = S.profile;
    $("#pname").value = p.name;
    $("#prefChips").innerHTML = PREFS.map((x) => `<button class="chip" data-action="pref" data-pref="${esc(x)}" aria-pressed="${p.prefs.includes(x)}"><span aria-hidden="true">${p.prefs.includes(x) ? "✓" : "＋"}</span>${esc(t("pref_" + x))}</button>`).join("");
    $("#pArea").value = p.area;
    $("#startCoordsNote").textContent = p.startCoords ? t("startCoordsSaved", { d: dateOnly(p.startCoords.savedAt) }) : "";
    $("#needs").innerHTML = ST.NEED_IDS.map((k) => `<label class="need"><input type="checkbox" value="${k}" ${p.needs.includes(k) ? "checked" : ""}><span><b>${esc(t("need_" + k))}</b><small>${esc(t("needDesc_" + k))}</small></span></label>`).join("");
    $("#pPetOwner").checked = p.petOwner; $("#pPetDetails").hidden = !p.petOwner; $("#pPetType").value = p.petType; $("#pBringPet").checked = p.bringPetByDefault;
    $("#pPP").value = p.budgetPerPerson || ""; $("#pPeople").value = p.groupSize; $("#pBank").value = p.bank; $("#pTier").value = p.cardTier;
    const pct = Math.min(100, Math.round(25 + p.prefs.length * 8 + (p.name.trim() ? 10 : 0) + (p.needs.length ? 20 : 0)));
    $("#pct").textContent = t("pctComplete", { n: num(pct) }); $("#pfill").style.width = pct + "%"; $("#pbar").setAttribute("aria-valuenow", pct);
  }
  let saveT;
  function saveProfileSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => { try { await S.store.saveProfile(S.profile); } catch (e) { toast(errMsg(e)); } }, 500);
  }

  /* ---------------- location ---------------- */
  const LOC_MAX_AGE = 5 * 60 * 1000, LOC_MAX_ACC = 1000, LOC_WARN_ACC = 200;
  function renderLocStatus() {
    const el = $("#locStatus"); el.className = "loc-status";
    const st = S.loc, d = S.device;
    const msg = {
      idle: t("locIdle"), requesting: t("locRequesting"), denied: t("locDenied"), timeout: t("locTimeout"), unavailable: t("locUnavailable"),
      unsupported: t("locUnsupported"), imprecise: t("locImprecise", { m: num(S.locAccuracy || 0) }), expired: t("locExpired"),
      ok: d ? t("locOk", { m: num(d.accuracy), time: new Intl.DateTimeFormat(S.lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" }).format(new Date(d.at)) }) : "",
      approx: d ? t("locApprox", { m: num(d.accuracy) }) : ""
    }[st] || t("locIdle");
    el.textContent = msg;
    if (st === "ok") el.classList.add("ok"); if (["approx", "denied", "timeout", "unavailable", "imprecise", "expired", "unsupported"].includes(st)) el.classList.add("warn");
    $("#locClear").hidden = !S.device; $("#locSave").hidden = !S.device;
    $("#locBtn").textContent = t(S.device ? "refreshLocation" : (["denied", "timeout", "unavailable", "imprecise", "expired"].includes(st) ? "tryAgain" : "useLocation"));
    $("#fArea").disabled = !!S.device; $("#fRadius").disabled = !S.device;
  }
  function locate() {
    if (!navigator.geolocation) { S.loc = "unsupported"; renderLocStatus(); return; }
    S.loc = "requesting"; renderLocStatus(); $("#locBtn").disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $("#locBtn").disabled = false;
      const c = pos.coords;
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) { S.device = null; S.loc = "unavailable"; renderLocStatus(); return; }
      if (!(c.accuracy <= LOC_MAX_ACC)) { S.device = null; S.locAccuracy = c.accuracy; S.loc = "imprecise"; renderLocStatus(); announce($("#locStatus").textContent); return; }
      S.device = { lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), at: Date.now() };
      S.loc = c.accuracy > LOC_WARN_ACC ? "approx" : "ok";
      setSrc($("#fArea"), ""); renderLocStatus(); announce($("#locStatus").textContent);
    }, (err) => {
      $("#locBtn").disabled = false; S.device = null;
      S.loc = err && err.code === 1 ? "denied" : err && err.code === 3 ? "timeout" : "unavailable";
      renderLocStatus(); announce($("#locStatus").textContent);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  function expireLocation() { S.device = null; S.loc = "expired"; renderLocStatus(); }
  function checkLocationExpiry() { if (S.device && Date.now() - S.device.at > LOC_MAX_AGE) expireLocation(); }

  /* ---------------- speech ---------------- */
  const canSpeak = "speechSynthesis" in window;
  function speak(text) {
    if (!canSpeak) { toast(t("noSpeech")); return; }
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = S.lang === "ar" ? "ar-EG" : "en-US"; u.rate = 0.95; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  function toggleMic() {
    const btn = $("#micBtn");
    if (!Rec) { toast(t("noVoice")); return; }
    if (listening) { try { rec.stop(); } catch (e) { /* ignore */ } return; }
    try {
      rec = new Rec(); rec.lang = S.set.vlang; rec.interimResults = true; rec.continuous = false;
      const base = $("#wish").value ? $("#wish").value + " " : "";
      rec.onresult = (e) => { let s = ""; for (const r of e.results) s += r[0].transcript; $("#wish").value = base + s; };
      rec.onstart = () => { listening = true; btn.classList.add("listening"); btn.setAttribute("aria-pressed", "true"); btn.setAttribute("aria-label", t("stopListening")); announce(t(S.set.vlang === "ar-EG" ? "listeningAr" : "listeningEn")); };
      rec.onend = () => { listening = false; btn.classList.remove("listening"); btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-label", t("speakWish")); };
      rec.onerror = (e) => toast(t(e.error === "not-allowed" || e.error === "service-not-allowed" ? "micBlocked" : "micFailed"));
      rec.start();
    } catch (e) { toast(t("micFailed")); }
  }
  function describeForSpeech(id) {
    const x = S.results && [...S.results.confirmed, ...S.results.ask].find((y) => y.place.id === id); if (!x) return "";
    return [pn(x.place), an(x.place.area), costLine(x.ev.cost), t("wishScoreSr", { s: num(x.score) }), ...x.ev.met.map(reqText), ...x.ev.unknowns.map(reqText)].join(". ");
  }

  async function copyFrom(sel) {
    const el = $(sel); if (!el) return; const txt = el.value !== undefined ? el.value : el.textContent;
    try { await navigator.clipboard.writeText(txt); toast(t("copied")); } catch (e) { if (el.select) el.select(); toast(t("copyManually")); }
  }

  /* ---------------- actions ---------------- */
  let delArmed = false, delT;
  const ACTIONS = {
    go: (el, e) => { e.preventDefault(); go(el.dataset.view); },
    account: () => openAccount(),
    lang: () => { S.lang = S.lang === "en" ? "ar" : "en"; ST.lsSet("wishly.lang", S.lang); localize(); announce(t("langChanged")); },
    a11y: () => { const d = $("#a11yDlg"); lastFocus = document.activeElement; if (d.showModal) d.showModal(); else d.setAttribute("open", ""); },
    closeDialog: (el) => closeDialog(el.closest("dialog") || $("#dlg")),
    size: (el) => { S.set.size = +el.dataset.size; applySettings(); },
    vlang: (el) => { S.set.vlang = el.dataset.vlang; applySettings(); },
    switch: (el) => { const k = el.dataset.set; S.set[k] = !S.set[k]; if (k === "contrast" && S.set.contrast) S.set.dark = false; if (k === "dark" && S.set.dark) S.set.contrast = false; applySettings(); if (k === "simple" && S.results) renderMatches(); if (k === "read" && S.set.read) speak(t("readOn")); },
    mic: () => toggleMic(),
    locate: () => locate(),
    clearLocation: () => { S.device = null; S.loc = "idle"; renderLocStatus(); $("#fArea").focus(); },
    saveLocation: async () => { if (!S.device) return; S.profile.startCoords = { lat: +S.device.lat.toFixed(5), lng: +S.device.lng.toFixed(5), savedAt: new Date().toISOString() }; await S.store.saveProfile(S.profile); renderProfile(); toast(t("locSaved")); },
    search: () => runSearch(),
    resetSearch: () => { ["#fArea", "#fPP", "#fTotal", "#fPeople", "#fPet", "#fWheel"].forEach((s) => setSrc($(s), "")); $("#fArea").value = ""; $("#fPP").value = ""; $("#fTotal").value = ""; $("#fMode").value = "cap"; S.budgetEntered = null; S.understood = null; $("#understood").innerHTML = ""; $("#searchPanel").classList.remove("review"); $("#h-search").textContent = t("searchTitle"); applyProfileDefaultsToForm(); },
    picToggle: () => { const b = $("#picBody"), open = b.hidden; b.hidden = !open; $("#picToggle").setAttribute("aria-expanded", String(open)); $("#picArrow").textContent = open ? "－" : "＋"; },
    tile: (el) => { const g = el.dataset.g; S.pic[g] = S.pic[g] === el.dataset.v ? undefined : el.dataset.v; renderPic(); const n = $(`.tile[data-g="${g}"][data-v="${el.dataset.v}"]`); if (n) n.focus(); $("#wish").value = picText(); },
    picGo: () => { if (!Object.values(S.pic).some(Boolean)) { toast(t("pickPicture")); return; } $("#wish").value = picText(); understandWish($("#wish").value); },
    picClear: () => { S.pic = {}; renderPic(); $("#wish").value = ""; announce(t("picCleared")); },
    cat: (el) => { const w = $("#wish"); w.value = t("catPrefix", { c: t("cat_" + el.dataset.cat) }) + " "; w.focus(); w.setSelectionRange(w.value.length, w.value.length); },
    idea: (el) => { $("#wish").value = t(el.dataset.idea + "Text"); understandWish($("#wish").value); },
    details: (el) => openDetails(el.dataset.id),
    ask: (el) => openAsk(el.dataset.id),
    ride: (el) => openRide(el.dataset.id),
    share: (el) => openShare(el.dataset.id),
    shareTrip: (el) => openShare(el.dataset.id, el.dataset.trip),
    speak: (el) => speak(describeForSpeech(el.dataset.id)),
    save: async (el) => { const id = el.dataset.id, on = !S.saved.has(id); try { await S.store.setSaved(id, on); if (on) S.saved.add(id); else S.saved.delete(id); toast(t(on ? "savedToast" : "unsavedToast")); $$(`[data-action=save][data-id="${id}"]`).forEach((b) => { b.textContent = t(on ? "saved" : "save"); b.setAttribute("aria-pressed", String(on)); }); if (!$("#view-trips").hidden) renderTrips(); } catch (e) { toast(errMsg(e)); } },
    hide: async (el) => { try { await S.store.hidePlace(el.dataset.id); S.exclusions = await S.store.listExclusions(); closeDialog(); toast(t("hiddenToast")); if (S.results) runSearch({ stay: !$("#view-trips").hidden }); } catch (e) { toast(errMsg(e)); } },
    restore: async (el) => { try { await S.store.restoreExclusion(el.dataset.id); S.exclusions = await S.store.listExclusions(); renderTrips(); toast(t("restoredToast", { place: pn(byId(el.dataset.id)) })); if (S.results) runSearch({ stay: true }); } catch (e) { toast(errMsg(e)); } },
    plan: (el) => openPlan(el.dataset.id),
    editTrip: (el) => openPlan(el.dataset.id, el.dataset.trip),
    visited: async (el) => { try { await S.store.markVisited(el.dataset.trip); await refreshTrips(); renderTrips(); openRate(el.dataset.trip); } catch (e) { toast(errMsg(e)); } },
    complete: async (el) => { try { await S.store.updateTrip(el.dataset.trip, { status: "completed" }); await refreshTrips(); renderTrips(); toast(t("tripCompleted")); } catch (e) { toast(errMsg(e)); } },
    cancelTrip: async (el) => { try { await S.store.updateTrip(el.dataset.trip, { status: "cancelled" }); await refreshTrips(); renderTrips(); } catch (e) { toast(errMsg(e)); } },
    deleteTrip: async (el) => { if (el.dataset.armed !== "1") { el.dataset.armed = "1"; el.textContent = t("tapAgainDelete"); setTimeout(() => { if (document.contains(el)) { el.dataset.armed = ""; el.textContent = t("deleteTrip"); } }, 5000); return; } try { await S.store.deleteTrip(el.dataset.trip); await refreshTrips(); renderTrips(); toast(t("tripDeleted")); } catch (e) { toast(errMsg(e)); } },
    leaveTrip: async (el) => { try { await S.store.leaveTrip(el.dataset.trip); await refreshTrips(); renderTrips(); toast(t("leftTrip")); } catch (e) { toast(errMsg(e)); } },
    rate: (el) => openRate(el.dataset.trip),
    invites: (el) => openInvites(el.dataset.trip),
    newInvite: async (el) => { try { const url = await S.store.createInvite(el.dataset.trip); $("#inviteOut").innerHTML = `<label class="field">${esc(t("inviteLink"))}<input id="inviteUrl" readonly value="${esc(url)}"></label><div class="row"><button class="btn small" data-action="copyText" data-target="#inviteUrl">${esc(t("copy"))}</button>${navigator.share ? `<button class="btn small" data-action="nativeShare" data-target="#inviteUrl">${esc(t("shareApps"))}</button>` : ""}</div><p class="mini">${esc(t("inviteNoAutoSend"))}</p>`; $("#inviteUrl").select(); } catch (e) { toast(errMsg(e)); } },
    revokeInvite: async (el) => { try { await S.store.revokeInvite(el.dataset.id); toast(t("linkRevoked")); openInvites(el.dataset.trip); } catch (e) { toast(errMsg(e)); } },
    inviteRespond: async (el) => { try { await S.store.respondInvite(el.dataset.token, el.dataset.accept === "1"); closeDialog(); await refreshTrips(); S.tripTab = "trips"; go("trips"); toast(t(el.dataset.accept === "1" ? "joinedTrip" : "declinedTrip")); } catch (e) { openDialog(t("inviteTitle"), `<p role="alert" class="err">${esc(errMsg(e))}</p>`); } },
    groupSearch: async (el) => { const trip = S.trips.find((x) => x.id === el.dataset.trip); if (!trip) return; try { S.groupSignals = await S.store.groupSignals(trip.id); } catch (e) { S.groupSignals = {}; } S.groupTrip = trip.id; $("#fPeople").value = trip.people; setSrc($("#fPeople"), "user"); if (trip.budgetPerPerson) { $("#fPP").value = trip.budgetPerPerson; S.budgetEntered = "pp"; setSrc($("#fPP"), "user"); } updateTotalLine(); go("wish"); $("#h-search").focus(); toast(t("groupReady")); },
    endGroup: () => { S.groupTrip = null; S.groupSignals = {}; runSearch(); },
    tripTab: (el) => { S.tripTab = el.dataset.tab; if ($("#view-trips").hidden) go("trips"); else renderTrips(); const b = $("#tab-" + S.tripTab); if (b) b.focus(); },
    expandAny: () => { $("#fArea").value = ""; setSrc($("#fArea"), "user"); runSearch({ expand: "any" }); },
    expandRadius: () => { const km = nextRadius(S.results.c.where.radiusKm); $("#fRadius").value = String(km); runSearch(); },
    friendInvite: async () => { try { const url = await S.store.createFriendInvite(); $("#friendOut").innerHTML = `<label class="field">${esc(t("inviteLink"))}<input id="friendUrl" readonly value="${esc(url)}"></label><div class="row"><button class="btn small" data-action="copyText" data-target="#friendUrl">${esc(t("copy"))}</button>${navigator.share ? `<button class="btn small" data-action="nativeShare" data-target="#friendUrl">${esc(t("shareApps"))}</button>` : ""}</div><p class="mini">${esc(t("inviteNoAutoSend"))}</p>`; } catch (e) { toast(errMsg(e)); } },
    revokeFriendInvite: async (el) => { try { await S.store.revokeFriendInvite(el.dataset.id); toast(t("linkRevoked")); renderTrips(); } catch (e) { toast(errMsg(e)); } },
    friendAccept: async (el) => { try { await S.store.acceptFriendInvite(el.dataset.token); closeDialog(); S.tripTab = "friends"; go("trips"); toast(t("friendAdded")); } catch (e) { openDialog(t("friendInviteTitle"), `<p role="alert" class="err">${esc(errMsg(e))}</p>`); } },
    friendRespond: async (el) => { try { await S.store.respondFriendRequest(el.dataset.id, el.dataset.accept === "1"); renderTrips(); } catch (e) { toast(errMsg(e)); } },
    removeFriend: async (el) => { if (el.dataset.armed !== "1") { el.dataset.armed = "1"; el.textContent = t("tapAgainRemove"); return; } try { await S.store.removeFriend(el.dataset.user); renderTrips(); } catch (e) { toast(errMsg(e)); } },
    facebookFriends: async () => { sessionStorage.setItem("wishly.fbFriends", "1"); try { await S.server.linkIdentity("facebook", "user_friends"); } catch (e) { try { await S.server.signInWith("facebook", "user_friends"); } catch (e2) { sessionStorage.removeItem("wishly.fbFriends"); toast(errMsg(e2)); } } },
    authTab: (el) => authPane(el.dataset.tab),
    togglePw: (el) => { const i = $(el.dataset.target); const show = i.type === "password"; i.type = show ? "text" : "password"; el.setAttribute("aria-pressed", String(show)); el.textContent = t(show ? "hidePassword" : "showPassword"); },
    oauth: async (el) => { try { await S.server.signInWith(el.dataset.provider); } catch (e) { toast(errMsg(e)); } },
    link: async (el) => { try { await S.server.linkIdentity(el.dataset.provider); } catch (e) { toast(errMsg(e)); } },
    unlink: async (el) => { try { const ids = await S.server.identities(); const id = ids.find((i) => i.provider === el.dataset.provider); if (id) await S.server.unlinkIdentity(id); openAccount(); } catch (e) { toast(errMsg(e)); } },
    resend: async (el) => { try { await S.server.resendVerification(el.dataset.email); toast(t("verificationSent")); } catch (e) { toast(errMsg(e)); } },
    signOut: async () => { try { await S.server.signOut(); S.serverCard = null; closeDialog(); await useGuest(); toast(t("signedOutToast")); } catch (e) { toast(errMsg(e)); } },
    importGuest: async () => { try { const g = await new ST.GuestStore().init(); await S.server.importGuest(await g.exportGuestData()); await loadData(); localize(); toast(t("guestImported")); } catch (e) { toast(errMsg(e)); } },
    pref: (el) => { const x = el.dataset.pref, a = S.profile.prefs; S.profile.prefs = a.includes(x) ? a.filter((y) => y !== x) : [...a, x]; renderProfile(); const n = $(`[data-action=pref][data-pref="${x}"]`); if (n) n.focus(); saveProfileSoon(); },
    copyText: (el) => copyFrom(el.dataset.target),
    nativeShare: async (el) => { const v = $(el.dataset.target).value; try { await navigator.share({ title: "Wishly", text: v }); } catch (e) { if (e.name !== "AbortError") toast(t("shareFailed")); } },
    deleteData: async (el) => {
      if (!delArmed) { delArmed = true; el.textContent = t("tapAgainConfirm"); $("#delMsg").textContent = t(S.store.kind === "server" ? "deleteWarnServer" : "deleteWarn"); clearTimeout(delT); delT = setTimeout(() => { delArmed = false; el.textContent = t("deleteData"); $("#delMsg").textContent = ""; }, 6000); return; }
      delArmed = false; clearTimeout(delT); el.disabled = true;
      try { await S.store.deleteAll(); if (S.store.kind !== "guest") await new ST.GuestStore().init().then((g) => g.deleteAll()); S.device = null; S.loc = "idle"; S.results = null; await loadData(); localize(); $("#delMsg").textContent = t(S.store.kind === "server" ? "deletedServer" : "deleted"); $("#matchArea").innerHTML = `<div class="status">${esc(t("matchesEmpty"))}</div>`; }
      catch (e) { $("#delMsg").textContent = errMsg(e); }
      el.disabled = false; el.textContent = t("deleteData"); announce($("#delMsg").textContent);
    }
  };
  W.app.ACTIONS = ACTIONS;

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]"); if (!el || el.disabled) return;
    if (el.tagName === "INPUT" || el.tagName === "LABEL") return;
    const f = ACTIONS[el.dataset.action]; if (f) f(el, e);
  });
  $("#wishForm").addEventListener("submit", (e) => { e.preventDefault(); understandWish($("#wish").value); });
  $("#wish").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); understandWish($("#wish").value); } });

  // structured fields: anything the person changes becomes "user" and wins over the wish text
  $("#fArea").addEventListener("change", () => setSrc($("#fArea"), "user"));
  $("#fPeople").addEventListener("input", () => { setSrc($("#fPeople"), "user"); updateTotalLine(); });
  $("#fPP").addEventListener("input", () => { S.budgetEntered = $("#fPP").value ? "pp" : null; setSrc($("#fPP"), "user"); setSrc($("#fTotal"), ""); if (!$("#fPP").value) $("#fTotal").value = ""; updateTotalLine(); });
  $("#fTotal").addEventListener("input", () => { S.budgetEntered = $("#fTotal").value ? "total" : null; setSrc($("#fTotal"), "user"); setSrc($("#fPP"), ""); if (!$("#fTotal").value) $("#fPP").value = ""; updateTotalLine(); });
  $("#fPet").addEventListener("change", () => { setSrc($("#fPet"), "user"); $("#fPetTypeWrap").hidden = !$("#fPet").checked; });
  $("#fPetType").addEventListener("change", () => setSrc($("#fPet"), "user"));
  $("#fWheel").addEventListener("change", () => setSrc($("#fWheel"), "user"));

  // profile fields
  $("#pname").addEventListener("input", (e) => { S.profile.name = e.target.value.slice(0, 40); renderGreeting(); saveProfileSoon(); });
  $("#pArea").addEventListener("change", (e) => { S.profile.area = e.target.value; saveProfileSoon(); });
  $("#pPetOwner").addEventListener("change", (e) => { S.profile.petOwner = e.target.checked; if (!e.target.checked) S.profile.bringPetByDefault = false; renderProfile(); applyProfileDefaultsToForm(); saveProfileSoon(); });
  $("#pPetType").addEventListener("change", (e) => { S.profile.petType = e.target.value; applyProfileDefaultsToForm(); saveProfileSoon(); });
  $("#pBringPet").addEventListener("change", (e) => { S.profile.bringPetByDefault = e.target.checked; applyProfileDefaultsToForm(); saveProfileSoon(); });
  $("#pPP").addEventListener("change", (e) => { S.profile.budgetPerPerson = Math.max(0, +e.target.value || 0); applyProfileDefaultsToForm(); saveProfileSoon(); });
  $("#pPeople").addEventListener("change", (e) => { S.profile.groupSize = Math.max(1, Math.min(20, Math.round(+e.target.value) || 1)); e.target.value = S.profile.groupSize; applyProfileDefaultsToForm(); saveProfileSoon(); });
  $("#pBank").addEventListener("change", (e) => { S.profile.bank = e.target.value; saveProfileSoon(); });
  $("#pTier").addEventListener("change", (e) => { S.profile.cardTier = e.target.value; saveProfileSoon(); });
  $("#needs").addEventListener("change", (e) => {
    S.profile.needs = $$("#needs input:checked").map((i) => i.value); renderNeedsNote(); applyProfileDefaultsToForm(); saveProfileSoon();
    const v = e.target.value, on = e.target.checked;
    if (on && v === "vision" && !S.set.size) { S.set.size = 1; applySettings(); toast(t("largerTextOn")); }
    if (on && v === "cognitive" && !S.set.simple) { S.set.simple = true; applySettings(); toast(t("simpleOn")); }
  });
  window.addEventListener("hashchange", () => handleHash());

  W.app.boot = boot; W.app.t = t; W.app.runSearch = runSearch; W.app.understandWish = understandWish;
  boot();
})(window.W = window.W || {});
