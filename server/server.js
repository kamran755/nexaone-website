// Zero-dependency Node.js (v18+) server: serves the site and provides /api/health, /api/chat, /api/contact.
// Secrets are read ONLY from environment variables (.env). They never reach the browser.
const http = require("http"), fs = require("fs"), path = require("path");

// Minimal .env loader (no dependencies)
for (const f of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")]) {
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { ANTHROPIC_API_KEY, AI_MODEL = "claude-sonnet-4-6", WEB3FORMS_KEY, ALLOWED_ORIGIN = "", PORT = 3000 } = process.env;
const ROOT = path.join(__dirname, "..");
const SYSTEM = `You are the website assistant for Nexaone Infotech Solutions, a technology consulting company in New Delhi, India. Help visitors with: SAP Business One implementation, consulting, support, customisation, SQL Server, SAP HANA, Query Manager, Crystal Reports, DTW data migration, dashboards, training, AI chatbots/automation, websites and custom software. Be concise and practical. Do not invent prices, clients, certifications, partnerships or achievements. If unsure, say so and suggest the contact form or email nexaoneinfotechsolutions@gmail.com.`;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const hits = new Map(); // naive per-IP rate limit
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 20; };

const json = (res, code, obj, req) => {
  const h = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (ALLOWED_ORIGIN) { h["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN; h["Access-Control-Allow-Headers"] = "Content-Type"; }
  res.writeHead(code, h); res.end(JSON.stringify(obj));
};
const body = req => new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > 20000) { no(new Error("Too large")); req.destroy(); } }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { no(new Error("Invalid JSON")); } }); });

async function chat(req, res) {
  if (!ANTHROPIC_API_KEY) return json(res, 503, { error: "AI is not configured on the server." });
  const { messages } = await body(req);
  const clean = (Array.isArray(messages) ? messages : []).slice(-10).filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string").map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!clean.length || clean[clean.length - 1].role !== "user") return json(res, 400, { error: "No question received." });
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: AI_MODEL, max_tokens: 600, system: SYSTEM, messages: clean }) });
  const j = await r.json();
  if (!r.ok) { console.error("AI error:", r.status, j.error && j.error.message); return json(res, 502, { error: "The AI service returned an error." }); }
  json(res, 200, { reply: (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n") });
}
async function contact(req, res) {
  if (!WEB3FORMS_KEY) return json(res, 501, { error: "Contact delivery is not configured on the server." });
  const d = await body(req);
  if (!d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || "") || !d.message) return json(res, 400, { error: "Missing or invalid fields." });
  const r = await fetch("https://api.web3forms.com/submit", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ access_key: WEB3FORMS_KEY, subject: "New Nexaone Infotech Solutions Enquiry", from_name: "Nexaone Website", name: d.name, email: d.email, phone: d.phone || "", service: d.service || "", message: d.message }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.success) return json(res, 200, { success: true });
  json(res, 502, { error: "The email service did not accept the message." });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), ip = req.socket.remoteAddress;
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, ai: !!ANTHROPIC_API_KEY, contact: !!WEB3FORMS_KEY });
    if (url.pathname === "/api/chat" && req.method === "POST") return limited(ip) ? json(res, 429, { error: "Too many requests. Wait a minute." }) : await chat(req, res);
    if (url.pathname === "/api/contact" && req.method === "POST") return limited(ip) ? json(res, 429, { error: "Too many requests. Wait a minute." }) : await contact(req, res);
    // static files
    let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || /[\\/](server|\.env)/.test(f.slice(ROOT.length)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e.message); json(res, 500, { error: "Server error." }); }
}).listen(PORT, () => console.log(`Nexaone site on http://localhost:${PORT}  |  AI: ${ANTHROPIC_API_KEY ? "live" : "demo mode (no key)"}`));
