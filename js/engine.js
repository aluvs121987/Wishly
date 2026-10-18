/* Wishly matching engine: pure functions, no DOM.
 * 1. parseWish()      reads a free-text wish (English or Egyptian Arabic)
 * 2. buildConstraints() merges it with the structured search fields
 *                      (structured fields always win) and the profile
 * 3. evaluatePlace()   checks every hard requirement BEFORE ranking and
 *                      returns confirmed / ask / excluded with reasons
 * 4. search()          filters, scores (WishScore) and groups the results
 * All user-facing text is produced by the UI from the codes returned here.
 */
(function (W) {
  "use strict";
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

  const NEEDS = {
    mobility: { tags: ["stepfree", "wc"], core: ["stepfree"] },
    vision: { tags: ["braille", "audio", "online", "text"], core: ["braille", "audio", "online", "text"] },
    hearing: { tags: ["sign", "captions", "text"], core: ["sign", "captions", "text"] },
    speech: { tags: ["text", "sign"], core: ["text", "sign"] },
    cognitive: { tags: ["easyread", "quiet"], core: ["easyread", "quiet"] }
  };
  const CATS = ["Shopping", "Food", "Experiences", "Services", "Travel", "Learning"];
  // Kinds where people stay a while, so an accessible toilet matters
  const STAY_KINDS = new Set(["cafe", "restaurant", "cinema", "museum", "resort", "workshop", "class", "spa", "daytrip", "park", "boat"]);

  function norm(text) {
    return String(text || "").toLowerCase()
      .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
      .replace(/٫/g, ".").replace(/٬/g, ",")
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/[ً-ْ]/g, "");
  }

  const KW = {
    Food: /\b(food|eat|dinner|lunch|breakfast|restaurant|coffee|brunch|meal|koshary|grill)\b|\bcaf[eé]s?(?![a-z])|اكل|عشا|غدا|فطار|مطعم|كافيه|كافي|قهوه/,
    Shopping: /\b(gift|buy|shop|present|books?|bookshop|bookstore|store)\b|هدي|هدايا|اشتري|شرا|محل/,
    Experiences: /\b(outing|afternoon|evening|fun|experience|activit\w*|museum|cinema|movie|film|picnic|boat|felucca|memorable|go out|day out)\b|خروجه|فسحه|سينما|فيلم|متحف|نزهه|حديقه/,
    Services: /\b(spa|massage|clean\w*|service|fix|help at home|barber|haircut|hair|salon|beard|groom\w*)\b|حلاق|شعر|سبا|مساج|تنظيف|نضافه/,
    Travel: /\b(trip|travel|weekend|getaway|resort|beach|vacation|holiday)\b|رحله|سفر|مصيف|ساحل|السخنه|ويك اند|اجازه/,
    Learning: /\b(learn|class|course|workshop|lesson|skill|curious)\b|اتعلم|تعلم|كورس|ورشه|درس/
  };
  const KIND_KW = { cafe: /\bcaf[eé]s?(?![a-z])|\bcoffee\s*(shop|house)?\b|كافيه|كافي|قهوه|كوفي/ };
  const MOOD = {
    relax: /\b(relax\w*|calm|quiet|tired|rest|reset|peace\w*|stress\w*|unwind)\b|هادي|هدوء|ريلاكس|راحه|تعبان|مضغوط/,
    celebrate: /\b(birthday|celebrat\w*|anniversar\w*|special|party|memorable)\b|عيد ميلاد|احتفال|مناسبه|مميز/,
    learn: /\b(learn|curious|class|workshop)\b|اتعلم|تعلم|كورس|ورشه/,
    fun: /\b(fun|night out|enjoy|exciting|entertain\w*)\b|فرفشه|مزاج/,
    outdoor: /\b(outdoors?|outside|nature|park|fresh air|sunset)\b|طبيعه|هوا طلق/,
    romantic: /\b(romantic|date|wife|husband|partner|couple|fianc\w*)\b|مراتي|جوزي|خطيب/,
    gift: /\b(gift|present)\b|هدي|هدايا/,
    family: /\b(family|kids|child\w*|parents)\b|عيله|عائله|اولاد|اطفال/,
    value: /\b(cheap|affordab\w*|value|save money|saving|good deal)\b|رخيص|توفير/
  };
  const NEED_KW = {
    mobility: /\b(wheel\s?chair\w*|can'?t walk|mobility|crutch\w*|ramp|step[- ]?free|walker)\b|كرسي متحرك|منحدر|مش بقدر امشي/,
    vision: /\b(blind|low vision|can'?t see|braille|visually)\b|كفيف|ضعيف البصر|برايل/,
    hearing: /\b(deaf|hard of hearing|sign language)\b|اصم|ضعيف السمع|لغه الاشاره/,
    speech: /\b(can'?t speak|mute|no calls|non[- ]?verbal)\b|ابكم|مش بتكلم|مبتكلمش/,
    cognitive: /\b(autis\w*|adhd|overwhelm\w*|down syndrome|learning difficult\w*|intellectual)\b|توحد|فرط الحركه|داون/
  };
  const PET_NEG = /\b(no pets?|without (a |my )?(pet|dog|cat)|not bringing (the |my )?(pet|dog|cat)|leave (the |my )?(dog|cat|pet) at home)\b|بدون حيوان|من غير حيوان|من غير الكلب|من غير القطه/;
  const PET_DOG = /\b(dogs?|puppy)\b|كلب|كلبي|الكلب/;
  const PET_CAT = /\b(cats?|kitten)\b|قطه|قطتي|القطه/;
  const PET_ANY = /\bpet[- ]?friendly\b|\bpets?\b|\bwith (my|our|a) (pet|dog|cat)\b|حيوان|اليف/;
  const STOP = new Set(["house", "home", "night", "city", "visit", "market", "lounge", "delivery", "garden", "classic", "calm",
    "egyptian", "cairo", "park", "lawn", "day", "trip", "cafe", "café", "dinner"]);

  /* ---------- budget ---------- */
  function parseBudget(t) {
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(k\b|الف|ألف)?/g;
    let m, best = null;
    while ((m = re.exec(t))) {
      let v = +m[1].replace(/,/g, ""); if (m[2]) v *= 1000;
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 26);
      const cur = /(egp|\ble\b|l\.e|pounds?|جنيه|ج\.م|budget|ميزانيه)/.test(before + " " + after);
      if (/^\s*(min|minutes?|people|persons?|person\b|of us|adults|guests|friends|km|kilomet|m\b|am|pm|hours?|years?|days?|nights?|stars?|اشخاص|افراد|فرد\b|دقيقه|دقايق|ساعه|ساعات|كيلو|سنه|ليالي|يوم)/.test(after)) continue;
      if (/(for|of|with|ل)\s*$/.test(before) && /^\s*(people|persons|of us|اشخاص|افراد)/.test(after)) continue;
      if (v < 20) continue;
      if (v >= 1900 && v <= 2100 && !cur) continue;
      // an amount with no qualifier is treated as a limit ("budget 700" = up to 700)
      let mode = "cap";
      if (/(around|about|roughly|approx\w*|حوالي|تقريبا|في حدود)\s*(egp|le|جنيه)?\s*$/.test(before)) mode = "around";
      else if (/(over|more than|above|at least|starting|اكتر من|اكثر من|فوق)\s*(egp|le|جنيه)?\s*$/.test(before)) mode = "over";
      else if (/(under|less than|below|max(imum)?|up to|within|no more than|cheaper than|budget( of| is)?|اقل من|تحت|لحد|مش اكتر من|ميزانيه|بميزانيه|حد اقصي|بحد اقصي)\s*:?\s*(egp|le|جنيه)?\s*$/.test(before)) mode = "cap";
      const tail = after + " " + t.slice(m.index + m[0].length, m.index + m[0].length + 40);
      let basis = "unspecified";
      if (/^\s*(egp|le|pounds?|جنيه|ج\.م)?\s*(per person|per head|each|pp\b|a head|\/ ?person|للفرد|لكل فرد|للشخص|لكل شخص|الفرد|للواحد|لكل واحد)/.test(tail)) basis = "per_person";
      else if (/^\s*(egp|le|pounds?|جنيه)?\s*(total|in total|altogether|for (both|all|everyone|the group)|اجمالي|للكل|لينا كلنا|للمجموعه)/.test(tail) || /(total|in total|اجمالي)\s*(budget)?\s*(of)?\s*(egp|le)?\s*$/.test(before)) basis = "total";
      if (!best || v > best.amount) best = { amount: v, mode, basis };
    }
    return best;
  }

  /* ---------- free-text wish ---------- */
  function parseWish(text) {
    const t = norm(text);
    const out = { text: String(text || ""), t };
    out.budget = parseBudget(t);
    let people = null;
    const md = t.match(/\b(\d{1,2})\s*(people|persons|of us|adults|guests|friends)\b/) || t.match(/(\d{1,2})\s*(اشخاص|افراد|شخص)/) || t.match(/\bfor (\d{1,2})\b(?!\s*(egp|le|pm|am|:))/);
    if (md) people = +md[1];
    else if (/\b(just me|myself|alone|solo)\b|لوحدي/.test(t)) people = 1;
    else if (/\b(two|for 2|couple|my wife|my husband|my partner|date|fianc\w*|anniversar\w*)\b|اتنين|شخصين|لشخصين|مراتي|جوزي|خطيبي|خطيبتي/.test(t)) people = 2;
    else if (/\b(three)\b|تلاته|ثلاثه/.test(t)) people = 3;
    else if (/\b(four)\b|اربعه/.test(t)) people = 4;
    out.people = people;
    out.cats = Object.keys(KW).filter((k) => KW[k].test(t));
    out.kind = KIND_KW.cafe.test(t) ? "cafe" : null;
    out.moods = Object.keys(MOOD).filter((k) => MOOD[k].test(t));
    out.needs = Object.keys(NEED_KW).filter((k) => NEED_KW[k].test(t));
    let area = null;
    for (const a of W.AREAS || []) if (t.includes(norm(a))) { area = a; break; }
    if (!area) for (const [en, ar] of Object.entries(W.AREA_AR || {})) {
      const n = norm(ar); if (n.length > 3 && (t.includes(n) || t.includes(n.replace(/^ال/, "")))) { if ((W.AREAS || []).includes(en)) { area = en; break; } }
    }
    out.area = area;
    const negated = PET_NEG.test(t);
    const type = PET_DOG.test(t) ? "dog" : PET_CAT.test(t) ? "cat" : null;
    out.pet = negated ? { mentioned: true, accompanying: false } :
      (type || PET_ANY.test(t)) ? { mentioned: true, accompanying: true, type } : { mentioned: false };
    return out;
  }

  /* ---------- constraints ----------
   * form: values from the structured search fields, with `set` flags for the
   *       ones the person filled in themselves.
   * profile: saved defaults (used only when neither the form nor the wish says).
   */
  function buildConstraints(parsed, form, profile) {
    profile = profile || {};
    const conflicts = [];
    const fromText = {};
    const c = { text: parsed.text, cats: parsed.cats.slice(), kind: parsed.kind, moods: parsed.moods.slice(), prefs: (profile.prefs || []).slice() };

    // people
    if (form.peopleSet) { c.people = form.people; c.peopleSource = "form"; if (parsed.people && parsed.people !== form.people) conflicts.push({ field: "people", text: parsed.people, used: form.people }); }
    else if (parsed.people) { c.people = parsed.people; c.peopleSource = "text"; fromText.people = parsed.people; }
    else { c.people = clampInt(profile.groupSize, 1, 20, 1); c.peopleSource = "profile"; }

    // budget
    const pb = parsed.budget;
    if (form.perPersonSet && form.perPerson > 0) {
      c.budget = { perPerson: form.perPerson, total: form.perPerson * c.people, mode: form.budgetMode || "cap", source: "form" };
      if (pb && !sameBudget(pb, c)) conflicts.push({ field: "budget", text: pb.amount, used: form.perPerson });
    } else if (form.totalSet && form.total > 0) {
      c.budget = { perPerson: form.total / c.people, total: form.total, mode: form.budgetMode || "cap", source: "form", enteredAs: "total" };
      if (pb && !sameBudget(pb, c)) conflicts.push({ field: "budget", text: pb.amount, used: form.total });
    } else if (pb) {
      const perPerson = pb.basis === "per_person" ? pb.amount : pb.amount / c.people;
      c.budget = { perPerson, total: pb.basis === "per_person" ? pb.amount * c.people : pb.amount, mode: pb.mode, source: "text",
        enteredAs: pb.basis === "per_person" ? "per_person" : "total", basisAssumed: pb.basis === "unspecified" };
      fromText.budget = pb;
    } else if (profile.budgetPerPerson > 0) {
      c.budget = { perPerson: profile.budgetPerPerson, total: profile.budgetPerPerson * c.people, mode: "cap", source: "profile" };
    } else c.budget = null;

    // where
    if (form.locationMode === "device" && form.device) {
      c.where = { mode: "device", device: form.device, radiusKm: form.radiusKm || 5 };
      if (parsed.area) conflicts.push({ field: "area", text: parsed.area, used: "device" });
    } else if (form.areaSet && form.area) {
      c.where = { mode: "area", area: form.area };
      if (parsed.area && parsed.area !== form.area) conflicts.push({ field: "area", text: parsed.area, used: form.area });
    } else if (form.areaSet && !form.area) {
      c.where = { mode: "any" };
      if (parsed.area) conflicts.push({ field: "area", text: parsed.area, used: "any" });
    } else if (parsed.area) { c.where = { mode: "area", area: parsed.area }; fromText.area = parsed.area; }
    else c.where = { mode: "any" };

    // pet: owning a pet never forces pet-friendly; only "accompanying" does
    if (form.petSet) {
      c.pet = { accompanying: !!form.petAccompanying, type: form.petType || profile.petType || "dog" };
      if (parsed.pet.mentioned && parsed.pet.accompanying !== c.pet.accompanying) conflicts.push({ field: "pet", text: parsed.pet.accompanying, used: c.pet.accompanying });
    } else if (parsed.pet.mentioned) {
      c.pet = { accompanying: parsed.pet.accompanying, type: parsed.pet.type || profile.petType || "dog" };
      fromText.pet = c.pet.accompanying;
    } else c.pet = { accompanying: !!(profile.petOwner && profile.bringPetByDefault), type: profile.petType || "dog", fromProfile: !!(profile.petOwner && profile.bringPetByDefault) };

    // access needs: profile needs + wish + wheelchair checkbox
    const needs = new Set([...(profile.needs || []), ...parsed.needs]);
    if (form.wheelchairSet) { if (form.wheelchair) needs.add("mobility"); else if (!parsed.needs.includes("mobility")) needs.delete("mobility"); }
    c.needs = [...needs].filter((n) => NEEDS[n]);
    c.wheelchair = c.needs.includes("mobility");
    c.startArea = profile.area || null;
    c.conflicts = conflicts; c.fromText = fromText;
    return c;
  }
  function sameBudget(pb, c) {
    const v = pb.basis === "per_person" ? c.budget.perPerson : c.budget.total;
    return Math.abs(v - pb.amount) < 1;
  }
  function clampInt(v, lo, hi, d) { v = Math.round(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }

  /* ---------- helpers ---------- */
  function distanceKm(a, b) {
    const rad = (x) => x * Math.PI / 180;
    const d1 = rad(b[0] - a[0]), d2 = rad(b[1] - a[1]);
    const h = Math.sin(d1 / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(d2 / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function groupCost(place, people) {
    if (!place.price || !(place.price.amount >= 0)) return null;
    const pp = place.price.basis === "per_person";
    return { unit: place.price.amount, basis: place.price.basis, people, total: pp ? place.price.amount * people : place.price.amount, perPerson: pp };
  }
  function evidenceOk(place, kind) {
    if (place.status === "demo") return false;
    if (kind === "pets") return !!(place.pets && place.pets.source && place.pets.checked);
    if (kind === "access") return !!(place.accessSource && place.accessChecked);
    if (kind === "coords") return !!(place.coords && place.coords.source && place.coords.checked);
    return false;
  }
  function areaEstimate(place, startArea) {
    const to = W.AREA_CENTRES && W.AREA_CENTRES[place.area], from = W.AREA_CENTRES && W.AREA_CENTRES[startArea];
    if (!to || !from) return null;
    const km = distanceKm(from, to);
    return { km, mins: Math.max(5, Math.round(km * 2.6 + 5)) };
  }

  /* ---------- wheelchair (three states) ---------- */
  function wheelchairCheck(place) {
    const w = place.wheelchair || {};
    const fails = [], missing = [];
    const entrance = w.stepFree === true || w.ramp === true ? true : (w.stepFree === false && w.ramp !== true ? false : null);
    if (entrance === false) fails.push("wc_entrance"); else if (entrance === null) missing.push("wc_entrance");
    if (w.interior === false) fails.push("wc_interior"); else if (w.interior !== true) missing.push("wc_interior");
    const level = w.groundFloor === true || w.lift === true ? true : (w.groundFloor === false && w.lift === false ? false : null);
    if (level === false) fails.push("wc_level"); else if (level === null) missing.push("wc_level");
    if (STAY_KINDS.has(place.kind)) { if (w.toilet === false) fails.push("wc_toilet"); else if (w.toilet !== true) missing.push("wc_toilet"); }
    const evidence = evidenceOk(place, "access");
    if (fails.length) return { state: "unsuitable", fails, missing, evidence };
    if (!missing.length && evidence) return { state: "suitable", fails, missing, evidence };
    return { state: "unknown", fails, missing, evidence };
  }

  /* ---------- evaluate one place against every hard requirement ---------- */
  function evaluatePlace(place, c, ctx) {
    ctx = ctx || {};
    const failures = [], unknowns = [], met = [];
    if (ctx.excluded && ctx.excluded.has(place.id)) failures.push({ code: "excluded_by_you" });
    if (c.cats.length) { if (c.cats.includes(place.cat)) met.push({ code: "category", v: place.cat }); else failures.push({ code: "category", v: place.cat }); }
    if (c.kind) { if (place.kind === c.kind) met.push({ code: "kind", v: c.kind }); else failures.push({ code: "kind", v: place.kind }); }

    let distance = null;
    if (c.where.mode === "area") {
      if (place.comesToYou) met.push({ code: "comes_to_you" });
      else if (place.area === c.where.area) met.push({ code: "area", v: c.where.area });
      else failures.push({ code: "area", v: place.area });
    } else if (c.where.mode === "device") {
      if (place.comesToYou) met.push({ code: "comes_to_you" });
      else if (!evidenceOk(place, "coords")) failures.push({ code: "no_coords" });
      else {
        distance = distanceKm([c.where.device.lat, c.where.device.lng], [place.coords.lat, place.coords.lng]);
        if (distance <= c.where.radiusKm) met.push({ code: "radius", v: distance }); else failures.push({ code: "radius", v: distance });
      }
    }

    const cost = groupCost(place, c.people);
    if (c.budget) {
      if (!cost) unknowns.push({ code: "price_unknown" });
      else {
        const limit = c.budget.mode === "around" ? c.budget.total * 1.15 : c.budget.total;
        if (c.budget.mode === "over") met.push({ code: "budget_min", v: cost.total });
        else if (cost.total <= limit + 0.5) met.push({ code: "budget", v: cost.total });
        else failures.push({ code: "over_budget", v: cost.total });
      }
    }

    if (c.pet && c.pet.accompanying) {
      const p = place.pets || { policy: "unknown" };
      if (p.policy === "not_allowed") failures.push({ code: "pets_not_allowed" });
      else if (p.policy === "allowed" && p.types && p.types.length && !p.types.includes(c.pet.type)) failures.push({ code: "pet_type", v: c.pet.type });
      else if (p.policy === "allowed" && evidenceOk(place, "pets")) met.push({ code: "pets_ok", v: c.pet.type });
      else unknowns.push({ code: "pets_unconfirmed", v: p.policy === "allowed" ? "claimed" : "unknown" });
    }

    let wc = null;
    for (const n of c.needs) {
      if (n === "mobility") {
        wc = wheelchairCheck(place);
        if (place.comesToYou) { met.push({ code: "comes_to_you_access" }); continue; }
        if (wc.state === "unsuitable") failures.push({ code: "wheelchair_unsuitable", v: wc.fails });
        else if (wc.state === "suitable") met.push({ code: "wheelchair_ok" });
        else unknowns.push({ code: "wheelchair_unconfirmed", v: wc.missing.length ? wc.missing : ["wc_evidence"], evidence: wc.evidence });
      } else {
        const has = NEEDS[n].core.some((f) => (place.access || []).includes(f));
        if (!evidenceOk(place, "access")) unknowns.push({ code: "access_unconfirmed", v: n, claimed: has });
        else if (has) met.push({ code: "access_ok", v: n });
        else failures.push({ code: "access_unsupported", v: n });
      }
    }
    const status = failures.length ? "excluded" : unknowns.length ? "ask" : "confirmed";
    return { id: place.id, status, failures, unknowns, met, cost, distance, wheelchair: wc };
  }

  /* ---------- WishScore: explained, never hides a failed requirement ---------- */
  const COMMON_TAGS = new Set(["value", "quiet", "relax", "romantic", "celebrate", "family", "outdoor", "learn", "social", "fun", "treat", "personal", "creative", "culture", "adventure", "home", "gift"]);
  function wishScore(place, ev, c, ctx) {
    ctx = ctx || {};
    const parts = [];
    const add = (code, pts, v) => { if (pts) parts.push({ code, pts, v }); };
    add("base", 50);
    if (c.cats.length && c.cats.includes(place.cat)) add("category", 12, place.cat);
    if (c.kind && place.kind === c.kind) add("kind", 6, c.kind);
    const words = (place.tags || []).filter((w) => !COMMON_TAGS.has(w)).concat(norm(place.name.en).split(/[^a-z]+/)).filter((w) => w.length > 3 && !STOP.has(w));
    if (words.some((w) => new RegExp("\\b" + w).test(norm(c.text)))) add("name_hit", 10);
    const mh = c.moods.filter((m) => (place.tags || []).includes(m));
    if (mh.length) add("mood", Math.min(18, mh.length * 6), mh);
    const pref = { "Good value": "value", "Quiet places": "quiet", "Outdoors": "outdoor", "Family friendly": "family", "Celebrations": "celebrate", "Learning something new": "learn" };
    for (const [p, tag] of Object.entries(pref)) if (c.prefs.includes(p) && (place.tags || []).includes(tag)) add("pref", 4, p);
    if (c.prefs.includes("Within 30 min") && c.where.mode !== "device") {
      const est = place.comesToYou ? { mins: 0 } : areaEstimate(place, c.startArea);
      if (est && est.mins <= 30) add("pref_near", 4, est.mins);
    }
    if (c.budget && ev.cost && c.budget.mode !== "over") {
      const r = ev.cost.total / c.budget.total;
      if (r >= 0.6 && r <= 1.15) add("budget_fit", 8, ev.cost.total);
      else if (r < 0.6) add("budget_under", 4, ev.cost.total);
    }
    if (ev.distance !== null) add("distance", Math.max(0, Math.round(8 - ev.distance)), ev.distance);
    if (c.needs.length) {
      const extra = [...new Set(c.needs.flatMap((n) => NEEDS[n] ? NEEDS[n].tags : []))].filter((f) => (place.access || []).includes(f)).length;
      add("access_extra", Math.min(6, extra * 2), extra);
    }
    const g = ctx.groupSignals && ctx.groupSignals[place.id];
    if (g && g.count) add("group_rating", g.avg >= 4 ? 6 : g.avg <= 2 ? -12 : 0, g);
    if (ev.unknowns.length) add("missing_info", -4 * ev.unknowns.length, ev.unknowns.length);
    const score = Math.max(0, Math.min(97, parts.reduce((s, p) => s + p.pts, 0)));
    return { score, parts };
  }

  function search(places, c, ctx) {
    ctx = ctx || {};
    const all = places.map((p) => ({ place: p, ev: evaluatePlace(p, c, ctx) }));
    const excludedCounts = {};
    for (const x of all) if (x.ev.status === "excluded") for (const f of x.ev.failures) excludedCounts[f.code] = (excludedCounts[f.code] || 0) + 1;
    const scoreIt = (x) => Object.assign(x, wishScore(x.place, x.ev, c, ctx));
    const confirmed = all.filter((x) => x.ev.status === "confirmed").map(scoreIt).sort((a, b) => b.score - a.score);
    const ask = all.filter((x) => x.ev.status === "ask").map(scoreIt).sort((a, b) => b.score - a.score);
    // a wish that only names a feeling ("something outdoors") still has to match it
    const relevant = (x) => c.cats.length || c.kind || !c.moods.length || x.parts.some((p) => p.code === "mood" || p.code === "name_hit");
    const top = confirmed.filter(relevant).slice(0, ctx.limit || 5);
    // a place excluded ONLY by the area/radius could be offered by expanding
    const onlyWhere = all.filter((x) => x.ev.status === "excluded" && x.ev.failures.every((f) => ["area", "radius", "no_coords"].includes(f.code)));
    const personal = all.filter((x) => x.ev.failures.some((f) => f.code === "excluded_by_you"));
    const weak = !top.length || (!c.cats.length && !c.moods.length && !c.kind && top[0].score < 58);
    return { confirmed: top, ask: ask.filter(relevant).slice(0, 6), excludedCounts, expandable: onlyWhere.length, personalExcluded: personal.map((x) => x.place.id), weak, total: places.length };
  }

  /* ---------- Africa/Cairo time ---------- */
  const CAIRO = "Africa/Cairo";
  function cairoParts(ms) {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return o;
  }
  function cairoOffsetMs(ms) {
    const p = cairoParts(ms);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  }
  /** "2026-10-24T17:00" (Cairo wall time) -> ISO UTC string */
  function cairoToUTC(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || ""); if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let utc = guess - cairoOffsetMs(guess);
    utc = guess - cairoOffsetMs(utc);
    return new Date(utc).toISOString();
  }
  /** ISO UTC -> "YYYY-MM-DDTHH:mm" in Cairo, for <input type=datetime-local> */
  function utcToCairoInput(iso) {
    if (!iso) return ""; const p = cairoParts(Date.parse(iso));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function formatCairo(iso, lang) {
    if (!iso) return "";
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: CAIRO, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }

  W.engine = { NEEDS, CATS, STAY_KINDS, norm, parseBudget, parseWish, buildConstraints, evaluatePlace, wishScore, search, distanceKm, groupCost, evidenceOk, wheelchairCheck, areaEstimate, cairoToUTC, utcToCairoInput, formatCairo };
})(window.W = window.W || {});
