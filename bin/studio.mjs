#!/usr/bin/env node
// openflirt studio: a local page over the crush folders, drawn like a dating sim. It serves studio/ and a small
// JSON API on 127.0.0.1 only. Every write carries the token this run printed into the page, so a site open in
// another tab cannot post into the folders through the browser.
// Usage: node bin/studio.mjs [--port 4747] [--open]
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { addCrush, addDecision, addEvents, computeState, crushDir, CrushError, ingest, listCrushes, markRead, readDecisions, readEvidence, readProfile, setFeedback, timeline, updateProfile } from "../skills/crush/scripts/lib/store.mjs";
import { askNext, readShots } from "../skills/crush/scripts/lib/agents.mjs";
import { runAgent } from "../scripts/lib/agent.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIC = join(ROOT, "studio");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_UPLOAD = 25 * 1024 * 1024;
const TOKEN = randomBytes(16).toString("hex");

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
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

export function summary(profile) {
  const state = computeState(timeline(profile.id), new Date(), { metOn: profile.metOn });
  return { ...profile, state, decisions: readDecisions(profile.id).slice(-1) };
}

// The roster ranks by the gauge, so the best pick is first; the order is the same function the page draws.
export const roster = () => listCrushes().map(summary).sort((a, b) => b.state.gauge.score - a.state.gauge.score);

async function readInstagram(url) {
  const out = mkdtempSync(join(tmpdir(), "openflirt-ig-"));
  try {
    const r = await runAgent({ command: process.execPath, args: [join(ROOT, "skills", "instagram-dm", "scripts", "read.mjs"), url, "--out", out], cwd: ROOT, input: "", timeoutMs: 300000 });
    if (r.kind !== "exit" || r.code === 2) throw new CrushError("인스타그램 DM을 읽지 못했다: " + (r.stderr ?? r.kind).slice(-400));
    return readFileSync(join(out, "thread.json"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

async function api(req, res, parts) {
  const [, , id, action] = parts;
  if (req.method !== "GET" && req.headers["x-openflirt-token"] !== TOKEN) return send(res, 403, { error: "토큰이 없거나 틀렸다." });
  if (!id) {
    if (req.method === "GET") return send(res, 200, roster());
    if (req.method === "POST") { const b = await readJsonBody(req); return send(res, 201, addCrush({ name: b.name, app: b.app || null, metOn: b.metOn || null, notes: b.notes || "" })); }
  }
  if (req.method === "GET" && !action) {
    const profile = readProfile(id);
    return send(res, 200, { ...summary(profile), timeline: timeline(id).slice(-300), decisions: readDecisions(id).slice(-20), unread: readEvidence(id).filter((e) => e.kind === "image" && !e.read).length });
  }
  if (req.method === "GET" && action === "photo") {
    const profile = readProfile(id);
    if (!profile.photo) return send(res, 404, { error: "사진이 없다." });
    return send(res, 200, readFileSync(join(crushDir(id), profile.photo)), TYPES[extname(profile.photo)] ?? "application/octet-stream");
  }
  if (req.method === "POST") {
    switch (action) {
      case "files": {
        const name = decodeURIComponent(String(req.headers["x-filename"] ?? "upload.bin"));
        return send(res, 201, ingest(id, { name, bytes: await readBody(req), me: req.headers["x-me"] ? decodeURIComponent(String(req.headers["x-me"])) : undefined }));
      }
      case "photo": {
        const ext = extname(decodeURIComponent(String(req.headers["x-filename"] ?? ""))).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new CrushError("사진은 png, jpg, webp만 받는다.");
        writeFileSync(join(crushDir(id), "photo" + ext), await readBody(req));
        return send(res, 200, updateProfile(id, { photo: "photo" + ext }));
      }
      case "instagram": {
        const { url } = await readJsonBody(req);
        if (!/^https:\/\/www\.instagram\.com\/direct\/t\/\d+/.test(url ?? "") && !/^\d+$/.test(url ?? "")) throw new CrushError("instagram.com/direct/t/<id> 주소나 대화방 id를 넣는다.");
        return send(res, 201, ingest(id, { name: "instagram-" + Date.now() + ".json", bytes: await readInstagram(url) }));
      }
      case "read": {
        const got = await readShots(id);
        const added = addEvents(id, got.events);
        if (got.profile?.notes) { const p = readProfile(id); updateProfile(id, { app: p.app ?? got.profile.app, notes: [p.notes, got.profile.notes].filter(Boolean).join("\n") }); }
        markRead(id, got.files);
        return send(res, 200, { read: got.files.length, added: added.length });
      }
      case "event": { const b = await readJsonBody(req); return send(res, 201, addEvents(id, [{ ...b, source: "manual" }])); }
      case "next": {
        const b = await readJsonBody(req);
        const { answer } = await askNext(id, { runtime: b.runtime === "claude" ? "claude" : "codex", ask: b.ask ?? "" });
        return send(res, 201, addDecision(id, { verdict: answer.verdict, action: answer.action, reading: answer.reading, message: answer.message, answer: answer.answer, citations: answer.citations }));
      }
      case "feedback": { const b = await readJsonBody(req); setFeedback(id, b.decision, b.feedback); return send(res, 200, { ok: true }); }
      case "profile": { const b = await readJsonBody(req); return send(res, 200, updateProfile(id, b)); }
    }
  }
  return send(res, 404, { error: "없는 경로다." });
}

export function handler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "api" && parts[1] === "crushes") {
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

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url).toLowerCase() === (await import("node:fs")).realpathSync(process.argv[1]).toLowerCase()) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "4747" }, open: { type: "boolean", default: false } } });
  const server = createServer(handler);
  server.listen(Number(values.port), "127.0.0.1", () => {
    const at = "http://127.0.0.1:" + values.port + "/";
    process.stdout.write("openflirt studio " + at + "\n");
    if (values.open) spawn(process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open", [at], { stdio: "ignore", detached: true }).unref();
  });
}
