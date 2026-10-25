// Drives skills/openflirt/scripts/behaviors.mjs as a process on small invented thread.json files in the
// format $kakaotalk-chat and $instagram-dm write.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./fixture-repo.mjs";

const SCRIPT = join(REPO_ROOT, "skills", "openflirt", "scripts", "behaviors.mjs");

const text = (at, who, body) => ({ at, who, kind: "text", text: body });

// A KakaoTalk-like thread: every message carries its own minute.
const MINUTE_THREAD = {
  source: "kakaotalk",
  title: "지수",
  me: "도윤",
  participants: ["도윤", "지수"],
  timePrecision: "minute",
  messages: [
    text("2026-03-02T20:00", "도윤", "이번 주 토요일에 저녁 어때?"),
    text("2026-03-02T23:30", "지수", "글쎄 봐서 나중에 알려줄게"),
    text("2026-03-04T09:00", "도윤", "좋은 아침"),
    text("2026-03-04T09:01", "도윤", "오늘 춥대"),
    text("2026-03-10T13:00", "지수", "오빠 이거 하나만\n봐줄 수 있어?"),
    text("2026-03-10T13:05", "도윤", "응 줘 봐"),
  ],
};

// An Instagram-like thread: each message carries its block's time, with calls, stories, reactions and a system line.
const BLOCK_THREAD = {
  source: "instagram",
  title: "jisu",
  me: "doyun",
  participants: ["doyun", "jisu"],
  timePrecision: "block",
  messages: [
    text("2026-03-02T20:00", "doyun", "이번 주 토요일에 저녁 어때?"),
    { ...text("2026-03-02T20:00", "jisu", "좋아"), reactions: ["❤"] },
    { at: "2026-03-02T20:00", who: "jisu", kind: "story", text: "내일 보자?", story: "like" },
    { at: "2026-03-03T21:00", who: "doyun", kind: "call", text: "음성 통화 시작", call: { type: "voice", event: "start" } },
    { at: "2026-03-03T21:00", who: "jisu", kind: "call", text: "음성 통화 종료", call: { type: "voice", event: "end" } },
    { at: "2026-03-04T10:00", who: "jisu", kind: "call", text: "영상 통화 시작", call: { type: "video", event: "start" } },
    { at: "2026-03-04T10:00", who: null, kind: "system", text: "상대가 대화를 시작했습니다" },
    { at: "2026-03-04T12:00", who: "doyun", kind: "media", text: "저녁 어때?", media: { photos: 1 } },
  ],
};

function run(t, thread, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "openflirt-behaviors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "thread.json");
  writeFileSync(file, typeof thread === "string" ? thread : JSON.stringify(thread, null, 2));
  const result = spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}

test("- reads the thread from standard input, so a reader's --out - output can be piped in", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "-"], { input: JSON.stringify(MINUTE_THREAD), encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("메시지 6개. 나 4개, 상대 2개."), result.stdout);
});

test("a minute thread becomes weekly counts, unanswered runs and meeting lines with their answers, with no names", (t) => {
  const { status, stdout } = run(t, MINUTE_THREAD, ["--me", "도윤"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 6개. 나 4개, 상대 2개."), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 나 | 3 | 0 | 2 | 2 | 1 | 1일 9시간 | 1일 9시간 | 1 |"), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 상대 | 1 | 0 | 0 | 0 | 1 | 3시간 30분 | 3시간 30분 | 0 |"), stdout);
  assert.ok(stdout.includes("| 2주차 03-09~03-15 | 상대 | 1 | 0 | 1 | 1 | 1 | 6일 3시간 | 6일 3시간 | 0 |"), stdout);
  assert.ok(stdout.includes("한쪽만 쓴 날: 03-04 나"), stdout);
  assert.ok(stdout.includes("마지막 메시지: 2026-03-10 13:05 나"), stdout);
  assert.ok(stdout.includes("- 03-02 20:00 나: 이번 주 토요일에 저녁 어때?\n  - 03-02 23:30 상대(3시간 30분 뒤): 글쎄 봐서 나중에 알려줄게"), stdout);
  assert.ok(!stdout.includes("하나만 봐줄 수 있어?\n  -"), "a favor request is not a meeting line");
  assert.ok(!stdout.includes("묶음 단위"), "a minute thread prints no block-time line");
  assert.ok(!stdout.includes("통화 시작은"), "a thread without calls prints no call line");
  assert.ok(!/지수|도윤/.test(stdout), "names never reach the output");
});

test("without --me the asker is thread.me", (t) => {
  const { status, stdout } = run(t, MINUTE_THREAD);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 6개. 나 4개, 상대 2개."), stdout);
  assert.ok(!/지수|도윤/.test(stdout), "names never reach the output");
});

test("a polite proposal in the middle of a message is a meeting line, and a promise to look at something is not", (t) => {
  const polite = {
    ...MINUTE_THREAD,
    me: null,
    participants: ["민준", "서연"],
    messages: [
      text("2026-03-02T20:57", "민준", "다음에 서울 오실 일 있으면 식사 한 번 하시지요 오늘 얘기 즐거웠어요"),
      text("2026-03-02T22:40", "서연", "그러니까요 올해 안에 또 올라갈 것 같아요!"),
      text("2026-03-02T23:00", "민준", "주말에 좀 봐 드릴게요"),
      text("2026-03-02T23:05", "서연", "고마워요"),
    ],
  };
  const { status, stdout } = run(t, polite, ["--me", "민준"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("- 03-02 20:57 나: 다음에 서울 오실 일 있으면 식사 한 번 하시지요 오늘 얘기 즐거웠어요\n  - 03-02 22:40 상대(1시간 43분 뒤): 그러니까요 올해 안에 또 올라갈 것 같아요!"), stdout);
  assert.ok(!stdout.includes("나: 주말에 좀 봐 드릴게요"), "a promise to do a favor is not a meeting line");
});

test("a block thread counts call starts in their own column, skips system lines and only reads text for meeting lines", (t) => {
  const { status, stdout } = run(t, BLOCK_THREAD);
  assert.equal(status, 0);
  assert.ok(stdout.includes("메시지 4개. 나 2개, 상대 2개."), "calls and the system line are not messages\n" + stdout);
  assert.ok(stdout.includes("통화 시작은 메시지에 넣지 않고 따로 센다: 나 1번, 상대 1번."), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 나 | 2 | 1 | "), stdout);
  assert.ok(stdout.includes("| 1주차 03-02~03-08 | 상대 | 2 | 1 | "), stdout);
  assert.ok(stdout.includes("시각이 묶음 단위라 같은 묶음 안의 답장은 0분으로 세고 실제 간격은 알 수 없다."), stdout);
  assert.ok(stdout.includes("- 03-02 20:00 나: 이번 주 토요일에 저녁 어때?\n  - 03-02 20:00 상대(0분 뒤): 좋아"), stdout);
  assert.ok(!stdout.includes("내일 보자?"), "a story line is not a meeting line");
  assert.ok(!stdout.includes("나: 저녁 어때?"), "a media line is not a meeting line");
  assert.ok(!/doyun|jisu/.test(stdout), "names never reach the output");
});

test("a thread that is not a thread.json exits 2 with a Korean message", (t) => {
  for (const bad of ["그냥 붙여 넣은 글\n", "{}", JSON.stringify({ ...MINUTE_THREAD, timePrecision: "second" }), JSON.stringify({ ...MINUTE_THREAD, messages: [{ at: "어제", who: "a", kind: "text", text: "x" }] }), JSON.stringify({ ...MINUTE_THREAD, messages: [{ at: "2026-03-02T20:00", who: "a", kind: "call", text: "x" }] })]) {
    const r = run(t, bad);
    assert.equal(r.status, 2, bad);
    assert.equal(r.stdout, "");
    assert.ok(/[가-힣]/.test(r.stderr), r.stderr);
  }
});

test("an asker nobody named exits 2 and lists the participants, and an unknown --me does too", (t) => {
  const unknown = run(t, { ...MINUTE_THREAD, me: null });
  assert.equal(unknown.status, 2);
  assert.ok(unknown.stderr.includes("도윤") && unknown.stderr.includes("지수"), unknown.stderr);
  const wrong = run(t, MINUTE_THREAD, ["--me", "민호"]);
  assert.equal(wrong.status, 2);
  assert.ok(wrong.stderr.includes("도윤"), wrong.stderr);
});
