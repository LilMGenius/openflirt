import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, claudeArgs, codexArgs, parseCli, readAnswerText, readClaudeOutput } from "../scripts/lib/cli.mjs";
import { loadAnswerValidator } from "../scripts/lib/schema.mjs";
import { REPO_ROOT } from "./fixture-repo.mjs";

test("options and a multi-word question parse together", () => {
  const cli = parseCli(["--json", "--runtime", "claude", "--model", "m1", "--timeout", "30", "답장이", "늦어요"]);
  assert.deepEqual(cli, { kind: "run", options: { json: true, runtime: "claude", model: "m1", timeoutSeconds: 30, question: "답장이 늦어요" } });
});

test("no question argument leaves the question to stdin, with defaults", () => {
  assert.deepEqual(parseCli([]), { kind: "run", options: { json: false, runtime: "codex", model: undefined, timeoutSeconds: 600, question: undefined } });
});

test("an unknown runtime, a bad timeout and an unknown flag are usage errors", () => {
  for (const argv of [["--runtime", "gemini", "q"], ["--timeout", "0", "q"], ["--timeout", "soon", "q"], ["--verbose", "q"]]) {
    assert.equal(parseCli(argv).kind, "usage", argv.join(" "));
  }
});

test("the prompt opens with the skill mention and ends with the question", () => {
  const lines = buildPrompt("질문\n둘째 줄").split("\n");
  assert.equal(lines[0], "$openflirt");
  assert.equal(lines[2], "");
  assert.deepEqual(lines.slice(3), ["질문", "둘째 줄"]);
});

test("codex reads the prompt from stdin and gets the schema only in json mode", () => {
  const plain = codexArgs({ repoRoot: "R", outFile: "O", model: undefined, schemaFile: undefined });
  assert.deepEqual(plain, ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", "R", "-o", "O", "-"]);
  const json = codexArgs({ repoRoot: "R", outFile: "O", model: "m", schemaFile: "S" });
  assert.deepEqual(json.slice(-5), ["-m", "m", "--output-schema", "S", "-"]);
});

test("claude gets the schema JSON only in json mode", () => {
  assert.deepEqual(claudeArgs({ model: undefined, schemaJson: undefined }), ["-p", "--output-format", "json"]);
  assert.deepEqual(claudeArgs({ model: "m", schemaJson: "{}" }).slice(3), ["--model", "m", "--json-schema", "{}"]);
});

test("claude output yields structured_output in json mode and result otherwise", () => {
  const stdout = JSON.stringify({ type: "result", is_error: false, result: "답", structured_output: { a: 1 } });
  assert.deepEqual(readClaudeOutput(stdout, true), { kind: "ok", value: { a: 1 } });
  assert.deepEqual(readClaudeOutput(stdout, false), { kind: "ok", value: "답" });
  assert.equal(readClaudeOutput(JSON.stringify({ result: "답" }), true).kind, "error");
  assert.equal(readClaudeOutput("not json", false).kind, "error");
});

test("an answer missing a required field is rejected with its path", () => {
  const result = readAnswerText(JSON.stringify({ verdict: "interest" }), loadAnswerValidator(REPO_ROOT));
  assert.equal(result.kind, "error");
  assert.match(result.reason, /must have required property 'reading'/);
});
