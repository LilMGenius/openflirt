// The golden eval: the case-file check on the fixture repository, the pure scorer, and
// scripts/eval.mjs driven with a fake codex first on PATH. No test reaches a real model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { report, runChecks } from "../scripts/lib/checks.mjs";
import { isLimitError, rescore, scoreRun, totals } from "../scripts/lib/eval.mjs";
import { edit, fixtureIndex, fixtureRepo, REPO_ROOT } from "./fixture-repo.mjs";

const CASES = "eval/cases.json";
const EVAL = join(REPO_ROOT, "scripts", "eval.mjs");
const FAKE = join(REPO_ROOT, "test", "fake-agent", "codex.mjs");
const evalLines = (root) => report(runChecks(root, { gitIndex: fixtureIndex })).filter((line) => line === "ok eval" || line.startsWith("FAIL " + CASES));

const ANSWER = {
  verdict: "ambiguous",
  reading: "약속을 계속 미루고 있다.",
  action: "withdraw",
  message: null,
  answer: "더 보내지 말고 거리를 둬라.",
  principles: ["distance"],
  citations: [{ t: "13:52", quote: "남자가 나를 좋아하고 있다는 걸 본인이 느낄수록 거리를 둡니다." }],
  out_of_scope: null,
};
const lectureCase = (id, action) => ({
  id,
  question: "질문 " + id,
  expect: { verdict: "ambiguous", action },
  source: { t: "13:52", quote: "남자가 나를 좋아하고 있다는 걸 본인이 느낄수록 거리를 둡니다." },
  why: "시험용 이유.",
});

test("the fixture case file passes the eval check", (t) => {
  assert.deepEqual(evalLines(fixtureRepo(t)), ["ok eval"]);
});

test("a label outside the schema enums fails at its line", (t) => {
  const root = fixtureRepo(t);
  edit(root, CASES, '"verdict": "friction"', '"verdict": "maybe"');
  edit(root, CASES, '"observe"', '"wait"');
  const lines = evalLines(root);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /^FAIL eval\/cases\.json:6 .*verdict.*maybe/);
  assert.match(lines[1], /^FAIL eval\/cases\.json:22 .*action.*wait/);
});

test("a lecture quote not in the transcript at its time fails", (t) => {
  for (const [from, to] of [['"약속을 미루면 그게 신호야."', '"약속을 미루면 그건 사랑이야."'], ['"t": "00:40"', '"t": "03:20"']]) {
    const root = fixtureRepo(t);
    edit(root, CASES, from, to);
    const lines = evalLines(root);
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(lines[0], /^FAIL eval\/cases\.json:11 .*not in the transcript/);
  }
});

test("an openflirt-rule quote not in SKILL.md fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, CASES, "연애 질문에 강의 원칙으로 답한다.", "연애 질문에 아무렇게나 답한다.");
  const lines = evalLines(root);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^FAIL eval\/cases\.json:27 .*SKILL\.md/);
});

test("a duplicate id fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, CASES, '"id": "harness-rule"', '"id": "put-off"');
  const lines = evalLines(root);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^FAIL eval\/cases\.json:16 .*put-off/);
});

test("an empty question or why fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, CASES, '"question": "약속을 자꾸 미뤄."', '"question": " "');
  edit(root, CASES, '"why": "시험용 이유."\n  }\n]', '"why": ""\n  }\n]');
  const lines = evalLines(root);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], /^FAIL eval\/cases\.json:4 .*question/);
  assert.match(lines[1], /^FAIL eval\/cases\.json:29 .*why/);
});

test("the scorer counts a match, a wrong action and a runner exit 1", () => {
  const cases = [lectureCase("match", "withdraw"), lectureCase("wrong-action", "stop"), lectureCase("crash", "withdraw")];
  const stdout = JSON.stringify(ANSWER);
  const results = [
    scoreRun(cases[0], { exit: 0, stdout, stderr: "", seconds: 1 }),
    scoreRun(cases[1], { exit: 0, stdout, stderr: "", seconds: 1 }),
    scoreRun(cases[2], { exit: 1, stdout: "", stderr: "\nfake codex failed\ncodex가 종료 코드 3로 끝났다.\n", seconds: 1 }),
  ];
  assert.deepEqual(results.map(({ verdictOk, actionOk, exit }) => [verdictOk, actionOk, exit]), [[true, true, 0], [true, false, 0], [false, false, 1]]);
  assert.equal(results[2].reason, "fake codex failed");
  assert.equal(results[2].got, null);
  assert.deepEqual(totals(results), { cases: 3, answered: 2, failed: 1, notRun: 0, verdictOk: 2, actionOk: 1, bothOk: 1 });
});

test("an action list accepts any action it names", () => {
  const kase = lectureCase("either", ["stop", "withdraw"]);
  assert.equal(scoreRun(kase, { exit: 0, stdout: JSON.stringify(ANSWER), stderr: "", seconds: 1 }).actionOk, true);
});

test("rescoring saved answers matches a fresh score and follows a changed label", () => {
  const cases = [lectureCase("match", "withdraw"), lectureCase("wrong-action", "stop"), lectureCase("crash", "withdraw")];
  const runs = [{ exit: 0, stdout: JSON.stringify(ANSWER), stderr: "", seconds: 2 }, { exit: 0, stdout: JSON.stringify(ANSWER), stderr: "", seconds: 3 }, { exit: 1, stdout: "", stderr: "boom\n", seconds: 4 }];
  const fresh = cases.map((kase, index) => scoreRun(kase, runs[index]));
  const saved = JSON.parse(JSON.stringify({ runtime: "codex", results: fresh, totals: totals(fresh) }));
  const again = rescore(saved, cases);
  assert.deepEqual(again.results, fresh);
  assert.deepEqual(again.totals, totals(fresh));
  const relabeled = rescore(saved, [cases[0], lectureCase("wrong-action", "withdraw"), cases[2]]);
  assert.equal(relabeled.results[1].actionOk, true);
  assert.deepEqual(relabeled.results[1].expect, { verdict: "ambiguous", action: "withdraw" });
});

test("a usage or rate limit in stderr is recognised", () => {
  assert.equal(isLimitError("ERROR: You've hit your usage limit. Try again later."), true);
  assert.equal(isLimitError("Error: 429 Too Many Requests"), true);
  assert.equal(isLimitError("rate_limit_error"), true);
  assert.equal(isLimitError("fake codex failed"), false);
});

function fakeDir(t, script) {
  const dir = mkdtempSync(join(tmpdir(), "openflirt-eval-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = script === undefined ? FAKE : join(dir, "fake.mjs");
  if (script !== undefined) writeFileSync(target, script);
  if (process.platform === "win32") {
    writeFileSync(join(dir, "codex.cmd"), '@echo off\r\n"' + process.execPath + '" "' + target + '" %*\r\n');
  } else {
    writeFileSync(join(dir, "codex"), '#!/bin/sh\nexec "' + process.execPath + '" "' + target + '" "$@"\n');
    chmodSync(join(dir, "codex"), 0o755);
  }
  return dir;
}

function runEval(t, args, { cases, env: extra = {}, script } = {}) {
  const dir = fakeDir(t, script);
  const casesFile = join(dir, "cases.json");
  writeFileSync(casesFile, JSON.stringify(cases, null, 2) + "\n");
  const out = join(dir, "result.json");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  env.PATH = dir + delimiter + (process.env.PATH ?? process.env.Path ?? "");
  env.FAKE_CODEX_LOG = join(dir, "call.json");
  Object.assign(env, extra);
  const result = spawnSync(process.execPath, [EVAL, "--runtime", "codex", "--cases", casesFile, "--out", out, ...args], { env, encoding: "utf8", timeout: 120000 });
  return { ...result, dir, out, saved: () => JSON.parse(readFileSync(out, "utf8")) };
}

test("scripts/eval.mjs runs each case through the runner and records the score", (t) => {
  const cases = [lectureCase("match", "withdraw"), lectureCase("wrong-action", "stop")];
  const run = runEval(t, [], { cases, env: { FAKE_CODEX_ANSWER: JSON.stringify(ANSWER) } });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const saved = run.saved();
  assert.equal(saved.runtime, "codex");
  assert.match(saved.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(saved.results.map(({ id, verdictOk, actionOk, exit }) => [id, verdictOk, actionOk, exit]), [["match", true, true, 0], ["wrong-action", true, false, 0]]);
  assert.deepEqual(saved.results[1].got.action, "withdraw");
  assert.deepEqual(saved.totals, { cases: 2, answered: 2, failed: 0, notRun: 0, verdictOk: 2, actionOk: 1, bothOk: 1 });
  const rescored = join(run.dir, "rescored.json");
  const again = spawnSync(process.execPath, [EVAL, "--cases", join(run.dir, "cases.json"), "--rescore", run.out, "--out", rescored], { encoding: "utf8" });
  assert.equal(again.status, 0, again.stderr);
  const after = JSON.parse(readFileSync(rescored, "utf8"));
  assert.deepEqual(after.results, saved.results);
  assert.deepEqual(after.totals, saved.totals);
});

test("scripts/eval.mjs counts a runner exit 1 as a miss with its first stderr line", (t) => {
  const run = runEval(t, ["--only", "crash"], { cases: [lectureCase("skipped", "withdraw"), lectureCase("crash", "withdraw")], env: { FAKE_CODEX_EXIT: "3" } });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const [result] = run.saved().results;
  assert.equal(run.saved().results.length, 1);
  assert.deepEqual([result.id, result.exit, result.reason, result.verdictOk, result.actionOk], ["crash", 1, "fake codex failed", false, false]);
});

test("scripts/eval.mjs stops at a usage limit and marks the rest not run", (t) => {
  const script = 'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_CODEX_LOG, "call\\n");\nprocess.stderr.write("ERROR: You\'ve hit your usage limit. Try again later.\\n");\nprocess.exit(1);\n';
  const run = runEval(t, [], { cases: [lectureCase("first", "withdraw"), lectureCase("second", "withdraw"), lectureCase("third", "withdraw")], script });
  assert.equal(run.status, 1, run.stderr + run.stdout);
  assert.equal(readFileSync(join(run.dir, "call.json"), "utf8"), "call\n");
  const saved = run.saved();
  assert.deepEqual(saved.results.map(({ id, status }) => [id, status]), [["first", "failed"], ["second", "not_run"], ["third", "not_run"]]);
  assert.match(saved.results[0].reason, /usage limit/);
  assert.equal(saved.totals.notRun, 2);
});

test("scripts/eval.mjs refuses an invalid case file before running anything", (t) => {
  const bad = { ...lectureCase("bad", "withdraw"), expect: { verdict: "maybe", action: "withdraw" } };
  const run = runEval(t, [], { cases: [bad], env: { FAKE_CODEX_ANSWER: JSON.stringify(ANSWER) } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /verdict/);
  assert.equal(existsSync(join(run.dir, "call.json")), false);
});
