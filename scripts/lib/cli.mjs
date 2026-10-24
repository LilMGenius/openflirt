// Pure pieces of the headless runner: argument parsing, the prompt, each runtime's command line,
// and reading an answer back. bin/openflirt.mjs wires them to processes and files.
import { parseArgs } from "node:util";

export const RUNTIMES = ["codex", "claude"];
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const USAGE = "사용법: openflirt [--json] [--runtime codex|claude] [--model <id>] [--timeout <초>] [질문...]  (질문을 주지 않으면 표준 입력에서 읽는다)";
const SKILL_MENTION = "$openflirt";
const INSTRUCTION = "openflirt 스킬을 읽고 그 판단 순서와 답하는 법을 따라 답하라.";
const OPTIONS = {
  json: { type: "boolean", default: false },
  runtime: { type: "string", default: "codex" },
  model: { type: "string" },
  timeout: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
};

const usage = (reason) => ({ kind: "usage", reason });

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    if (error instanceof TypeError) return usage(error.message);
    throw error;
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (!RUNTIMES.includes(values.runtime)) return usage("--runtime은 codex나 claude만 받는다: " + values.runtime);
  if (values.model !== undefined && values.model.trim() === "") return usage("--model에 모델 id가 비었다");
  const timeoutSeconds = values.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(values.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return usage("--timeout은 0보다 큰 초여야 한다: " + values.timeout);
  return {
    kind: "run",
    options: {
      json: values.json,
      runtime: values.runtime,
      model: values.model,
      timeoutSeconds,
      question: positionals.length === 0 ? undefined : positionals.join(" ").trim(),
    },
  };
}

export const buildPrompt = (question) => [SKILL_MENTION, INSTRUCTION, "", question].join("\n");

// The trailing "-" makes codex read the prompt from stdin, so the question never enters an argv or a shell string.
export function codexArgs({ repoRoot, outFile, model, schemaFile }) {
  return [
    "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", repoRoot, "-o", outFile,
    ...(model === undefined ? [] : ["-m", model]),
    ...(schemaFile === undefined ? [] : ["--output-schema", schemaFile]),
    "-",
  ];
}

// claude -p reads the prompt from stdin when no prompt argument is given.
export function claudeArgs({ model, schemaJson }) {
  return [
    "-p", "--output-format", "json",
    ...(model === undefined ? [] : ["--model", model]),
    ...(schemaJson === undefined ? [] : ["--json-schema", schemaJson]),
  ];
}

// Claude Code's --json-schema validator has no draft 2020-12 meta-schema and rejects the schema
// when "$schema" names it ("no schema with key or ref"). The answer schema uses only keywords
// draft-07 reads the same way, so dropping the dialect line keeps its meaning.
export function claudeSchemaJson(schema) {
  const { $schema, ...rest } = schema;
  return JSON.stringify(rest);
}

const parseJson = (text) => {
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "error", reason: "JSON이 아니다: " + error.message };
    throw error;
  }
};

// claude --output-format json prints one result object; --json-schema puts the answer in structured_output.
export function readClaudeOutput(stdout, json) {
  const parsed = parseJson(stdout);
  if (parsed.kind === "error") return { kind: "error", reason: "claude 출력이 " + parsed.reason };
  const result = parsed.value;
  if (typeof result !== "object" || result === null) return { kind: "error", reason: "claude 출력이 JSON 객체가 아니다" };
  if (result.is_error === true) return { kind: "error", reason: "claude가 오류로 끝났다: " + String(result.result ?? result.subtype ?? "") };
  if (json) {
    return result.structured_output === undefined
      ? { kind: "error", reason: "claude 출력에 structured_output이 없다" }
      : { kind: "ok", value: result.structured_output };
  }
  return typeof result.result === "string" ? { kind: "ok", value: result.result } : { kind: "error", reason: "claude 출력에 result 문자열이 없다" };
}

export function checkAnswer(value, validate) {
  if (validate(value)) return { kind: "ok", value };
  const errors = (validate.errors ?? []).map((error) => (error.instancePath === "" ? "/" : error.instancePath) + " " + error.message);
  return { kind: "error", reason: "답이 schema/answer.schema.json에 맞지 않는다: " + errors.join("; ") };
}

export function readAnswerText(text, validate) {
  const parsed = parseJson(text);
  return parsed.kind === "error" ? { kind: "error", reason: "답이 " + parsed.reason } : checkAnswer(parsed.value, validate);
}
