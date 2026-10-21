// Unit tests for js/engine.js (pure logic). Run: node tests/unit/engine.test.cjs
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "../..");
const ctx = { window: {}, Intl, Date, Math, console };
vm.createContext(ctx);
for (const f of ["js/places.js", "js/engine.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const W = ctx.window.W, E = W.engine;
const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail: cond ? "" : JSON.stringify(detail) }); }
const noForm = { };
const run = (text, form, profile, extra) => {
  const c = E.buildConstraints(E.parseWish(text), form || noForm, profile || {});
  return { c, r: E.search(extra && extra.places || W.DEMO_PLACES, c, extra || {}) };
};

// Budget and group --------------------------------------------------------
let p = E.parseWish("Pet-friendly café in Maadi, Cairo. Budget 700 EGP per person, 2 people");
check("EN: 700 per person parsed", p.budget && p.budget.amount === 700 && p.budget.basis === "per_person", p.budget);
check("EN: 2 people parsed", p.people === 2, p.people);
check("EN: Maadi parsed", p.area === "Maadi", p.area);
check("EN: café kind parsed", p.kind === "cafe", p.kind);
check("EN: pet accompanying parsed", p.pet.accompanying === true, p.pet);
let c = E.buildConstraints(p, {}, {});
check("700 × 2 = 1,400 total", c.budget.total === 1400 && c.budget.perPerson === 700, c.budget);
p = E.parseWish("كافيه في المعادي بميزانية ٧٠٠ جنيه للفرد لشخصين ومعانا كلب");
c = E.buildConstraints(p, {}, {});
check("AR + Arabic digits: 700 per person × 2 = 1,400", c.budget && c.budget.total === 1400 && c.people === 2, { b: c.budget, people: c.people });
check("AR: المعادي → Maadi", c.where.area === "Maadi", c.where);
check("AR: كلب → dog accompanying", c.pet.accompanying && c.pet.type === "dog", c.pet);
check("AR: كافيه → café", c.kind === "cafe", c.kind);
p = E.parseWish("dinner for 2 around 1500, 3 hours, 2026");
check("headcount, hours and year are not read as budget", p.budget.amount === 1500 && p.budget.mode === "around", p.budget);
p = E.parseWish("a gift under EGP 1,000");
check("'under' = hard cap", p.budget.mode === "cap" && p.budget.amount === 1000, p.budget);
p = E.parseWish("budget 1400 total for both of us");
check("'total' basis recognised", p.budget.basis === "total", p.budget);

// Structured fields win over text ------------------------------------------
c = E.buildConstraints(E.parseWish("café in Zamalek 500 per person for 3 people"), { areaSet: true, area: "Maadi", perPersonSet: true, perPerson: 700, peopleSet: true, people: 2 }, {});
check("structured area wins over text area", c.where.area === "Maadi", c.where);
check("structured per-person budget wins", c.budget.perPerson === 700 && c.budget.total === 1400, c.budget);
check("conflicts are reported", c.conflicts.map((x) => x.field).sort().join() === "area,budget,people", c.conflicts);

// Pets ---------------------------------------------------------------------
c = E.buildConstraints(E.parseWish("dinner in Zamalek"), {}, { petOwner: true, petType: "dog" });
check("owning a pet does not force pet-friendly", c.pet.accompanying === false, c.pet);
c = E.buildConstraints(E.parseWish("dinner in Zamalek without my dog"), {}, { petOwner: true, petType: "dog", bringPetByDefault: true });
check("'without my dog' turns accompanying off", c.pet.accompanying === false, c.pet);

// Required Maadi scenario (demo data) -----------------------------------------
let { r } = run("Pet-friendly café", { areaSet: true, area: "Maadi", perPersonSet: true, perPerson: 700, peopleSet: true, people: 2, petSet: true, petAccompanying: true, petType: "dog" });
check("Maadi pet-friendly café: no confirmed match from demo data", r.confirmed.length === 0, r.confirmed.map((x) => x.place.id));
check("Maadi pet-friendly café: nothing outside Maadi offered as Ask", r.ask.every((x) => x.place.area === "Maadi"), r.ask.map((x) => x.place.id));
check("Maadi pet-friendly café: non-cafés never appear", [...r.confirmed, ...r.ask].every((x) => x.place.kind === "cafe"), r.ask.map((x) => x.place.kind));
({ r } = run("Pet-friendly café", { areaSet: true, area: "Zamalek", perPersonSet: true, perPerson: 700, peopleSet: true, people: 2, petSet: true, petAccompanying: true, petType: "dog" }));
check("Zamalek demo café with a demo 'pets allowed' claim → Ask, not confirmed", r.confirmed.length === 0 && r.ask.length === 1 && r.ask[0].place.id === "c1", { c: r.confirmed.length, a: r.ask.map((x) => x.place.id) });

// With a verified record (fixture) the same search returns it as confirmed ----------
const verified = { id: "v1", status: "verified", name: { en: "Evidence Café", ar: "كافيه" }, cat: "Food", kind: "cafe", area: "Maadi",
  coords: { lat: 29.96, lng: 31.257, source: "site visit", checked: "2026-10-18" }, price: { amount: 300, basis: "per_person" },
  pets: { policy: "allowed", types: ["dog"], source: "phone call", checked: "2026-10-18" }, wheelchair: {}, access: [], tags: [] };
({ r } = run("Pet-friendly café", { areaSet: true, area: "Maadi", perPersonSet: true, perPerson: 700, peopleSet: true, people: 2, petSet: true, petAccompanying: true, petType: "dog" }, {}, { places: [...W.DEMO_PLACES, verified] }));
check("verified Maadi pet café with evidence → confirmed", r.confirmed.length === 1 && r.confirmed[0].place.id === "v1", r.confirmed.map((x) => x.place.id));
check("its group cost is 300 × 2 = 600", r.confirmed[0] && r.confirmed[0].ev.cost.total === 600, r.confirmed[0] && r.confirmed[0].ev.cost);
({ r } = run("Pet-friendly café", { areaSet: true, area: "Maadi", petSet: true, petAccompanying: true, petType: "cat" }, {}, { places: [verified] }));
check("'dogs allowed' place says nothing about cats → Ask, not excluded", r.confirmed.length === 0 && r.ask.length === 1, { a: r.ask.length, x: r.excludedCounts });

// Wheelchair three states ----------------------------------------------------------
const wcBase = Object.assign({}, verified, { id: "w", accessSource: "site visit", accessChecked: "2026-10-18" });
const wcRun = (w, extra) => E.evaluatePlace(Object.assign({}, wcBase, { wheelchair: w }, extra || {}), E.buildConstraints(E.parseWish("café"), { wheelchairSet: true, wheelchair: true }, {}));
check("ramp alone is not enough (interior, level, toilet unknown)", wcRun({ ramp: true }).status === "ask", wcRun({ ramp: true }).unknowns);
check("all wheelchair facts true + evidence → confirmed", wcRun({ stepFree: true, interior: true, groundFloor: true, toilet: true }).status === "confirmed");
check("interior not usable → excluded", wcRun({ stepFree: true, interior: false, groundFloor: true, toilet: true }).status === "excluded");
check("listed accessible entrance + seating (reachable) answers the level question", wcRun({ stepFree: true, interior: true, reachable: true, toilet: true }).status === "confirmed");
check("Google-style entrance=false → excluded", wcRun({ stepFree: false, interior: true, toilet: true }).status === "excluded");
{ const rg = E.groupCost({ price: { amount: 200, min: 1, basis: "per_person" } }, 3);
  check("price range keeps both ends (1–200 × 3 = 3–600)", rg.min === 1 && rg.minTotal === 3 && rg.total === 600, rg); }
check("upper floor without lift → excluded", wcRun({ stepFree: true, interior: true, groundFloor: false, lift: false, toilet: true }).status === "excluded");
check("all true but demo record → needs confirmation", wcRun({ stepFree: true, interior: true, groundFloor: true, toilet: true }, { status: "demo" }).status === "ask");
check("demo 'steps at entrance' → excluded (a no is respected)", wcRun({ stepFree: false }, { status: "demo" }).status === "excluded");
({ r } = run("something outdoors", { wheelchairSet: true, wheelchair: true }));
check("wheelchair search over demo data: no confirmed results", r.confirmed.length === 0, r.confirmed.map((x) => x.place.id));
check("felucca with steps is excluded for wheelchair users", !r.ask.some((x) => x.place.id === "c5"), r.ask.map((x) => x.place.id));

// Location and radius ---------------------------------------------------------------
const dev = { lat: 29.9602, lng: 31.2569, accuracy: 25, at: Date.now() };
({ r } = run("café", { locationMode: "device", device: dev, radiusKm: 5 }, {}, { places: [...W.DEMO_PLACES, verified] }));
check("radius search uses only venue coordinates (demo has none)", r.confirmed.length === 1 && r.confirmed[0].place.id === "v1" && r.excludedCounts.no_coords >= 3, { c: r.confirmed.map((x) => x.place.id), e: r.excludedCounts });
({ r } = run("café", { locationMode: "device", device: { lat: 30.06, lng: 31.22, accuracy: 20, at: Date.now() }, radiusKm: 5 }, {}, { places: [verified] }));
check("place outside radius is excluded, offered only as expansion", r.confirmed.length === 0 && r.excludedCounts.radius === 1 && r.expandable === 1, r.excludedCounts);

// Personal exclusions -----------------------------------------------------------------
({ r } = run("café in Zamalek", {}, {}, { excluded: new Set(["c1"]) }));
check("excluded place never appears", ![...r.confirmed, ...r.ask].some((x) => x.place.id === "c1") && r.personalExcluded.includes("c1"));
({ r } = run("café in Zamalek", {}, {}, { excluded: new Set() }));
check("restored place is eligible again", r.confirmed.some((x) => x.place.id === "c1"), r.confirmed.map((x) => x.place.id));

// Constraints before top-N ------------------------------------------------------------
({ r } = run("food", { perPersonSet: true, perPerson: 150, peopleSet: true, people: 2 }));
check("budget applied before top results (nothing over 300 total)", r.confirmed.every((x) => x.ev.cost.total <= 300), r.confirmed.map((x) => [x.place.id, x.ev.cost.total]));
check("fixed-price items are not multiplied", E.groupCost(W.DEMO_PLACES.find((x) => x.id === "c10"), 4).total === 450);

// WishScore honesty ---------------------------------------------------------------------
({ r } = run("pet-friendly café in Zamalek", { petSet: true, petAccompanying: true }));
const a = r.ask[0];
check("missing info lowers the score and is listed", a && a.parts.some((x) => x.code === "missing_info"), a && a.parts);
const g = E.wishScore(W.DEMO_PLACES[0], E.evaluatePlace(W.DEMO_PLACES[0], E.buildConstraints(E.parseWish("café"), {}, {})), E.buildConstraints(E.parseWish("café"), {}, {}), { groupSignals: { c1: { avg: 1.5, count: 2 } } });
check("low participant ratings lower the group score", g.parts.some((x) => x.code === "group_rating" && x.pts < 0));

// Cairo time -------------------------------------------------------------------------
check("Cairo winter time (UTC+2): 2026-12-01 17:00 → 15:00Z", E.cairoToUTC("2026-12-01T17:00") === "2026-12-01T15:00:00.000Z", E.cairoToUTC("2026-12-01T17:00"));
check("Cairo summer time (UTC+3): 2026-07-01 17:00 → 14:00Z", E.cairoToUTC("2026-07-01T17:00") === "2026-07-01T14:00:00.000Z", E.cairoToUTC("2026-07-01T17:00"));
check("round trip back to the Cairo input value", E.utcToCairoInput(E.cairoToUTC("2026-10-24T19:30")) === "2026-10-24T19:30");

const failed = results.filter((x) => !x.ok);
for (const x of results) console.log((x.ok ? "PASS " : "FAIL ") + x.name + (x.ok ? "" : "  → " + x.detail));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
