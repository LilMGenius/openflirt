// Golden eval: the case file's check and the scorer. A case's labels come from the lecture's own
// worked example (or an openflirt rule in SKILL.md), never from a model's answer, so the check
// holds every source quote to the words it cites and the scorer compares verdict and action only.
// A lecture quote names its lecture in source.video; a case without it quotes the first lecture
// in corpus/lectures.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LECTURES_FILE } from "./corpus.mjs";
import { SCHEMA_FILE } from "./schema.mjs";
import { normalize, quoteFinding } from "./transcript.mjs";

export const CASES_FILE = "eval/cases.json";
export const SKILL_FILE = "skills/openflirt/SKILL.md";
const TIME = /^([0-5]\d):([0-5]\d)$/;
const LIMIT = /usage limit|rate[ _-]?limit|too many requests|\b429\b|limit reached|hit your limit|quota/i;

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;
const isText = (value) => typeof value === "string" && value.trim() !== "";
const isMapping = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Where each case's keys sit in the file, so a finding names a line. Cases are the top-level
// objects of a two-space indented array; a file in another layout reports at its first line.
function locator(text, count) {
  const starts = [...text.matchAll(/^ {2}\{/gm)].map((match) => match.index);
  if (starts.length !== count) return () => 1;
  return (index, keys, value) => {
    const end = starts[index + 1] ?? text.length;
    let at = starts[index];
    for (const key of keys) {
      const next = text.indexOf(JSON.stringify(key) + ":", at);
      if (next === -1 || next >= end) return lineAt(text, at);
      at = next;
    }
    if (value !== undefined) {
      const next = text.indexOf(JSON.stringify(value), at);
      if (next !== -1 && next < end) at = next;
    }
    return lineAt(text, at);
  };
}

// paragraphsByVideo maps every registry video, in registry order, to its transcript paragraphs (undefined when the transcript is missing).
export function caseFindings(text, file, { verdicts, actions, paragraphsByVideo, skillText }) {
  let cases;
  try {
    cases = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return [{ file, line: 1, reason: "invalid JSON: " + error.message }];
    throw error;
  }
  if (!Array.isArray(cases)) return [{ file, line: 1, reason: "the case file must be a JSON array of cases" }];
  const at = locator(text, cases.length);
  const findings = [];
  const add = (index, keys, reason, value) => findings.push({ file, line: at(index, keys, value), reason: "case " + (index + 1) + ": " + reason });
  const seen = new Map();
  const skill = normalize(skillText);
  const firstVideo = paragraphsByVideo.keys().next().value;
  for (const [index, kase] of cases.entries()) {
    if (!isMapping(kase)) {
      add(index, [], "must be an object");
      continue;
    }
    if (!isText(kase.id)) add(index, ["id"], "id must be a non-empty string");
    else if (seen.has(kase.id)) add(index, ["id"], "id " + kase.id + " repeats case " + seen.get(kase.id));
    else seen.set(kase.id, index + 1);
    if (!isText(kase.question)) add(index, ["question"], "question must be a non-empty string");
    if (!isText(kase.why)) add(index, ["why"], "why must be a non-empty string");
    const expect = isMapping(kase.expect) ? kase.expect : {};
    if (!verdicts.includes(expect.verdict)) add(index, ["expect", "verdict"], "expect.verdict " + JSON.stringify(expect.verdict) + " is not in the schema verdict enum");
    const listed = Array.isArray(expect.action) ? expect.action : [expect.action];
    if (Array.isArray(expect.action) && (expect.action.length < 2 || new Set(expect.action).size !== expect.action.length)) add(index, ["expect", "action"], "an action list must name two or more different actions");
    for (const action of listed) {
      if (!actions.includes(action)) add(index, ["expect", "action"], "expect.action " + JSON.stringify(action) + " is not in the schema action enum", Array.isArray(expect.action) ? action : undefined);
    }
    const source = isMapping(kase.source) ? kase.source : {};
    if (!isText(source.quote)) {
      add(index, ["source"], "source.quote must be a non-empty string");
    } else if (source.kind === "openflirt") {
      if (!skill.includes(normalize(source.quote))) add(index, ["source", "quote"], "source.quote is not in " + SKILL_FILE + " (openflirt rules are quoted from it)");
    } else if (source.kind !== undefined) {
      add(index, ["source", "kind"], 'source.kind must be "openflirt" or absent for a lecture quote');
    } else {
      const video = source.video ?? firstVideo;
      const paragraphs = paragraphsByVideo.get(video);
      const time = TIME.exec(source.t ?? "");
      if (!paragraphsByVideo.has(video)) add(index, ["source", "video"], "source.video " + JSON.stringify(video) + " is not a lecture in " + LECTURES_FILE);
      else if (paragraphs === undefined) add(index, ["source"], "the transcript of lecture " + video + " is missing");
      else if (time === null) add(index, ["source", "t"], "source.t must be mm:ss");
      else {
        const reason = quoteFinding({ t: source.t, sec: Number(time[1]) * 60 + Number(time[2]), text: source.quote }, paragraphs);
        if (reason !== undefined) add(index, ["source", "quote"], reason);
      }
    }
  }
  return findings;
}

export function schemaEnums(root) {
  const schema = JSON.parse(readFileSync(join(root, SCHEMA_FILE), "utf8"));
  return { verdicts: schema.properties?.verdict?.enum ?? [], actions: schema.properties?.action?.enum ?? [] };
}

export function checkEval(root, paragraphsByVideo) {
  for (const file of [CASES_FILE, SCHEMA_FILE, SKILL_FILE]) if (!existsSync(join(root, file))) return [{ file, line: 1, reason: "file is missing" }];
  return caseFindings(readFileSync(join(root, CASES_FILE), "utf8"), CASES_FILE, { ...schemaEnums(root), paragraphsByVideo, skillText: readFileSync(join(root, SKILL_FILE), "utf8") });
}

export const isLimitError = (stderr) => LIMIT.test(stderr);

const firstLine = (text) => text.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "") ?? "";

function judge(expect, got) {
  const actions = Array.isArray(expect.action) ? expect.action : [expect.action];
  return { verdictOk: got !== null && got.verdict === expect.verdict, actionOk: got !== null && actions.includes(got.action) };
}

// One runner call: exit 0 carries one schema-checked answer on stdout; any other exit is a miss
// whose reason is the first line the runner printed on stderr.
export function scoreRun(kase, { exit, stdout, stderr, seconds }) {
  const base = { id: kase.id, expect: kase.expect, exit, seconds };
  if (exit !== 0) return { ...base, status: "failed", got: null, verdictOk: false, actionOk: false, reason: firstLine(stderr) || "runner exited " + exit };
  let got;
  try {
    got = JSON.parse(stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ...base, status: "failed", got: null, verdictOk: false, actionOk: false, reason: "runner printed no JSON: " + error.message };
  }
  return { ...base, status: "answered", got, ...judge(kase.expect, got), reason: null };
}

export const notRun = (kase, reason) => ({ id: kase.id, expect: kase.expect, exit: null, seconds: 0, status: "not_run", got: null, verdictOk: false, actionOk: false, reason });

export function totals(results) {
  const count = (test) => results.filter(test).length;
  return {
    cases: results.length,
    answered: count((result) => result.status === "answered"),
    failed: count((result) => result.status === "failed"),
    notRun: count((result) => result.status === "not_run"),
    verdictOk: count((result) => result.verdictOk),
    actionOk: count((result) => result.actionOk),
    bothOk: count((result) => result.verdictOk && result.actionOk),
  };
}

// Saved answers judged again against the current labels; nothing runs.
export function rescore(saved, cases) {
  const byId = new Map(cases.map((kase) => [kase.id, kase]));
  const results = saved.results.map((result) => {
    const kase = byId.get(result.id);
    if (kase === undefined) throw new RangeError("saved case " + result.id + " is not in the case file");
    return { ...result, expect: kase.expect, ...(result.status === "answered" ? judge(kase.expect, result.got) : {}) };
  });
  return { ...saved, results, totals: totals(results) };
}
