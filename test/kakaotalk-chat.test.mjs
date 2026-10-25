// Drives skills/kakaotalk-chat/scripts/lib/export.mjs and parse.mjs on small invented KakaoTalk exports.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseExport, renderTranscript, ExportError } from "../skills/kakaotalk-chat/scripts/lib/export.mjs";
import { validateThread } from "../skills/openflirt/scripts/behaviors.mjs";
import { REPO_ROOT } from "./fixture-repo.mjs";

const CLI = join(REPO_ROOT, "skills", "kakaotalk-chat", "scripts", "parse.mjs");

// Invented exports in the PC and mobile line formats.
const PC_EXPORT = [
  "지수 님과 카카오톡 대화",
  "저장한 날짜 : 2026-03-20 22:00:00",
  "",
  "--------------- 2026년 3월 2일 월요일 ---------------",
  "[도윤] [오후 8:00] 이번 주 토요일에 저녁 어때?",
  "[지수] [오후 11:30] 글쎄 봐서 나중에 알려줄게",
  "--------------- 2026년 3월 4일 수요일 ---------------",
  "[도윤] [오전 9:00] 좋은 아침",
  "[도윤] [오전 9:01] 오늘 춥대",
  "--------------- 2026년 3월 10일 화요일 ---------------",
  "[지수] [오후 1:00] 오빠 이거 하나만",
  "봐줄 수 있어?",
  "[도윤] [오후 1:05] 응 줘 봐",
  "",
].join("\n");

const MOBILE_EXPORT =
  "2026년 3월 2일 월요일\n2026년 3월 2일 오후 8:00, 도윤 : 이번 주 토요일에 저녁 어때?\n2026년 3월 2일 오후 11:30, 지수 : 글쎄 봐서 나중에 알려줄게\n";

// Invented: every app placeholder line the real exports showed, plus look-alikes that must stay text.
const PLACEHOLDERS = [
  "지수 님과 카카오톡 대화",
  "저장한 날짜 : 2026-03-20 22:00:00",
  "",
  "도윤님이 하나님을 초대했습니다.",
  "--------------- 2026년 3월 2일 월요일 ---------------",
  "[도윤] [오전 12:05] 사진",
  "[지수] [오후 12:30] 사진 3장",
  "[도윤] [오후 1:00] 동영상",
  "[지수] [오후 1:01] 이모티콘",
  "[도윤] [오후 1:02] 파일: 일정표.pdf",
  "[지수] [오후 1:03] 보이스톡 해요",
  "[지수] [오후 1:04] 보이스톡 부재중",
  "[도윤] [오후 1:05] 보이스톡 취소",
  "[지수] [오후 1:06] 보이스톡 응답없음",
  "[도윤] [오후 1:07] 보이스톡 0:31",
  "[지수] [오후 1:08] 사진 같아 보여",
  "[도윤] [오후 1:09] [네이버지도]",
  "[지수] [오후 1:10] 그냥 한마디",
  "메시지가 삭제되었습니다.",
  "[도윤] [오후 1:11] 사진",
  "이어서 쓴 줄",
  "",
].join("\n");

function cli(t, content, args, { fileName = "export.txt" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kakaotalk-chat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, fileName);
  writeFileSync(file, content);
  const out = join(dir, "out");
  const result = spawnSync(process.execPath, [CLI, file, "--out", out, ...args], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  return { ...result, out };
}

const triples = (thread) => thread.messages.filter((m) => m.who !== null).map((m) => [m.at, m.who, m.text]);

test("a PC export gives local minute times, joins continuation lines with a newline and takes me from the 1:1 header", () => {
  const thread = parseExport(PC_EXPORT, { fileName: "chat.txt" });
  assert.equal(thread.source, "kakaotalk");
  assert.equal(thread.title, "지수");
  assert.equal(thread.me, "도윤");
  assert.deepEqual(thread.participants, ["도윤", "지수"]);
  assert.equal(thread.timePrecision, "minute");
  assert.deepEqual(triples(thread), [
    ["2026-03-02T20:00", "도윤", "이번 주 토요일에 저녁 어때?"],
    ["2026-03-02T23:30", "지수", "글쎄 봐서 나중에 알려줄게"],
    ["2026-03-04T09:00", "도윤", "좋은 아침"],
    ["2026-03-04T09:01", "도윤", "오늘 춥대"],
    ["2026-03-10T13:00", "지수", "오빠 이거 하나만\n봐줄 수 있어?"],
    ["2026-03-10T13:05", "도윤", "응 줘 봐"],
  ]);
  assert.ok(thread.messages.every((m) => m.kind === "text"));
});

test("a mobile export parses the same way, and without a header the title is the file name and me is null", () => {
  const thread = parseExport(MOBILE_EXPORT, { fileName: "KakaoTalk_chat.txt" });
  assert.equal(thread.title, "KakaoTalk_chat");
  assert.equal(thread.me, null);
  assert.deepEqual(triples(thread), [
    ["2026-03-02T20:00", "도윤", "이번 주 토요일에 저녁 어때?"],
    ["2026-03-02T23:30", "지수", "글쎄 봐서 나중에 알려줄게"],
  ]);
});

test("--me overrides the header, and a header with three speakers leaves me null", () => {
  assert.equal(parseExport(PC_EXPORT, { fileName: "c.txt", me: "지수" }).me, "지수");
  const group = [
    "모임방 님과 카카오톡 대화",
    "",
    "--------------- 2026년 3월 2일 월요일 ---------------",
    "[가] [오후 8:00] 하나",
    "[나] [오후 8:01] 둘",
    "[다] [오후 8:02] 셋",
    "",
  ].join("\n");
  const thread = parseExport(group, { fileName: "g.txt" });
  assert.equal(thread.me, null);
  assert.equal(thread.title, "모임방");
  assert.deepEqual(thread.participants, ["가", "나", "다"]);
});

test("app placeholder lines become media, call and system kinds and look-alikes stay text", () => {
  const thread = parseExport(PLACEHOLDERS, { fileName: "p.txt" });
  const m = thread.messages;
  const brief = m.map((x) => [x.at, x.who, x.kind]);
  assert.deepEqual(m[0], { at: "2026-03-02T00:05", who: null, kind: "system", text: "도윤님이 하나님을 초대했습니다." });
  assert.deepEqual(m[1], { at: "2026-03-02T00:05", who: "도윤", kind: "media", text: "", media: { photos: 1 } });
  assert.deepEqual(m[2], { at: "2026-03-02T12:30", who: "지수", kind: "media", text: "", media: { photos: 3 } });
  assert.deepEqual(m[3], { at: "2026-03-02T13:00", who: "도윤", kind: "media", text: "", media: { videos: 1 } });
  assert.deepEqual(m[4], { at: "2026-03-02T13:01", who: "지수", kind: "media", text: "이모티콘" });
  assert.deepEqual(m[5], { at: "2026-03-02T13:02", who: "도윤", kind: "media", text: "파일: 일정표.pdf" });
  assert.deepEqual(m[6], { at: "2026-03-02T13:03", who: "지수", kind: "call", text: "음성 통화 시작", call: { type: "voice", event: "start" } });
  assert.deepEqual(m[7], { at: "2026-03-02T13:04", who: "지수", kind: "call", text: "음성 통화 못 받음", call: { type: "voice", event: "missed" } });
  assert.deepEqual(m[8], { at: "2026-03-02T13:05", who: "도윤", kind: "call", text: "음성 통화 못 받음", call: { type: "voice", event: "missed" } });
  assert.deepEqual(m[9], { at: "2026-03-02T13:06", who: "지수", kind: "call", text: "음성 통화 못 받음", call: { type: "voice", event: "missed" } });
  assert.deepEqual(m[10], { at: "2026-03-02T13:07", who: "도윤", kind: "call", text: "음성 통화 종료", call: { type: "voice", event: "end" } });
  assert.deepEqual(m[11], { at: "2026-03-02T13:08", who: "지수", kind: "text", text: "사진 같아 보여" });
  assert.deepEqual(m[12], { at: "2026-03-02T13:09", who: "도윤", kind: "text", text: "[네이버지도]" });
  assert.deepEqual(m[13], { at: "2026-03-02T13:10", who: "지수", kind: "text", text: "그냥 한마디" });
  assert.deepEqual(m[14], { at: "2026-03-02T13:10", who: null, kind: "system", text: "메시지가 삭제되었습니다." });
  assert.equal(m[15].kind, "text", "a placeholder followed by a continuation line is a text message: " + JSON.stringify(brief));
  assert.equal(m[15].text, "사진\n이어서 쓴 줄");
  assert.equal(m.length, 16);
  assert.deepEqual(thread.participants, ["도윤", "지수"]);
});

test("a system line never takes a person's continuation line", () => {
  const thread = parseExport("--------------- 2026년 3월 2일 월요일 ---------------\n[도윤] [오후 1:00] 첫 줄\n메시지가 삭제되었습니다.\n둘째 줄\n", { fileName: "s.txt" });
  assert.deepEqual(thread.messages.map((m) => [m.who, m.text]), [["도윤", "첫 줄\n둘째 줄"], [null, "메시지가 삭제되었습니다."]]);
});

test("transcript.md follows the contract rendering", () => {
  const thread = parseExport(PLACEHOLDERS, { fileName: "p.txt" });
  const md = renderTranscript(thread);
  const expected = [
    "# 지수",
    "",
    "kakaotalk 대화 2026-03-02 ~ 2026-03-02, 메시지 16개 (도윤 7, 지수 7, 시스템 2).",
    "시각은 메시지마다 분 단위다.",
    "",
    "## 2026-03-02 (월)",
    "",
    "- 00:05 (시스템) 도윤님이 하나님을 초대했습니다.",
    "- 00:05 도윤: [사진 1장]",
    "- 12:30 지수: [사진 3장]",
    "- 13:00 도윤: [동영상 1개]",
    "- 13:01 지수: 이모티콘",
    "- 13:02 도윤: 파일: 일정표.pdf",
    "- 13:03 지수: 음성 통화 시작",
    "- 13:04 지수: 음성 통화 못 받음",
    "- 13:05 도윤: 음성 통화 못 받음",
    "- 13:06 지수: 음성 통화 못 받음",
    "- 13:07 도윤: 음성 통화 종료",
    "- 13:08 지수: 사진 같아 보여",
    "- 13:09 도윤: [네이버지도]",
    "- 13:10 지수: 그냥 한마디",
    "- 13:10 (시스템) 메시지가 삭제되었습니다.",
    "- 13:11 도윤: 사진",
    "  이어서 쓴 줄",
    "",
  ].join("\n");
  assert.equal(md, expected);
});

test("a day heading opens each new day and later lines of a message are indented", () => {
  const md = renderTranscript(parseExport(PC_EXPORT, { fileName: "c.txt" }));
  assert.ok(md.includes("## 2026-03-04 (수)\n\n- 09:00 도윤: 좋은 아침\n- 09:01 도윤: 오늘 춥대\n"), md);
  assert.ok(md.includes("- 13:00 지수: 오빠 이거 하나만\n  봐줄 수 있어?\n"), md);
  assert.ok(md.includes("2026-03-02 ~ 2026-03-10, 메시지 6개 (도윤 4, 지수 2, 시스템 0)."), md);
});

test("the CLI writes thread.json and transcript.md and prints a summary without names", (t) => {
  const r = cli(t, PC_EXPORT, []);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(readFileSync(join(r.out, "thread.json"), "utf8"));
  assert.equal(json.source, "kakaotalk");
  assert.equal(json.me, "도윤");
  assert.equal(json.messages.length, 6);
  assert.ok(readFileSync(join(r.out, "thread.json"), "utf8").includes('\n  "source"'), "2-space indent");
  assert.ok(readFileSync(join(r.out, "transcript.md"), "utf8").startsWith("# 지수\n"));
  assert.equal(r.stdout.trim().split("\n").length, 1);
  assert.ok(!/지수|도윤/.test(r.stdout), "names never reach the summary: " + r.stdout);
});

test("the CLI honours --me", (t) => {
  const r = cli(t, PC_EXPORT, ["--me", "지수"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(join(r.out, "thread.json"), "utf8")).me, "지수");
});

test("--out - prints thread.json on stdout and the summary on stderr, and writes no file", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kakaotalk-chat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "export.txt"), PC_EXPORT);
  const r = spawnSync(process.execPath, [CLI, "export.txt", "--out", "-"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).messages.length, 6);
  assert.ok(r.stderr.startsWith("kakaotalk-chat: 메시지 6개"), r.stderr);
  assert.deepEqual(readdirSync(dir), ["export.txt"]);
});

test("every thread it writes is one openflirt's behaviors.mjs accepts", () => {
  for (const [text, fileName] of [[PC_EXPORT, "c.txt"], [MOBILE_EXPORT, "m.txt"], [PLACEHOLDERS, "p.txt"]]) {
    assert.doesNotThrow(() => validateThread(parseExport(text, { fileName })), fileName);
  }
});

test("the CLI runs when called through a linked skill folder, the way an agent calls an installed skill", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kakaotalk-chat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(join(REPO_ROOT, "skills", "kakaotalk-chat"), join(dir, "linked"), "junction");
  writeFileSync(join(dir, "export.txt"), PC_EXPORT);
  const r = spawnSync(process.execPath, [join(dir, "linked", "scripts", "parse.mjs"), "export.txt", "--out", "-"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).messages.length, 6, "a linked path must not turn the CLI into a silent no-op");
});

test("text that is not an export and an unknown --me exit 2 and write nothing", (t) => {
  const notExport = cli(t, "그냥 붙여 넣은 글\n", []);
  assert.equal(notExport.status, 2);
  assert.equal(existsSync(notExport.out), false);
  const wrong = cli(t, PC_EXPORT, ["--me", "민호"]);
  assert.equal(wrong.status, 2);
  assert.equal(existsSync(wrong.out), false);
  assert.ok(wrong.stderr.includes("도윤"), wrong.stderr);
  assert.throws(() => parseExport("그냥 글", { fileName: "x.txt" }), ExportError);
  assert.throws(() => parseExport(PC_EXPORT, { fileName: "x.txt", me: "민호" }), ExportError);
});

test("bad arguments exit 2", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kakaotalk-chat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "e.txt");
  writeFileSync(file, PC_EXPORT);
  assert.equal(spawnSync(process.execPath, [CLI, file], { encoding: "utf8" }).status, 2, "--out missing");
  assert.equal(spawnSync(process.execPath, [CLI, "--out", join(dir, "o")], { encoding: "utf8" }).status, 2, "file missing");
  assert.equal(spawnSync(process.execPath, [CLI, join(dir, "nope.txt"), "--out", join(dir, "o")], { encoding: "utf8" }).status, 2, "unreadable");
  assert.equal(existsSync(join(dir, "o")), false);
});

