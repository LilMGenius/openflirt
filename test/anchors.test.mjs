import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAnchors } from "../scripts/lib/anchors.mjs";
import { edit, fixtureRepo, read, write } from "./fixture-repo.mjs";

test("links into references that name existing anchors pass, and code spans are ignored", (t) => {
  assert.deepEqual(checkAnchors(fixtureRepo(t)), []);
});

test("an AGENTS.md link to a missing anchor fails with line and column", (t) => {
  const root = fixtureRepo(t);
  edit(root, "AGENTS.md", "#action-first", "#action-last");
  const col = read(root, "AGENTS.md").split("\n")[2].indexOf("skills/") + 1;
  assert.deepEqual(checkAnchors(root).map((finding) => [finding.file, finding.line, finding.col]), [["AGENTS.md", 3, col]]);
});

test("a SKILL.md relative link to a missing file fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, "skills/openflirt/SKILL.md", "references/glossary.md", "references/terms.md");
  assert.deepEqual(checkAnchors(root).map((finding) => finding.file), ["skills/openflirt/SKILL.md"]);
});

test("an anchor id defined twice across reference files fails", (t) => {
  const root = fixtureRepo(t);
  write(root, "skills/openflirt/references/part2.md", '<a id="distance"></a>\n### 또\n> [02:00] 좋아할수록\n');
  assert.deepEqual(checkAnchors(root).map((finding) => [finding.file, finding.line]), [["skills/openflirt/references/part2.md", 1]]);
});
