// llms.txt and llms-full.txt: the builder's link rewrite, the check that holds the committed files
// to the builder, and the generator's --check mode.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { report, runChecks } from "../scripts/lib/checks.mjs";
import { absoluteLinks, BASE_URL } from "../scripts/lib/llms.mjs";
import { addSecondLecture, edit, fixtureIndex, fixtureRepo, read, REPO_ROOT } from "./fixture-repo.mjs";

const llmsLines = (root) => report(runChecks(root, { gitIndex: fixtureIndex })).filter((line) => line === "ok llms" || /^FAIL llms/.test(line));
const TICK = "\x60";

test("relative links become absolute raw URLs with their anchors, and code, fences and absolute links stay", () => {
  const text = ["[a](part2.md#loss) [b](../SKILL.md) [c](https://youtu.be/x) [d](#here) " + TICK + "[e](part1.md)" + TICK, TICK.repeat(3), "[f](part1.md)", TICK.repeat(3)].join("\n");
  assert.deepEqual(absoluteLinks(text, "skills/openflirt/references/glossary.md").split("\n"), [
    "[a](" + BASE_URL + "skills/openflirt/references/part2.md#loss) [b](" + BASE_URL + "skills/openflirt/SKILL.md) [c](https://youtu.be/x) [d](#here) " + TICK + "[e](part1.md)" + TICK,
    TICK.repeat(3),
    "[f](part1.md)",
    TICK.repeat(3),
  ]);
});

test("llms-full.txt carries every registry part file, the second lecture's included", (t) => {
  const root = addSecondLecture(fixtureRepo(t));
  assert.deepEqual(llmsLines(root), ["ok llms"]);
  assert.deepEqual(read(root, "llms-full.txt").split("\n").filter((line) => line.startsWith("--- FILE: ")).map((line) => line.split(" ")[2]), [
    "skills/openflirt/SKILL.md",
    "skills/openflirt/references/glossary.md",
    "skills/openflirt/references/part1.md",
    "skills/openflirt/references/part2.md",
  ]);
  assert.match(read(root, "llms.txt"), /\n- \[corpus\/SecondVideo\/transcript\.md\]\(https:\/\/raw\.githubusercontent\.com\/LilMGenius\/openflirt\/main\/corpus\/SecondVideo\/transcript\.md\): 「둘째 픽스처 강의」 전문/);
});

test("a principle file edited after generation makes llms-full.txt stale at the line that differs", (t) => {
  const root = fixtureRepo(t);
  edit(root, "skills/openflirt/references/part1.md", "말이 아니라 행동을 읽는다.", "말이 아니라 행동을 먼저 읽는다.");
  const lines = llmsLines(root);
  const at = read(root, "llms-full.txt").split("\n").indexOf("말이 아니라 행동을 읽는다.") + 1;
  assert.deepEqual(lines, ["FAIL llms-full.txt:" + at + " differs from what node scripts/llms.mjs builds from the files it indexes and carries; run node scripts/llms.mjs and commit the result"]);
});

test("node scripts/llms.mjs --check exits 1 naming the stale file and writes nothing", (t) => {
  const root = fixtureRepo(t);
  edit(root, "llms-full.txt", "# openflirt 전체", "# openflirt");
  const before = read(root, "llms-full.txt");
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "llms.mjs"), "--check", "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, "llms-full.txt is stale; run node scripts/llms.mjs\n");
  assert.equal(read(root, "llms-full.txt"), before);
});
