#!/usr/bin/env node
// openflirt studio: a local page over the crush folders. It serves studio/ and a JSON API on 127.0.0.1 only,
// and every write carries the token this run printed into the page, so another site open in the browser
// cannot post into the folders.
// Usage: node bin/studio.mjs [--port 4747] [--open]
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { addChat, addCrush, addDecision, addEvents, computeState, crushDir, CrushError, ingest, listCrushes, markRead, matchCrush, readChat, readDecisions, readEvidence, readProfile, routeFile, timeline, uniqueId, updateProfile, addAlias } from "../skills/crush/scripts/lib/store.mjs";
import { askNext, readShots } from "../skills/crush/scripts/lib/agents.mjs";
import { runAgent } from "../scripts/lib/agent.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIC = join(ROOT, "studio");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
const MAX_UPLOAD = 25 * 1024 * 1024;
const TOKEN = randomBytes(16).toString("hex");
const INSTAGRAM = /https:\/\/www\.instagram\.com\/direct\/t\/\d+\/?/;

// The models each runtime offers. Codex lists what its own catalog file holds; Claude Code takes the
// aliases its CLI documents (opus, sonnet, haiku). An empty model means the runtime's configured default.
export function models() {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  let codex = [];
  try {
    const config = readFileSync(join(codexHome, "config.toml"), "utf8");
    const file = /^model_catalog_json\s*=\s*"(.+)"/m.exec(config)?.[1]?.replaceAll("\\\\", "\\");
    const list = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    codex = (Array.isArray(list?.models) ? list.models : Array.isArray(list) ? list : []).map((m) => m.slug ?? m.id ?? m.model).filter((m) => typeof m === "string" && !/review/.test(m));
  } catch {}
  return [{ runtime: "codex", label: "Codex", models: codex }, { runtime: "claude", label: "Claude Code", models: ["opus", "sonnet", "haiku"] }];
}

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": type.startsWith("font/") || type.startsWith("image/") ? "max-age=3600" : "no-store", "x-content-type-options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size > MAX_UPLOAD) { reject(new CrushError("파일이 25MB를 넘는다.")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
const readJsonBody = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString("utf8")) : {}; };
const header = (req, name) => (req.headers[name] ? decodeURIComponent(String(req.headers[name])) : undefined);

export function summary(profile) {
  return { ...profile, state: computeState(timeline(profile.id), new Date(), { metOn: profile.metOn }) };
}
// The roster ranks by the gauge; the page draws it in this order.
export const roster = () => listCrushes().filter((c) => !c.id.startsWith("_")).map(summary).sort((a, b) => b.state.gauge.score - a.state.gauge.score);

async function readInstagram(url) {
  const out = mkdtempSync(join(tmpdir(), "openflirt-ig-"));
  try {
    const r = await runAgent({ command: process.execPath, args: [join(ROOT, "skills", "instagram-dm", "scripts", "read.mjs"), url, "--out", out], cwd: ROOT, input: "", timeoutMs: 300000 });
    if (r.kind !== "exit" || r.code === 2) throw new CrushError("인스타그램 DM을 읽지 못했다: " + (r.stderr ?? r.kind).slice(-400));
    return readFileSync(join(out, "thread.json"));
  } finally { rmSync(out, { recursive: true, force: true }); }
}

// One file into the right crush. A screenshot nobody is open for is read first, in a hidden inbox crush, so the
// name it shows can pick the crush; its events then move to that crush.
async function intake({ name, bytes, selected, me }) {
  const route = routeFile({ name, bytes, selected, me });
  if (route.ambiguous) return { ...route, status: "ambiguous" };
  if (!route.needsRead) {
    const got = ingest(route.id, { name, bytes, me });
    return { status: "stored", id: route.id, created: route.created, reason: route.reason, kind: route.kind, added: got.added };
  }
  const inbox = "_inbox";
  if (!existsSync(join(crushDir(inbox), "profile.json"))) addCrush({ name: "inbox", id: inbox });
  ingest(inbox, { name, bytes });
  const read = await readShots(inbox);
  markRead(inbox, read.files);
  const seen = read.profile?.name ?? null;
  const hits = seen ? matchCrush(seen, roster()) : [];
  let id, created = false, reason;
  if (hits.length === 1) { id = hits[0].id; addAlias(id, seen); reason = "화면의 이름 '" + seen + "'이 " + hits[0].name + "와 맞는다"; }
  else if (hits.length > 1) { rmSync(crushDir(inbox), { recursive: true, force: true }); return { status: "ambiguous", ambiguous: hits.map((c) => c.id), hint: seen, kind: "image" }; }
  else { id = uniqueId(seen ?? "새 상대"); addCrush({ name: seen ?? "새 상대", id, app: read.profile?.app ?? null }); created = true; reason = seen ? "처음 보는 이름 '" + seen + "'이라 새 상대로 만들었다" : "이름이 보이지 않아 새 상대로 만들었다"; }
  const got = ingest(id, { name, bytes });
  markRead(id, [got.entry.file]);
  addEvents(id, read.events.map((e) => ({ ...e, source: got.entry.file })));
  if (read.profile?.notes) { const p = readProfile(id); updateProfile(id, { app: p.app ?? read.profile.app, notes: [p.notes, read.profile.notes].filter(Boolean).join("\n") }); }
  rmSync(crushDir(inbox), { recursive: true, force: true });
  return { status: "stored", id, created, reason, kind: "image", events: read.events.length };
}

async function api(req, res, parts) {
  const [, area, id, action] = parts;
  if (req.method !== "GET" && req.headers["x-openflirt-token"] !== TOKEN) return send(res, 403, { error: "토큰이 없거나 틀렸다." });
  if (area === "models" && req.method === "GET") return send(res, 200, models());
  if (area === "inbox" && req.method === "POST") {
    return send(res, 201, await intake({ name: header(req, "x-filename") ?? "upload.bin", bytes: await readBody(req), selected: header(req, "x-selected") || null, me: header(req, "x-me") }));
  }
  if (area !== "crushes") return send(res, 404, { error: "없는 경로다." });
  if (!id && req.method === "GET") return send(res, 200, roster());
  if (req.method === "GET" && !action) {
    const profile = readProfile(id);
    const page = Number(new URL(req.url, "http://x").searchParams.get("before") ?? Infinity);
    const all = timeline(id);
    const end = Number.isFinite(page) ? Math.max(0, Math.min(page, all.length)) : all.length;
    return send(res, 200, { ...summary(profile), timeline: all.slice(Math.max(0, end - 200), end), timelineStart: Math.max(0, end - 200), timelineTotal: all.length, chat: readChat(id).slice(-40), decisions: readDecisions(id).slice(-40), unread: readEvidence(id).filter((e) => e.kind === "image" && !e.read).length });
  }
  if (req.method === "GET" && action === "photo") {
    const profile = readProfile(id);
    if (!profile.photo) return send(res, 404, { error: "사진이 없다." });
    return send(res, 200, readFileSync(join(crushDir(id), profile.photo)), TYPES[extname(profile.photo)] ?? "application/octet-stream");
  }
  if (req.method === "POST" && action === "photo") {
    const ext = extname(header(req, "x-filename") ?? "").toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new CrushError("사진은 png, jpg, webp만 받는다.");
    writeFileSync(join(crushDir(id), "photo" + ext), await readBody(req));
    return send(res, 200, updateProfile(id, { photo: "photo" + ext }));
  }
  if (req.method === "POST" && action === "read") {
    const got = await readShots(id);
    const added = addEvents(id, got.events);
    markRead(id, got.files);
    return send(res, 200, { read: got.files.length, added: added.length });
  }
  if (req.method === "POST" && action === "chat") {
    const b = await readJsonBody(req);
    const text = String(b.text ?? "").trim();
    const runtime = b.runtime === "claude" ? "claude" : "codex";
    const model = typeof b.model === "string" && /^[\w./:-]{1,60}$/.test(b.model) ? b.model : undefined;
    addChat(id, { role: "user", text, files: Array.isArray(b.files) ? b.files.slice(0, 20).map(String) : [] });
    const ig = INSTAGRAM.exec(text);
    if (ig) { const got = ingest(id, { name: "instagram-" + Date.now() + ".json", bytes: await readInstagram(ig[0]) }); addChat(id, { role: "system", text: "인스타그램 DM을 읽어 넣었다.", file: got.entry.file }); }
    const { answer } = await askNext(id, { runtime, model, ask: text.replace(INSTAGRAM, "").trim() });
    const decision = addDecision(id, { ask: text, runtime, model: model ?? null, verdict: answer.verdict, action: answer.action, reading: answer.reading, message: answer.message, answer: answer.answer, citations: answer.citations });
    addChat(id, { role: "assistant", decision: decision.id });
    return send(res, 201, decision);
  }
  if (req.method === "POST" && action === "profile") { const b = await readJsonBody(req); return send(res, 200, updateProfile(id, b)); }
  return send(res, 404, { error: "없는 경로다." });
}

export function handler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "api") {
    return api(req, res, parts).catch((e) => {
      if (e instanceof CrushError || e instanceof SyntaxError) return send(res, 400, { error: e.message });
      console.error(e);
      return send(res, 500, { error: String(e?.message ?? e) });
    });
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const path = join(STATIC, file);
  if (!path.startsWith(STATIC) || !existsSync(path)) return send(res, 404, "not found", "text/plain; charset=utf-8");
  const body = readFileSync(path);
  return send(res, 200, file === "index.html" ? body.toString("utf8").replace("__OPENFLIRT_TOKEN__", TOKEN) : body, TYPES[extname(path)] ?? "application/octet-stream");
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "4747" }, open: { type: "boolean", default: false } } });
  const server = createServer(handler);
  server.listen(Number(values.port), "127.0.0.1", () => {
    const at = "http://127.0.0.1:" + values.port + "/";
    process.stdout.write("OpenFlirt studio " + at + "\n");
    if (values.open) spawn(process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open", [at], { stdio: "ignore", detached: true }).unref();
  });
}
