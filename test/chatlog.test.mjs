// Drives skills/openflirt/scripts/chatlog.mjs as a process on small invented KakaoTalk exports.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./fixture-repo.mjs";

const SCRIPT = join(REPO_ROOT, "skills", "openflirt", "scripts", "chatlog.mjs");

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

function run(t, content, args) {
  const dir = mkdtempSync(join(tmpdir(), "openflirt-chatlog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "export.txt");
  writeFileSync(file, content);
  const result = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}

test("a PC export becomes weekly counts, unanswered runs and meeting lines with their answers, with no names", (t) => {
  const { status, stdout } = run(t, PC_EXPORT, ["--me", "도윤"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 6개. 나 4개, 상대 2개."), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 나 | 3 | 2 | 2 | 1 | 1일 9시간 | 1일 9시간 | 1 |"), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 상대 | 1 | 0 | 0 | 1 | 3시간 30분 | 3시간 30분 | 0 |"), stdout);
  assert.ok(stdout.includes("| 2주차 03-09~03-15 | 상대 | 1 | 1 | 1 | 1 | 6일 3시간 | 6일 3시간 | 0 |"), stdout);
  assert.ok(stdout.includes("한쪽만 쓴 날: 03-04 나"), stdout);
  assert.ok(stdout.includes("- 03-02 20:00 나: 이번 주 토요일에 저녁 어때?\n  - 03-02 23:30 상대(3시간 30분 뒤): 글쎄 봐서 나중에 알려줄게"), stdout);
  assert.ok(!stdout.includes("하나만 봐줄 수 있어?\n  -"), "a favor request is not a meeting line");
  assert.ok(!/지수|도윤/.test(stdout), "names never reach the output");
});

test("without --me a PC export takes the asker from its header", (t) => {
  const { status, stdout } = run(t, PC_EXPORT, []);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 6개. 나 4개, 상대 2개."), stdout);
  assert.ok(!/지수|도윤/.test(stdout), "names never reach the output");
});

test("mobile export lines parse the same way", (t) => {
  const mobile = "2026년 3월 2일 월요일\n2026년 3월 2일 오후 8:00, 도윤 : 이번 주 토요일에 저녁 어때?\n2026년 3월 2일 오후 11:30, 지수 : 글쎄 봐서 나중에 알려줄게\n";
  const { status, stdout } = run(t, mobile, ["--me", "도윤"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 2개. 나 1개, 상대 1개."), stdout);
});

test("text that is not a KakaoTalk export and an unknown --me name exit 2", (t) => {
  assert.equal(run(t, "그냥 붙여 넣은 글\n", []).status, 2);
  const wrong = run(t, PC_EXPORT, ["--me", "민호"]);
  assert.equal(wrong.status, 2);
  assert.ok(wrong.stderr.includes("도윤"), wrong.stderr);
});

