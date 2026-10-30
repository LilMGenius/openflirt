// Drives the lecture-corpus scripts as processes on tiny inline fixtures; no test reaches the network, uv, yt-dlp or Whisper.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./fixture-repo.mjs";

const SCRIPTS = join(REPO_ROOT, "skills", "lecture-corpus", "scripts");
const VIDEO = "abc12345678";
const link = (sec) => "[" + String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0") + "](https://youtu.be/" + VIDEO + "?t=" + sec + ")";

function workdir(t) {
  const dir = mkdtempSync(join(tmpdir(), "openflirt-lecture-corpus-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}

function write(dir, name, content) {
  const file = join(dir, name);
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const TRANSCRIPT = [
  "# 테스트 강의 전문",
  "",
  "- 영상: https://youtu.be/" + VIDEO,
  "",
  "## 전문",
  "",
  link(0) + " 안녕하세요.",
  "",
  link(26) + " 반갑습니다.",
  "",
  "### 둘째",
  "",
  link(60) + " 두 번째 이야기입니다.",
  "",
].join("\n");

test("draft.mjs turns captions, metadata and sections into the exact draft transcript", (t) => {
  const dir = workdir(t);
  const captions = write(dir, "captions.json3", {
    events: [
      { tStartMs: 0, segs: [{ utf8: "안녕하세요. " }] },
      { tStartMs: 26000, segs: [{ utf8: "반갑" }, { utf8: "습니다.\n", tOffsetMs: 500 }] },
      { tStartMs: 60000, segs: [{ utf8: "두 번째 " }, { utf8: "이야기입니다." }] },
      { tStartMs: 70000 },
    ],
  });
  const meta = write(dir, "info.json", { id: VIDEO, title: "테스트 강의", channel: "채널", uploader_id: "@ch", upload_date: "20260102", duration_string: "1:10" });
  const sections = write(dir, "sections.json", [["H2", "전문", "__START__"], ["H3", "둘째", "두번째"]]);
  const out = join(dir, "transcript.md");
  const result = run("draft.mjs", ["--captions", captions, "--meta", meta, "--sections", sections, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const expected = [
    "# 테스트 강의 전문",
    "",
    "- 영상: https://youtu.be/" + VIDEO,
    "- 채널: 채널 (@ch)",
    "- 올린 날: 2026-01-02",
    "- 길이: 1:10",
    "- 이 판의 본문: YouTube 자동 자막(ko-orig)을 한 글자도 고치지 않은 초안이다. 소제목과 문단은 강의 흐름을 따라 붙였고, 문단 앞 시각을 누르면 그 장면이 열린다.",
    "",
    "## 전문",
    "",
    link(0) + " 안녕하세요.",
    "",
    link(26) + " 반갑습니다.",
    "",
    "### 둘째",
    "",
    link(60) + " 두 번째 이야기입니다.",
    "",
  ].join("\n");
  assert.equal(readFileSync(out, "utf8"), expected);
});

test("draft.mjs never writes an empty paragraph for a whitespace-only caption piece", (t) => {
  const dir = workdir(t);
  const captions = write(dir, "captions.json3", {
    events: [
      { tStartMs: 0, segs: [{ utf8: "첫 문장입니다." }] },
      { tStartMs: 30000, segs: [{ utf8: " " }] },
      { tStartMs: 31000, segs: [{ utf8: "다음 이야기." }] },
    ],
  });
  const meta = write(dir, "info.json", { id: VIDEO, title: "t", channel: "c", uploader_id: "@c", upload_date: "20260102", duration_string: "0:40" });
  const sections = write(dir, "sections.json", [["H2", "전문", "__START__"], ["H3", "다음", "다음이야기"]]);
  const out = join(dir, "transcript.md");
  const result = run("draft.mjs", ["--captions", captions, "--meta", meta, "--sections", sections, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  const body = readFileSync(out, "utf8").split("\n").filter((line) => line.startsWith("["));
  assert.deepEqual(body, [link(0) + " 첫 문장입니다.", link(31) + " 다음 이야기."]);
});

test("draft.mjs stops and writes nothing when an anchor phrase is not in the captions", (t) => {
  const dir = workdir(t);
  const captions = write(dir, "captions.json3", { events: [{ tStartMs: 0, segs: [{ utf8: "안녕하세요. " }] }] });
  const meta = write(dir, "info.json", { id: VIDEO, title: "t", channel: "c", uploader_id: "@c", upload_date: "20260102", duration_string: "0:01" });
  const sections = write(dir, "sections.json", [["H2", "전문", "__START__"], ["H3", "없는 곳", "없는구절"]]);
  const out = join(dir, "transcript.md");
  const result = run("draft.mjs", ["--captions", captions, "--meta", meta, "--sections", sections, "--out", out]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /없는구절/u);
  assert.equal(existsSync(out), false);
});

test("apply.mjs replays a transcript given as its own lines byte for byte", (t) => {
  const dir = workdir(t);
  const transcript = write(dir, "transcript.md", TRANSCRIPT);
  const out = join(dir, "out.md");
  const result = run("apply.mjs", ["--transcript", transcript, "--video", VIDEO, "--lines", transcript, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(out, "utf8"), TRANSCRIPT);
});

test("apply.mjs puts the corrected text of each paragraph into the transcript", (t) => {
  const dir = workdir(t);
  const transcript = write(dir, "transcript.md", TRANSCRIPT);
  const lines = write(dir, "lines.md", [link(0) + " 안녕하세요, 고침.", link(26) + " 반갑습니다, 고침.", link(60) + " 두 번째 고침."].join("\n") + "\n");
  const out = join(dir, "out.md");
  const result = run("apply.mjs", ["--transcript", transcript, "--video", VIDEO, "--lines", lines, "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(out, "utf8"), TRANSCRIPT.replace("안녕하세요.", "안녕하세요, 고침.").replace("반갑습니다.", "반갑습니다, 고침.").replace("두 번째 이야기입니다.", "두 번째 고침."));
});

test("apply.mjs stops and writes nothing when the lines miss a paragraph", (t) => {
  const dir = workdir(t);
  const transcript = write(dir, "transcript.md", TRANSCRIPT);
  const lines = write(dir, "lines.md", [link(0) + " 안녕하세요, 고침.", link(60) + " 두 번째 고침."].join("\n") + "\n");
  const out = join(dir, "out.md");
  const result = run("apply.mjs", ["--transcript", transcript, "--video", VIDEO, "--lines", lines, "--out", out]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /00:26/u);
  assert.equal(existsSync(out), false);
});

test("apply.mjs with --partial applies only the paragraphs that have a corrected line", (t) => {
  const dir = workdir(t);
  const transcript = write(dir, "transcript.md", TRANSCRIPT);
  const lines = write(dir, "lines.md", [link(0) + " 안녕하세요, 고침.", link(60) + " 두 번째 고침."].join("\n") + "\n");
  const out = join(dir, "out.md");
  const result = run("apply.mjs", ["--transcript", transcript, "--video", VIDEO, "--lines", lines, "--out", out, "--partial"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(out, "utf8"), TRANSCRIPT.replace("안녕하세요.", "안녕하세요, 고침.").replace("두 번째 이야기입니다.", "두 번째 고침."));
});

function readingsArgs(dir, whisper, subtitles, out) {
  const transcript = write(dir, "transcript.md", TRANSCRIPT);
  return ["--transcript", transcript, "--video", VIDEO, "--whisper", whisper, "--subtitles", subtitles, "--out", out];
}

test("readings.mjs lines up the three sources of each paragraph and marks low-confidence subtitles", (t) => {
  const dir = workdir(t);
  const whisper = write(dir, "whisper.json", [{ start: 1, text: " 안녕하세요" }, { start: 30, text: " 반갑습니다" }]);
  const subtitles = write(dir, "subtitles.json", [{ start: 2, text: "안녕하세요", confidence: 0.99 }, { start: 3, text: "흐릿", confidence: 0.2 }]);
  const out = join(dir, "readings.md");
  const result = run("readings.mjs", readingsArgs(dir, whisper, subtitles, out));
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(out, "utf8");
  assert.match(text, /^- 위스퍼: 안녕하세요$/mu);
  assert.match(text, /^- 자막: 안녕하세요 \/ ⟨\?흐릿⟩$/mu);
});

test("readings.mjs stops and writes nothing when the whisper file is missing", (t) => {
  const dir = workdir(t);
  const subtitles = write(dir, "subtitles.json", []);
  const out = join(dir, "readings.md");
  const result = run("readings.mjs", readingsArgs(dir, join(dir, "no-such-whisper.json"), subtitles, out));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no-such-whisper\.json/u);
  assert.equal(existsSync(out), false);
});

for (const [flag, name] of [["whisper", "whisper.json"], ["subtitles", "subtitles.json"]]) {
  test("readings.mjs reports a malformed " + flag + " file in one line, names it and writes nothing", (t) => {
    const dir = workdir(t);
    const good = write(dir, "good.json", []);
    const bad = write(dir, name, "{ not json");
    const out = join(dir, "readings.md");
    const result = run("readings.mjs", readingsArgs(dir, flag === "whisper" ? bad : good, flag === "whisper" ? good : bad, out));
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr.trim().split("\n").length, 1, result.stderr);
    assert.ok(result.stderr.includes(name), result.stderr);
    assert.equal(existsSync(out), false);
  });
}
