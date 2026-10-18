// Builds dist/wishly-artifact.html: one self-contained page (CSS and JS inlined)
// for publishing as a claude.ai artifact. The source files stay the master copy.
// Run: node tools/build_artifact.cjs
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
html = html.replace(/<link rel="stylesheet" href="css\/app.css">/, () => "<style>\n" + read("css/app.css") + "\n</style>");
// claude.ai blocks connections to Supabase, so the artifact copy runs without the server
const noServer = (f, src) => f === "js/config.js" ? src.replace(/supabaseUrl:\s*"[^"]*"/, 'supabaseUrl: ""').replace(/supabaseAnonKey:\s*"[^"]*"/, 'supabaseAnonKey: ""') : src;
html = html.replace(/<script src="(js\/[a-z0-9_]+\.js)"><\/script>/g, (m, f) => "<script>\n" + noServer(f, read(f)).replace(/<\/script>/g, "<\\/script>") + "\n</script>");
// the artifact host supplies the document skeleton
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"))
  .replace(/<meta charset="utf-8">\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const out = head.trim() + "\n" + body.trim() + "\n";
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/wishly-artifact.html"), out);
console.log("wrote dist/wishly-artifact.html", (out.length / 1024).toFixed(0) + " KB");
