// Turns data/places_google_2026-10-21.json into supabase/real_places.sql.
// Every record is 'sourced' (public Google Maps listing), never 'verified':
// nobody has called the place. Run: node tools/make_real_places_sql.cjs
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "data/places_google_2026-10-21.json"), "utf8"));
const SRC = "Google Maps listing", D = data.checked;
const q = (v) => v === null || v === undefined ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const arr = (a) => "array[" + a.map(q).join(",") + "]::text[]";
const json = (o) => q(JSON.stringify(o)) + "::jsonb";
const AREA_AR = { "Maadi": "المعادي", "New Cairo": "القاهرة الجديدة", "Zamalek": "الزمالك", "Downtown": "وسط البلد", "Giza": "الجيزة" };

const rows = [], ev = [], objs = [];
for (const p of data.places) {
  const id = "gm-" + p.cid;
  const map = "https://maps.google.com/?cid=" + p.cid;
  const contacts = { mapUrl: map };
  if (p.phone) contacts.phone = p.phone;
  if (p.web) contacts.website = p.web;
  if (p.menu) contacts.menu = p.menu;
  if (p.social) contacts.social = [{ url: p.social, label: /instagram/.test(p.social) ? "Instagram" : /facebook/.test(p.social) ? "Facebook" : "Social page" }];
  let pet = "unknown", types = [], rEn = null, rAr = null;
  if (p.pets === "in") { pet = "allowed"; types = ["dog"]; }
  if (p.pets === "out") { pet = "allowed"; types = ["dog"]; rEn = "Dogs in the outdoor seating only"; rAr = "الكلاب في الجلسة الخارجية بس"; }
  const wc = {};
  const W = p.wc || {};
  if (W.E !== undefined) wc.step_free = W.E;
  if (W.S !== undefined) wc.interior = W.S;
  if (W.R !== undefined) wc.accessible_toilet = W.R;
  if (W.E === true && W.S === true) wc.reachable = true; // you can get in and sit: the level question is answered
  const feats = [];
  if (W.E === true) feats.push("stepfree");
  if (W.R === true) feats.push("wc");
  if (p.loop) feats.push("hearingloop");
  const hasWc = Object.keys(wc).length > 0;
  const price = p.price || null;
  const pMax = price ? (price[1] === null ? price[0] : price[1]) : null;
  const pMin = price && price[1] !== null ? price[0] : null;
  const notes = [p.conflict].filter(Boolean).join(" ");
  objs.push({ id, record_status: "sourced", name_en: p.name, category: "Food", kind: p.kind, area: p.area, address_en: p.addr, lat: p.lat, lng: p.lng,
    coords_source: SRC, coords_checked_at: D, price_amount: pMax, price_min: pMin, price_open: !!(price && price[1] === null), price_basis: price ? "per_person" : null,
    includes_transport: "excluded", includes_taxes: "unknown", pet_policy: pet, pet_types: types, pet_restrictions_en: rEn, pet_restrictions_ar: rAr,
    pet_source: pet === "unknown" ? null : SRC, pet_checked_at: pet === "unknown" ? null : D, wheelchair: wc, access_features: feats,
    access_source: hasWc || feats.length ? SRC : null, access_checked_at: hasWc || feats.length ? D : null, contacts, contacts_source: SRC, contacts_checked_at: D,
    provider_rating: p.rating, provider_rating_count: p.reviews, provider_rating_source: "Google Maps", tags: p.tags || [], note_en: notes || null, bank_offers: [] });
  rows.push("(" + [
    q(id), "'sourced'", q(p.name), "null", "'Food'", q(p.kind), q(p.area), q(p.addr), "null",
    p.lat, p.lng, q(SRC), q(D),
    pMax === null ? "null" : pMax, pMin === null ? "null" : pMin, price && price[1] === null ? "true" : "false", price ? "'per_person'" : "null",
    "'excluded'", "'unknown'",
    q(pet), arr(types), q(rEn), q(rAr), pet === "unknown" ? "null" : q(SRC), pet === "unknown" ? "null" : q(D),
    json(wc), arr(feats), hasWc || feats.length ? q(SRC) : "null", hasWc || feats.length ? q(D) : "null",
    json(contacts), q(SRC), q(D),
    p.rating, p.reviews, "'Google Maps'", arr(p.tags || []), q(notes || null)
  ].join(", ") + ")");
  ev.push(`(${q(id)}, 'coords', ${q("Pin and address on the public Google Maps listing")}, 'official_listing', ${q(map)}, ${q(D)})`);
  ev.push(`(${q(id)}, 'contacts', ${q("Phone/website/menu links as shown on the Google Maps listing" + (p.phone ? "" : " (no phone listed)"))}, 'official_listing', ${q(map)}, ${q(D)})`);
  if (pet !== "unknown") ev.push(`(${q(id)}, 'pets', ${q(p.pets === "out" ? "Listing: Dogs allowed outside" : "Listing: Dogs allowed")}, 'official_listing', ${q(map)}, ${q(D)})`);
  if (hasWc) ev.push(`(${q(id)}, 'wheelchair', ${q("Listing accessibility: " + Object.entries(W).map(([k, v]) => ({ E: "entrance", S: "seating", R: "restroom" })[k] + "=" + v).join(", "))}, 'official_listing', ${q(map)}, ${q(D)})`);
  if (price) ev.push(`(${q(id)}, 'price', ${q("Google price range per person: E£" + price[0] + (price[1] === null ? "+" : "–" + price[1]))}, 'official_listing', ${q(map)}, ${q(D)})`);
}
const cols = "id, record_status, name_en, name_ar, category, kind, area, address_en, address_ar, lat, lng, coords_source, coords_checked_at, price_amount, price_min, price_open, price_basis, includes_transport, includes_taxes, pet_policy, pet_types, pet_restrictions_en, pet_restrictions_ar, pet_source, pet_checked_at, wheelchair, access_features, access_source, access_checked_at, contacts, contacts_source, contacts_checked_at, provider_rating, provider_rating_count, provider_rating_source, tags, note_en";
const upd = cols.split(", ").filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
let sql = `-- Real places from public Google Maps listings, checked ${D}. Status 'sourced', not 'verified'.\n-- Generated by tools/make_real_places_sql.cjs; safe to run again (upsert).\n`;
sql += "alter table public.places add column if not exists price_min numeric check (price_min >= 0);\nalter table public.places add column if not exists price_open boolean not null default false;\n\n";
sql += `insert into public.places (${cols}) values\n${rows.join(",\n")}\non conflict (id) do update set ${upd}, updated_at = now();\n\n`;
sql += `insert into public.place_evidence (place_id, field, summary, source_type, source_url, checked_at)\nselect v.* from (values\n${ev.join(",\n")}\n) as v(place_id, field, summary, source_type, source_url, checked_at)\nwhere not exists (select 1 from public.place_evidence e where e.place_id = v.place_id and e.field = v.field and e.checked_at = v.checked_at::date);\n`;
sql = sql.replace("select v.* from", "select v.place_id, v.field, v.summary, v.source_type, v.source_url, v.checked_at::date from");
module.exports = { rows: objs };
if (require.main === module) { fs.writeFileSync(path.join(root, "supabase/real_places.sql"), sql);
console.log("places:", rows.length, "evidence:", ev.length, "bytes:", sql.length); }
