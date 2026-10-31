// One folder per person the asker is getting to know, and the deterministic reads over it: the merged
// timeline, the counts a reading of interest rests on, and the gauge the studio draws. Every decision that
// needs meaning (what a screenshot shows, whether a line proposes a meeting) is written into the folder by
// a reader, a model run or a person, as an event; this module only stores and counts.
//
// <root>/<id>/profile.json   { id, name, app, metOn, photo, notes, createdAt }
// <root>/<id>/evidence/      every file the asker handed over, as given, named <sha8>-<name>
// <root>/<id>/evidence.json  [{ file, sha256, kind, source, addedAt, read, thread }]
// <root>/<id>/threads/       thread.json files ($kakaotalk-chat, $instagram-dm), validated by validateThread
// <root>/<id>/events.jsonl   events read from screenshots or written by hand
// <root>/<id>/decisions.jsonl next-action answers and the asker's reaction to each
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateThread } from "../../../openflirt/scripts/behaviors.mjs";
import { parseExport, renderTranscript } from "../../../kakaotalk-chat/scripts/lib/export.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const DEFAULT_ROOT = join(REPO_ROOT, "crushes.local");
export const crushRoot = () => process.env.OPENFLIRT_CRUSHES ?? DEFAULT_ROOT;

export class CrushError extends Error {}

const ID = /^[\p{L}\p{N}_-]{1,40}$/u;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const EVENT_KINDS = ["message", "meet", "plan", "call", "profile", "note"];
export const WHO = ["me", "her", null];
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"]);

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const readLines = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)) : []);
const pad = (n) => String(n).padStart(2, "0");
export const stamp = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
const parseAt = (at) => new Date(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, Number(at.slice(8, 10)), Number(at.slice(11, 13)), Number(at.slice(14, 16)));

export const idFor = (name) => name.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);

export function crushDir(id, root = crushRoot()) {
  if (typeof id !== "string" || !ID.test(id)) throw new CrushError("id는 글자, 숫자, -, _ 40자 이내여야 한다: " + id);
  return join(root, id);
}

function mustExist(id, root) {
  const dir = crushDir(id, root);
  if (!existsSync(join(dir, "profile.json"))) throw new CrushError("등록되지 않은 상대다: " + id);
  return dir;
}

export function addCrush({ name, id = idFor(name ?? ""), app = null, metOn = null, notes = "" }, root = crushRoot()) {
  if (typeof name !== "string" || name.trim() === "") throw new CrushError("이름(별명)이 비었다.");
  if (metOn !== null && !DATE.test(metOn)) throw new CrushError("metOn은 YYYY-MM-DD다: " + metOn);
  const dir = crushDir(id, root);
  if (existsSync(join(dir, "profile.json"))) throw new CrushError("이미 있는 상대다: " + id);
  for (const sub of ["evidence", "threads"]) mkdirSync(join(dir, sub), { recursive: true });
  const profile = { id, name: name.trim(), aliases: [], app, metOn, photo: null, notes, createdAt: stamp(new Date()) };
  writeJson(join(dir, "profile.json"), profile);
  writeJson(join(dir, "evidence.json"), []);
  return profile;
}

export const listCrushes = (root = crushRoot()) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, e.name, "profile.json"))).map((e) => readJson(join(root, e.name, "profile.json")))
    : [];

export const readProfile = (id, root = crushRoot()) => readJson(join(mustExist(id, root), "profile.json"));

export function updateProfile(id, patch, root = crushRoot()) {
  const dir = mustExist(id, root);
  const profile = { ...readJson(join(dir, "profile.json")) };
  for (const key of ["name", "aliases", "app", "metOn", "notes", "photo", "instagram"]) if (key in patch) profile[key] = patch[key];
  if (profile.metOn !== null && !DATE.test(profile.metOn)) throw new CrushError("metOn은 YYYY-MM-DD다: " + profile.metOn);
  writeJson(join(dir, "profile.json"), profile);
  return profile;
}

// A KakaoTalk export is told by its content, so a renamed file is still read; a thread.json by validating it.
function kindOf(name, bytes) {
  const ext = extname(name).toLowerCase();
  if (IMAGE.has(ext)) return "image";
  if (ext === ".json") {
    try { validateThread(JSON.parse(bytes.toString("utf8"))); return "thread"; } catch { return "other"; }
  }
  if (ext === ".txt") {
    try { parseExport(bytes.toString("utf8"), { fileName: name }); return "kakaotalk"; } catch { return "text"; }
  }
  return "other";
}

// Stores one file as evidence. The same bytes twice are one entry. A KakaoTalk export or a thread.json
// also becomes a thread; an image waits, unread, for a reader to turn it into events.
export function ingest(id, { name, bytes, me } = {}, root = crushRoot()) {
  const dir = mustExist(id, root);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const evidence = readJson(join(dir, "evidence.json"), []);
  const known = evidence.find((e) => e.sha256 === sha256);
  if (known) return { entry: known, added: false };
  const file = "evidence/" + sha256.slice(0, 8) + "-" + basename(name).replace(/[^\p{L}\p{N}._-]/gu, "_");
  writeFileSync(join(dir, file), bytes);
  const kind = kindOf(name, bytes);
  const entry = { file, sha256, kind, source: basename(name), addedAt: stamp(new Date()), read: kind !== "image", thread: null };
  if (kind === "kakaotalk" || kind === "thread") {
    const thread = kind === "kakaotalk" ? parseExport(bytes.toString("utf8"), { fileName: basename(name), me }) : JSON.parse(bytes.toString("utf8"));
    if (thread.me === null) throw new CrushError("대화의 어느 쪽이 나인지 알 수 없다. me를 정해 다시 넣는다: " + thread.participants.join(", "));
    entry.thread = "threads/" + sha256.slice(0, 8) + ".json";
    writeJson(join(dir, entry.thread), thread);
    if (kind === "kakaotalk") writeFileSync(join(dir, "threads", sha256.slice(0, 8) + ".md"), renderTranscript(thread));
  }
  writeJson(join(dir, "evidence.json"), [...evidence, entry]);
  return { entry, added: true };
}

export const ingestFile = (id, path, { me } = {}, root = crushRoot()) => ingest(id, { name: basename(path), bytes: readFileSync(path), me }, root);

export const readEvidence = (id, root = crushRoot()) => readJson(join(mustExist(id, root), "evidence.json"), []);

export function markRead(id, files, root = crushRoot()) {
  const dir = mustExist(id, root);
  const evidence = readJson(join(dir, "evidence.json"), []).map((e) => (files.includes(e.file) ? { ...e, read: true } : e));
  writeJson(join(dir, "evidence.json"), evidence);
}

export function checkEvent(e, i = 0) {
  const where = "events[" + i + "]";
  if (typeof e !== "object" || e === null) throw new CrushError(where + "가 객체가 아니다.");
  if (typeof e.at !== "string" || !AT.test(e.at)) throw new CrushError(where + ".at은 YYYY-MM-DDTHH:MM이다: " + e.at);
  if (!EVENT_KINDS.includes(e.kind)) throw new CrushError(where + ".kind는 " + EVENT_KINDS.join(", ") + " 중 하나다: " + e.kind);
  if (!WHO.includes(e.who ?? null)) throw new CrushError(where + ".who는 me, her, null 중 하나다: " + e.who);
  if (typeof e.text !== "string") throw new CrushError(where + ".text가 문자열이 아니다.");
  return { at: e.at, who: e.who ?? null, kind: e.kind, text: e.text, source: typeof e.source === "string" ? e.source : null };
}

// Appends events, skipping one already stored with the same time, side, kind and text.
export function addEvents(id, events, root = crushRoot()) {
  const dir = mustExist(id, root);
  const checked = events.map(checkEvent);
  const key = (e) => [e.at, e.who, e.kind, e.text].join("|");
  const have = new Set(readLines(join(dir, "events.jsonl")).map(key));
  const fresh = checked.filter((e) => !have.has(key(e)) && have.add(key(e)));
  if (fresh.length) appendFileSync(join(dir, "events.jsonl"), fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return fresh;
}

// Every message of every thread and every stored event, oldest first, with sides as me and her.
export function timeline(id, root = crushRoot()) {
  const dir = mustExist(id, root);
  const items = [];
  for (const e of readJson(join(dir, "evidence.json"), [])) {
    if (!e.thread) continue;
    const thread = readJson(join(dir, e.thread));
    for (const m of thread.messages) {
      if (m.kind === "system") continue;
      const kind = m.kind === "call" ? "call" : "message";
      items.push({ at: m.at, who: m.who === null ? null : m.who === thread.me ? "me" : "her", kind, text: m.text || "[" + m.kind + "]", source: e.file });
    }
  }
  items.push(...readLines(join(dir, "events.jsonl")));
  const seen = new Set();
  return items
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .filter((e) => { const k = [e.at, e.who, e.kind, e.text].join("|"); return seen.has(k) ? false : seen.add(k); });
}

const DAY = 86400000;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

// The counts the studio shows and the gauge drawn from them. The gauge is a fixed sum of behaviours with its
// parts listed, never a guess at her feelings; the verdict still comes from the openflirt verdict table.
export function computeState(items, now = new Date(), { metOn = null } = {}) {
  const talk = items.filter((e) => e.kind === "message" && e.who !== null);
  const first = items.length ? parseAt(items[0].at) : null;
  const met = metOn ? new Date(Number(metOn.slice(0, 4)), Number(metOn.slice(5, 7)) - 1, Number(metOn.slice(8, 10))) : null;
  const firstDay = first ? new Date(first.getFullYear(), first.getMonth(), first.getDate()) : null;
  const start = met && (!firstDay || met < firstDay) ? met : firstDay;
  const recentFrom = new Date(now.getTime() - 14 * DAY);
  const recent = talk.filter((e) => parseAt(e.at) >= recentFrom);
  const delays = { me: [], her: [] };
  let opened = { me: 0, her: 0 };
  talk.forEach((e, i) => {
    const prev = talk[i - 1];
    if (parseAt(e.at) < recentFrom) return;
    if (!prev || parseAt(e.at) - parseAt(prev.at) >= 6 * 3600000) opened[e.who]++;
    else if (prev.who !== e.who) delays[e.who].push((parseAt(e.at) - parseAt(prev.at)) / 60000);
  });
  const plans = items.filter((e) => e.kind === "plan");
  const nextMeet = plans.filter((e) => parseAt(e.at) >= now).at(0) ?? null;
  const meets = items.filter((e) => e.kind === "meet" && parseAt(e.at) <= now);
  const lastHer = [...talk].reverse().find((e) => e.who === "her") ?? null;
  const last = talk.at(-1) ?? null;
  const herMsgs = recent.filter((e) => e.who === "her").length;
  const herReply = median(delays.her);
  const openedTotal = opened.me + opened.her;
  const sinceHer = lastHer ? (now - parseAt(lastHer.at)) / DAY : null;
  const parts = [
    { label: "만남", points: nextMeet || meets.length ? 30 : 0, max: 30, why: meets.length ? "만난 적 " + meets.length + "번" : nextMeet ? "잡힌 약속 " + nextMeet.at : "잡힌 약속 없음" },
    { label: "먼저 연 대화", points: openedTotal ? Math.round((25 * opened.her) / openedTotal) : 0, max: 25, why: "최근 14일 상대 " + opened.her + "번, 나 " + opened.me + "번" },
    { label: "답장 속도", points: herReply === null ? 0 : herReply < 30 ? 20 : herReply < 180 ? 12 : herReply < 1440 ? 5 : 0, max: 20, why: herReply === null ? "최근 14일 답장 없음" : "상대 답장 중앙값 " + Math.round(herReply) + "분" },
    { label: "대화 비중", points: recent.length ? Math.min(15, Math.round((30 * herMsgs) / recent.length)) : 0, max: 15, why: "최근 14일 메시지 " + recent.length + "개 중 상대 " + herMsgs + "개" },
    { label: "최근 연락", points: sinceHer === null ? 0 : sinceHer <= 2 ? 10 : sinceHer <= 7 ? 5 : 0, max: 10, why: sinceHer === null ? "상대 메시지 없음" : "상대 마지막 메시지 " + Math.floor(sinceHer) + "일 전" },
  ];
  return {
    day: start ? Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / DAY) + 1 : null,
    firstAt: items[0]?.at ?? null,
    stage: meets.length ? "만남 " + meets.length + "번" : nextMeet ? "약속 잡힘" : "만남 전",
    nextMeet,
    daysToMeet: nextMeet ? Math.ceil((parseAt(nextMeet.at) - now) / DAY) : null,
    last,
    lastHer,
    counts: { messages: talk.length, me: talk.filter((e) => e.who === "me").length, her: talk.filter((e) => e.who === "her").length },
    recent: { opened, replyMedianMinutes: { me: median(delays.me), her: herReply } },
    gauge: { score: parts.reduce((s, p) => s + p.points, 0), parts },
  };
}

export const readDecisions = (id, root = crushRoot()) => readLines(join(mustExist(id, root), "decisions.jsonl"));

export function addDecision(id, decision, root = crushRoot()) {
  const dir = mustExist(id, root);
  const entry = { id: stamp(new Date()) + "-" + createHash("sha256").update(JSON.stringify(decision)).digest("hex").slice(0, 6), at: stamp(new Date()), ...decision, feedback: null };
  appendFileSync(join(dir, "decisions.jsonl"), JSON.stringify(entry) + "\n");
  return entry;
}

export function setFeedback(id, decisionId, feedback, root = crushRoot()) {
  const dir = mustExist(id, root);
  const all = readLines(join(dir, "decisions.jsonl"));
  if (!all.some((d) => d.id === decisionId)) throw new CrushError("없는 추천이다: " + decisionId);
  writeFileSync(join(dir, "decisions.jsonl"), all.map((d) => JSON.stringify(d.id === decisionId ? { ...d, feedback } : d)).join("\n") + "\n");
}

export const evidencePath = (id, file, root = crushRoot()) => {
  const dir = mustExist(id, root);
  const path = resolve(dir, file);
  if (!path.startsWith(resolve(dir, "evidence") + (process.platform === "win32" ? "\\" : "/"))) throw new CrushError("evidence 폴더 밖 파일이다: " + file);
  return path;
};


// Routing: which crush a new piece of evidence belongs to. The names a file carries are read by fixed rules
// (the KakaoTalk header and speakers, a thread's title and participants, the export's file name); only a
// screenshot needs a model, which reports the name it sees and is then matched by the same rule.
const HONORIFIC = /(님|씨|양|군)$/u;
export const normName = (s) => String(s ?? "").normalize("NFC").replace(/^\*?\d+\s*/u, "").replace(/[\s\p{Extended_Pictographic}·•._-]+/gu, "").replace(HONORIFIC, "").toLowerCase();

// Every crush whose name or alias equals the name, or, for names of two letters or more, contains it or is
// contained in it ("서빈" and "*01 박서빈" are one person). More than one hit is ambiguous and is returned whole.
export function matchCrush(name, crushes) {
  const n = normName(name);
  if (n.length === 0) return [];
  const keys = (c) => [c.name, ...(c.aliases ?? [])].map(normName).filter(Boolean);
  const exact = crushes.filter((c) => keys(c).includes(n));
  if (exact.length) return exact;
  if (n.length < 2) return [];
  return crushes.filter((c) => keys(c).some((k) => k.length >= 2 && (k.includes(n) || n.includes(k))));
}

const KAKAO_FILE = /^KakaoTalk_[\d_]+?_(?:\d+_)*(.+?)(?:\.local)?\.txt$/u;
// The other side's name as the file states it, or null. Never guesses from free text.
export function nameHint(name, bytes, kind, me) {
  if (kind === "kakaotalk") {
    try {
      const t = parseExport(bytes.toString("utf8"), { fileName: basename(name), me });
      const others = t.participants.filter((p) => p !== t.me);
      if (others.length === 1) return others[0];
      if (t.title && !/\.txt$/.test(t.title)) return t.title;
    } catch {}
    return KAKAO_FILE.exec(basename(name))?.[1] ?? null;
  }
  if (kind === "thread") {
    try { const t = JSON.parse(bytes.toString("utf8")); const others = t.participants.filter((p) => p !== t.me); return others.length === 1 ? others[0] : t.title ?? null; } catch { return null; }
  }
  return null;
}

export const fileKind = (name, bytes) => kindOf(name, bytes);

export function addAlias(id, alias, root = crushRoot()) {
  const dir = mustExist(id, root);
  const p = readJson(join(dir, "profile.json"));
  const have = [p.name, ...(p.aliases ?? [])].map(normName);
  if (alias && !have.includes(normName(alias))) { p.aliases = [...(p.aliases ?? []), alias]; writeJson(join(dir, "profile.json"), p); }
  return p;
}

// Decides the crush for a file: the name it carries matched against every crush, then the crush the asker
// has open, then, when nothing matches and the file names someone, a new crush with that name.
// Returns { id, created, reason } or { ambiguous: [...ids] } or { needsRead: true } for an unnamed screenshot.
export function routeFile({ name, bytes, selected = null, me }, root = crushRoot()) {
  const kind = kindOf(name, bytes);
  const crushes = listCrushes(root);
  const hint = nameHint(name, bytes, kind, me);
  if (hint) {
    const hits = matchCrush(hint, crushes);
    if (hits.length === 1) { addAlias(hits[0].id, hint, root); return { id: hits[0].id, created: false, kind, reason: "이름 '" + hint + "'이 " + hits[0].name + "와 맞는다" }; }
    if (hits.length > 1) return { ambiguous: hits.map((c) => c.id), kind, hint };
    const p = addCrush({ name: hint.replace(/^\*?\d+\s*/u, "").trim() || hint, id: uniqueId(hint, root) }, root);
    addAlias(p.id, hint, root);
    return { id: p.id, created: true, kind, reason: "처음 보는 이름 '" + hint + "'이라 새 상대로 만들었다" };
  }
  if (selected) return { id: selected, created: false, kind, reason: "이름이 없는 파일이라 열려 있는 상대에 넣었다" };
  if (kind === "image") return { needsRead: true, kind };
  if (crushes.length === 1) return { id: crushes[0].id, created: false, kind, reason: "상대가 한 명뿐이라 그 상대에 넣었다" };
  return { ambiguous: crushes.map((c) => c.id), kind, hint: null };
}

export function uniqueId(name, root = crushRoot()) {
  const base = idFor(String(name).replace(/^\*?\d+\s*/u, "")) || "crush";
  let id = base, n = 2;
  while (existsSync(join(root, id))) id = base + "-" + n++;
  return id;
}

// The conversation the asker has with openflirt about one crush: what they asked or sent and what came back.
export const readChat = (id, root = crushRoot()) => readLines(join(mustExist(id, root), "chat.jsonl"));
export function addChat(id, turn, root = crushRoot()) {
  const dir = mustExist(id, root);
  const entry = { at: stamp(new Date()), ...turn };
  appendFileSync(join(dir, "chat.jsonl"), JSON.stringify(entry) + "\n");
  return entry;
}
