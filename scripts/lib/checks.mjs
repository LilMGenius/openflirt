// Every repository check in one list, so "node scripts/check.mjs" and the tests run the same code.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAnchors } from "./anchors.mjs";
import { checkCoverage } from "./coverage.mjs";
import { COVERAGE_FILE, TRANSCRIPT_FILE, VIDEO_ID } from "./corpus.mjs";
import { checkEval } from "./eval.mjs";
import { readGitIndex, checkSymlinks } from "./links.mjs";
import { collectPrinciples } from "./principles.mjs";
import { checkSchema, SCHEMA_FILE } from "./schema.mjs";
import { checkSkills } from "./skills.mjs";
import { checkQuotes, parseTranscript } from "./transcript.mjs";

const missingFile = (file) => [{ file, line: 1, reason: "file is missing" }];
const readOr = (root, file, check) => (existsSync(join(root, file)) ? check(readFileSync(join(root, file), "utf8")) : missingFile(file));

function symlinkFindings(root, gitIndex, skillNames) {
  let index;
  try {
    index = gitIndex(root);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return [{ file: ".", line: 1, reason: "cannot read the git index: " + error.message.split("\n")[0] }];
  }
  return checkSymlinks(index.entries, index.readBlob, skillNames);
}

export function runChecks(root, { gitIndex = readGitIndex } = {}) {
  const skills = checkSkills(root);
  const principles = collectPrinciples(root);
  const ids = principles.principles.map((principle) => principle.id);
  const transcript = existsSync(join(root, TRANSCRIPT_FILE)) ? parseTranscript(readFileSync(join(root, TRANSCRIPT_FILE), "utf8"), TRANSCRIPT_FILE, VIDEO_ID) : undefined;
  return [
    { name: "skills", findings: skills.findings },
    { name: "symlinks", findings: symlinkFindings(root, gitIndex, skills.names) },
    { name: "principles", findings: principles.findings },
    { name: "transcript", findings: transcript?.findings ?? missingFile(TRANSCRIPT_FILE) },
    { name: "quotes", findings: transcript === undefined ? missingFile(TRANSCRIPT_FILE) : checkQuotes(principles.principles, transcript.paragraphs) },
    { name: "coverage", findings: transcript === undefined ? missingFile(TRANSCRIPT_FILE) : readOr(root, COVERAGE_FILE, (text) => checkCoverage(text, COVERAGE_FILE, transcript.sections, principles.principles)) },
    { name: "anchors", findings: checkAnchors(root) },
    { name: "schema", findings: existsSync(join(root, SCHEMA_FILE)) ? checkSchema(root, ids) : missingFile(SCHEMA_FILE) },
    { name: "eval", findings: transcript === undefined ? missingFile(TRANSCRIPT_FILE) : checkEval(root, transcript.paragraphs) },
  ];
}

export const formatFinding = ({ file, line, col, reason }) => "FAIL " + file + ":" + line + (col === undefined ? "" : ":" + col) + " " + reason;

export function report(results) {
  return results.flatMap(({ name, findings }) => (findings.length === 0 ? ["ok " + name] : findings.map(formatFinding)));
}
