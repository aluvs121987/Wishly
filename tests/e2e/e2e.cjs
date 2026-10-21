// End-to-end tests through the real UI in headless Chromium (Playwright).
// Usage: start a static server in the project folder (python3 -m http.server 8765)
//        then: node tests/e2e/e2e.cjs [baseUrl]
// Writes tests/e2e/results.json. Each test records PASS / FAIL with expected vs actual.
const path = require("path"), fs = require("fs");
let pw; for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { pw = require(p); break; } catch (e) { /* next */ } }
const { chromium } = pw;
const BASE = (process.argv[2] || "http://127.0.0.1:8765") + "/index.html";
const results = [];
function rec(id, name, ok, expected, actual) { results.push({ id, name, result: ok ? "PASS" : "FAIL", expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual) }); console.log((ok ? "PASS " : "FAIL ") + id + " " + name + (ok ? "" : "\n      expected: " + expected + "\n      actual:   " + JSON.stringify(actual))); }

// A test-only VERIFIED record, injected into the page to exercise the positive path.
// It is not shipped in the app.
const FIXTURE = { id: "fx1", status: "verified", name: { en: "Fixture Verified Café", ar: "كافيه اختبار موثّق" }, cat: "Food", kind: "cafe", area: "Maadi",
  address: { en: "Road 9, Maadi (test fixture)", ar: "شارع ٩، المعادي (بيانات اختبار)" },
  coords: { lat: 29.9605, lng: 31.2575, source: "test fixture", checked: "2026-10-18" }, price: { amount: 300, basis: "per_person" }, includes: { transport: "excluded", taxes: "included" },
  pets: { policy: "allowed", types: ["dog"], source: "test fixture", checked: "2026-10-18" },
  wheelchair: { stepFree: true, interior: true, groundFloor: true, toilet: true }, accessSource: "test fixture", accessChecked: "2026-10-18", access: ["stepfree", "wc"],
  contacts: { phone: "+20 2 0000 0000", whatsapp: "201000000000", website: "https://example.org/fixture" }, contactsSource: "test fixture", contactsChecked: "2026-10-18",
  bankOffers: [], tags: ["quiet"] };

async function fresh(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1200, height: 900 } }, opts || {}));
  // run the guest-mode tests without the real server config
  await ctx.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.WISHLY_CONFIG={supabaseUrl:'',supabaseAnonKey:'',siteUrl:'',providers:{google:false,facebook:false},manualLinking:false,facebookFriends:false,uberClientId:''};" }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|fonts\.g|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(BASE); await page.waitForFunction(() => window.W && W.app && W.app.S.store);
  return { ctx, page };
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
async function wishAndCheck(page, wish) { await page.fill("#wish", wish); await page.click("#sendBtn"); await page.waitForTimeout(100); }
async function search(page) { await page.click("#searchBtn"); await page.waitForSelector("#view-matches:not([hidden])"); await page.waitForTimeout(100); }
const cardIds = (page, which) => page.$$eval(`#matchArea ol.cards ${which === "ask" ? "li.ask-card" : "li.card:not(.ask-card)"} [data-action=details]`, (b) => b.map((x) => x.dataset.id));

(async () => {
  const browser = await chromium.launch();

  /* ---------- T1 required Maadi scenario ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await wishAndCheck(page, "Pet-friendly café in Maadi, Cairo. Budget 700 EGP per person, 2 people. Our dog is coming.");
    const f = { area: await page.inputValue("#fArea"), pp: await page.inputValue("#fPP"), people: await page.inputValue("#fPeople"), total: await page.inputValue("#fTotal"), pet: await page.isChecked("#fPet"), mode: await page.inputValue("#fMode") };
    rec("T1.1", "Maadi scenario: wish fills editable fields before searching", f.area === "Maadi" && f.pp === "700" && f.people === "2" && f.pet && f.mode === "cap" && (await page.isVisible("#view-wish")), "area Maadi, 700 pp, 2 people, pet ticked, still on the search screen", f);
    const tl = await text(page, "#totalLine");
    rec("T1.2", "Recognises 700 × 2 = 1,400 EGP total", tl.includes("700") && tl.includes("1,400") && f.total === "1400", "EGP 700 per person × 2 = EGP 1,400 total", tl);
    await search(page);
    const chips = await text(page, "#matchArea .query");
    rec("T1.3", "Search uses Maadi, café, pet and 1,400 total", /Area: Maadi/.test(chips) && /Café/.test(chips) && /Dog coming/.test(chips) && /1,400/.test(chips), "chips: Area: Maadi, Café, Dog coming, 1,400", chips);
    const conf = await cardIds(page, "confirmed"), ask = await cardIds(page, "ask");
    const body = await text(page, "#matchArea");
    rec("T1.4", "Honest no-match with demo data (no fictional place confirmed)", conf.length === 0 && /No confirmed match/.test(body), "0 confirmed + 'No confirmed match'", { conf, ask });
    rec("T1.5", "Area not silently expanded (expansion offered as a button only)", ask.length === 0 && (await page.isVisible("[data-action=expandAny]")), "no results outside Maadi; 'Search all areas' button shown", { ask });
    // positive path with an injected verified fixture
    await page.evaluate((fx) => { W.app.S.places = [...W.app.S.places, fx]; }, FIXTURE);
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await search(page);
    const conf2 = await cardIds(page, "confirmed");
    const meta = conf2.length ? await text(page, "#matchArea li.card:not(.ask-card) .meta") : "";
    rec("T1.6", "With a verified Maadi pet-friendly café (test fixture) it is confirmed, priced for 2", conf2.length === 1 && conf2[0] === "fx1" && meta.includes("EGP 600"), "fx1 confirmed, EGP 300 × 2 = EGP 600", { conf2, meta });
    rec("T1.7", "No page errors", page.errors.length === 0, "no errors", page.errors);
    await ctx.close();
  }

  /* ---------- T2 structured fields win; Arabic request ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.selectOption("#fArea", "Zamalek");
    await wishAndCheck(page, "café in Maadi for 2");
    const conflict = await text(page, "#understood");
    rec("T2.1", "Selected area wins over text area and the conflict is shown", (await page.inputValue("#fArea")) === "Zamalek" && /mentions Maadi/.test(conflict), "area stays Zamalek, note explains", conflict);
    await search(page);
    rec("T2.2", "Results use the structured area", /Area: Zamalek/.test(await text(page, "#matchArea .query")), "chip Area: Zamalek", await text(page, "#matchArea .query"));
    await ctx.close();
    const b = await fresh(browser);
    await wishAndCheck(b.page, "كافيه في المعادي بميزانية ٧٠٠ جنيه للفرد لشخصين ومعانا كلب");
    const g = { area: await b.page.inputValue("#fArea"), pp: await b.page.inputValue("#fPP"), people: await b.page.inputValue("#fPeople"), pet: await b.page.isChecked("#fPet"), type: await b.page.inputValue("#fPetType") };
    rec("T2.3", "Arabic wish with Arabic digits fills Maadi, 700/person, 2 people, dog", g.area === "Maadi" && g.pp === "700" && g.people === "2" && g.pet && g.type === "dog", "Maadi / 700 / 2 / dog", g);
    // total entered instead of per person
    await b.page.fill("#fPP", ""); await b.page.fill("#fTotal", "1500"); await b.page.fill("#fPeople", "3"); await b.page.dispatchEvent("#fPeople", "input");
    rec("T2.4", "Group total → per person derived (1,500 / 3 = 500)", (await b.page.inputValue("#fPP")) === "500", "per person 500", await b.page.inputValue("#fPP"));
    await b.ctx.close();
  }

  /* ---------- T3 wheelchair ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.check("#fWheel");
    await wishAndCheck(page, "a café"); await search(page);
    const conf = await cardIds(page, "confirmed"), ask = await cardIds(page, "ask");
    const askText = await text(page, "#matchArea");
    rec("T3.1", "Wheelchair: no demo place shown as confirmed accessible", conf.length === 0, "0 confirmed", conf);
    rec("T3.2", "Unknown access goes to 'Ask before choosing' with what to confirm", ask.length >= 1 && /Wheelchair access not confirmed/.test(askText) && /Ask the place/.test(askText), "ask list with 'Wheelchair access not confirmed'", ask);
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await wishAndCheck(page, "a boat ride outdoors"); await search(page);
    const all = [...(await cardIds(page, "confirmed")), ...(await cardIds(page, "ask"))];
    rec("T3.3", "Place with steps at the entrance (felucca) is excluded", !all.includes("c5") && /Not suitable for wheelchairs/.test(await text(page, "#matchArea")), "c5 absent, reason listed", all);
    await page.evaluate((fx) => { W.app.S.places = [...W.app.S.places, fx, Object.assign({}, fx, { id: "fx2", name: { en: "Ramp Only Café", ar: "كافيه برامب" }, wheelchair: { ramp: true } }), Object.assign({}, fx, { id: "fx3", name: { en: "Upstairs Café", ar: "كافيه فوق" }, wheelchair: { stepFree: true, interior: true, groundFloor: false, lift: false, toilet: true } })]; }, FIXTURE);
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await wishAndCheck(page, "a café"); await search(page);
    const c2 = await cardIds(page, "confirmed"), a2 = await cardIds(page, "ask");
    rec("T3.4", "Three states: verified full access → confirmed; ramp only → needs confirmation; upstairs no lift → excluded", c2.includes("fx1") && a2.includes("fx2") && !c2.includes("fx3") && !a2.includes("fx3"), "fx1 confirmed, fx2 ask, fx3 excluded", { c2, a2 });
    await page.click("[data-action=details][data-id=c1]");
    const det = await text(page, "#dlgBody");
    rec("T3.5", "Details show access facts, 'ramp alone' rule and demo source", /Step-free entrance/.test(det) && /A ramp alone/.test(det) && /From demo data, not confirmed/.test(det), "facts + ramp note + source", det.slice(0, 300));
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  /* ---------- T4 location permission states ---------- */
  {
    const ok = await fresh(browser, { geolocation: { latitude: 29.9602, longitude: 31.2569, accuracy: 20 }, permissions: ["geolocation"] });
    const before = await text(ok.page, "#locStatus");
    await ok.page.evaluate((fx) => { W.app.S.places = [...W.app.S.places, fx]; }, FIXTURE);
    await ok.page.click("#locBtn"); await ok.page.waitForFunction(() => W.app.S.device);
    const st = await text(ok.page, "#locStatus");
    rec("T4.1", "Location requested only on click; accuracy shown", /not used unless/.test(before) && /accurate to about 20 m/.test(st) && !(await ok.page.isDisabled("#fRadius")), "idle before click; '~20 m' after", { before, st });
    await wishAndCheck(ok.page, "café"); await search(ok.page);
    const conf = await cardIds(ok.page, "confirmed"), body = await text(ok.page, "#matchArea");
    rec("T4.2", "Radius search uses only verified venue coordinates (fixture within 5 km; demo left out and counted)", conf.length === 1 && conf[0] === "fx1" && /without an exact location were left out/.test(body), "only fx1; note about places without exact location", { conf });
    const ls = await ok.page.evaluate(() => JSON.stringify(localStorage));
    rec("T4.3", "Precise coordinates are not written to storage", !ls.includes("29.9602") && !ls.includes("31.2569"), "no coordinates in localStorage", ls.length + " chars");
    await ok.page.evaluate(() => { W.app.S.device.at = Date.now() - 6 * 60 * 1000; });
    await ok.page.click("[data-action=go][data-view=wish] >> nth=0"); await ok.page.click("#searchBtn"); await ok.page.waitForTimeout(150);
    rec("T4.4", "Stale location (over 5 min) expires and asks for refresh", /more than 5 minutes old/.test(await text(ok.page, "#locStatus")) && !(await ok.page.evaluate(() => !!W.app.S.device)), "expired message, device cleared", await text(ok.page, "#locStatus"));
    await ok.ctx.close();
    const states = [["denied", "{code:1}", /permission was denied/], ["unavailable", "{code:2}", /isn't available right now/], ["timeout", "{code:3}", /took too long/]];
    for (const [name, err, re] of states) {
      const x = await fresh(browser);
      await x.page.evaluate((e) => { navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail(eval("(" + e + ")")), 20); }, err);
      await x.page.click("#locBtn"); await x.page.waitForTimeout(150);
      const s = await text(x.page, "#locStatus");
      rec("T4." + (5 + states.findIndex((q) => q[0] === name)), "Location " + name + " handled with manual-area fallback", re.test(s) && !(await x.page.evaluate(() => !!W.app.S.device)) && !(await x.page.isDisabled("#fArea")), "message + area selectable", s);
      await x.ctx.close();
    }
    const y = await fresh(browser);
    await y.page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { latitude: 30, longitude: 31.2, accuracy: 4800 } }), 20); });
    await y.page.click("#locBtn"); await y.page.waitForTimeout(150);
    rec("T4.8", "Inaccurate location (4.8 km) is rejected, not silently used", /too imprecise/.test(await text(y.page, "#locStatus")) && !(await y.page.evaluate(() => !!W.app.S.device)), "imprecise message, no device location", await text(y.page, "#locStatus"));
    const den = await fresh(browser, { permissions: [] });
    await den.page.click("#locBtn"); await den.page.waitForTimeout(600);
    rec("T4.9", "Real browser permission not granted → denied state", /denied|isn't available|took too long/.test(await text(den.page, "#locStatus")), "denied (or unavailable) message", await text(den.page, "#locStatus"));
    await y.ctx.close(); await den.ctx.close();
  }

  /* ---------- T5 lifecycle, exclusion, restore, persistence (guest) ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await wishAndCheck(page, "café in Zamalek for 2"); await search(page);
    rec("T5.1", "Zamalek café (demo) appears as a requirement match", (await cardIds(page, "confirmed")).includes("c1"), "c1 in results", await cardIds(page, "confirmed"));
    await page.click("#matchArea [data-action=save][data-id=c1]");
    await page.click("#matchArea [data-action=plan][data-id=c1]");
    await page.fill("#planWhen", "2026-10-24T19:30"); await page.fill("#planPP", "300");
    await page.click("#planForm button[type=submit]"); await page.waitForSelector("#view-trips:not([hidden])");
    const trip = await text(page, "#tripArea");
    const stored = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("wishly.v4")).trips)[0]);
    rec("T5.2", "Saved → planned trip with Cairo time (19:30 Cairo = 16:30 UTC in October 2026)", /Planned/.test(trip) && /19:30|7:30/.test(trip) && stored.startsAt === "2026-10-24T16:30:00.000Z" && /600/.test(trip), "trip listed 7:30 pm Cairo; stored 16:30Z; total 600", { startsAt: stored.startsAt, trip });
    await page.click("#tripArea [data-action=visited]"); await page.waitForSelector("#rateForm");
    await page.click("#rateForm input[name=rPlace][value='2'] >> xpath=..");
    await page.click("#rateForm input[name=rOrg][value='4'] >> xpath=..");
    await page.click("#rateForm button[type=submit]"); await page.waitForTimeout(200);
    const ex = await page.evaluate(() => JSON.parse(localStorage.getItem("wishly.v4")).exclusions);
    rec("T5.3", "Visited → rating 2 explains and creates a personal exclusion", ex.c1 && ex.c1.reason === "rating" && /hidden from your future results/.test(await text(page, "#toast")), "exclusion c1 (rating); toast explains", { ex, toast: await text(page, "#toast") });
    await page.click("#tripTabs [data-tab=excluded]");
    rec("T5.4", "Excluded section lists the place with Restore", /Garden Courtyard/.test(await text(page, "#tripArea")) && (await page.isVisible("#tripArea [data-action=restore]")), "listed + Restore", await text(page, "#tripArea"));
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await search(page);
    rec("T5.5", "Excluded place is gone from the reviewer's next search", !(await cardIds(page, "confirmed")).includes("c1") && /hidden by your own ratings/.test(await text(page, "#matchArea")), "c1 absent + note", await cardIds(page, "confirmed"));
    await page.reload(); await page.waitForFunction(() => W.app && W.app.S.store);
    const persisted = await page.evaluate(() => ({ saved: [...W.app.S.saved], ex: W.app.S.exclusions.map((e) => e.placeId), trips: W.app.S.trips.length }));
    rec("T5.6", "Refresh keeps saved place, trip, rating and exclusion", persisted.saved.includes("c1") && persisted.ex.includes("c1") && persisted.trips === 1, "saved c1, excluded c1, 1 trip", persisted);
    await page.click("[data-action=go][data-view=trips] >> nth=0"); await page.click("#tripTabs [data-tab=excluded]"); await page.click("#tripArea [data-action=restore]"); await page.waitForTimeout(150);
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await wishAndCheck(page, "café in Zamalek for 2"); await search(page);
    rec("T5.7", "Restore → eligible again", (await cardIds(page, "confirmed")).includes("c1"), "c1 back", await cardIds(page, "confirmed"));
    await page.click("[data-action=go][data-view=trips] >> nth=0"); await page.click("#tripTabs [data-tab=experiences]");
    await page.click("#tripArea [data-action=rate]"); await page.click("#rateForm input[name=rPlace][value='1'] >> xpath=.."); await page.click("#rateForm button[type=submit]"); await page.waitForTimeout(150);
    await page.click("#tripTabs [data-tab=experiences]"); await page.click("#tripArea [data-action=rate]"); await page.click("#rateForm input[name=rPlace][value='4'] >> xpath=.."); await page.click("#rateForm button[type=submit]"); await page.waitForTimeout(150);
    const st2 = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("wishly.v4")); return { ex: s.exclusions, reviews: Object.keys(s.reviews).length, rating: Object.values(s.reviews)[0].place }; });
    rec("T5.8", "Updating rating above 2 removes the exclusion; still one rating per trip", !st2.ex.c1 && st2.reviews === 1 && st2.rating === 4, "no exclusion, 1 review = 4", st2);
    rec("T5.9", "Separate place / organization / transport ratings stored", await page.evaluate(() => { const r = Object.values(JSON.parse(localStorage.getItem("wishly.v4")).reviews)[0]; return "org" in r && "transport" in r && "place" in r; }), "fields place, org, transport", "");
    await page.click("#tripTabs [data-tab=trips]");
    const inv = await text(page, "#tripArea");
    rec("T5.10", "Guest mode is honest about invites (no fake invite button)", !(await page.$("#tripArea [data-action=invites]")) && /needs a Wishly account on the server/.test(inv + (await text(page, "#tripArea").catch(() => ""))) || !(await page.$("#tripArea [data-action=invites]")), "no invite button in guest mode", "");
    rec("T5.11", "No page errors", page.errors.length === 0, "none", page.errors);
    await ctx.close();
  }

  /* ---------- T6 pets ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.click("[data-action=go][data-view=profile] >> nth=0"); await page.check("#pPetOwner"); await page.waitForTimeout(600);
    await page.click("[data-action=go][data-view=wish] >> nth=0");
    rec("T6.1", "Owning a pet does not tick 'pet is coming'", !(await page.isChecked("#fPet")), "unticked", await page.isChecked("#fPet"));
    await page.click("[data-action=go][data-view=profile] >> nth=0"); await page.check("#pBringPet"); await page.waitForTimeout(600);
    await page.click("[data-action=go][data-view=wish] >> nth=0");
    const ticked = await page.isChecked("#fPet");
    await wishAndCheck(page, "café in Zamalek without my dog");
    rec("T6.2", "Default can be overridden per outing ('without my dog')", ticked && !(await page.isChecked("#fPet")), "ticked by default, unticked by the wish", { ticked, after: await page.isChecked("#fPet") });
    await page.check("#fPet"); await search(page);
    const ask = await cardIds(page, "ask"), conf = await cardIds(page, "confirmed");
    rec("T6.3", "Unknown / demo pet policy goes to 'Ask before choosing', not confirmed", !conf.includes("c1") && ask.includes("c1"), "c1 in ask", { ask, conf });
    await ctx.close();
  }

  /* ---------- T7 ask the place, rides, share ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.evaluate((fx) => { W.app.S.places = [...W.app.S.places, Object.assign({}, fx, { pets: { policy: "unknown", types: [] }, wheelchair: { stepFree: true } })]; }, FIXTURE);
    await page.check("#fWheel"); await page.check("#fPet");
    await wishAndCheck(page, "café in Maadi"); await search(page);
    await page.click("#matchArea [data-action=ask][data-id=fx1]");
    const msg1 = await page.inputValue("#askMsg");
    const links = await page.$$eval("#askContacts a", (a) => a.map((x) => x.href));
    rec("T7.1", "Ask the place: verified contacts only, click-to-call and WhatsApp text", links.some((h) => h.startsWith("tel:+20")) && links.some((h) => h.startsWith("https://wa.me/201000000000?text=")), "tel: + wa.me with text", links);
    rec("T7.2", "Access questions stay out of the message without consent", !/wheelchair|ground floor/i.test(msg1) && /pet|dog/i.test(msg1), "no access questions; pet question present", msg1);
    await page.check("#askIncludeAccess");
    rec("T7.3", "With consent, access questions are added", /wheelchair|ground floor/i.test(await page.inputValue("#askMsg")), "access questions included", await page.inputValue("#askMsg"));
    await page.keyboard.press("Escape");
    await page.click("#matchArea [data-action=ride][data-id=fx1]");
    const rides = await page.$$eval("#dlgBody a.ride", (a) => a.map((x) => x.href));
    const uber = rides.find((h) => h.startsWith("https://m.uber.com/ul/")) || "";
    rec("T7.4", "Uber link carries venue coordinates and name; Maps uses venue coordinates", uber && new URL(uber).searchParams.get("dropoff[latitude]") === "29.9605" && new URL(uber).searchParams.get("dropoff[nickname]") === "Fixture Verified Café" && rides.some((h) => h.includes("destination=29.9605,31.2575")), "dropoff lat/lng + nickname; google destination", rides);
    rec("T7.5", "Careem: honest copy-address fallback (no fake deep link)", /doesn't offer a public link/.test(await text(page, "#dlgBody")) && !rides.some((h) => /careem/i.test(h)), "fallback text, no careem link", "");
    await page.keyboard.press("Escape");
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await page.uncheck("#fWheel"); await page.uncheck("#fPet"); await wishAndCheck(page, "café in Zamalek"); await search(page);
    await page.click("#matchArea [data-action=ride][data-id=c1]");
    const demoRide = await text(page, "#dlgBody");
    rec("T7.6", "Demo place: no map pin or ride link (district centre never used)", (await page.$$("#dlgBody a.ride")).length === 0 && /no verified location/.test(demoRide), "no links; explanation + Ask the place", demoRide.slice(0, 160));
    await page.keyboard.press("Escape");
    await page.click("[data-action=go][data-view=profile] >> nth=0"); await page.check("#needs input[value=hearing]"); await page.waitForTimeout(600);
    await page.click("[data-action=go][data-view=matches] >> nth=0");
    await page.click("#matchArea [data-action=details][data-id=c1]"); await page.click("#dlgBody [data-action=share]");
    const share = await page.inputValue("#shareText");
    rec("T7.7", "Share text has name, area, price basis and total, demo note; no access needs or location", /Garden Courtyard Café/.test(share) && /per person × /.test(share) && /demo listing/.test(share) && !/hearing|deaf|29\.|31\./i.test(share), "name/price/demo note, nothing private", share);
    await ctx.close();
  }

  /* ---------- T8 account honesty, invite links without server ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.click("#acctBtn"); const acct = await text(page, "#dlgBody");
    rec("T8.1", "Account dialog: honest 'Not connected' status, no fake login form", /Not connected/.test(acct) && /Instagram/.test(acct) && /Not offered/.test(acct) && !(await page.$("#dlgBody input[type=password]")), "status table; no password input", acct.slice(0, 200));
    rec("T8.2", "Guest is clearly labelled as device-only, not an account", /saved in this browser only/.test(acct) && (await text(page, "#acctLabel")) === "Guest", "guest label + explanation", await text(page, "#acctLabel"));
    await page.keyboard.press("Escape");
    await page.goto(BASE + "#invite=abc123invalid"); await page.waitForFunction(() => W.app && W.app.S.store); await page.waitForTimeout(150);
    const inv = await text(page, "#dlgBody");
    rec("T8.3", "Invite link without the server: explained, token removed from the address bar", /needs the Wishly server/.test(inv) && !page.url().includes("abc123"), "message + clean URL", { inv, url: page.url() });
    await ctx.close();
  }

  /* ---------- T9 Arabic interface ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.click("#langBtn");
    const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    rec("T9.1", "Arabic switches the whole page to RTL", dir[0] === "rtl" && dir[1] === "ar", "rtl / ar", dir);
    const ALLOW = /^(Wishly|WishScore|wishly|Uber|Careem|Google|Facebook|Instagram|Claude|claude\.ai|Supabase|SETUP\.md|English|CIB|Classic|Gold|Platinum|Signature|user_friends|WhatsApp|A|EGP|OAuth|Meta|Cloud|Login)$/;
    const latin = async (scope) => page.evaluate(([sc, allow]) => {
      const re = new RegExp(allow); const out = new Set();
      const root = document.querySelector(sc); if (!root) return [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode, el = n.parentElement;
        if (!el || el.closest("[hidden], script, style, q, textarea, .sr-only-ok, [lang=en], option[value='Classic'],option[value='Gold'],option[value='Platinum'],option[value='Signature']")) continue;
        if (el.offsetParent === null && !el.closest("dialog[open]")) continue;
        for (let w of n.textContent.match(/[A-Za-z][A-Za-z.\-_]{2,}/g) || []) { w = w.replace(/[.\-_]+$/, ""); if (!re.test(w)) out.add(w); }
      }
      return [...out];
    }, [scope, ALLOW.source]);
    const found = {};
    found.wish = await latin("body");
    await wishAndCheck(page, "كافيه في الزمالك لشخصين"); await search(page);
    found.matches = await latin("#matchArea");
    await page.click("#matchArea [data-action=details][data-id=c1]"); found.details = await latin("#dlg");
    await page.click("#dlgBody [data-action=ask]"); found.ask = await latin("#dlg");
    await page.click("#dlgBody [data-action=closeDialog], #dlg [data-action=closeDialog]");
    await page.click("#matchArea [data-action=plan][data-id=c1]"); found.plan = await latin("#dlg");
    await page.fill("#planWhen", "2026-10-24T19:30"); await page.click("#planForm button[type=submit]"); await page.waitForSelector("#view-trips:not([hidden])");
    found.trips = await latin("#view-trips");
    await page.click("#tripArea [data-action=visited]"); found.rate = await latin("#dlg");
    await page.click("#rateForm input[name=rPlace][value='5'] >> xpath=.."); await page.click("#rateForm button[type=submit]"); await page.waitForTimeout(150);
    for (const tab of ["saved", "experiences", "excluded", "friends"]) { await page.click(`#tripTabs [data-tab=${tab}]`); await page.waitForTimeout(80); found["tab_" + tab] = await latin("#tripArea"); }
    await page.click("[data-action=go][data-view=profile] >> nth=0"); found.profile = await latin("#view-profile");
    await page.click("#acctBtn"); found.account = await latin("#dlg"); await page.keyboard.press("Escape");
    await page.click("[data-action=a11y]"); found.a11y = await latin("#a11yDlg"); await page.keyboard.press("Escape");
    const bad = Object.fromEntries(Object.entries(found).filter(([, v]) => v.length));
    rec("T9.2", "No untranslated English in Arabic screens, dialogs, empty states", Object.keys(bad).length === 0, "no stray English words", bad);
    rec("T9.3", "No missing translation keys at run time", (await page.evaluate(() => W.missingKeys.size)) === 0, "0", await page.evaluate(() => [...W.missingKeys]));
    const tl = await text(page, "#greet");
    rec("T9.4", "Voice language is separate from interface language", (await page.evaluate(() => W.app.S.set.vlang)) === "en-US" && (await page.evaluate(() => W.app.S.lang)) === "ar", "UI ar, voice en-US", tl);
    await page.reload(); await page.waitForFunction(() => W.app && W.app.S.store);
    rec("T9.5", "Language choice persists after refresh", (await page.evaluate(() => document.documentElement.dir)) === "rtl", "rtl", "");
    rec("T9.6", "No page errors in Arabic flows", page.errors.length === 0, "none", page.errors);
    await ctx.close();
  }

  /* ---------- T10 keyboard, focus, dead buttons, mobile ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.keyboard.press("Tab");
    rec("T10.1", "First Tab reaches the skip link", (await page.evaluate(() => document.activeElement.className)) === "skip", "skip link focused", await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80)));
    await page.focus("#searchBtn"); await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + " " + getComputedStyle(document.activeElement).outlineWidth);
    rec("T10.2", "Visible focus outline on keyboard focus", /solid 3px/.test(outline), "solid 3px", outline);
    await page.focus("[data-action=a11y]"); await page.keyboard.press("Enter"); await page.waitForTimeout(80);
    const open = await page.evaluate(() => document.querySelector("#a11yDlg").open);
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    rec("T10.3", "Dialog opens from keyboard, Escape closes and focus returns", open && (await page.evaluate(() => document.activeElement.dataset.action)) === "a11y", "returns to Accessibility button", await page.evaluate(() => document.activeElement.outerHTML.slice(0, 60)));
    // every data-action in every view and dialog has a handler
    const missing = new Set();
    const collect = async () => (await page.$$eval("[data-action]", (els) => els.map((e) => e.dataset.action))).forEach((a) => { missing.add(a); });
    await collect(); await wishAndCheck(page, "café in Zamalek"); await search(page); await collect();
    await page.click("#matchArea [data-action=details][data-id=c1]"); await collect(); await page.keyboard.press("Escape");
    await page.click("#matchArea [data-action=plan][data-id=c1]"); await page.click("#planForm button[type=submit]"); await page.waitForSelector("#view-trips:not([hidden])"); await collect();
    for (const tab of ["saved", "experiences", "excluded", "friends"]) { await page.click(`#tripTabs [data-tab=${tab}]`); await collect(); }
    await page.click("#acctBtn"); await collect(); await page.keyboard.press("Escape");
    const handlers = await page.evaluate(() => Object.keys(W.app.ACTIONS));
    const dead = [...missing].filter((a) => !handlers.includes(a));
    rec("T10.4", "No dead buttons: every action in the UI has a handler", dead.length === 0, "0 unhandled actions", dead);
    const unlabeled = await page.$$eval("button, input, select, textarea", (els) => els.filter((e) => e.offsetParent !== null && e.type !== "hidden").filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim() || (e.labels && e.labels.length) || e.getAttribute("aria-labelledby"))).map((e) => e.id || e.outerHTML.slice(0, 60)));
    rec("T10.5", "All visible controls are labelled", unlabeled.length === 0, "0 unlabeled", unlabeled);
    await ctx.close();
    for (const lang of ["en", "ar"]) {
      const m = await fresh(browser, { viewport: { width: 360, height: 780 } });
      if (lang === "ar") await m.page.click("#langBtn");
      const over = {};
      const chk = async (k) => { over[k] = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); };
      await chk("wish"); await wishAndCheck(m.page, "café in Zamalek"); await search(m.page); await chk("matches");
      await m.page.click("#matchArea [data-action=details][data-id=c1]"); await chk("details"); await m.page.keyboard.press("Escape");
      await m.page.click(".tabbar [data-view=trips]"); await chk("trips"); await m.page.click(".tabbar [data-view=profile]"); await chk("profile");
      rec("T10.6" + (lang === "ar" ? "b" : "a"), `Mobile 360 px (${lang}): no horizontal scrolling`, Object.values(over).every((v) => v <= 0), "overflow 0 on every screen", over);
      await m.ctx.close();
    }
  }

  /* ---------- T11 claude.ai private storage (mocked runtime) ---------- */
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await ctx.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.WISHLY_CONFIG={supabaseUrl:'',supabaseAnonKey:'',siteUrl:'',providers:{},manualLinking:false,facebookFriends:false,uberClientId:''};" }));
    await page.addInitScript(() => {
      const KEY = "__mockClaudeDb";
      const load = () => JSON.parse(sessionStorage.getItem(KEY) || "{}"), saveAll = (o) => sessionStorage.setItem(KEY, JSON.stringify(o));
      const doc = (p) => ({ get: async () => { const o = load(); return { exists: p in o, data: () => o[p] }; }, set: async (d) => { if (!p.startsWith("data/users/u_test/")) throw { code: "invalid_argument" }; const o = load(); o[p] = d; saveAll(o); }, delete: async () => { const o = load(); delete o[p]; saveAll(o); } });
      window.claude = { use: async (n) => n === "db" ? { doc } : n === "user" ? { id: async () => "u_test" } : null };
    });
    await page.goto(BASE); await page.waitForFunction(() => W.app && W.app.S.store && W.app.S.store.kind === "claude");
    await page.click("#wish"); await wishAndCheck(page, "café in Zamalek"); await search(page);
    await page.click("#matchArea [data-action=save][data-id=c1]"); await page.waitForTimeout(150);
    const db = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__mockClaudeDb"))["data/users/u_test/wishly"]);
    const ls = await page.evaluate(() => localStorage.getItem("wishly.v4"));
    rec("T11.1", "On claude.ai the viewer's private document is used (mocked runtime)", db && db.saved && db.saved.c1 && !(ls && JSON.parse(ls).saved && JSON.parse(ls).saved.c1) && (await text(page, "#acctLabel")) === "Claude account", "saved in data/users/<id>/wishly, not localStorage", { saved: db && db.saved });
    await page.reload(); await page.waitForFunction(() => W.app && W.app.S.store && W.app.S.store.kind === "claude");
    rec("T11.2", "Persists across reloads in that mode (mocked runtime)", await page.evaluate(() => W.app.S.saved.has("c1")), "c1 still saved", "");
    await ctx.close();
  }

  /* ---------- T12 delete my data ---------- */
  {
    const { ctx, page } = await fresh(browser);
    await page.click("[data-action=go][data-view=profile] >> nth=0"); await page.fill("#pname", "Samaa"); await page.waitForTimeout(700);
    await page.click("#delBtn"); const armed = await text(page, "#delBtn"); await page.click("#delBtn"); await page.waitForTimeout(200);
    const after = await page.evaluate(() => localStorage.getItem("wishly.v4"));
    rec("T12.1", "Delete my data needs two taps and clears the device data", /Tap again/.test(armed) && (!after || !after.includes("Samaa")), "armed, then cleared", { armed, after: after && after.slice(0, 80) });
    await ctx.close();
  }


  /* ---------- T13 server-mode screens against a stand-in Supabase client (no RLS; see tests/sql) ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }); const page = await ctx.newPage();
    page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
    await ctx.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.WISHLY_CONFIG={supabaseUrl:"https://mock.supabase.test",supabaseAnonKey:"anon-test",siteUrl:"https://wishly.example/",providers:{google:false,facebook:false},manualLinking:false,facebookFriends:false,uberClientId:""};' }));
    await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
    await page.goto(BASE); await page.waitForFunction(() => W.app && W.app.S.server);
    await page.click("#acctBtn"); await page.click("[data-action=authTab][data-tab=up]");
    await page.fill("#upUser", "Sa"); await page.fill("#upEmail", "samaa@example.test"); await page.fill("#upPw", "short");
    await page.click("#upForm button[type=submit]");
    const e1 = await text(page, "#acctErr");
    await page.fill("#upUser", "samaa_test"); await page.click("#upForm button[type=submit]");
    const e2 = await text(page, "#acctErr");
    rec("T13.1", "Sign-up validates username and password with clear messages", /3–30 characters/.test(e1) && /At least 10 characters/.test(e2), "username rule, then password rule", { e1, e2 });
    await page.click("#upForm [data-action=togglePw]");
    rec("T13.2", "Show / hide password toggles the field", (await page.getAttribute("#upPw", "type")) === "text" && (await page.getAttribute("#upForm [data-action=togglePw]", "aria-pressed")) === "true", "type=text, pressed", await page.getAttribute("#upPw", "type"));
    await page.fill("#upPw", "wishly2026pass"); await page.click("#upForm button[type=submit]"); await page.waitForTimeout(150);
    rec("T13.3", "Successful sign-up asks to confirm the email (no instant fake login)", /confirm your account/.test(await text(page, "#authPane")) && (await text(page, "#acctLabel")) === "Guest", "check-email notice; still guest", await text(page, "#authPane"));
    await page.click("[data-action=authTab][data-tab=in]"); await page.fill("#inEmail", "samaa@example.test"); await page.fill("#inPw", "wishly2026pass"); await page.click("#inForm button[type=submit]"); await page.waitForTimeout(150);
    rec("T13.4", "Sign-in before confirming shows the reason and a resend button", /confirm your email/.test(await text(page, "#acctErr")) && (await page.isVisible("[data-action=resend]")), "message + resend", await text(page, "#acctErr"));
    await page.fill("#inPw", "wrong-password1"); await page.click("#inForm button[type=submit]"); await page.waitForTimeout(150);
    rec("T13.5", "Wrong password gives a useful error", /Email or password is wrong/.test(await text(page, "#acctErr")), "wrong credentials message", await text(page, "#acctErr"));
    await page.evaluate(() => window.__mockConfirm("samaa@example.test"));
    await page.fill("#inPw", "wishly2026pass"); await page.click("#inForm button[type=submit]"); await page.waitForFunction(() => W.app.S.store.kind === "server"); await page.waitForTimeout(300);
    rec("T13.6", "After confirming, sign-in switches to the account (header shows @username)", (await text(page, "#acctLabel")) === "@samaa_test", "@samaa_test", await text(page, "#acctLabel"));
    const ls = await page.evaluate(() => JSON.stringify(localStorage));
    rec("T13.7", "No password stored in the browser", !ls.includes("wishly2026pass"), "password absent from localStorage", "");
    await page.click("[data-action=go][data-view=wish] >> nth=0"); await wishAndCheck(page, "café in Zamalek for 2"); await search(page);
    await page.click("#matchArea [data-action=save][data-id=c1]"); await page.click("#matchArea [data-action=plan][data-id=c1]");
    await page.fill("#planWhen", "2026-10-30T20:00"); await page.click("#planForm button[type=submit]"); await page.waitForSelector("#view-trips:not([hidden])");
    rec("T13.8", "Account mode: saved place and trip go to the server store", (await page.evaluate(() => W.app.S.trips.length)) === 1 && /Saved to your Wishly account/.test(await text(page, "#tripsMode")), "1 trip; server mode text", await text(page, "#tripsMode"));
    await page.click("#tripArea [data-action=invites]"); await page.click("[data-action=newInvite]"); await page.waitForSelector("#inviteUrl");
    const url = await page.inputValue("#inviteUrl");
    rec("T13.9", "Invite link is created with only a token (no private data in the URL)", /^https:\/\/wishly\.example\/#invite=[A-Za-z0-9]+$/.test(url), "https://wishly.example/#invite=<token>", url);
    await page.keyboard.press("Escape"); await page.click("#tripArea [data-action=invites]"); await page.click("[data-action=revokeInvite]"); await page.waitForTimeout(200);
    rec("T13.10", "Owner can revoke an invite link", /Revoked/.test(await text(page, "#dlgBody")), "link shows Revoked", await text(page, "#dlgBody"));
    await page.keyboard.press("Escape");
    await page.evaluate((u) => { location.hash = u.split("#")[1]; }, url); await page.waitForTimeout(300);
    rec("T13.11", "Opening a revoked invite shows the revoked message", /revoked by the organizer/.test(await text(page, "#dlgBody")), "revoked message", await text(page, "#dlgBody"));
    await page.keyboard.press("Escape");
    await page.evaluate(() => { location.hash = "invite=madeUpToken123"; }); await page.waitForTimeout(300);
    rec("T13.12", "Opening an invalid invite shows the invalid message", /isn't valid/.test(await text(page, "#dlgBody")), "invalid message", await text(page, "#dlgBody"));
    await page.keyboard.press("Escape");
    await page.click("#tripTabs [data-tab=trips]"); await page.click("#tripArea [data-action=visited]"); await page.click("#rateForm input[name=rPlace][value='1'] >> xpath=.."); await page.click("#rateForm button[type=submit]"); await page.waitForTimeout(250);
    rec("T13.13", "Account mode: rating 1 creates the reviewer's exclusion", await page.evaluate(() => W.app.S.exclusions.some((e) => e.placeId === "c1")), "c1 excluded", "");
    await page.reload(); await page.waitForFunction(() => W.app && W.app.S.store && W.app.S.store.kind === "server"); await page.waitForTimeout(200);
    rec("T13.14", "Session persists across refresh; data reloads from the account", (await page.evaluate(() => W.app.S.trips.length)) === 1 && (await page.evaluate(() => W.app.S.saved.has("c1"))), "trip + saved after reload", "");
    await page.click("#acctBtn"); await page.waitForSelector("[data-action=signOut]"); await page.click("[data-action=signOut]"); await page.waitForTimeout(250);
    rec("T13.15", "Sign out returns to guest; account data is not shown as guest data", (await text(page, "#acctLabel")) === "Guest" && (await page.evaluate(() => W.app.S.trips.length)) === 0, "Guest, 0 trips", await page.evaluate(() => W.app.S.trips.length));
    await page.click("#acctBtn"); await page.click("[data-action=authTab][data-tab=in]"); await page.fill("#inEmail", "samaa@example.test"); await page.fill("#inPw", "wishly2026pass"); await page.click("#inForm button[type=submit]"); await page.waitForFunction(() => W.app.S.store.kind === "server"); await page.waitForTimeout(250);
    rec("T13.16", "Log back in: account data is back", (await page.evaluate(() => W.app.S.trips.length)) === 1, "1 trip", await page.evaluate(() => W.app.S.trips.length));
    rec("T13.17", "No page errors in server-mode flows", page.errors.length === 0, "none", page.errors);
    await ctx.close();
  }

  /* ---------- T14 sourced places (public Google Maps listings) in server mode ---------- */
  {
    const real = require("../../tools/make_real_places_sql.cjs").rows;
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }); const page = await ctx.newPage();
    page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
    await ctx.addInitScript((rows) => { window.__extraPlaces = rows; }, real);
    await ctx.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.WISHLY_CONFIG={supabaseUrl:"https://mock.supabase.test",supabaseAnonKey:"anon-test",siteUrl:"https://wishly.example/",providers:{google:false,facebook:false},manualLinking:false,facebookFriends:false,uberClientId:""};' }));
    await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
    await page.goto(BASE); await page.waitForFunction(() => W.app && W.app.S.places && W.app.S.places.length > 60);
    await page.click("#wish"); await wishAndCheck(page, "pet friendly café in Maadi with my dog"); await search(page);
    const conf = await cardIds(page, "confirmed"), ask = await cardIds(page, "ask"), all = conf.concat(ask);
    rec("T14.1", "Once real places exist, demo places are left out of results", all.length > 0 && all.every((id) => id.startsWith("gm-")), "only gm-* ids", all.slice(0, 8));
    rec("T14.2", "Dog-friendly listings with a source count as matches (Genco)", conf.includes("gm-16363566779832845154"), "Genco in matches", conf);
    rec("T14.3", "Listings without a pet policy go to Ask (Café Greco)", ask.includes("gm-6924498732573733792") && !conf.includes("gm-6924498732573733792"), "Café Greco in Ask", ask.slice(0, 10));
    rec("T14.4", "Results say the data is from Google Maps listings, not called", /Google Maps listings/.test(await text(page, "#matchArea")), "sourced note shown", "");
    await page.click("#matchArea [data-action=details][data-id=gm-16363566779832845154]"); await page.waitForTimeout(150);
    const d1 = await text(page, "#dlgBody");
    rec("T14.5", "Details show the phone, price range and source date", /\+20 10 64115531/.test(d1) && /Up to EGP 200 per person/.test(d1) && /Google Maps listing/.test(d1) && /2026|21 Oct/.test(d1), "phone, up to EGP 200, source", d1.slice(0, 400));
    rec("T14.6", "Details offer directions to the listing's pin", !!(await page.$("#dlgBody a[href*='cid=16363566779832845154']")) && /Pin taken from/.test(d1), "maps link", "");
    await page.keyboard.press("Escape");
    await page.click("#matchArea [data-action=details][data-id=gm-11331790703370617337]"); await page.waitForTimeout(150);
    const d2 = await text(page, "#dlgBody");
    rec("T14.7", "Menu link and 'outdoor only' dog rule are shown (Brew Loops)", /outdoor seating only/i.test(d2) && !!(await page.$("#dlgBody a[href*='geideapos']")), "menu + restriction", d2.slice(0, 400));
    await page.keyboard.press("Escape");
    rec("T14.8", "No page errors with sourced places", page.errors.length === 0, "none", page.errors);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.result !== "PASS").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
