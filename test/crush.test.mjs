// The crush store: one folder per person, evidence kept as given, a merged timeline and the counts the studio
// draws. No test reaches a model; the studio is driven over HTTP with its real handler.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addCrush, addEvents, computeState, CrushError, evidencePath, ingest, listCrushes, matchCrush, readEvidence, readProfile, routeFile, timeline } from "../skills/crush/scripts/lib/store.mjs";

const EXPORT = [
  "지수 님과 카카오톡 대화",
  "저장한 날짜 : 2026-03-20 22:00:00",
  "",
  "--------------- 2026년 3월 2일 월요일 ---------------",
  "[도윤] [오후 8:00] 이번 주 토요일에 저녁 어때?",
  "[지수] [오후 8:10] 좋아 7시?",
  "[도윤] [오후 8:12] 응 7시",
  "",
].join("\n");

const root = (t) => { const dir = mkdtempSync(join(tmpdir(), "openflirt-crush-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const bytes = (s) => Buffer.from(s, "utf8");

test("a crush is a folder, and an id that leaves its root is refused", (t) => {
  const dir = root(t);
  const p = addCrush({ name: "지수", app: "케밋", metOn: "2026-02-28" }, dir);
  assert.equal(p.id, "지수");
  assert.deepEqual(listCrushes(dir).map((c) => c.id), ["지수"]);
  assert.throws(() => addCrush({ name: "지수" }, dir), CrushError);
  assert.throws(() => addCrush({ name: "x", id: "../out" }, dir), CrushError);
  assert.throws(() => addCrush({ name: "y", metOn: "3월" }, dir), CrushError);
});

test("a KakaoTalk export becomes a thread once, and the same bytes again add nothing", (t) => {
  const dir = root(t);
  addCrush({ name: "jisu" }, dir);
  const first = ingest("jisu", { name: "chat.txt", bytes: bytes(EXPORT) }, dir);
  assert.equal(first.added, true);
  assert.equal(first.entry.kind, "kakaotalk");
  assert.equal(ingest("jisu", { name: "copy.txt", bytes: bytes(EXPORT) }, dir).added, false);
  const items = timeline("jisu", dir);
  assert.deepEqual(items.map((e) => e.who), ["me", "her", "me"]);
});

test("a screenshot waits unread, and evidence paths stay inside the evidence folder", (t) => {
  const dir = root(t);
  addCrush({ name: "jisu" }, dir);
  const { entry } = ingest("jisu", { name: "IMG_1.png", bytes: Buffer.from([137, 80, 78, 71]) }, dir);
  assert.equal(entry.kind, "image");
  assert.equal(readEvidence("jisu", dir)[0].read, false);
  assert.ok(evidencePath("jisu", entry.file, dir).endsWith("IMG_1.png"));
  assert.throws(() => evidencePath("jisu", "../profile.json", dir), CrushError);
});

test("events merge into the timeline in time order, and a repeated event is stored once", (t) => {
  const dir = root(t);
  addCrush({ name: "jisu" }, dir);
  ingest("jisu", { name: "chat.txt", bytes: bytes(EXPORT) }, dir);
  const plan = { at: "2026-03-07T19:00", who: null, kind: "plan", text: "토요일 저녁" };
  assert.equal(addEvents("jisu", [plan, { at: "2026-03-01T12:00", who: "her", kind: "message", text: "안녕하세요" }], dir).length, 2);
  assert.equal(addEvents("jisu", [plan], dir).length, 0);
  assert.throws(() => addEvents("jisu", [{ at: "3/7", kind: "plan", text: "" }], dir), CrushError);
  assert.deepEqual(timeline("jisu", dir).map((e) => e.at), ["2026-03-01T12:00", "2026-03-02T20:00", "2026-03-02T20:10", "2026-03-02T20:12", "2026-03-07T19:00"]);
});

test("the gauge counts behaviour: a booked meeting and quick replies outweigh a quiet thread", () => {
  const at = (d, h) => "2026-03-" + String(d).padStart(2, "0") + "T" + String(h).padStart(2, "0") + ":00";
  const warm = [
    { at: at(2, 20), who: "her", kind: "message", text: "보고 싶다" },
    { at: at(2, 21), who: "me", kind: "message", text: "토요일 7시?" },
    { at: at(2, 21), who: "her", kind: "message", text: "좋아" },
    { at: at(7, 19), who: null, kind: "plan", text: "저녁" },
  ];
  const cold = [
    { at: at(1, 10), who: "me", kind: "message", text: "뭐해?" },
    { at: at(2, 22), who: "her", kind: "message", text: "ㅇㅇ" },
  ];
  const now = new Date(2026, 2, 4, 12, 0);
  const w = computeState(warm, now, { metOn: "2026-02-25" });
  const c = computeState(cold, now);
  assert.equal(w.stage, "약속 잡힘");
  assert.equal(w.daysToMeet, 4);
  assert.equal(w.day, 8);
  assert.ok(w.gauge.score > c.gauge.score);
  assert.equal(w.gauge.parts.reduce((s, p) => s + p.max, 0), 100);
  assert.ok(w.gauge.parts.every((p) => p.points >= 0 && p.points <= p.max && p.why.length > 0));
});

test("the studio answers reads without a token and refuses a write that does not carry it", async (t) => {
  const dir = root(t);
  process.env.OPENFLIRT_CRUSHES = dir;
  t.after(() => delete process.env.OPENFLIRT_CRUSHES);
  const { handler } = await import("../bin/studio.mjs");
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const page = await (await fetch(base + "/")).text();
  const token = /name="openflirt-token" content="([0-9a-f]{32})"/.exec(page)[1];
  const post = (headers) => fetch(base + "/api/inbox", { method: "POST", headers: { "x-filename": "chat.txt", ...headers }, body: EXPORT });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ "x-openflirt-token": "0".repeat(32) })).status, 403);
  assert.deepEqual(await (await fetch(base + "/api/crushes")).json(), []);
  assert.equal((await (await post({ "x-openflirt-token": token })).json()).created, true);
  const roster = await (await fetch(base + "/api/crushes")).json();
  assert.equal(roster[0].name, "지수");
  const one = await (await fetch(base + "/api/crushes/" + encodeURIComponent(roster[0].id))).json();
  assert.equal(one.timelineTotal, 3);
  assert.ok(Array.isArray(await (await fetch(base + "/api/models")).json()));
  assert.equal((await fetch(base + "/api/crushes/..%2F..%2Fx")).status, 400);
  assert.equal((await fetch(base + "/../package.json")).status, 404);
});

test("a file goes to the crush its names point to, and a new name makes a new crush", (t) => {
  const dir = root(t);
  addCrush({ name: "서빈", id: "seobin" }, dir);
  addCrush({ name: "지아", id: "jia" }, dir);
  assert.deepEqual(matchCrush("*01 박서빈", listCrushes(dir)).map((c) => c.id), ["seobin"]);
  assert.deepEqual(matchCrush("빈", listCrushes(dir)), []);
  const kakao = EXPORT.replace("지수 님과", "*01 박서빈 님과").replaceAll("[지수]", "[*01 박서빈]");
  assert.equal(routeFile({ name: "KakaoTalk_1_x.txt", bytes: bytes(kakao) }, dir).id, "seobin");
  assert.ok(readProfile("seobin", dir).aliases.includes("*01 박서빈"));
  const fresh = routeFile({ name: "chat.txt", bytes: bytes(EXPORT) }, dir);
  assert.equal(fresh.created, true);
  assert.equal(readProfile(fresh.id, dir).name, "지수");
  assert.equal(routeFile({ name: "notes.md", bytes: bytes("메모"), selected: "jia" }, dir).id, "jia");
  assert.equal(routeFile({ name: "IMG_1.png", bytes: Buffer.from([137, 80]) }, dir).needsRead, true);
  assert.deepEqual(routeFile({ name: "notes.md", bytes: bytes("메모") }, dir).ambiguous.sort(), ["jia", "seobin", fresh.id].sort());
});


test("the studio finds the three tones in an answer, whether each sits on its line or heads a block", async () => {
  const { choicesOf } = await import("../studio/choices.js");
  const block = { answer: "판정은 관심\n\n담백\nㅋㅋㅋ 넹\n화요일 7시예요\n\n장난\nAI한테 넣어둘게요\n\n티징\n강지보다 기억력 안좋다면서\n", message: "x" };
  assert.deepEqual(choicesOf(block), [{ tone: "담백", bubbles: ["ㅋㅋㅋ 넹", "화요일 7시예요"] }, { tone: "장난", bubbles: ["AI한테 넣어둘게요"] }, { tone: "티징", bubbles: ["강지보다 기억력 안좋다면서"] }]);
  const inline = { answer: "- 담백: \"ㅋㅋ 알려드릴게요\"\n- **장난**: 전화 오면 받으셔야 돼요", message: null };
  assert.deepEqual(choicesOf(inline).map((c) => c.bubbles), [["ㅋㅋ 알려드릴게요"], ["전화 오면 받으셔야 돼요"]]);
  const remark = { answer: "티징: \"ㅋㅋㅋ 강지보다 기억력 안좋다면서 / 제 AI 비서 쓰시려면 칼국수 한그릇이에요\" (지난번에 마음에 든다고 했던 그 줄이고, 이 자리에도 그대로 맞아)", message: null };
  assert.deepEqual(choicesOf(remark), [{ tone: "티징", bubbles: ["ㅋㅋㅋ 강지보다 기억력 안좋다면서", "제 AI 비서 쓰시려면 칼국수 한그릇이에요"] }]);
  assert.deepEqual(choicesOf({ answer: "보낼 말은 없다.", message: null }), []);
  assert.deepEqual(choicesOf({ answer: "그냥 답", message: "한 줄" }), [{ tone: "보낼 말", bubbles: ["한 줄"] }]);
});
