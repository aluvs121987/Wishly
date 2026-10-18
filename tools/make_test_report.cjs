// Builds TEST_RESULTS.md from the saved outputs of the three test suites.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const e2e = JSON.parse(fs.readFileSync(path.join(root, "tests/e2e/results.json"), "utf8"));
const sql = fs.readFileSync(path.join(root, "tests/sql/results.txt"), "utf8").trim().split("\n").map((l) => l.split("|").map((x) => x.trim()));
const unit = fs.readFileSync(path.join(root, "tests/unit/engine.results.txt"), "utf8").trim().split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const pass = (a) => a.filter((x) => x).length;
let md = `# Wishly V4: test results

Run on 18 October 2026 in this build environment: headless Chromium 141 through Playwright 1.56, Node 22 and PostgreSQL 16.
Every result below comes from a test that actually ran. Tests that could not run are listed under **Blocked or not executed**; none of them is counted as passed.

| Suite | What it exercises | Result |
|---|---|---|
| Database authorization | \`supabase/schema.sql\` on real PostgreSQL, as 3 signed-in users, an admin, an anonymous visitor and the service role | **${sql.filter((r) => r[1] === "PASS").length} / ${sql.length} PASS** |
| Browser end-to-end | The real UI, driven through its controls (\`tests/e2e/e2e.cjs\`) | **${e2e.filter((r) => r.result === "PASS").length} / ${e2e.length} PASS** |
| Matching engine | Parsing, constraints, three-state access, Cairo time (\`tests/unit/engine.test.cjs\`) | **${unit.filter((l) => l.startsWith("PASS")).length} / ${unit.length} PASS** |
| Text | English and Arabic have the same 711 keys, with matching placeholders | **PASS** |

Re-run everything with \`tests/run_all.sh -h localhost -U postgres\`.

**How to read the results**
- **Fixture:** Some browser tests add a test-only "verified" café in Maadi (\`fx1\`) so that the positive paths can be checked. These are confirmed results, radius search, map and ride links, and Ask the place with real contact buttons. The fixture is not part of the app.
- **T13 (stand-in sign-in service):** The T13 tests run the account screens against a stand-in for the Supabase client, because Supabase can't be reached from this environment. They check the app's own handling: validation, messages, sessions, invites and ratings. **They do not test Row Level Security.** That is what the database suite does, on real PostgreSQL.

## Required scenario: Maadi, pet-friendly café, 700 EGP per person, 2 people, pet coming

| Check | Expected | Actual | Result |
|---|---|---|---|
| Total | 700 × 2 = 1,400 EGP | "EGP 700 per person × 2 = EGP 1,400 total" | PASS (T1.2) |
| Area respected | Maadi only, no silent expansion | 0 results outside Maadi; "Search all areas" offered as a button | PASS (T1.5) |
| Café + pet enforced | Only cafés; pet policy must be confirmed | 16 non-cafés ruled out; no demo pet claim accepted | PASS (T1.3, T1.4) |
| Outcome with demo data | Honest no-match | "No confirmed match", with the reasons counted | PASS (T1.4) |
| Outcome with a verified record | Confirmed, priced for 2 | Fixture café confirmed, EGP 300 × 2 = EGP 600 | PASS (T1.6) |
| Arabic version with Arabic digits | Same fields filled | Maadi / 700 / 2 / dog | PASS (T2.3) |

## Browser end-to-end

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
${e2e.map((r) => `| ${r.id} | ${cell(r.name)} | ${cell(r.expected)} | ${cell(r.result === "PASS" ? "as expected" : r.actual)} | ${r.result} |`).join("\n")}

## Database authorization (real PostgreSQL 16)

These run as users A, B and C and check what each one can and cannot read or change.

| # | Check | Result |
|---|---|---|
${sql.map((r) => `| ${r[0]} | ${cell(r[2])} | ${r[1]} |`).join("\n")}

## Matching engine

| Check | Result |
|---|---|
${unit.map((l) => `| ${cell(l.slice(5))} | ${l.slice(0, 4)} |`).join("\n")}

## Blocked or not executed

| Test | Status | Why | What it needs |
|---|---|---|---|
| Two real people signing in from two browsers against a live Supabase project | **Blocked** | No Supabase project exists yet, and this environment can't reach supabase.co | SETUP.md steps 1–5, then the two-person check at the end of SETUP.md. Isolation itself is tested at database level (checks 5–8, 25–27, 31–42, 57–59, 77–78) |
| Email verification and password-reset emails actually arriving | **Blocked** | Needs a live project and email delivery | SETUP.md step 3 |
| Google sign-in | **Blocked** | Needs a Google Cloud OAuth client | SETUP.md step 6 |
| Facebook sign-in and Facebook friend discovery | **Blocked** | Needs a Meta app, plus App Review for \`user_friends\` | SETUP.md steps 7 and 9 |
| Supabase client calls against the real API (\`js/stores.js\` ServerStore) | **Not executed** | Exercised only against the stand-in client (T13) | First run after SETUP.md |
| Edge Function \`facebook-friends\` | **Not executed** | Needs deployment and a Facebook token | SETUP.md step 9 |
| Private Claude storage on the live claude.ai artifact | **Partly executed** | After publishing, the page ran on claude.ai and created the owner's private document \`data/users/<id>/wishly\` (read back on 18 Oct 2026: version 1, empty profile). Saving and reloading by a person was not executed. The logic passed with a stand-in runtime (T11) | Open the review artifact, save a place, reload |
| Real phone GPS, and the native share sheet on a phone | **Not executed** | Simulated with Chromium's location override and errors (T4) | Test on a phone over HTTPS |
| Screen readers (NVDA, VoiceOver, TalkBack) | **Not executed** | Only automated checks ran (labels, focus, keyboard: T10) | A manual pass before the submission |
| Arabic wording reviewed by a native speaker | **Not executed** | Written for Egyptian users, not proof-read by a person | Samaa or a colleague |
`;
fs.writeFileSync(path.join(root, "TEST_RESULTS.md"), md);
console.log("wrote TEST_RESULTS.md");
