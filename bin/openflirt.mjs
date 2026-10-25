#!/usr/bin/env node
// Headless openflirt: hands one question to an installed agent CLI (Codex by default, or Claude
// Code) running in this repository, so AGENTS.md and the openflirt skill load whatever the
// caller's cwd, and prints the answer as text or, with --json, as JSON whose shape the schema
// checks and whose citations the transcript checks.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { runAgent } from "../scripts/lib/agent.mjs";
import { buildPrompt, checkAnswer, checkCitations, claudeArgs, claudeSchemaJson, codexArgs, parseCli, readAnswerText, readClaudeOutput, USAGE } from "../scripts/lib/cli.mjs";
import { TRANSCRIPT_FILE, VIDEO_ID } from "../scripts/lib/corpus.mjs";
import { loadAnswerValidator, SCHEMA_FILE } from "../scripts/lib/schema.mjs";
import { parseTranscript } from "../scripts/lib/transcript.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(repoRoot, SCHEMA_FILE);

const fail = (message) => ({ kind: "fail", message });

function processFailure(name, result, timeoutSeconds) {
  switch (result.kind) {
    case "missing":
      return fail(name + " 실행 파일을 PATH에서 찾지 못했다. " + name + "를 설치하거나 --runtime으로 다른 런타임을 고른다.");
    case "timeout":
      return fail(name + "가 " + timeoutSeconds + "초 안에 끝나지 않아 프로세스를 모두 멈췄다.");
    case "interrupted":
      return fail(name + " 실행을 중단했다.");
    case "failed":
      return fail(name + "를 실행하지 못했다: " + result.reason);
    case "exit":
      process.stderr.write(result.stderr);
      return fail(name + "가 종료 코드 " + result.code + "로 끝났다.");
    default:
      throw new TypeError("unknown agent result " + JSON.stringify(result));
  }
}

async function askCodex(prompt, options) {
  const scratch = mkdtempSync(join(tmpdir(), "openflirt-"));
  const outFile = join(scratch, "answer.txt");
  try {
    const args = codexArgs({ repoRoot, outFile, model: options.model, schemaFile: options.json ? schemaPath : undefined });
    const result = await runAgent({ command: "codex", args, cwd: repoRoot, input: prompt, timeoutMs: options.timeoutSeconds * 1000 });
    if (result.kind !== "exit" || result.code !== 0) return processFailure("codex", result, options.timeoutSeconds);
    if (!existsSync(outFile)) return fail("codex가 마지막 답(-o 파일)을 남기지 않았다.");
    const answer = readFileSync(outFile, "utf8");
    return options.json ? { kind: "text", text: answer } : { kind: "answer", value: answer };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function askClaude(prompt, options) {
  const schemaJson = options.json ? claudeSchemaJson(JSON.parse(readFileSync(schemaPath, "utf8"))) : undefined;
  const args = claudeArgs({ model: options.model, schemaJson });
  const result = await runAgent({ command: "claude", args, cwd: repoRoot, input: prompt, timeoutMs: options.timeoutSeconds * 1000 });
  if (result.kind !== "exit" || result.code !== 0) return processFailure("claude", result, options.timeoutSeconds);
  const output = readClaudeOutput(result.stdout, options.json);
  return output.kind === "error" ? fail(output.reason) : { kind: "answer", value: output.value };
}

function emit(reply, json) {
  if (reply.kind === "fail") return fail(reply.message);
  if (!json) {
    process.stdout.write(String(reply.value).trimEnd() + "\n");
    return { kind: "done" };
  }
  const validate = loadAnswerValidator(repoRoot);
  const checked = reply.kind === "text" ? readAnswerText(reply.text, validate) : checkAnswer(reply.value, validate);
  if (checked.kind === "error") return fail(checked.reason);
  const { paragraphs } = parseTranscript(readFileSync(join(repoRoot, TRANSCRIPT_FILE), "utf8"), TRANSCRIPT_FILE, VIDEO_ID);
  const cited = checkCitations(checked.value, paragraphs);
  if (cited.kind === "error") return fail(cited.reason);
  process.stdout.write(JSON.stringify(cited.value, null, 2) + "\n");
  return { kind: "done" };
}

async function main(argv) {
  const cli = parseCli(argv);
  if (cli.kind === "help") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (cli.kind === "usage") {
    process.stderr.write(cli.reason + "\n" + USAGE + "\n");
    return 2;
  }
  const { options } = cli;
  const question = options.question ?? (process.stdin.isTTY ? "" : (await text(process.stdin)).trim());
  if (question === "") {
    process.stderr.write("질문이 비었다.\n" + USAGE + "\n");
    return 2;
  }
  const prompt = buildPrompt(question);
  const reply = options.runtime === "claude" ? await askClaude(prompt, options) : await askCodex(prompt, options);
  const outcome = emit(reply, options.json);
  if (outcome.kind === "fail") {
    process.stderr.write(outcome.message + "\n");
    return 1;
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
