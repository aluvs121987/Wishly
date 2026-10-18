// Checks that English and Arabic have the same keys and that every key the
// app uses exists. Run: node tests/unit/i18n.test.cjs
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "../..");
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ["js/i18n.js", "js/places.js", "js/engine.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx);
const W = ctx.window.W, en = W.I18N.en, ar = W.I18N.ar;
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8"), html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const problems = [];
for (const k of Object.keys(en)) if (!(k in ar)) problems.push("missing in Arabic: " + k);
for (const k of Object.keys(ar)) if (!(k in en)) problems.push("missing in English: " + k);
for (const [k, v] of Object.entries(ar)) if (!v || !String(v).trim()) problems.push("empty Arabic: " + k);
// placeholders must match
for (const k of Object.keys(en)) { const a = (en[k].match(/\{\w+\}/g) || []).sort().join(), b = ((ar[k] || "").match(/\{\w+\}/g) || []).sort().join(); if (a !== b) problems.push(`placeholders differ for ${k}: ${a} vs ${b}`); }
const used = new Set();
// t("key" ...) and the string literals that appear directly as t()'s first argument expression
const re = /\bt\(\s*([^,)]*)/g; let m;
while ((m = re.exec(app))) for (const lit of m[1].match(/"([A-Za-z0-9_ ]+)"/g) || []) used.add(lit.slice(1, -1));
for (const mm of html.matchAll(/data-t="([^"]+)"/g)) used.add(mm[1]);
for (const mm of html.matchAll(/data-t-attr="([^"]+)"/g)) for (const pair of mm[1].split(";")) used.add(pair.split(":")[1]);
// families built at run time
const fam = (prefix, list) => list.forEach((x) => used.add(prefix + x));
fam("cat_", W.engine.CATS); fam("kind_", [...new Set(W.DEMO_PLACES.map((p) => p.kind))]);
fam("mood_", ["relax", "celebrate", "learn", "fun", "outdoor", "romantic", "gift", "family", "value"]);
fam("need_", Object.keys(W.engine.NEEDS)); fam("needDesc_", Object.keys(W.engine.NEEDS)); fam("driver_", Object.keys(W.engine.NEEDS)); fam("ask_access_", Object.keys(W.engine.NEEDS));
fam("pref_", ["Good value", "Quiet places", "Within 30 min", "For two", "Family friendly", "Outdoors", "Celebrations", "Learning something new"]);
fam("fail_", ["excluded_by_you", "category", "kind", "area", "no_coords", "radius", "over_budget", "pets_not_allowed", "pet_type", "wheelchair_unsuitable", "access_unsupported"]);
fam("wc_", ["entrance", "interior", "level", "toilet", "evidence"]); fam("ask_wc_", ["entrance", "interior", "level", "toilet", "evidence"]);
fam("part_", ["base", "category", "kind", "name_hit", "mood", "pref", "budget_fit", "budget_under", "distance", "access_extra", "group_rating".replace("group_rating", "group"), "missing"]);
fam("status_", ["sourced", "verified"]); fam("basis_", ["per_person", "per_booking", "per_item", "per_visit"]); fam("inc_", ["included", "excluded", "unknown"]);
fam("petPolicy_", ["allowed", "not_allowed", "unknown"]); fam("feat_", [...new Set(W.DEMO_PLACES.flatMap((p) => p.access))]);
fam("tab_", ["trips", "saved", "experiences", "excluded", "friends"]); fam("pstatus_", ["accepted", "declined"]); fam("tstatus_", ["planned", "completed", "cancelled"]);
fam("link_", ["active", "revoked", "expired", "used"]);
for (const g of [["what", ["food", "outing", "gift", "learn", "trip", "relax"]], ["who", ["me", "two", "family", "friends"]], ["budget", ["low", "mid", "high"]], ["feel", ["calm", "happy", "curious", "special"]]]) { fam("pic_" + g[0] + "_", g[1]); fam("pict_" + g[0] + "_", g[1]); }
for (const i of [1, 2, 3, 4]) fam("idea" + i, ["Tag", "Title", "Meta", "Text"]);
fam("err_", ["invite_invalid", "invite_revoked", "invite_expired", "invite_used_up", "invite_own", "trip_not_found", "not_a_member", "review_before_visit", "rating_out_of_range", "request_not_allowed", "request_not_found", "already_friends", "request_self", "trip_cancelled", "not_a_guest", "not_authenticated", "trip_owner_and_place_are_fixed", "auth_invalid", "auth_unconfirmed", "auth_weak_password", "auth_rate_limited", "auth_exists", "server_unreachable", "server_error", "storage_unavailable", "save_failed", "storage_full", "facebook_failed"]);
const ignore = new Set(["invite", "Tag", "Title", "Meta", "Text", "_", "claimed", "Delivered", "mobility", "denied", "1", "ar", "en", "server", "claude", "guest", "user", "text", "profile", "other", "device", "area", "any", "over", "around", "cap", "rating", "manual", "owner", "pp", "total", "demo", "email", "google", "facebook", "completed", "cancelled", "accepted"]);
for (const k of used) if (!(k in en) && !ignore.has(k) && !/_$/.test(k)) problems.push("used but not defined: " + k);
console.log(problems.length ? problems.join("\n") : "");
console.log(`${Object.keys(en).length} keys in each language; ${used.size} keys referenced; ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
