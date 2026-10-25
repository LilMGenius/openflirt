// Pins the routing detector on tiny recorded streams and drives scripts/routing.mjs with a fake codex
// first on PATH; no test starts a real codex or claude.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "./fixture-repo.mjs";
import { codexRoutingArgs, claudeRoutingArgs, isRateLimited, loadedSkill, tally } from "../scripts/lib/routing.mjs";

const fixture = (name) => readFileSync(join(REPO_ROOT, "test", "fixtures", "routing", name), "utf8");

test("codex stream that reads openflirt/SKILL.md counts as loaded", () => {
  assert.equal(loadedSkill("codex", fixture("codex-loaded.jsonl")), true);
});

test("codex stream whose answer only mentions openflirt is not loaded", () => {
  assert.equal(loadedSkill("codex", fixture("codex-mention-only.jsonl")), false);
});

test("codex reads with backslash paths count too", () => {
  const line = JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "type .agents\\skills\\openflirt\\SKILL.md" } });
  assert.equal(loadedSkill("codex", line + "\n"), true);
});

test("claude Skill tool_use for openflirt is loaded", () => {
  assert.equal(loadedSkill("claude", fixture("claude-skill-openflirt.jsonl")), true);
});

test("claude Skill tool_use for another skill is not loaded", () => {
  assert.equal(loadedSkill("claude", fixture("claude-skill-other.jsonl")), false);
});

test("claude Read of openflirt/SKILL.md is loaded", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "C:\\x\\.claude\\skills\\openflirt\\SKILL.md" } }] } });
  assert.equal(loadedSkill("claude", line + "\n"), true);
});

test("tally of a mixed result gives the confusion table", () => {
  const r = [
    { expect: "load", loaded: true }, { expect: "load", loaded: true }, { expect: "load", loaded: false },
    { expect: "skip", loaded: false }, { expect: "skip", loaded: false }, { expect: "skip", loaded: true },
    { expect: "skip", loaded: null },
  ];
  assert.deepEqual(tally(r), { tp: 2, fn: 1, fp: 1, tn: 2, notRun: 1, accuracy: 4 / 6 });
});

test("rate limit events stop a run", () => {
  assert.equal(isRateLimited("claude", JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } })), true);
  assert.equal(isRateLimited("claude", JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })), false);
  assert.equal(isRateLimited("codex", JSON.stringify({ type: "error", message: "You've hit your usage limit." })), true);
  assert.equal(isRateLimited("codex", fixture("codex-loaded.jsonl")), false);
});

test("runtime args feed the prompt over stdin", () => {
  assert.deepEqual(codexRoutingArgs({}).slice(-1), ["-"]);
  assert.ok(codexRoutingArgs({ model: "m" }).includes("m"));
  const claude = claudeRoutingArgs({ model: "m" });
  assert.ok(claude.includes("stream-json") && claude.includes("--verbose") && claude.includes("m"));
  assert.ok(!claude.some((a) => a.includes("읽씹")));
});

test("eval/routing.json holds 30 unique prompts, 20 load and 10 skip", () => {
  const cases = JSON.parse(readFileSync(join(REPO_ROOT, "eval", "routing.json"), "utf8"));
  assert.equal(cases.length, 30);
  assert.equal(new Set(cases.map((c) => c.id)).size, 30);
  assert.equal(cases.filter((c) => c.expect === "load").length, 20);
  assert.equal(cases.filter((c) => c.expect === "skip").length, 10);
  for (const c of cases) {
    assert.ok(typeof c.prompt === "string" && c.prompt.trim() !== "", c.id);
    assert.ok(/[가-힣]/.test(c.why), c.id + " why must be Korean");
  }
});

// The fake reads the prompt from stdin and answers with a recorded stream: one that reads SKILL.md
// when the prompt says 읽씹, one that only mentions openflirt otherwise. It logs whether the skill
// was reachable from the folder it ran in.
const FAKE_ROUTING = [
  'import { appendFileSync, existsSync, readFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'const prompt = readFileSync(0, "utf8");',
  'const skill = existsSync(join(process.cwd(), ".agents", "skills", "openflirt", "SKILL.md"));',
  'appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ skill, args: process.argv.slice(2) }) + "\\n");',
  'process.stdout.write(readFileSync(join(process.env.FAKE_FIXTURES, prompt.includes("읽씹") ? "codex-loaded.jsonl" : "codex-mention-only.jsonl"), "utf8"));',
].join("\n") + "\n";

test("scripts/routing.mjs runs each prompt in a scratch repo, scores it and deletes only the scratch folder", (t) => {
  const base = mkdtempSync(join(tmpdir(), "openflirt-routing-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  const temp = join(base, "temp");
  mkdirSync(bin);
  mkdirSync(temp);
  const fake = join(bin, "fake.mjs");
  writeFileSync(fake, FAKE_ROUTING);
  if (process.platform === "win32") {
    writeFileSync(join(bin, "codex.cmd"), '@echo off\r\n"' + process.execPath + '" "' + fake + '" %*\r\n');
  } else {
    writeFileSync(join(bin, "codex"), '#!/bin/sh\nexec "' + process.execPath + '" "' + fake + '" "$@"\n');
    chmodSync(join(bin, "codex"), 0o755);
  }
  const replaced = ["PATH", "TEMP", "TMP", "TMPDIR"];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !replaced.includes(key.toUpperCase())));
  Object.assign(env, { PATH: bin + delimiter + (process.env.PATH ?? process.env.Path ?? ""), TEMP: temp, TMP: temp, TMPDIR: temp });
  env.FAKE_CODEX_LOG = join(base, "calls.jsonl");
  env.FAKE_FIXTURES = join(REPO_ROOT, "test", "fixtures", "routing");
  const out = join(base, "out", "result.json");
  const run = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "routing.mjs"), "--runtime", "codex", "--only", "r01,r21", "--out", out], { env, encoding: "utf8", timeout: 120000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const calls = readFileSync(env.FAKE_CODEX_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((call) => call.skill), [true, true]);
  assert.deepEqual(calls[0].args.slice(-1), ["-"]);
  const saved = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual([saved.tp, saved.fn, saved.fp, saved.tn, saved.notRun, saved.accuracy], [1, 0, 0, 1, 0, 1]);
  assert.deepEqual(saved.results.map(({ id, loaded, ok, exit, eventsFile }) => [id, loaded, ok, exit, eventsFile]), [
    ["r01", true, true, 0, "events-codex-result/r01.jsonl"],
    ["r21", false, true, 0, "events-codex-result/r21.jsonl"],
  ]);
  assert.ok(existsSync(join(base, "out", "events-codex-result", "r21.jsonl")));
  assert.deepEqual(readdirSync(temp), []);
  assert.ok(existsSync(join(REPO_ROOT, "skills", "openflirt", "SKILL.md")));
});
