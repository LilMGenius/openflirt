// Drives bin/openflirt.mjs as a process with a fake codex first on PATH; no test reaches a real model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./fixture-repo.mjs";

const BIN = join(REPO_ROOT, "bin", "openflirt.mjs");
const FAKE = join(REPO_ROOT, "test", "fake-agent", "codex.mjs");
const VALID = {
  verdict: "ambiguous",
  reading: "약속을 계속 미루고 있다.",
  action: "withdraw",
  message: null,
  answer: "더 보내지 말고 거리를 둬라.",
  principles: ["distance"],
  citations: [{ video: "RhfqIi3DmWU", t: "13:52", quote: "남자가 나를 좋아하고 있다는 걸 본인이 느낄수록 거리를 둡니다." }],
  out_of_scope: null,
};

function fakeCodexDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "openflirt-fake-codex-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (process.platform === "win32") {
    writeFileSync(join(dir, "codex.cmd"), '@echo off\r\n"' + process.execPath + '" "' + FAKE + '" %*\r\n');
  } else {
    writeFileSync(join(dir, "codex"), '#!/bin/sh\nexec "' + process.execPath + '" "' + FAKE + '" "$@"\n');
    chmodSync(join(dir, "codex"), 0o755);
  }
  return dir;
}

function run(t, args, { answer = "", exit, input } = {}) {
  const dir = fakeCodexDir(t);
  const log = join(dir, "call.json");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = dir + delimiter + (process.env.PATH ?? process.env.Path ?? "");
  env.FAKE_CODEX_LOG = log;
  env.FAKE_CODEX_ANSWER = answer;
  if (exit !== undefined) env.FAKE_CODEX_EXIT = String(exit);
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd: tmpdir(), env, input: input ?? "", encoding: "utf8" });
  const call = () => JSON.parse(readFileSync(log, "utf8"));
  return { ...result, call };
}

test("--json prints a valid answer and exits 0", (t) => {
  const result = run(t, ["--json", "약속을", "미뤄요"], { answer: JSON.stringify(VALID) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), VALID);
  const { args, prompt } = result.call();
  assert.equal(args[args.indexOf("-C") + 1], REPO_ROOT);
  assert.equal(args[args.indexOf("--output-schema") + 1], join(REPO_ROOT, "schema", "answer.schema.json"));
  assert.equal(args.at(-1), "-");
  assert.ok(!args.some((arg) => arg.includes("미뤄요")), "the question must not travel in argv");
  assert.equal(prompt.split("\n").at(-1), "약속을 미뤄요");
});

test("--json exits 1 when the answer breaks the schema", (t) => {
  const result = run(t, ["--json", "질문"], { answer: JSON.stringify({ ...VALID, verdict: "maybe" }) });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\/verdict/);
});

test("--json exits 1 when the answer is not JSON", (t) => {
  const result = run(t, ["--json", "질문"], { answer: "그냥 글" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON/);
});

test("--json exits 1 and prints nothing when a citation is not the lecture's words at its time", (t) => {
  for (const citation of [{ video: "RhfqIi3DmWU", t: "13:52", quote: "여자는 무조건 밀당해야 넘어온다" }, { video: "RhfqIi3DmWU", t: "40:00", quote: "남자가 나를 좋아하고 있다는 걸 본인이 느낄수록 거리를 둡니다." }]) {
    const result = run(t, ["--json", "질문"], { answer: JSON.stringify({ ...VALID, citations: [VALID.citations[0], citation] }) });
    assert.equal(result.status, 1, citation.t);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp("\\[" + citation.t + "\\]"));
  }
});

test("--json exits 1 when a citation names no video", (t) => {
  const { video, ...bare } = VALID.citations[0];
  const result = run(t, ["--json", "질문"], { answer: JSON.stringify({ ...VALID, citations: [bare] }) });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /video/);
});

test("text mode prints the answer and passes no schema", (t) => {
  const result = run(t, ["질문"], { answer: "거리를 둬라." });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "거리를 둬라.\n");
  assert.ok(!result.call().args.includes("--output-schema"));
});

test("the question is read from stdin when no argument names it", (t) => {
  const result = run(t, [], { answer: "답", input: "표준 입력 질문\n" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.call().prompt.split("\n").at(-1), "표준 입력 질문");
});

test("an empty question exits 2 without starting codex", (t) => {
  const result = run(t, [], { input: "  \n" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /사용법/);
});

test("a failing codex exits 1 and passes its stderr through", (t) => {
  const result = run(t, ["질문"], { exit: 3 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fake codex failed/);
  assert.match(result.stderr, /종료 코드 3/);
});

test("a missing runtime binary exits 1 and names it", () => {
  const env = { ...process.env, PATH: mkdtempSync(join(tmpdir(), "openflirt-empty-")), Path: undefined };
  const result = spawnSync(process.execPath, [BIN, "--runtime", "claude", "질문"], { env, input: "", encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /claude 실행 파일/);
});

test("a codex that outlives --timeout is killed and exits 1", (t) => {
  const dir = fakeCodexDir(t);
  writeFileSync(join(dir, "slow.mjs"), "setTimeout(() => {}, 60000);\n");
  const body = process.platform === "win32" ? '@echo off\r\n"' + process.execPath + '" "' + join(dir, "slow.mjs") + '"\r\n' : '#!/bin/sh\nexec "' + process.execPath + '" "' + join(dir, "slow.mjs") + '"\n';
  writeFileSync(join(dir, process.platform === "win32" ? "codex.cmd" : "codex"), body);
  if (process.platform !== "win32") chmodSync(join(dir, "codex"), 0o755);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = dir + delimiter + (process.env.PATH ?? process.env.Path ?? "");
  const started = Date.now();
  const result = spawnSync(process.execPath, [BIN, "--timeout", "1", "질문"], { env, input: "", encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /1초 안에 끝나지 않아/);
  assert.ok(Date.now() - started < 20000);
});
