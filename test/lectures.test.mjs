// The lecture registry and the checks that read it: each lecture's principles are held to that
// lecture's own transcript and coverage, and a case or citation quotes the lecture it names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { report, runChecks } from "../scripts/lib/checks.mjs";
import { parseLectures } from "../scripts/lib/corpus.mjs";
import { addSecondLecture, edit, fixtureIndex, fixtureRepo, read, SECOND_VIDEO, write } from "./fixture-repo.mjs";

const PART2 = "skills/openflirt/references/part2.md";
// Editing a carried file after the fixture is built also makes llms-full.txt stale; test/llms.test.mjs owns that.
const failures = (root) => report(runChecks(root, { gitIndex: fixtureIndex })).filter((line) => line.startsWith("FAIL") && !line.startsWith("FAIL llms"));

test("two lectures pass every check, each against its own transcript and coverage", (t) => {
  assert.deepEqual(failures(addSecondLecture(fixtureRepo(t))), []);
});

test("a quote valid only in the first lecture fails when it sits in the second lecture's part file", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  edit(root, PART2, "> [00:05] 쉽게 허락하는 사람은 편안함을 준다", "> [00:10] 말보다 행동을 봐라");
  const lines = failures(root);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^FAIL skills\/openflirt\/references\/part2\.md:6 quote fragment 1\/1 is not in the transcript/);
});

test("a principle of the second lecture listed only in the first lecture's coverage fails", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  edit(root, "corpus/RhfqIi3DmWU/coverage.md", "| action-first |", "| action-first, comfort |");
  edit(root, "corpus/" + SECOND_VIDEO + "/coverage.md", "| comfort |", "| 제외: 시험 |");
  const lines = failures(root);
  assert.deepEqual(lines.map((line) => line.split(" ")[1]), ["corpus/RhfqIi3DmWU/coverage.md:6", PART2 + ":3"]);
});

test("a part file no lecture lists, and a listed part that does not exist, fail under principles", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  edit(root, "corpus/lectures.json", '"part2.md"', '"part3.md"');
  const lines = failures(root);
  assert.ok(lines.includes("FAIL corpus/lectures.json:1 lecture " + SECOND_VIDEO + " lists part3.md, which is not in skills/openflirt/references"), lines.join("\n"));
  assert.ok(lines.includes("FAIL " + PART2 + ":1 part2.md is listed under no lecture in corpus/lectures.json"), lines.join("\n"));
});

test("a case quoting the second lecture passes with source.video and fails without it or with an unknown video", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  const cases = JSON.parse(read(root, "eval/cases.json"));
  const second = { id: "second", question: "질문", expect: { verdict: "interest", action: "reciprocate" }, source: { video: SECOND_VIDEO, t: "00:05", quote: "쉽게 허락하는 사람은 편안함을 준다." }, why: "시험용 이유." };
  const evalFails = (kase) => {
    write(root, "eval/cases.json", JSON.stringify([...cases, kase], null, 2) + "\n");
    return failures(root).filter((line) => line.startsWith("FAIL eval/cases.json"));
  };
  assert.deepEqual(evalFails(second), []);
  const { video, ...firstLecture } = second.source;
  assert.match(evalFails({ ...second, source: firstLecture }).join("\n"), /^FAIL eval\/cases\.json:\d+ case 3: quote fragment/);
  assert.match(evalFails({ ...second, source: { ...second.source, video: "NoSuchVideo" } }).join("\n"), /^FAIL eval\/cases\.json:\d+ case 3: source\.video "NoSuchVideo" is not a lecture in corpus\/lectures\.json$/);
});

test("a registry entry with a bad id, a repeated part or a missing title fails", () => {
  const text = JSON.stringify([
    { video: "RhfqIi3DmWU", title: "첫째", uploaded: "2026-01-01", parts: ["part1.md"] },
    { video: "short", title: "둘째", uploaded: "2026-02-01", parts: ["part2.md"] },
    { video: "SecondVideo", title: "", uploaded: "2026-03-01", parts: ["part1.md"] },
  ]);
  const { lectures, findings } = parseLectures(text, "l.json");
  assert.deepEqual(lectures.map((lecture) => lecture.video), ["RhfqIi3DmWU"]);
  assert.deepEqual(findings.map((finding) => finding.reason), [
    "lecture 2: video must be an 11-character YouTube id",
    "lecture 3: title must be a non-empty string",
    "lecture 3: part1.md is already listed under lecture 1",
  ]);
});

test("a registry that is not oldest upload first, or that has no upload date, fails", () => {
  const text = JSON.stringify([
    { video: "RhfqIi3DmWU", title: "첫째", uploaded: "2026-06-14", parts: ["part1.md"] },
    { video: "F05nX3MKCD0", title: "둘째", uploaded: "2026-01-01", parts: ["part2.md"] },
    { video: "SecondVideo", title: "셋째", parts: ["part3.md"] },
  ]);
  assert.deepEqual(parseLectures(text, "l.json").findings.map((finding) => finding.reason), [
    "lecture 2: uploaded 2026-01-01 must be later than the lecture above it (2026-06-14); list lectures oldest first",
    "lecture 3: uploaded must be the upload date as YYYY-MM-DD",
  ]);
});

test("a transcript whose header upload date differs from the registry fails under transcript", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  const file = "corpus/" + SECOND_VIDEO + "/transcript.md";
  edit(root, file, "# 둘째 픽스처 강의\n", "# 둘째 픽스처 강의\n\n- 올린 날: 2026-03-03\n");
  assert.deepEqual(failures(root), ["FAIL " + file + ":3 올린 날 2026-03-03 differs from uploaded 2026-02-01 in corpus/lectures.json"]);
});
