// Every repository check in one list, so "node scripts/check.mjs" and the tests run the same code.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkAnchors } from "./anchors.mjs";
import { checkCoverage } from "./coverage.mjs";
import { coverageFile, loadLectures, readTranscripts, uploadDateFinding } from "./corpus.mjs";
import { checkEval } from "./eval.mjs";
import { readGitIndex, checkSymlinks } from "./links.mjs";
import { checkLlms } from "./llms.mjs";
import { collectPrinciples } from "./principles.mjs";
import { checkSchema, SCHEMA_FILE } from "./schema.mjs";
import { checkSkills } from "./skills.mjs";
import { checkQuotes } from "./transcript.mjs";

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
  const registry = loadLectures(root);
  const principles = collectPrinciples(root, registry.lectures);
  const ids = principles.principles.map((principle) => principle.id);
  const transcripts = readTranscripts(root, registry.lectures);
  // Each lecture is checked on its own: its transcript, and only the principles from its own part files.
  const perLecture = (check) => transcripts.flatMap((entry) => (entry.parsed === undefined ? missingFile(entry.file) : check(entry)));
  const principlesOf = (video) => principles.principles.filter((principle) => principle.video === video);
  const coverage = ({ lecture, parsed }) => readOr(root, coverageFile(lecture.video), (text) => checkCoverage(text, coverageFile(lecture.video), parsed.sections, principlesOf(lecture.video)));
  const paragraphsByVideo = new Map(transcripts.map(({ lecture, parsed }) => [lecture.video, parsed?.paragraphs]));
  return [
    { name: "skills", findings: skills.findings },
    { name: "symlinks", findings: symlinkFindings(root, gitIndex, skills.names) },
    { name: "principles", findings: [...registry.findings, ...principles.findings] },
    { name: "transcript", findings: perLecture(({ lecture, file, parsed }) => [...parsed.findings, ...uploadDateFinding(readFileSync(join(root, file), "utf8"), file, lecture)]) },
    { name: "quotes", findings: perLecture(({ lecture, parsed }) => checkQuotes(principlesOf(lecture.video), parsed.paragraphs)) },
    { name: "coverage", findings: perLecture(coverage) },
    { name: "anchors", findings: checkAnchors(root) },
    { name: "schema", findings: existsSync(join(root, SCHEMA_FILE)) ? checkSchema(root, ids, registry.lectures.map((lecture) => lecture.video)) : missingFile(SCHEMA_FILE) },
    { name: "eval", findings: checkEval(root, paragraphsByVideo) },
    { name: "llms", findings: checkLlms(root) },
  ];
}

export const formatFinding = ({ file, line, col, reason }) => "FAIL " + file + ":" + line + (col === undefined ? "" : ":" + col) + " " + reason;

export function report(results) {
  return results.flatMap(({ name, findings }) => (findings.length === 0 ? ["ok " + name] : findings.map(formatFinding)));
}
