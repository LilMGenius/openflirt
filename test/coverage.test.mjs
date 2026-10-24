import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCoverage } from "../scripts/lib/coverage.mjs";
import { collectPrinciples } from "../scripts/lib/principles.mjs";
import { parseTranscript } from "../scripts/lib/transcript.mjs";
import { edit, fixtureRepo, read } from "./fixture-repo.mjs";

const COVERAGE = "corpus/RhfqIi3DmWU/coverage.md";
const TRANSCRIPT = "corpus/RhfqIi3DmWU/transcript.md";

function check(root) {
  const { sections } = parseTranscript(read(root, TRANSCRIPT), TRANSCRIPT, "RhfqIi3DmWU");
  return checkCoverage(read(root, COVERAGE), COVERAGE, sections, collectPrinciples(root).principles);
}
const lines = (findings) => findings.map((finding) => finding.file + ":" + finding.line);

test("a table with one row per section, in order, passes and skips sections without paragraphs", (t) => {
  assert.deepEqual(check(fixtureRepo(t)), []);
});

test("a missing section row fails once, at the row where it belongs", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| 02:00 | 거리를 둔다 | distance |\n", "");
  const findings = check(root);
  assert.deepEqual(lines(findings), [COVERAGE + ":7", "skills/openflirt/references/part1.md:11"]);
  assert.match(findings[0].reason, /거리를 둔다/);
});

test("a row whose time is not the section's first paragraph fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| 00:10 |", "| 00:40 |");
  assert.deepEqual(lines(check(root)), [COVERAGE + ":6"]);
});

test("rows out of transcript order fail", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| 00:10 | 말보다 행동 | action-first |\n| 02:00 | 거리를 둔다 | distance |", "| 02:00 | 거리를 둔다 | distance |\n| 00:10 | 말보다 행동 | action-first |");
  assert.ok(check(root).length > 0);
});

test("an unknown principle id fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| distance |", "| distance, nosuch |");
  assert.deepEqual(lines(check(root)), [COVERAGE + ":7"]);
});

test("a principle no row names fails at its anchor", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| distance |", "| action-first |");
  assert.deepEqual(lines(check(root)), ["skills/openflirt/references/part1.md:11"]);
});

test("제외: without a reason fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, COVERAGE, "| 제외: 인사 |", "| 제외: |");
  assert.deepEqual(lines(check(root)), [COVERAGE + ":5"]);
});
