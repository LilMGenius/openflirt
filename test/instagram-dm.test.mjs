// Pins how rows read from an Instagram DM thread (Korean UI) become the shared thread format, and drives
// skills/instagram-dm/scripts/read.mjs --raw as a process. Every row here is invented.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeRows, renderTranscript } from "../skills/instagram-dm/scripts/lib/rows.mjs";
import { validateThread } from "../skills/openflirt/scripts/behaviors.mjs";
import { REPO_ROOT } from "./fixture-repo.mjs";

const SCRIPT = join(REPO_ROOT, "skills", "instagram-dm", "scripts", "read.mjs");
const actions = (who) => [who + "님의 메시지에 공감하기", who + "님의 메시지에 답장하기", who + "님의 메시지에 대한 옵션 더 보기"];
const row = (rev, who, texts, extra = {}) => ({
  rev,
  head: extra.head ? [extra.head] : [],
  quote: extra.quote ?? [],
  texts,
  after: extra.after ?? [],
  labels: who === "minho" ? ["Message actions", ...actions(who)] : who === "sua.k" ? ["Open the profile page of sua.k", "Message actions", ...actions(who)] : [],
  imgs: extra.imgs ?? [],
  hrefs: extra.hrefs ?? [],
  video: extra.video ?? 0,
  audio: 0,
});
const mine = (rev, texts, extra) => row(rev, "minho", texts, extra);
const theirs = (rev, texts, extra) => row(rev, "sua.k", texts, extra);
const sys = (rev, texts, extra) => row(rev, null, texts, extra);
const raw = (rows, extra = {}) => ({ url: "https://www.instagram.com/direct/t/1/", capturedAt: "2026-10-26T03:00", top: { reached: true, loadSteps: 3, above: ["수아님", "sua.k · Instagram", "프로필 보기"] }, total: rows.length + 1, missing: [], rows, ...extra });

test("a timestamp header dates its row and every row below it, and the sender comes from the like label", () => {
  const t = normalizeRows(raw([
    mine(5, ["안녕하세요"], { head: "2026. 9. 29. 오후 10:56" }),
    theirs(4, ["안녕하세용"], { head: "2026. 9. 29. 오후 11:13" }),
    mine(3, ["오후 3:00"]),
    theirs(2, ["주말엔 일해서\n안돼요"], { head: "2026. 10. 1. 오전 12:05" }),
  ]));
  assert.equal(t.source, "instagram");
  assert.equal(t.title, "sua.k");
  assert.equal(t.me, "minho");
  assert.deepEqual(t.participants, ["minho", "sua.k"]);
  assert.equal(t.timePrecision, "block");
  assert.deepEqual(t.messages.map((m) => [m.at, m.who, m.kind, m.text]), [
    ["2026-09-29T22:56", "minho", "text", "안녕하세요"],
    ["2026-09-29T23:13", "sua.k", "text", "안녕하세용"],
    ["2026-09-29T23:13", "minho", "text", "오후 3:00"],
    ["2026-10-01T00:05", "sua.k", "text", "주말엔 일해서\n안돼요"],
  ]);
});

test("a weekday header is the latest such day before the capture day, and an unknown header stops the run", () => {
  const t = normalizeRows(raw([
    mine(5, ["a"], { head: "2026. 10. 12. 오후 7:37" }),
    theirs(4, ["b"], { head: "(화) 오전 2:27" }),
    mine(3, ["c"], { head: "(월) 오후 12:25" }),
    theirs(2, ["d"], { head: "어제 오후 11:59" }),
    mine(1, ["e"], { head: "오전 1:07" }),
  ]));
  assert.deepEqual(t.messages.map((m) => m.at), ["2026-10-12T19:37", "2026-10-20T02:27", "2026-10-19T12:25", "2026-10-25T23:59", "2026-10-26T01:07"]);
  assert.throws(() => normalizeRows(raw([mine(1, ["a"], { head: "10월 12일" })])), (e) => e.code === "UNKNOWN_HEADER");
});

test("call rows are calls: a named start is theirs, an unnamed start is the reader's, an end or a miss names nobody", () => {
  const t = normalizeRows(raw([
    mine(6, ["걸어볼게요"], { head: "2026. 10. 10. 오후 11:10" }),
    sys(5, ["sua.k", "님이 음성 통화를 시작했습니다"]),
    sys(4, ["음성 통화가 종료되었습니다"]),
    sys(3, ["음성 통화를 시작했습니다"]),
    sys(2, ["음성 통화를 받지 못했습니다"]),
    sys(1, ["sua.k", "님이 영상 통화를 시작했습니다"]),
  ]));
  assert.deepEqual(t.messages.slice(1).map((m) => [m.who, m.kind, m.call, m.text]), [
    ["sua.k", "call", { type: "voice", event: "start" }, "음성 통화 시작"],
    [null, "call", { type: "voice", event: "end" }, "음성 통화 종료"],
    ["minho", "call", { type: "voice", event: "start" }, "음성 통화 시작"],
    [null, "call", { type: "voice", event: "missed" }, "음성 통화 못 받음"],
    ["sua.k", "call", { type: "video", event: "start" }, "영상 통화 시작"],
  ]);
});

test("story, reply, edit, reaction and media markers become fields and leave the text clean", () => {
  const t = normalizeRows(raw([
    mine(9, ["생일이에요?"], { head: "2026. 10. 3. 오전 11:41", quote: ["@수아님의 스토리에 답장을 보냈습니다"], imgs: [[95, 169, true, ""]], hrefs: ["/stories/sua.k/1?reel_id=2"] }),
    mine(8, [], { quote: ["@수아님의 스토리에 공감했습니다", "스토리를 볼 수 없습니다"] }),
    mine(7, ["뵙고 이야기 하고 싶어요"], { quote: ["회원님이 수아님에게 보낸 답장", "전화로는 안되나요?"] }),
    mine(6, ["2터미널로 가야 돼요!"], { quote: ["수정됨"], after: ["❤️", "읽음"] }),
    theirs(5, ["이 사진은 한 번만 다시 볼 수 있습니다. 사진을 보려면 모바일 앱을 사용하세요.", "이 사진은 한 번만 다시 볼 수 있습니다. 사진을 보려면 모바일 앱을 사용하세요."]),
    mine(4, [], { quote: ["사진 3장을 보냈습니다"], imgs: [[125, 125, false, ""], [125, 125, false, ""], [125, 125, false, ""]] }),
    theirs(3, [], { imgs: [[157, 280, false, ""], [28, 28, false, "user-profile-picture"]] }),
    mine(2, ["https://example.com/a", "예시 글 제목"], { imgs: [[300, 157, true, ""]], hrefs: ["https://example.com/a", "https://example.com/a", "/explore/tags/x/"] }),
    theirs(1, ["좋아요"], { quote: ["수아님이 회원님에게 보낸 답장"] }),
  ]));
  const [story, like, reply, edited, once, photos, photo, link, photoReply] = t.messages;
  assert.deepEqual([story.kind, story.story, story.text, story.links, story.media], ["story", "reply", "생일이에요?", undefined, undefined]);
  assert.deepEqual([like.kind, like.story, like.text], ["story", "like", ""]);
  assert.deepEqual([reply.kind, reply.replyTo, reply.text], ["text", "전화로는 안되나요?", "뵙고 이야기 하고 싶어요"]);
  assert.deepEqual([edited.edited, edited.reactions, edited.notes, edited.text], [true, ["❤️"], ["읽음"], "2터미널로 가야 돼요!"]);
  assert.deepEqual([once.kind, once.media, once.text], ["media", { photos: 1, once: true }, ""]);
  assert.deepEqual([photos.kind, photos.media, photos.text], ["media", { photos: 3 }, ""]);
  assert.deepEqual([photo.kind, photo.media], ["media", { photos: 1 }]);
  assert.deepEqual([link.kind, link.text, link.links, link.media], ["text", "예시 글 제목", ["https://example.com/a"], undefined]);
  assert.deepEqual([photoReply.replyTo, photoReply.text], [undefined, "좋아요"], "a reply to a photo quotes no text");
});

test("rows that hold nothing are dropped, and the reader can be named or is refused when unknown", () => {
  const rows = [mine(3, ["a"], { head: "2026. 9. 29. 오후 10:56" }), sys(2, []), theirs(1, ["b"])];
  assert.equal(normalizeRows(raw(rows)).messages.length, 2);
  assert.equal(normalizeRows(raw(rows), { me: "sua.k" }).me, "sua.k");
  assert.throws(() => normalizeRows(raw(rows), { me: "nobody" }), (e) => e.code === "BAD_ME" && e.message.includes("sua.k"));
});

test("a thread read in another UI language stops instead of turning every message into a system line", () => {
  const english = { ...mine(1, ["hi"], { head: "2026. 9. 29. 오후 10:56" }), labels: ["Message actions", "Like message from minho"] };
  assert.throws(() => normalizeRows(raw([english])), (e) => e.code === "UI_LANGUAGE");
});

test("a first message without a timestamp header means the top of the thread was never reached", () => {
  assert.throws(() => normalizeRows(raw([mine(2, ["a"]), theirs(1, ["b"])])), (e) => e.code === "NO_TOP");
});

test("the transcript dates each day, labels the sides and puts markers where the contract says", () => {
  const t = normalizeRows(raw([
    mine(5, ["첫 줄\n\n둘째 줄"], { head: "2026. 9. 29. 오후 10:56" }),
    theirs(4, ["네"], { head: "2026. 9. 30. 오전 9:11", quote: ["수아님이 민호님에게 보낸 답장", "첫 줄 둘째 줄이 아주 길어서 사십 글자를 넘기는 인용이라고 칩시다 정말로"], after: ["❤️"] }),
    sys(3, ["sua.k", "님이 음성 통화를 시작했습니다"]),
    mine(2, ["https://example.com/a", "제목"], { imgs: [[300, 157, true, ""]], hrefs: ["https://example.com/a"] }),
    theirs(1, ["사진 2장을 보냈습니다"]),
  ]));
  assert.equal(renderTranscript(t), [
    "# sua.k",
    "",
    "instagram 대화 2026-09-29 ~ 2026-09-30, 메시지 5개 (minho 2, sua.k 3, 시스템 0).",
    "시각은 앱이 묶음 위에 보여 준 시각이고, 같은 묶음 안의 간격은 알 수 없다.",
    "",
    "## 2026-09-29 (화)",
    "",
    "- 22:56 minho: 첫 줄",
    "  둘째 줄",
    "",
    "## 2026-09-30 (수)",
    "",
    "- 09:11 sua.k: [답장: 첫 줄 둘째 줄이 아주 길어서 사십 글자를 넘기는 인용이라고 칩시다 정말] 네 [공감 ❤️]",
    "- 09:11 sua.k: 음성 통화 시작",
    "- 09:11 minho: 제목",
    "  https://example.com/a",
    "- 09:11 sua.k: [사진 2장]",
    "",
  ].join("\n"));
});

function run(t, rawObject, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "instagram-dm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rawFile = join(dir, "raw.json");
  writeFileSync(rawFile, JSON.stringify(rawObject));
  const out = join(dir, "out");
  const result = spawnSync(process.execPath, [SCRIPT, "--raw", rawFile, "--out", out, ...args], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  return { ...result, out };
}

test("read.mjs --raw writes thread.json and transcript.md and exits 0 for a complete capture", (t) => {
  const { status, stdout, stderr, out } = run(t, raw([mine(2, ["a"], { head: "2026. 9. 29. 오후 10:56" }), theirs(1, ["b"])]));
  assert.equal(status, 0, stdout + stderr);
  const thread = JSON.parse(readFileSync(join(out, "thread.json"), "utf8"));
  assert.equal(thread.messages.length, 2);
  assert.ok(readFileSync(join(out, "transcript.md"), "utf8").startsWith("# sua.k\n"));
});

test("read.mjs --raw --out - prints thread.json on stdout, the summary on stderr, and writes no file", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "instagram-dm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "raw.json"), JSON.stringify(raw([mine(2, ["a"], { head: "2026. 9. 29. 오후 10:56" }), theirs(1, ["b"])])));
  const r = spawnSync(process.execPath, [SCRIPT, "--raw", "raw.json", "--out", "-"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).messages.length, 2);
  assert.ok(r.stderr.includes("messages 2: minho 1, sua.k 1"), r.stderr);
  assert.deepEqual(readdirSync(dir), ["raw.json"]);
});

test("the thread it writes is one openflirt's behaviors.mjs accepts", () => {
  const t = normalizeRows(raw([
    mine(6, ["걸어볼게요"], { head: "2026. 10. 10. 오후 11:10" }),
    sys(5, ["sua.k", "님이 음성 통화를 시작했습니다"]),
    sys(4, ["음성 통화가 종료되었습니다"]),
    mine(3, ["생일이에요?"], { quote: ["@수아님의 스토리에 답장을 보냈습니다"] }),
    theirs(2, [], { quote: ["사진 3장을 보냈습니다"] }),
    sys(1, ["sua.k님이 대화를 수락했습니다"], { head: "(화) 오전 2:27" }),
  ]));
  assert.deepEqual(t.messages.map((m) => m.kind), ["text", "call", "call", "story", "media", "system"]);
  assert.doesNotThrow(() => validateThread(t));
});

test("read.mjs runs when called through a linked skill folder, the way an agent calls an installed skill", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "instagram-dm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(join(REPO_ROOT, "skills", "instagram-dm"), join(dir, "linked"), "junction");
  writeFileSync(join(dir, "raw.json"), JSON.stringify(raw([mine(2, ["a"], { head: "2026. 9. 29. 오후 10:56" }), theirs(1, ["b"])])));
  const r = spawnSync(process.execPath, [join(dir, "linked", "scripts", "read.mjs"), "--raw", "raw.json", "--out", "-"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).messages.length, 2, "a linked path must not turn the CLI into a silent no-op");
});

test("read.mjs --raw exits 1 when rows stayed unread, and 2 with nothing written on bad input", (t) => {
  const partial = run(t, raw([mine(3, ["a"], { head: "2026. 9. 29. 오후 10:56" }), theirs(1, ["b"])], { missing: [2] }));
  assert.equal(partial.status, 1, partial.stdout + partial.stderr);
  assert.ok(existsSync(join(partial.out, "thread.json")));
  const short = run(t, raw([mine(2, ["a"], { head: "2026. 9. 29. 오후 10:56" }), theirs(1, ["b"])], { top: { reached: false, loadSteps: 3000, above: [] } }));
  assert.equal(short.status, 1, "a list that never stopped loading did not reach the top");
  assert.ok(short.stdout.includes("NOT REACHED"), short.stdout);
  const noTop = run(t, raw([mine(2, ["a"]), theirs(1, ["b"])]));
  assert.equal(noTop.status, 2);
  assert.equal(existsSync(join(noTop.out, "thread.json")), false);
  const bad = run(t, raw([]), ["--bogus"]);
  assert.equal(bad.status, 2);
});
