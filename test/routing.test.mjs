// Pins the routing detector on tiny recorded streams; no test starts a real codex or claude.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
