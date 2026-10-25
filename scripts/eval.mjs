#!/usr/bin/env node
// Golden eval: runs bin/openflirt.mjs --json once per case, one after another, and scores the
// verdict and action of each answer against the labels in the case file. --rescore judges a
// saved result file again against the current labels without running anything.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatFinding } from "./lib/checks.mjs";
import { TRANSCRIPT_FILE, VIDEO_ID } from "./lib/corpus.mjs";
import { CASES_FILE, caseFindings, isLimitError, notRun, rescore, schemaEnums, scoreRun, SKILL_FILE, totals } from "./lib/eval.mjs";
import { parseTranscript } from "./lib/transcript.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = join(repoRoot, "bin", "openflirt.mjs");
const USAGE = "usage: node scripts/eval.mjs --runtime codex|claude [--model <id>] [--cases eval/cases.json] [--only id,id] --out <result.json>\n       node scripts/eval.mjs --rescore <result.json> [--cases eval/cases.json] --out <result.json>";
const OPTIONS = { runtime: { type: "string" }, model: { type: "string" }, cases: { type: "string" }, only: { type: "string" }, out: { type: "string" }, rescore: { type: "string" } };

function usage(reason) {
  process.stderr.write(reason + "\n" + USAGE + "\n");
  return 2;
}

function loadCases(file) {
  const text = readFileSync(file, "utf8");
  const rel = relative(repoRoot, file);
  const name = rel.startsWith("..") ? file : rel.replace(/\\/g, "/");
  const { paragraphs } = parseTranscript(readFileSync(join(repoRoot, TRANSCRIPT_FILE), "utf8"), TRANSCRIPT_FILE, VIDEO_ID);
  const findings = caseFindings(text, name, { ...schemaEnums(repoRoot), paragraphs, skillText: readFileSync(join(repoRoot, SKILL_FILE), "utf8") });
  return findings.length === 0 ? { cases: JSON.parse(text), name } : { findings };
}

const git = (args) => spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const label = (expect) => expect.verdict + "/" + (Array.isArray(expect.action) ? expect.action.join("|") : expect.action);

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (error) {
    if (error instanceof TypeError) return usage(error.message);
    throw error;
  }
  if (values.out === undefined) return usage("--out is required");
  const loaded = loadCases(resolve(values.cases ?? join(repoRoot, CASES_FILE)));
  if (loaded.findings !== undefined) {
    process.stderr.write(loaded.findings.map(formatFinding).join("\n") + "\n");
    return 2;
  }
  if (values.rescore !== undefined) {
    const saved = JSON.parse(readFileSync(values.rescore, "utf8"));
    let again;
    try {
      again = rescore(saved, loaded.cases);
    } catch (error) {
      if (error instanceof RangeError) return usage(error.message);
      throw error;
    }
    save(values.out, { ...again, rescored: { commit: git(["rev-parse", "HEAD"]), cases: loaded.name, at: new Date().toISOString() } });
    process.stdout.write(JSON.stringify(again.totals) + "\n");
    return 0;
  }
  if (values.runtime !== "codex" && values.runtime !== "claude") return usage("--runtime must be codex or claude");
  const only = values.only === undefined ? undefined : values.only.split(",").map((id) => id.trim()).filter((id) => id !== "");
  const unknown = (only ?? []).filter((id) => !loaded.cases.some((kase) => kase.id === id));
  if (unknown.length > 0) return usage("--only names cases that do not exist: " + unknown.join(", "));
  const selected = only === undefined ? loaded.cases : loaded.cases.filter((kase) => only.includes(kase.id));
  const record = { runtime: values.runtime, model: values.model ?? null, commit: git(["rev-parse", "HEAD"]), cases: loaded.name, startedAt: new Date().toISOString(), finishedAt: null, results: [], totals: totals([]) };
  const args = [BIN, "--json", "--runtime", values.runtime, ...(values.model === undefined ? [] : ["--model", values.model])];
  let limited;
  for (const [index, kase] of selected.entries()) {
    if (limited !== undefined) {
      record.results.push(notRun(kase, "not run: " + limited));
      continue;
    }
    const started = Date.now();
    const child = spawnSync(process.execPath, args, { cwd: repoRoot, input: kase.question, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const result = scoreRun(kase, { exit: child.status ?? 1, stdout: child.stdout ?? "", stderr: (child.stderr ?? "") + (child.error === undefined ? "" : child.error.message), seconds: Math.round((Date.now() - started) / 100) / 10 });
    record.results.push(result);
    if (result.exit !== 0 && isLimitError(child.stderr ?? "")) limited = "the runtime hit a usage or rate limit at " + kase.id;
    const got = result.got === null ? "exit " + result.exit + " " + result.reason : result.got.verdict + "/" + result.got.action;
    process.stdout.write("[" + (index + 1) + "/" + selected.length + "] " + kase.id + " expect " + label(kase.expect) + " got " + got + " verdict " + (result.verdictOk ? "ok" : "MISS") + " action " + (result.actionOk ? "ok" : "MISS") + " " + result.seconds + "s\n");
    record.totals = totals(record.results);
    save(values.out, record);
  }
  record.finishedAt = new Date().toISOString();
  record.totals = totals(record.results);
  save(values.out, record);
  process.stdout.write(JSON.stringify(record.totals) + "\n");
  if (limited !== undefined) {
    process.stderr.write("stopped: " + limited + "; the remaining cases are marked not_run\n");
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
